import { chromium } from 'playwright-core';

const LIGHTPANDA_WS_URL = process.env.BROWSER_ADDRESS || 'ws://127.0.0.1:9222';
const VUFIND_BASE_URL = 'https://vufind.library.sh.cn';
/** 单页导航超时：检索页 + 详情页两步，需控制在前端 30s 总超时内 */
const PAGE_TIMEOUT_MS = 15_000;

export class VuFindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VuFindError';
  }
}

/** 浏览器上下文内的最小 DOM 结构类型（后端 tsconfig 无 DOM lib） */
interface EvalElement {
  querySelector(sel: string): EvalElement | null;
  querySelectorAll(sel: string): EvalElement[];
  textContent: string | null;
  getAttribute(name: string): string | null;
}

interface EvalDocument {
  querySelector(sel: string): EvalElement | null;
  querySelectorAll(sel: string): EvalElement[];
}

/** 单条复本的馆藏信息 */
export interface VuFindHoldingItem {
  callnumber: string;
  barcode: string;
  loanType: string;
  status: string;
}

/** 按馆藏地分组的复本列表 */
export interface VuFindHoldingGroup {
  location: string;
  items: VuFindHoldingItem[];
}

export interface VuFindRecord {
  /** 索书号（检索结果页即可取得，始终尽力返回） */
  callNumber: string;
  /** 图书详情页 URL（馆藏信息来源；仅索书号场景可能为空） */
  recordUrl: string;
  /** 馆藏分组列表；详情页无馆藏信息时为空数组（不算失败） */
  holdings: VuFindHoldingGroup[];
}

/** 从 vufind 检索结果 HTML 中提取索书号（中文页「索书号: K835.465.6/2212-11」或英文页「Call Number: ...」） */
function extractCallNumber(html: string): string {
  const match = html.match(/(?:索书号|Call Number)\s*[:：]\s*([^<\n]+)/);
  const value = match?.[1]?.trim() ?? '';
  if (!value) {
    throw new VuFindError('未找到索书号');
  }
  return value;
}

/**
 * 连接 Lightpanda 浏览器实例，两步抓取：
 * 1. 导航至 vufind 检索页，提取索书号 + 首条结果的详情页链接；
 * 2. 打开详情页，解析馆藏地 / 条码 / 借阅类型 / 状态。
 * 详情页无馆藏时不视为失败，返回仅含索书号的部分结果。
 * 若浏览器不可用，降级为 HTTP fetch 仅取索书号。
 */
export async function fetchVuFindRecord(isbn: string): Promise<VuFindRecord> {
  const url = `${VUFIND_BASE_URL}/Search/Results?searchtype=vague&lookfor=${encodeURIComponent(isbn)}&type=AllFields&limit=20`;

  try {
    return await fetchViaLightpanda(url);
  } catch (err) {
    // 索书号都没拿到（检索无结果等）才是真失败
    if (err instanceof VuFindError) throw err;
    const callNumber = await fetchCallNumberViaHttp(url);
    return { callNumber, recordUrl: '', holdings: [] };
  }
}

async function fetchViaLightpanda(searchUrl: string): Promise<VuFindRecord> {
  const browser = await chromium.connectOverCDP(LIGHTPANDA_WS_URL);
  try {
    const page = await browser.newPage();

    // 第一步：检索页 → 索书号 + 详情页链接
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
    const searchHtml = await page.content();
    const callNumber = extractCallNumber(searchHtml);

    const detailPath = await page.evaluate((): string => {
      const doc = (globalThis as unknown as { document?: EvalDocument }).document;
      return doc?.querySelector('a.title.getFull')?.getAttribute('href') ?? '';
    });

    let recordUrl = '';
    let holdings: VuFindHoldingGroup[] = [];
    if (detailPath) {
      recordUrl = detailPath.startsWith('http') ? detailPath : `${VUFIND_BASE_URL}${detailPath}`;
      try {
        await page.goto(recordUrl, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
        holdings = await parseHoldings(page);
      } catch {
        // 详情页打开失败或无馆藏：保留索书号部分结果，不整体报错
        holdings = [];
      }
    }

    return { callNumber, recordUrl, holdings };
  } finally {
    await browser.close();
  }
}

/** 解析详情页馆藏：按 .location-item 分组，桌面表格行去重（同页含移动端重复 DOM） */
async function parseHoldings(page: import('playwright-core').Page): Promise<VuFindHoldingGroup[]> {
  return page.evaluate((): VuFindHoldingGroup[] => {
    const doc = (globalThis as unknown as { document?: EvalDocument }).document;
    if (!doc) return [];
    const seenBarcodes = new Set<string>();
    const groups: VuFindHoldingGroup[] = [];

    doc.querySelectorAll('.branch .location-item').forEach((loc) => {
      const location = loc.querySelector('h3')?.textContent?.trim() ?? '';
      const items: VuFindHoldingItem[] = [];
      // 仅取桌面端表格行，避免移动端 div 布局的重复复本
      loc.querySelectorAll('.visible-lg-block tr[typeof="Offer"]').forEach((tr) => {
        const fieldText = (cls: string): string => {
          const el = tr.querySelector(`.holding-field.${cls}`);
          if (!el) return '';
          // 状态列内含隐藏的「预计归还时间」节点与脚本文本，只取首个可见状态标签
          const tag = el.querySelector('span.text-success, span.text-danger');
          if (tag) return tag.textContent?.trim() ?? '';
          return (
            (el.textContent ?? '')
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)[0] ?? ''
          );
        };
        const barcode = fieldText('barcode');
        if (!barcode || seenBarcodes.has(barcode)) return;
        seenBarcodes.add(barcode);
        items.push({
          callnumber: fieldText('callnumber'),
          barcode,
          loanType: fieldText('loanType'),
          status: fieldText('availability'),
        });
      });
      if (items.length > 0) groups.push({ location, items });
    });

    return groups;
  });
}

async function fetchViaHttp(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  const html = await res.text();
  return html;
}

/** HTTP 兜底：只能拿检索页静态 HTML 的索书号（馆藏为 AJAX 加载时拿不到，属已知限制） */
async function fetchCallNumberViaHttp(url: string): Promise<string> {
  const html = await fetchViaHttp(url);
  return extractCallNumber(html);
}

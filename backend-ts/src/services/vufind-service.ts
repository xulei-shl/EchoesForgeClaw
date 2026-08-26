import { chromium } from 'playwright-core';

const LIGHTPANDA_WS_URL = process.env.BROWSER_ADDRESS || 'ws://127.0.0.1:9222';
const VUFIND_BASE_URL = 'https://vufind.library.sh.cn';
/** 单页导航超时：检索页 + 详情页两步，需控制在前端 30s 总超时内 */
const PAGE_TIMEOUT_MS = 15_000;
/** 强制中文界面：Lightpanda 新会话默认按英文 locale 渲染，馆藏字段（借阅类型/状态）会返回英文 */
const VUFIND_LANG = 'zh-cn';

/** 给 vufind URL 追加中文语言参数（VuFind 标准语言切换机制） */
function withZhLang(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}lng=${VUFIND_LANG}`;
}

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

/** 检索结果页提取的书目信息（与索书号同源，无需二次请求） */
export interface VuFindBiblio {
  title: string;
  author: string;
  /** 其他责任者（译者等） */
  contributor: string;
  publisher: string;
  pubYear: string;
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
  /** 书目信息（检索页同步提取；缺失字段为空串） */
  bibliographic: VuFindBiblio;
  /** 图书详情页 URL（馆藏信息来源；仅索书号场景可能为空） */
  recordUrl: string;
  /** 馆藏分组列表；详情页无馆藏信息时为空数组（不算失败） */
  holdings: VuFindHoldingGroup[];
}

const EMPTY_BIBLIO: VuFindBiblio = { title: '', author: '', contributor: '', publisher: '', pubYear: '' };

/** 从 vufind 检索结果 HTML 中提取索书号（中文页「索书号: K835.465.6/2212-11」或英文页「Call Number: ...」） */
function extractCallNumber(html: string): string {
  const match = html.match(/(?:索书号|Call Number)\s*[:：]\s*([^<\n]+)/);
  const value = match?.[1]?.trim() ?? '';
  if (!value) {
    throw new VuFindError('未找到索书号');
  }
  return value;
}

/** 去标签、去实体、压缩空白 */
function stripHtmlTags(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从检索结果 HTML 提取首条结果的书目信息（纯字符串解析，DOM/HTTP 兑底路径均可用）。
 * 结构依据 vufind 检索项 result-body：a.title.getFull 为题名，各字段「label: value <br>」排列。
 */
export function extractBibliographic(html: string): VuFindBiblio {
  const title = stripHtmlTags(html.match(/class="title getFull"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '');
  // 著者等字段的值含嵌套标签（链接、角色标注），取标签后到 <br> 的片段再剥标签
  const labelValue = (...labels: string[]): string => {
    for (const label of labels) {
      const m = html.match(new RegExp(`${label}\\s*[:：]\\s*([\\s\\S]*?)<br`));
      if (!m) continue;
      const value = stripHtmlTags(m[1] ?? '');
      if (value) return value;
    }
    return '';
  };

  return {
    title,
    author: labelValue('著者', 'Author'),
    contributor: labelValue('其他责任者', 'Contributor(s)?'),
    publisher: labelValue('出版社', 'Publisher'),
    pubYear: labelValue('出版时间', 'Publication Year', 'Year'),
  };
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
    return { callNumber, bibliographic: EMPTY_BIBLIO, recordUrl: '', holdings: [] };
  }
}

async function fetchViaLightpanda(searchUrl: string): Promise<VuFindRecord> {
  const browser = await chromium.connectOverCDP(LIGHTPANDA_WS_URL);
  try {
    const page = await browser.newPage({
      extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });

    // 第一步：检索页 → 索书号 + 详情页链接
    await page.goto(withZhLang(searchUrl), { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
    const searchHtml = await page.content();
    const callNumber = extractCallNumber(searchHtml);
    const bibliographic = extractBibliographic(searchHtml);

    const detailPath = await page.evaluate((): string => {
      const doc = (globalThis as unknown as { document?: EvalDocument }).document;
      return doc?.querySelector('a.title.getFull')?.getAttribute('href') ?? '';
    });

    let recordUrl = '';
    let holdings: VuFindHoldingGroup[] = [];
    if (detailPath) {
      recordUrl = detailPath.startsWith('http') ? detailPath : `${VUFIND_BASE_URL}${detailPath}`;
      try {
        await page.goto(withZhLang(recordUrl), { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
        // Lightpanda 对 networkidle 支持有限，馆藏可能异步渲染：显式等待复本行出现
        await page
          .waitForSelector('.location-item tr[typeof="Offer"]', { timeout: 8_000 })
          .catch(() => {});
        const locationItemCount = await countLocationItems(page);
        holdings = await parseHoldingsViaDom(page);
        if (holdings.length === 0) {
          // DOM 解析为空（Lightpanda 选择器/evaluate 兼容性问题）→ 纯正则兑底解析 HTML
          console.warn(
            `[vufind] DOM 馆藏解析为空（location-item=${locationItemCount}），改用正则兑底: ${recordUrl}`
          );
          holdings = parseHoldingsFromHtml(await page.content());
        }
      } catch (err) {
        // 详情页打开失败或无馆藏：保留索书号部分结果，不整体报错
        console.warn(
          `[vufind] 详情页馆藏抓取失败（保留索书号部分结果）: ${err instanceof Error ? err.message : String(err)}`
        );
        holdings = [];
      }
    }

    return { callNumber, bibliographic, recordUrl, holdings };
  } finally {
    await browser.close();
  }
}

async function countLocationItems(page: import('playwright-core').Page): Promise<number> {
  try {
    return await page.evaluate((): number => {
      const doc = (globalThis as unknown as { document?: EvalDocument }).document;
      return doc ? doc.querySelectorAll('.branch .location-item').length : -1;
    });
  } catch {
    return -1;
  }
}

/** DOM 解析详情页馆藏：按 .location-item 分组，条码全局去重 */
async function parseHoldingsViaDom(page: import('playwright-core').Page): Promise<VuFindHoldingGroup[]> {
  return page.evaluate((): VuFindHoldingGroup[] => {
    const doc = (globalThis as unknown as { document?: EvalDocument }).document;
    if (!doc) return [];
    const seenBarcodes = new Set<string>();
    const groups: VuFindHoldingGroup[] = [];

    doc.querySelectorAll('.branch .location-item').forEach((loc) => {
      const location = loc.querySelector('h3')?.textContent?.trim() ?? '';
      const items: VuFindHoldingItem[] = [];
      // 移动端复本是 div.row 而非 tr，天然不会重复；条码去重再兕底
      loc.querySelectorAll('tr[typeof="Offer"]').forEach((tr) => {
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

/** 去除标签与实体，压缩空白后取首个非空行 */
function extractTextField(raw: string): string {
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return text ?? '';
}

/**
 * 正则兑底解析馆藏 HTML（不依赖浏览器 DOM 实现，用于 Lightpanda evaluate/选择器异常时）。
 * 结构依据 vufind 详情页：每个 <div class="location-item"> 块内含一个 h3 馆藏地标题，
 * 桌面端复本为 <tr typeof="Offer"> 行（移动端为 div.row，天然不会被匹配）。
 */
export function parseHoldingsFromHtml(html: string): VuFindHoldingGroup[] {
  const seenBarcodes = new Set<string>();
  const groups: VuFindHoldingGroup[] = [];

  const chunks = html.split('<div class="location-item').slice(1);
  for (const chunk of chunks) {
    const rawLocation = chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '';
    const location = extractTextField(rawLocation);
    const items: VuFindHoldingItem[] = [];

    const rowRe = /<tr[^>]*typeof="Offer"[^>]*>([\s\S]*?)<\/tr>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(chunk)) !== null) {
      const row = rowMatch[1] ?? '';
      const fieldRaw = (cls: string): string =>
        row.match(new RegExp(`<span class="holding-field ${cls}">([\\s\\S]*?)</span>`))?.[1] ?? '';

      // 状态列优先取可见的 text-success / text-danger 标签文本
      let status = '';
      const availRaw = fieldRaw('availability');
      const statusTag = availRaw.match(/<span class="text-(?:success|danger)">\s*([^<]*?)\s*</);
      if (statusTag?.[1] != null) {
        status = statusTag[1].trim();
      } else {
        status = extractTextField(availRaw);
      }

      const barcode = extractTextField(fieldRaw('barcode'));
      if (!barcode || seenBarcodes.has(barcode)) continue;
      seenBarcodes.add(barcode);
      items.push({
        callnumber: extractTextField(fieldRaw('callnumber')),
        barcode,
        loanType: extractTextField(fieldRaw('loanType')),
        status,
      });
    }
    if (items.length > 0) groups.push({ location, items });
  }

  return groups;
}

async function fetchViaHttp(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9',
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

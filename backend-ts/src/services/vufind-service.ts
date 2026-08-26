import { chromium } from 'playwright-core';

const LIGHTPANDA_WS_URL = process.env.BROWSER_ADDRESS || 'ws://127.0.0.1:9222';

export class VuFindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VuFindError';
  }
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
 * 连接 Lightpanda 浏览器实例，导航至 vufind 检索页，提取索书号。
 * 若浏览器不可用，降级为 HTTP fetch 直接解析 HTML。
 */
export async function fetchCallNumber(isbn: string): Promise<string> {
  const url = `https://vufind.library.sh.cn/Search/Results?searchtype=vague&lookfor=${encodeURIComponent(isbn)}&type=AllFields&limit=20`;

  try {
    return await fetchViaLightpanda(url);
  } catch {
    return await fetchViaHttp(url);
  }
}

async function fetchViaLightpanda(url: string): Promise<string> {
  const browser = await chromium.connectOverCDP(LIGHTPANDA_WS_URL);
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const html = await page.content();
    return extractCallNumber(html);
  } finally {
    await browser.close();
  }
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
  return extractCallNumber(html);
}
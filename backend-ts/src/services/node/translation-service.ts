import { fetchWithProxy } from '../platform/http-proxy.js';

/** 本地地址不经过代理，避免代理不可达时挂死或干扰本地服务（如 localhost 的 DeepLX） */
function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0' || u.hostname === '::1';
  } catch {
    return false;
  }
}

export class TranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslationError';
  }
}

const TRANSLATION_TIMEOUT_MS = 15_000;

const GOOGLE_LAN_MAP: Record<string, string> = {
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  auto: 'auto',
};

const DEEPLX_LAN_MAP: Record<string, string> = {
  auto: '',
  'zh-Hans': 'ZH',
  'zh-Hant': 'ZH',
  en: 'EN',
  'en-Gb': 'EN-GB',
  'en-Us': 'EN-US',
  ja: 'JA',
  ko: 'KO',
  fr: 'FR',
  es: 'ES',
  pt: 'PT',
  'pt-Br': 'PT-BR',
  'pt-Pt': 'PT-PT',
  de: 'DE',
  it: 'IT',
  ru: 'RU',
  ar: 'AR',
  tr: 'TR',
  nl: 'NL',
  pl: 'PL',
  sv: 'SV',
  da: 'DA',
  fi: 'FI',
  cs: 'CS',
  ro: 'RO',
  hu: 'HU',
  el: 'EL',
  id: 'ID',
  vi: 'VI',
  th: 'TH',
  uk: 'UK',
  bg: 'BG',
  et: 'ET',
  lt: 'LT',
  lv: 'LV',
  sl: 'SL',
  sk: 'SK',
  hr: 'HR',
  nb: 'NB',
  no: 'NB',
};

const TRANSLATION_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}

async function translateGoogle(
  text: string,
  from: string,
  to: string,
  proxy?: string,
): Promise<string> {
  const sl = GOOGLE_LAN_MAP[from] ?? from;
  const tl = GOOGLE_LAN_MAP[to] ?? to;
  const url = new URL('https://translate.google.com/m');
  url.searchParams.set('sl', sl);
  url.searchParams.set('tl', tl);
  url.searchParams.set('hl', tl);
  url.searchParams.set('q', text);

  const urlStr = url.toString();
  const effectiveProxy = proxy && !isLocalUrl(urlStr) ? proxy : '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);
  try {
    const res = await fetchWithProxy(urlStr, {
      method: 'GET',
      headers: {
        'User-Agent': TRANSLATION_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    }, effectiveProxy);
    if (!res.ok) {
      throw new TranslationError(`Google Translate HTTP ${res.status}`);
    }
    const html = await res.text();
    const match = html.match(/class="result-container">(.*?)<\/div>/s) || html.match(/class="t0">(.*?)<\/div>/s);
    if (!match || !match[1]) {
      throw new TranslationError('Google Translate: unexpected response format');
    }
    return decodeHtmlEntities(match[1]);
  } finally {
    clearTimeout(timer);
  }
}

async function translateDeepLX(
  text: string,
  from: string,
  to: string,
  deeplxUrl: string,
  proxy?: string,
): Promise<string> {
  const sourceLang = DEEPLX_LAN_MAP[from] ?? from.toUpperCase();
  const targetLang = DEEPLX_LAN_MAP[to] ?? to.toUpperCase();
  const effectiveProxy = proxy && !isLocalUrl(deeplxUrl) ? proxy : '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);
  try {
    const res = await fetchWithProxy(deeplxUrl, {
      method: 'POST',
      body: JSON.stringify({
        source_lang: sourceLang,
        target_lang: targetLang,
        text: text,
      }),
      signal: controller.signal,
    }, effectiveProxy);
    if (!res.ok) {
      throw new TranslationError(`DeepLX HTTP ${res.status}`);
    }
    const t = await res.json() as Record<string, unknown>;
    if (t.translations) {
      return (t.translations as Array<{ text: string }>).map((x) => x.text).join('\n');
    }
    if (t.data) {
      return typeof t.data === 'string' ? t.data : (t.data as string[]).join('\n');
    }
    throw new TranslationError(`DeepLX: unexpected response ${JSON.stringify(t)}`);
  } finally {
    clearTimeout(timer);
  }
}

export type TranslationSource = 'random' | 'google' | 'deeplx';

export interface TranslationOptions {
  text: string;
  from: string;
  to: string;
  source: TranslationSource;
  deeplxUrl?: string;
  /** 全局兜底代理 URL */
  proxy?: string;
  /** 各翻译源独立代理配置（如 google: 'http://...', deeplx: ''） */
  proxies?: Partial<Record<TranslationSource, string>>;
}

export async function translateText(opts: TranslationOptions): Promise<{ output: string; source: string }> {
  const { text, from, to, source, deeplxUrl, proxy, proxies } = opts;
  if (!text.trim()) return { output: '', source: 'none' };

  const hasDeepLX = !!deeplxUrl?.trim();
  const availableSources: TranslationSource[] = ['google'];
  if (hasDeepLX) availableSources.push('deeplx');

  const trySource = async (src: TranslationSource): Promise<{ output: string; source: string }> => {
    const effectiveProxy = proxies?.[src] ?? proxy ?? '';
    if (src === 'google') {
      const output = await translateGoogle(text, from, to, effectiveProxy);
      return { output, source: 'google' };
    }
    if (src === 'deeplx' && deeplxUrl?.trim()) {
      const output = await translateDeepLX(text, from, to, deeplxUrl.trim(), effectiveProxy);
      return { output, source: 'deeplx' };
    }
    throw new TranslationError(`翻译源 ${src} 不可用`);
  };

  if (source !== 'random') {
    return trySource(source);
  }

  const shuffled = [...availableSources].sort(() => Math.random() - 0.5);
  let lastError: Error | null = null;
  for (const src of shuffled) {
    try {
      return await trySource(src);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError || new TranslationError('所有翻译源均失败');
}

export const COMMON_LANGUAGES = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'zh-Hant', label: '繁体中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'fr', label: '法语' },
  { value: 'es', label: '西班牙语' },
  { value: 'pt', label: '葡萄牙语' },
  { value: 'de', label: '德语' },
  { value: 'it', label: '意大利语' },
  { value: 'ru', label: '俄语' },
  { value: 'ar', label: '阿拉伯语' },
  { value: 'tr', label: '土耳其语' },
  { value: 'nl', label: '荷兰语' },
  { value: 'pl', label: '波兰语' },
  { value: 'sv', label: '瑞典语' },
  { value: 'da', label: '丹麦语' },
  { value: 'fi', label: '芬兰语' },
  { value: 'cs', label: '捷克语' },
  { value: 'ro', label: '罗马尼亚语' },
  { value: 'hu', label: '匈牙利语' },
  { value: 'el', label: '希腊语' },
  { value: 'id', label: '印尼语' },
  { value: 'vi', label: '越南语' },
  { value: 'th', label: '泰语' },
  { value: 'uk', label: '乌克兰语' },
  { value: 'bg', label: '保加利亚语' },
  { value: 'et', label: '爱沙尼亚语' },
  { value: 'lt', label: '立陶宛语' },
  { value: 'lv', label: '拉脱维亚语' },
  { value: 'sl', label: '斯洛文尼亚语' },
  { value: 'sk', label: '斯洛伐克语' },
  { value: 'hr', label: '克罗地亚语' },
  { value: 'nb', label: '挪威语' },
  { value: 'no', label: '挪威语' },
];
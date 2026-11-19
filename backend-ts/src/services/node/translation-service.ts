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

async function translateGoogle(
  text: string,
  from: string,
  to: string,
  proxy?: string,
): Promise<string> {
  const sl = GOOGLE_LAN_MAP[from] ?? from;
  const tl = GOOGLE_LAN_MAP[to] ?? to;
  // 免费 JSON 接口（client=gtx），比抓取 /m 页面稳定：无需解析 HTML 与实体
  const url = new URL('https://translate.google.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', sl);
  url.searchParams.set('tl', tl);
  url.searchParams.set('hl', tl);
  url.searchParams.set('dt', 't');
  url.searchParams.set('ie', 'UTF-8');
  url.searchParams.set('oe', 'UTF-8');
  url.searchParams.set('otf', '1');
  url.searchParams.set('ssel', '0');
  url.searchParams.set('tsel', '0');
  url.searchParams.set('kc', '7');
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
        'Accept': 'application/json,text/plain,*/*',
      },
      signal: controller.signal,
    }, effectiveProxy);
    if (!res.ok) {
      // 带上响应体片段（Google 反爬时是 "Sorry..." 页面），便于区分限流与参数错误
      const body = await res.text().catch(() => '');
      const detail = body ? `: ${body.replace(/\s+/g, ' ').slice(0, 200)}` : '';
      throw new TranslationError(`Google Translate HTTP ${res.status}${detail}`);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new TranslationError('Google Translate: unexpected response format');
    }
    // 响应形如 [[["译文片段","原文片段",...],...], null, "en", ...]
    const segments = Array.isArray(data) ? data[0] : undefined;
    if (!Array.isArray(segments)) {
      throw new TranslationError('Google Translate: unexpected response format');
    }
    const output = segments
      .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
      .join('');
    if (!output) {
      throw new TranslationError('Google Translate: empty translation');
    }
    return output;
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

const BILIBILI_LAN_MAP: Record<string, string> = {
  'zh-hans': '中文',
  'zh-hant': '中文',
  zh: '中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  es: '西班牙语',
  pt: '葡萄牙语',
  de: '德语',
  it: '意大利语',
  ru: '俄语',
  ar: '阿拉伯语',
  tr: '土耳其语',
  nl: '荷兰语',
  pl: '波兰语',
  sv: '瑞典语',
  da: '丹麦语',
  fi: '芬兰语',
  cs: '捷克语',
  ro: '罗马尼亚语',
  hu: '匈牙利语',
  el: '希腊语',
  id: '印尼语',
  vi: '越南语',
  th: '泰语',
  uk: '乌克兰语',
  bg: '保加利亚语',
  et: '爱沙尼亚语',
  lt: '立陶宛语',
  lv: '拉脱维亚语',
  sl: '斯洛文尼亚语',
  sk: '斯洛伐克语',
  hr: '克罗地亚语',
  nb: '挪威语',
  no: '挪威语',
};

function stripThink(text: string): string {
  if (text.includes('</think>')) {
    text = text.split('</think>', 2)[1] ?? '';
  }
  return text.replace(/^<think>/, '').trim();
}

export interface BilibiliTranslateConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  proxy?: string;
}

async function translateBilibili(
  text: string,
  from: string,
  to: string,
  config?: BilibiliTranslateConfig,
): Promise<string> {
  const baseUrl = (config?.baseUrl?.trim() || 'https://index-translate.bilibili.com/v1').replace(/\/+$/, '');
  const model = config?.model?.trim() || 'Index-Translate-35B-A3B';
  const apiKey = config?.apiKey?.trim() || '';
  const proxy = config?.proxy?.trim() || '';

  const tgtName = BILIBILI_LAN_MAP[to.toLowerCase()] ?? to;
  const hasSource = from && from.toLowerCase() !== 'auto';
  const srcName = hasSource ? (BILIBILI_LAN_MAP[from.toLowerCase()] ?? from) : '';

  const prompt = srcName
    ? `请将以下${srcName}文本翻译为${tgtName}，直接输出翻译结果，不要进行任何解释。\n\n${text.trim()}`
    : `请将以下文本翻译为${tgtName}，直接输出翻译结果，不要进行任何解释。\n\n${text.trim()}`;

  const url = `${baseUrl}/chat/completions`;
  const effectiveProxy = proxy && !isLocalUrl(url) ? proxy : '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Index-Translate-Client/1.0',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const payload = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.0,
    max_tokens: 2048,
    stream: false,
    chat_template_kwargs: { enable_thinking: false },
  };

  try {
    const res = await fetchWithProxy(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
      effectiveProxy
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const detail = body ? `: ${body.slice(0, 200)}` : '';
      throw new TranslationError(`哔哩翻译 HTTP ${res.status}${detail}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
    const content = choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new TranslationError(`哔哩翻译响应格式错误: ${JSON.stringify(data).slice(0, 200)}`);
    }

    const output = stripThink(content);
    if (!output) {
      throw new TranslationError('哔哩翻译结果为空');
    }
    return output;
  } finally {
    clearTimeout(timer);
  }
}

export type TranslationSource = 'bilibili' | 'random' | 'google' | 'deeplx';

export interface TranslationOptions {
  text: string;
  from: string;
  to: string;
  source?: TranslationSource | string;
  deeplxUrl?: string;
  bilibiliBaseUrl?: string;
  bilibiliApiKey?: string;
  bilibiliModel?: string;
  /** 全局兜底代理 URL */
  proxy?: string;
  /** 各翻译源独立代理配置（如 bilibili: 'http://...', google: 'http://...', deeplx: ''） */
  proxies?: Partial<Record<TranslationSource, string>>;
}

export async function translateText(opts: TranslationOptions): Promise<{ output: string; source: string }> {
  const {
    text,
    from,
    to,
    deeplxUrl,
    bilibiliBaseUrl,
    bilibiliApiKey,
    bilibiliModel,
    proxy,
    proxies,
  } = opts;
  if (!text.trim()) return { output: '', source: 'none' };

  // 当前默认且统一执行哔哩翻译 (Index-Translate)
  const effectiveProxy = proxies?.bilibili ?? proxy ?? '';
  const output = await translateBilibili(text, from, to, {
    baseUrl: bilibiliBaseUrl,
    apiKey: bilibiliApiKey,
    model: bilibiliModel,
    proxy: effectiveProxy,
  });
  return { output, source: 'bilibili' };

  /*
  // =========================================================================
  // 【备用历史逻辑】原 Google 翻译与 DeepLX 多引擎翻译（保留逻辑以备后续重新接入）
  // =========================================================================
  const hasDeepLX = !!deeplxUrl?.trim();
  const availableSources: TranslationSource[] = ['google'];
  if (hasDeepLX) availableSources.push('deeplx');

  const trySource = async (src: TranslationSource): Promise<{ output: string; source: string }> => {
    const p = proxies?.[src] ?? proxy ?? '';
    if (src === 'google') {
      const out = await translateGoogle(text, from, to, p);
      return { output: out, source: 'google' };
    }
    if (src === 'deeplx' && deeplxUrl?.trim()) {
      const out = await translateDeepLX(text, from, to, deeplxUrl.trim(), p);
      return { output: out, source: 'deeplx' };
    }
    throw new TranslationError(`翻译源 ${src} 不可用`);
  };

  if (opts.source !== 'random') {
    return trySource(opts.source as TranslationSource);
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
  // =========================================================================
  */
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
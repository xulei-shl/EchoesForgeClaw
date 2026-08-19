const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const EXA_SEARCH_URL = 'https://api.exa.ai/search';
const ANYSEARCH_SEARCH_URL = 'https://api.anysearch.com/v1/search';
const DOUBAO_SEARCH_URL = 'https://open.feedcoopapi.com/search_api/web_search';

const TOOL_REQUEST_TIMEOUT_MS = 15_000;

export class WebSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebSearchError';
  }
}

export type WebSearchSource = 'zhihu_global' | 'tavily' | 'exa' | 'anysearch' | 'doubao';

export interface WebSearchResult {
  output: string;
  source: WebSearchSource;
  query: string;
}

interface TavilyResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
  answer?: string;
}

interface ExaResponse {
  results?: Array<{
    title?: string;
    url?: string;
    text?: string;
  }>;
}

interface AnySearchResponse {
  code: number;
  message: string;
  request_id?: string;
  data?: {
    results?: Array<{
      title?: string;
      url?: string;
      snippet?: string;
      content?: string;
    }>;
    metadata?: {
      total_results: number;
      search_time_ms: number;
    };
  };
}

interface DoubaoResponse {
  ResponseMetadata: {
    RequestId: string;
    Error?: {
      Code: number | string;
      Message: string;
    };
  };
  Result?: {
    ResultCount: number;
    WebResults?: Array<{
      Id: string;
      Title: string;
      Url?: string;
      Snippet?: string;
      Summary?: string;
      Content?: string;
      SiteName?: string;
    }>;
    TimeCost: number;
    LogId: string;
  };
}

function formatResults(source: string, query: string, items: { title?: string; url?: string; snippet?: string }[]): string {
  const lines = [`# ${source} · ${query}`];
  if (items.length === 0) {
    lines.push('', '> 未找到相关内容，换个关键词试试');
    return lines.join('\n');
  }
  for (const item of items) {
    const t = (item.title ?? '').trim();
    const url = (item.url ?? '').trim();
    const snippet = (item.snippet ?? '').trim();
    lines.push('', url && t ? `### [${t}](${url})` : t ? `### ${t}` : '### 未命名结果');
    if (snippet) lines.push('', snippet);
    lines.push('', '---');
  }
  return lines.join('\n');
}

export async function searchTavily(apiKey: string, query: string, count: number): Promise<WebSearchResult> {
  const q = query.trim();
  if (!q) throw new WebSearchError('检索关键词不能为空');
  const c = Math.max(1, Math.min(Math.trunc(count) || 5, 20));
  const res = await fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query: q, max_results: c, include_answer: false }),
    signal: AbortSignal.timeout(TOOL_REQUEST_TIMEOUT_MS),
  });
  let body: any;
  try {
    body = await res.json() as TavilyResponse;
  } catch {
    throw new WebSearchError('Tavily 搜索返回了无法解析的内容');
  }
  if (!res.ok) {
    const errDetail = body?.detail?.error || body?.detail || body?.message || `Tavily 搜索失败（HTTP ${res.status}）`;
    throw new WebSearchError(typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail));
  }
  const items = (body.results ?? []).map((r: { title?: string; url?: string; content?: string }) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
  return { output: formatResults('Tavily 搜索', q, items), source: 'tavily', query: q };
}

export async function searchExa(apiKey: string, query: string, count: number): Promise<WebSearchResult> {
  const q = query.trim();
  if (!q) throw new WebSearchError('检索关键词不能为空');
  const c = Math.max(1, Math.min(Math.trunc(count) || 5, 20));
  const res = await fetch(EXA_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query: q, num_results: c, contents: { text: true } }),
    signal: AbortSignal.timeout(TOOL_REQUEST_TIMEOUT_MS),
  });
  let body: any;
  try {
    body = await res.json() as ExaResponse;
  } catch {
    throw new WebSearchError('Exa 搜索返回了无法解析的内容');
  }
  if (!res.ok) {
    const errDetail = body?.error?.message || body?.detail || body?.message || `Exa 搜索失败（HTTP ${res.status}）`;
    throw new WebSearchError(typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail));
  }
  const items = (body.results ?? []).map((r: { title?: string; url?: string; text?: string }) => ({
    title: r.title,
    url: r.url,
    snippet: r.text,
  }));
  return { output: formatResults('Exa 搜索', q, items), source: 'exa', query: q };
}

export async function searchAnySearch(apiKey: string, query: string, count: number): Promise<WebSearchResult> {
  const q = query.trim();
  if (!q) throw new WebSearchError('检索关键词不能为空');
  const c = Math.max(1, Math.min(Math.trunc(count) || 5, 20));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  const res = await fetch(ANYSEARCH_SEARCH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: q, max_results: c }),
    signal: AbortSignal.timeout(TOOL_REQUEST_TIMEOUT_MS),
  });
  let body: any;
  try {
    body = await res.json() as AnySearchResponse;
  } catch {
    throw new WebSearchError('AnySearch 搜索返回了无法解析的内容');
  }
  if (body.code !== 0) {
    const errMsg = body.message || `AnySearch 搜索失败（HTTP ${res.status}）`;
    throw new WebSearchError(errMsg);
  }
  if (!res.ok) {
    const errDetail = body?.message || `AnySearch 搜索失败（HTTP ${res.status}）`;
    throw new WebSearchError(typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail));
  }
  const items = (body.data?.results ?? []).map((r: { title?: string; url?: string; snippet?: string }) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
  }));
  return { output: formatResults('AnySearch 搜索', q, items), source: 'anysearch', query: q };
}

export async function searchDoubao(apiKey: string, query: string, count: number): Promise<WebSearchResult> {
  const q = query.trim();
  if (!q) throw new WebSearchError('检索关键词不能为空');
  const c = Math.max(1, Math.min(Math.trunc(count) || 5, 50));
  const res = await fetch(DOUBAO_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ Query: q, SearchType: 'web', Count: c }),
    signal: AbortSignal.timeout(TOOL_REQUEST_TIMEOUT_MS),
  });
  let body: any;
  try {
    body = await res.json() as DoubaoResponse;
  } catch {
    throw new WebSearchError('豆包搜索返回了无法解析的内容');
  }
  if (body.ResponseMetadata?.Error) {
    const err = body.ResponseMetadata.Error;
    throw new WebSearchError(`豆包搜索失败（${err.Code}）：${err.Message}`);
  }
  if (!res.ok) {
    const errDetail = body?.ResponseMetadata?.Error?.Message || `豆包搜索失败（HTTP ${res.status}）`;
    throw new WebSearchError(typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail));
  }
  const items = (body.Result?.WebResults ?? []).map((r: { Title: string; Url?: string; Summary?: string; Snippet?: string }) => ({
    title: r.Title,
    url: r.Url,
    snippet: r.Summary || r.Snippet,
  }));
  return { output: formatResults('豆包搜索', q, items), source: 'doubao', query: q };
}
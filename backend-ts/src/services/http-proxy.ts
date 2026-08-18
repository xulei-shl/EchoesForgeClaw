import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProxyAgent } from 'undici';

/**
 * HTTP 传输工具（undici ProxyAgent + curl 回退）。
 *
 * Node 原生 `fetch`（undici）无内置代理支持，需要代理出网的请求（如 GLAM 的 LoC
 * 检索与 tile.loc.gov 图片下载）通过 undici `ProxyAgent` 注入 `dispatcher` 实现；
 * 代理 URL 为空 = 直连（返回 undefined，保持现有行为不变）。
 *
 * 注意：HTTP CONNECT 代理只是字节转发，**不改变客户端 TLS 指纹**。LoC 的
 * Cloudflare 反爬会按 TLS 指纹识别 undici（实测返回 403 + "Just a moment" challenge），
 * 代理出口也未必放行；因此提供 `curlFetch`（curl 的 TLS 指纹可正常通过）作为回退传输。
 */

/** 各代理 URL 对应的 ProxyAgent 缓存（连接池按代理复用，避免每次请求新建）。 */
const agents = new Map<string, ProxyAgent>();

/** 返回指定 HTTP 代理的 undici dispatcher；proxy 为空返回 undefined（直连）。 */
export function proxyDispatcher(proxy: string): ProxyAgent | undefined {
  const p = proxy.trim();
  if (!p) return undefined;
  let agent = agents.get(p);
  if (!agent) {
    agent = new ProxyAgent(p);
    agents.set(p, agent);
  }
  return agent;
}

/** 带可选代理的 fetch（代理为空时与原生 fetch 行为一致）。 */
export async function fetchWithProxy(
  url: string,
  init: RequestInit,
  proxy: string
): Promise<Response> {
  const dispatcher = proxyDispatcher(proxy);
  // undici 扩展：fetch 的 init 支持 dispatcher（Node 全局 fetch 透传），
  // 类型上不属于标准 RequestInit，这里显式并入
  const opts = dispatcher ? { ...init, dispatcher } : init;
  return fetch(url, opts as RequestInit & { dispatcher?: unknown });
}

export interface CurlFetchResult {
  status: number;
  contentType: string;
  body: Uint8Array;
}

/**
 * 用 curl 子进程发起 GET 请求（跟随重定向）。
 * TLS 指纹与 undici 不同，用于规避 Cloudflare 对 undici 的反爬 challenge；
 * 失败（网络不通 / curl 不存在）时抛出 Error，HTTP 错误码通过返回值暴露。
 */
export async function curlFetch(
  url: string,
  opts: { proxy?: string; timeoutMs?: number; userAgent?: string } = {}
): Promise<CurlFetchResult> {
  const tmp = path.join(tmpdir(), `bookforge-curl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const args = [
    '-sS',
    '-L',
    '--max-time',
    String(Math.max(5, Math.ceil((opts.timeoutMs ?? 30_000) / 1000))),
    '-o',
    tmp,
    '-w',
    '%{http_code} %{content_type}',
  ];
  if (opts.proxy) args.push('--proxy', opts.proxy);
  if (opts.userAgent) args.push('-A', opts.userAgent);
  args.push(url);
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile('curl', args, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout.trim()) {
          reject(new Error(`curl 请求失败: ${err.message}`));
          return;
        }
        resolve({ stdout });
      });
    });
    const [statusStr = '', contentType = ''] = stdout.trim().split(/\s+/, 2);
    const status = Number(statusStr) || 0;
    const bytes = existsSync(tmp) ? readFileSync(tmp) : Buffer.alloc(0);
    return { status, contentType: contentType.trim(), body: new Uint8Array(bytes) };
  } finally {
    rmSync(tmp, { force: true });
  }
}

import type { ConnectOverCDPTransport } from 'playwright-core';
import { WebSocket } from 'undici';
import { proxyDispatcher } from './http-proxy.js';

/**
 * CDP WebSocket over HTTP 代理（undici ProxyAgent CONNECT 隧道）。
 *
 * 为什么需要自建传输：`chromium.connectOverCDP(endpointURL)` 没有 proxy 选项，Playwright 也不读
 * `HTTP(S)_PROXY` 环境变量，因此需要代理出网时（如云端 Lightpanda 的 wss:// 端点）只能自建
 * WebSocket，再按 Playwright 的 `ConnectOverCDPTransport` 契约（send/close + onmessage/onclose，
 * 消息为已解析的 JSON 对象）交给 `connectOverCDP(transport)`。
 *
 * 注意：日志与错误信息一律不带完整 URL（云端地址 query 里含 token），仅保留主机名与路径。
 */

/** 去敏后的端点展示串：丢弃 userinfo 与 query（token 等凭据），仅保留主路径 */
export function safeWsLabel(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '(非法地址)';
  }
}

function waitForOpen(ws: WebSocket, timeoutMs: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`连接 ${label} 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    ws.addEventListener('open', () => finish(), { once: true });
    ws.addEventListener('error', (event) => {
      const message = (event as unknown as { message?: string; error?: { message?: string } }).message
        ?? (event as { error?: { message?: string } }).error?.message
        ?? '未知错误';
      finish(new Error(`连接 ${label} 失败: ${message}`));
    });
    ws.addEventListener('close', (event) => finish(new Error(`连接 ${label} 被关闭: ${event.reason || '无原因'}`)));
  });
}

/** 文本帧解码：CDP 只用文本帧，二进制帧尽力按 UTF-8 解出（异常帧返回空串） */
function frameText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  return '';
}

/**
 * 建立经 HTTP 代理的 CDP 连接，返回可直接传给 `chromium.connectOverCDP(transport)` 的传输对象。
 * 返回前等待 WebSocket 进入 OPEN（undici 未 OPEN 时 send 会抛错，而 Playwright 拿到传输后会立即发送 CDP 命令）。
 */
export async function connectCdpOverProxy(
  wsUrl: string,
  proxy: string,
  timeoutMs = 15_000
): Promise<ConnectOverCDPTransport> {
  const label = safeWsLabel(wsUrl);
  const ws = new WebSocket(wsUrl, { dispatcher: proxyDispatcher(proxy) });
  await waitForOpen(ws, timeoutMs, label);

  const transport: ConnectOverCDPTransport = {
    send(message: object): void {
      ws.send(JSON.stringify(message));
    },
    close(): void {
      try {
        ws.close();
      } catch {
        /* 已关闭：忽略 */
      }
    },
  };

  ws.addEventListener('message', (event) => {
    const raw = frameText(event.data);
    if (!raw) return;
    let parsed: object;
    try {
      parsed = JSON.parse(raw) as object;
    } catch {
      // 非 JSON 帧（协议异常）直接断开，交由 Playwright 走 onclose 收尾
      console.warn(`[cdp] ${label} 收到非 JSON 帧，关闭连接`);
      ws.close();
      return;
    }
    transport.onmessage?.(parsed);
  });
  ws.addEventListener('close', (event) => transport.onclose?.(event.reason));
  ws.addEventListener('error', (event) => {
    // 错误详情由随后的 close 事件收敛，这里只在控制台留痕（不含凭据）
    const message = (event as unknown as { message?: string }).message ?? 'unknown';
    console.warn(`[cdp] ${label} WebSocket 错误: ${message}`);
  });

  return transport;
}

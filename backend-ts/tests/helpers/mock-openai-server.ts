import { createServer, type Server } from 'node:http';

/**
 * 本地 OpenAI 兼容 mock 端点（对应 Python 契约测试里的 ThreadingHTTPServer）。
 *
 * 用真实 HTTP + SSE 协议喂给 AI SDK provider（baseURL 指向本服务器），
 * 不 mock AI SDK 内部，验证真实请求/响应路径。
 */

export interface MockRequest {
  path: string;
  body: any;
}

export interface MockOpenAIServer {
  port: number;
  /** provider baseURL（含 /v1，OpenAI 兼容端点用）。 */
  baseURL: string;
  /** 根地址（不含 /v1，FastClaw 等自定义路径端点用）。 */
  rootURL: string;
  /** 收到的所有请求（按顺序）。 */
  requests: MockRequest[];
  close: () => Promise<void>;
}

/** 构造 SSE data 块（JSON）。 */
export function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** 原始（非 JSON）响应：{ raw } 字节 + 可选 contentType / 状态码。 */
export interface RawMockResponse {
  raw: string | Buffer;
  contentType?: string;
  status?: number;
}

type RespondResult = string | RawMockResponse | void;

/**
 * 启动 mock 服务器。
 * @param respond (req, send) => string | RawMockResponse | void：每收到一个请求调用一次；
 *   - 返回字符串：作为纯 JSON 响应体直接返回（图像等非 SSE 端点）；
 *   - 返回 { raw, contentType? }：作为原始字节返回（如 zip 下载）；
 *   - 返回 undefined：用 send(chunk) 写 SSE data 块，结束时自动补 data: [DONE]。
 */
export function startMockOpenAIServer(
  respond: (req: MockRequest, send: (chunk: string) => void) => RespondResult
): Promise<MockOpenAIServer> {
  const requests: MockRequest[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf-8')));
    req.on('end', () => {
      let body: any = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { __raw: raw };
      }
      const url = new URL(req.url ?? '/', 'http://mock.local');
      requests.push({ path: url.pathname, body });
      // 先收集响应（send() 缓冲到 chunks），respond 返回后再统一 writeHead + 写入，
      // 避免先 write 导致隐式发送头部后 writeHead 抛 ERR_HTTP_HEADERS_SENT
      const chunks: string[] = [];
      const plain = respond(
        { path: url.pathname, body },
        (chunk) => chunks.push(chunk)
      );
      if (typeof plain === 'string') {
        // 纯 JSON 响应（非 SSE）：图像等端点
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(plain);
        return;
      }
      if (plain && typeof plain === 'object' && 'raw' in plain) {
        // 原始字节响应（zip 下载等），可自定义状态码（如 Bifrost 404）
        const { raw, contentType, status } = plain as RawMockResponse;
        res.writeHead(status ?? 200, { 'Content-Type': contentType ?? 'application/octet-stream' });
        res.end(raw);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.end(chunks.join('') + 'data: [DONE]\n\n');
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({
        port,
        baseURL: `http://127.0.0.1:${port}/v1`,
        rootURL: `http://127.0.0.1:${port}`,
        requests,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

/**
 * AI SDK UI Message Stream 的轻量前端消费（analyze-image / generate-prompt / generate-image(agent)）。
 *
 * 后端这些端点输出 AI SDK Data Stream（每行 `data: {chunk-json}`，`[DONE]` 收尾），
 * 与旧 `postSSEStream`（`event:`/`data:`）的线格式不同。此模块把新格式解析后
 * 按回调分发给既有消费方，保持各节点执行逻辑（内容增量 / agent 步骤 / 错误）不变。
 *
 * | chunk 类型        | 回调                        |
 * | ----------------- | --------------------------- |
 * | text-delta        | onTextDelta（正文增量）     |
 * | text-end          | onStreamEnd（完整正文收尾） |
 * | data-<name>       | onData（agent_* 自定义 part，name 已去 data- 前缀） |
 * | error             | onError                     |
 */

export interface PostUIStreamOptions {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  /** 正文增量（text-delta），generate-prompt 逐段追加 */
  onTextDelta?: (delta: string) => void;
  /** 正文流式收尾（text-end），携带该条消息的完整文本 */
  onStreamEnd?: (text: string) => void;
  /** 自定义 data part（agent_tool_call / agent_tool_result / agent_status / agent_file / agent_image） */
  onData?: (name: string, data: unknown) => void;
  /** 流内错误（error chunk，消息已为人类可读文案） */
  onError?: (message: string) => void;
}

/** 401 统一处理：清除本地凭据并跳转登录（与 postSSEStream 行为一致）。 */
function handleUnauthorized(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (window.location.pathname !== '/login') {
    sessionStorage.setItem(
      'redirectAfterLogin',
      window.location.pathname + window.location.search
    );
    window.location.href = '/login';
  }
}

export async function postUIStream({
  url,
  body,
  signal,
  onTextDelta,
  onStreamEnd,
  onData,
  onError,
}: PostUIStreamOptions): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (response.status === 401) {
    handleUnauthorized();
    throw new Error('登录已过期，请重新登录');
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `请求失败: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      // 行缓冲：以 \n 切分，最后一段可能是不完整行，留待下次拼接
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let chunk: { type?: string; delta?: string; errorText?: string; data?: unknown };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue; // 非 JSON 行（如心跳）忽略
        }
        if (!chunk || typeof chunk.type !== 'string') continue;
        switch (chunk.type) {
          case 'text-start':
            text = '';
            break;
          case 'text-delta':
            if (typeof chunk.delta === 'string' && chunk.delta) {
              text += chunk.delta;
              onTextDelta?.(chunk.delta);
            }
            break;
          case 'text-end':
            onStreamEnd?.(text);
            break;
          case 'error':
            if (typeof chunk.errorText === 'string' && chunk.errorText) {
              onError?.(chunk.errorText);
            }
            break;
          default:
            if (chunk.type.startsWith('data-')) {
              onData?.(chunk.type.slice('data-'.length), chunk.data);
            }
            // start / finish / reasoning-* / message-metadata 等：本模块消费方不需要
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

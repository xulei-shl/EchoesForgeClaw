export interface PostSSEOptions {
  url: string;
  body: unknown;
  onMessage: (event: string, data: string) => void;
  signal?: AbortSignal;
}

export async function postSSEStream({
  url,
  body,
  onMessage,
  signal,
}: PostSSEOptions): Promise<void> {
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
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (window.location.pathname !== '/login') {
      sessionStorage.setItem('redirectAfterLogin', window.location.pathname + window.location.search);
      window.location.href = '/login';
    }
    throw new Error('登录已过期，请重新登录');
  }

  if (!response.ok || !response.body) {
    throw new Error(`SSE 请求失败: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        let eventType = '';
        const dataLines: string[] = [];
        for (const line of event.split('\n')) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const dataStr = line.slice(5);
            dataLines.push(dataStr.startsWith(' ') ? dataStr.slice(1) : dataStr);
          }
        }
        if (dataLines.length) onMessage(eventType || 'message', dataLines.join('\n'));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
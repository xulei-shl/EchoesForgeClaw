/**
 * FastClaw Agent 调用代理（原样移植 Python `app/services/fastclaw_service.py`）。
 *
 * 调用 FastClaw 仪表盘 SSE 接口 `POST /api/chat/stream`（Bearer API Key 鉴权），
 * 将内部富事件流（content_delta / tool_call / tool_result / status /
 * subagent_progress / error / done）归一化为统一的 dict 事件流。
 * 外部服务，不经 AI SDK（设计文档 ADR-022）。
 */

/** 归一化事件（对应 Python fastclaw_service._normalize_event 输出）。 */
export type FastClawEvent =
  | { type: 'content_delta'; data: { delta: string } }
  | { type: 'content'; data: { delta: string } }
  | { type: 'tool_call'; data: { id: string; name: string; arguments: string } }
  | { type: 'tool_result'; data: { id: string; name: string; result: string } }
  | { type: 'status'; data: { message: string } }
  | { type: 'subagent_progress'; data: Record<string, unknown> }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: {} };

export interface FastClawRuntimeConfig {
  base_url: string;
  api_key: string;
  agent_id: string;
  /** 上游 end-user 标识（FastClaw 据此隔离会话/记忆/用量）。 */
  end_user: string;
}

export class FastClawAgentError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'FastClawAgentError';
  }
}

/** 连接阶段超时 15s（读阶段不设上限，由调用方按空闲超时中止）。 */
const CONNECT_TIMEOUT_MS = 15_000;

/** agent 名字解析 TTL：成功 5 分钟 / 失败 30 秒（对应 Python _AGENT_NAME_CACHE_TTL / _AGENT_NAME_FAIL_TTL）。 */
const AGENT_NAME_CACHE_TTL_MS = 5 * 60 * 1000;
const AGENT_NAME_FAIL_TTL_MS = 30 * 1000;
const agentNameCache = new Map<string, { name: string | null; expiresAt: number }>();

/** 从 agent 最终文本中提取第一张图片 URL（支持 markdown 图片语法与裸 URL）。 */
const IMAGE_URL_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)\]]+\.(?:png|jpe?g|webp|gif)[^\s)\]]*)/;

export function extractImageUrl(text: string): string | null {
  if (!text) return null;
  const m = IMAGE_URL_RE.exec(text);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

export class FastClawAgentService {
  /** 调用 agent 并产出归一化事件流（AsyncGenerator）。 */
  async *runAgent(
    config: FastClawRuntimeConfig,
    message: string,
    sessionKey: string,
    images?: string[],
    params?: Record<string, unknown>
  ): AsyncGenerator<FastClawEvent, void, unknown> {
    if (!config.base_url || !config.api_key || !config.agent_id) {
      throw new FastClawAgentError('FastClaw Agent 配置不完整（base_url / api_key / agent_id）');
    }

    const url = config.base_url.replace(/\/+$/, '') + '/api/chat/stream';
    const body: Record<string, unknown> = {
      agentId: config.agent_id,
      sessionId: sessionKey,
      message,
    };
    if (images?.length) body.imageUrls = images;
    if (params) body.params = params;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (config.end_user) headers['X-Fastclaw-End-User'] = config.end_user;

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FastClawAgentError(`FastClaw Agent 调用失败: ${messageOf(err)}`, err);
    }
    if (!resp.ok) {
      let detail = '';
      try {
        detail = (await resp.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      throw new FastClawAgentError(`FastClaw /api/chat/stream 返回 HTTP ${resp.status}: ${detail}`);
    }
    if (!resp.body) throw new FastClawAgentError('FastClaw /api/chat/stream 返回空响应体');

    // SSE 解析：累积 data: 行，空行成块
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawDelta = false;
    let sawEvent = false;

    const emit = (payload: string): FastClawEvent[] => {
      const out: FastClawEvent[] = [];
      for (const evt of normalizeEvent(payload)) {
        // FastClaw 先流式发 content_delta，再在本轮结束补发完整 content；
        // 若本轮已收到增量，跳过该条完整 content，避免前端重复拼接文本。
        if (evt.type === 'content_delta') sawDelta = true;
        else if (['tool_call', 'tool_result', 'status', 'subagent_progress'].includes(evt.type)) {
          sawDelta = false;
        }
        if (evt.type === 'content' && sawDelta) continue;
        out.push(evt);
      }
      return out;
    };

    for (;;) {
      let chunk: { done: boolean; value?: Uint8Array };
      try {
        chunk = await reader.read();
      } catch (err) {
        throw new FastClawAgentError(`FastClaw Agent 流读取失败: ${messageOf(err)}`, err);
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const dataLines: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        if (dataLines.length === 0) continue;
        const payload = dataLines.join('\n');
        for (const evt of emit(payload)) {
          sawEvent = true;
          yield evt;
        }
      }
    }
    // 流自然结束（无 done 事件时补发，保证调用方收尾逻辑统一）
    if (!sawEvent) {
      yield { type: 'done', data: {} };
    }
  }

  /** 列出该 API Key 可访问的 FastClaw agent（admin 页面拉取候选）。 */
  async listAgents(baseUrl: string, apiKey: string, endUser = ''): Promise<unknown[]> {
    const base = baseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    };
    if (endUser) headers['X-Fastclaw-End-User'] = endUser;
    // 1) dashboard 接口：带真实名字（AgentRecord.name）
    try {
      const resp = await fetch(base + '/api/agents', { headers, signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
      if (resp.ok) {
        const data = (await resp.json()) as { agents?: unknown[] };
        if (Array.isArray(data.agents) && data.agents.length > 0) return data.agents;
      }
    } catch {
      /* 走回退分支 */
    }
    // 2) 上游接口回退：name 与 id 相同
    try {
      const resp = await fetch(base + '/v1/agents', { headers, signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
      if (!resp.ok) throw new FastClawAgentError(`FastClaw /v1/agents 返回 HTTP ${resp.status}`);
      const data = (await resp.json()) as { agents?: unknown[] };
      return Array.isArray(data.agents) ? data.agents : [];
    } catch (err) {
      if (err instanceof FastClawAgentError) throw err;
      throw new FastClawAgentError(`连接 FastClaw 失败: ${messageOf(err)}`, err);
    }
  }

  /** 解析 agent_id 对应的 FastClaw 真实名字（AgentRecord.name，如 "Xulei"）。
   *
   * 带进程内 TTL 缓存（成功 5 分钟 / 失败 30 秒）；FastClaw 不可达或未找到时
   * 返回 null 且短时间内不重试，用于给存量配置回填可读名字（best-effort，不抛错）。
   */
  async resolveAgentName(baseUrl: string, apiKey: string, agentId: string): Promise<string | null> {
    if (!agentId) return null;
    const key = `${baseUrl.replace(/\/+$/, '')}\u0000${apiKey}\u0000${agentId}`;
    const now = Date.now();
    const cached = agentNameCache.get(key);
    if (cached && cached.expiresAt > now) return cached.name;
    let name: string | null = null;
    try {
      const agents = await this.listAgents(baseUrl, apiKey);
      for (const a of agents) {
        if (a && typeof a === 'object' && (a as { id?: unknown }).id === agentId) {
          const candidate = (a as { name?: unknown }).name;
          // 仅接受与 id 不同的可读名字：/v1/agents 回退路径 name==id，
          // 此时视为未解析（返回 null），避免把 agt_xxx 当名字持久化
          if (typeof candidate === 'string' && candidate && candidate !== agentId) {
            name = candidate;
          }
          break;
        }
      }
    } catch {
      name = null;
    }
    agentNameCache.set(key, {
      name,
      expiresAt: now + (name ? AGENT_NAME_CACHE_TTL_MS : AGENT_NAME_FAIL_TTL_MS),
    });
    return name;
  }
}

/** 解析单个 SSE payload 为归一化事件（对应 Python _normalize_event）。 */
function normalizeEvent(payload: string): FastClawEvent[] {
  let evt: unknown;
  try {
    evt = JSON.parse(payload);
  } catch {
    return []; // 非 JSON 行（杂讯）忽略，不中断流
  }
  if (typeof evt !== 'object' || evt === null) return [];
  const e = evt as { type?: string; data?: unknown };
  const data = (typeof e.data === 'object' && e.data !== null ? e.data : {}) as Record<string, any>;
  switch (e.type) {
    case 'content_delta': {
      const delta = typeof data.delta === 'string' ? data.delta : '';
      return delta ? [{ type: 'content_delta', data: { delta } }] : [];
    }
    case 'content':
    case 'message': {
      const content = typeof data.content === 'string' ? data.content : typeof data.text === 'string' ? data.text : '';
      return content ? [{ type: 'content', data: { delta: content } }] : [];
    }
    case 'tool_call':
      return [{ type: 'tool_call', data: { id: str(data.id), name: str(data.name), arguments: str(data.arguments) } }];
    case 'tool_result':
      return [{ type: 'tool_result', data: { id: str(data.id), name: str(data.name), result: str(data.result) } }];
    case 'tool_progress':
    case 'status':
      return [{ type: 'status', data: { message: typeof data.message === 'string' ? data.message : typeof data.tool === 'string' ? data.tool : JSON.stringify(data) } }];
    case 'subagent_progress':
      return [{ type: 'subagent_progress', data }];
    case 'error':
      return [{ type: 'error', data: { message: typeof data.message === 'string' ? data.message : JSON.stringify(data) } }];
    case 'done':
      return [{ type: 'done', data: {} }];
    default:
      return [];
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 单例（对应 Python 模块级 fastclaw_agent_service）。 */
export const fastclawAgentService = new FastClawAgentService();

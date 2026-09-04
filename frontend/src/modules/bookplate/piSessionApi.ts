import { authHeaders, handleUnauthorized } from './authUtils';
import type { ExtensionWidgetItem } from './piStream';
import type { AgentFile, AgentStep, ChatMessage } from '../../platform/types';

// ---------------------------------------------------------------------------
// 服务端水合（会话真相源）：Skill Agent（pi）会话持久化在服务端
// `.pi-agent/run/chat.jsonl`，本模块封装所有 /chat/* 会话接口调用。
// ---------------------------------------------------------------------------

/** GET /chat/session 返回的消息 DTO（与后端 pi-session-hydrate.ts 对齐）。 */
interface HydratedMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  agentSteps?: AgentStep[];
  files?: AgentFile[];
  interrupted?: boolean;
}

/** GET /chat/session 返回体（消息 DTO + 扩展 widget 快照）。 */
interface HydratedSessionDto {
  messages?: HydratedMessageDto[];
  widgets?: ExtensionWidgetItem[];
}

/** 已上传到工作区 inputs/ 的文件信息（/chat/upload 返回体）。 */
export interface UploadedWorkspaceFile {
  name: string;
  path: string;
  mime: string;
  size: number;
}

const SESSION_CACHE_MAX = 8;
/** 模块级 LRU：key = workspaceId（含节点创建时间戳，跨账号碰撞概率可忽略）；缓存消息 + widget 快照。 */
const sessionCache = new Map<string, { messages: ChatMessage[]; widgets: ExtensionWidgetItem[] }>();

function cachedSessionOf(ws: string): { messages: ChatMessage[]; widgets: ExtensionWidgetItem[] } | null {
  const hit = sessionCache.get(ws);
  if (hit) {
    sessionCache.delete(ws);
    sessionCache.set(ws, hit);
  }
  return hit ?? null;
}

function putSessionCache(
  ws: string,
  data: { messages: ChatMessage[]; widgets: ExtensionWidgetItem[] }
): void {
  sessionCache.delete(ws);
  sessionCache.set(ws, data);
  while (sessionCache.size > SESSION_CACHE_MAX) {
    const oldest = sessionCache.keys().next().value;
    if (oldest === undefined) break;
    sessionCache.delete(oldest);
  }
}

function dtoToChatMessage(m: HydratedMessageDto): ChatMessage {
  return {
    role: m.role,
    content: m.content ?? '',
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    ...(m.agentSteps?.length ? { agentSteps: m.agentSteps } : {}),
    ...(m.files?.length ? { files: m.files } : {}),
    ...(m.interrupted ? { interrupted: true } : {}),
  };
}

async function fetchPiSession(ws: string): Promise<{ messages: ChatMessage[]; widgets: ExtensionWidgetItem[] }> {
  const resp = await fetch(
    `/api/modules/bookplate/chat/session?workspace_id=${encodeURIComponent(ws)}`,
    { headers: authHeaders() }
  );
  if (resp.status === 401) {
    handleUnauthorized();
    throw new Error('401');
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as HydratedSessionDto;
  return {
    messages: (data.messages ?? []).map(dtoToChatMessage),
    // 只取前端需要的展示字段（剥离 updatedAt/toolCallId 等服务端溯源元数据）
    widgets: (data.widgets ?? []).map((w) => ({
      key: w.key,
      ...(w.label ? { label: w.label } : {}),
      lines: w.lines,
      placement: w.placement ?? 'aboveEditor',
      ...(w.data !== undefined ? { data: w.data } : {}),
    })),
  };
}

async function fetchWorkspaceFiles(ws: string): Promise<AgentFile[]> {
  // include_inputs=1：面板同时展示用户上传到 inputs/ 的文件（产物 + 上传物统一视图）
  const resp = await fetch(
    `/api/modules/bookplate/chat/files?workspace_id=${encodeURIComponent(ws)}&include_inputs=1`,
    { headers: authHeaders() }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { files?: AgentFile[] };
  // 已删除的历史产物不进面板（manifest 可追溯语义由服务端保留）
  return (data.files ?? []).filter((f) => f.exists !== false);
}

/**
 * 任意格式文件 → 工作区 inputs/（Skill Agent 附件通道）。
 * multipart（字段名 file）；workspace_id 走查询参数。返回工作区相对路径供消息引用。
 */
async function uploadWorkspaceFile(ws: string, file: File): Promise<UploadedWorkspaceFile> {
  const body = new FormData();
  body.append('file', file);
  const resp = await fetch(`/api/modules/bookplate/chat/upload?workspace_id=${encodeURIComponent(ws)}`, {
    method: 'POST',
    headers: authHeaders(),
    body,
  });
  if (resp.status === 401) {
    handleUnauthorized();
    throw new Error('401');
  }
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const j = (await resp.json()) as { detail?: string };
      if (j?.detail) detail = j.detail;
    } catch {
      /* 非 JSON 错误体：用状态码兜底 */
    }
    throw new Error(detail);
  }
  return (await resp.json()) as UploadedWorkspaceFile;
}

/**
 * 上游继承的图片 → 拷入工作区 inputs/（服务端 /chat/import 白名单拷贝 + data URL 解码），
 * 返回工作区相对路径列表。失败时抛错（前端在首轮注入处兜底降级为 base64 通道）。
 */
async function importInheritedImages(
  ws: string,
  req: { urls: string[]; dataUrls?: string[] }
): Promise<string[]> {
  if (!req.urls.length && !req.dataUrls?.length) return [];
  const resp = await fetch('/api/modules/bookplate/chat/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      workspace_id: ws,
      urls: req.urls,
      ...(req.dataUrls?.length ? { data_urls: req.dataUrls } : {}),
    }),
  });
  if (resp.status === 401) {
    handleUnauthorized();
    throw new Error('401');
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { files?: { path: string }[] };
  return (data.files ?? []).map((f) => f.path);
}

/** 扩展交互作答 → POST /chat/ui-response 写回 RPC 子进程。404（会话已结束）静默。 */
async function postUiResponse(
  ws: string,
  id: string,
  response: { value?: string; confirmed?: boolean; cancelled?: boolean }
): Promise<boolean> {
  try {
    const resp = await fetch('/api/modules/bookplate/chat/ui-response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ workspace_id: ws, id, ...response }),
    });
    if (resp.status === 401) {
      handleUnauthorized();
      return false;
    }
    return resp.ok;
  } catch {
    return false;
  }
}

/** 会话快照缓存（挂载时先渲染缓存再拉服务端，消除首屏闪空）。 */
export { cachedSessionOf, putSessionCache };
/** 服务端会话 / 文件 / 上传 / 导入 / UI 作答接口。 */
export { fetchPiSession, fetchWorkspaceFiles, uploadWorkspaceFile, importInheritedImages, postUiResponse };
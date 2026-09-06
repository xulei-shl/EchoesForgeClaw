import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { sanitizeWorkspaceId, workspaceRoot } from './skill-agent-service.js';
import {
  resolvePiSessionFile,
  type HydratedFile,
  type HydratedMessage,
  type HydratedSession,
  type HydratedStep,
} from './pi-session-hydrate.js';
import {
  deletePiConversation,
  formatFallbackTime,
  listPiConversations,
  readConversationMeta,
  titleFromUserText,
  type ConversationSummary,
} from './pi/conversations.js';

/**
 * LLM / FastClaw 模式的会话 transcript（本地镜像，服务端为真相源）。
 *
 * - pi 模式的历史以 `.pi-agent/run/chat.jsonl`（pi 子进程写入）为真相源，既有逻辑不动；
 * - LLM / FastClaw 模式此前无任何服务端会话记录：后端在每轮把「用户消息 + 助手回复」
 *   （FastClaw 附工具步骤 / 桥接产物）追加写 `{ws}/conversation.jsonl`（append-only JSONL），
 *   每行标注来源 mode（'llm' / 'agent'）供列表按模式隔离，列表 / 水合 / 删除与 pi 模式走同一路由形态，
 *   仅存储 Provider 不同；
 * - 写路径全部 best-effort（磁盘失败静默跳过），绝不阻断对话流本身。
 */

/** 会话 transcript 文件（相对工作区根）。与 pi 的 chat.jsonl 互斥：LLM / FastClaw 专用。 */
export const CONVERSATION_REL = 'conversation.jsonl';

/** 列表头部扫描字节上限（只读文件头取创建时间 / 标题 / 轮次近似值，避免整读大文件）。 */
const MAX_SCAN_BYTES = 256 * 1024;
/** 水合单条消息正文字符上限。 */
const MAX_FIELD_CHARS = 20_000;
/** 水合全部消息正文字符总量软上限（超出即停止并标记 truncated）。 */
const MAX_TOTAL_CHARS = 600_000;

/** transcript 行条目（append-only；id 仅作行标识，水合前端自行重建展示 id）。 */
export interface TranscriptMessage {
  type: 'message';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 写入时来源模式：'llm'（LLM API）或 'agent'（FastClaw Agent），列表按此隔离 */
  mode?: 'llm' | 'agent';
  /** LLM 模式的图片（base64 / 静态 URL，随历史重发） */
  images?: string[];
  reasoning?: string;
  agentSteps?: HydratedStep[];
  files?: HydratedFile[];
  interrupted?: boolean;
  ts: number;
}

/** 追加一行（调用方保证 ws 目录已存在；失败抛错由上层 best-effort 兜底）。 */
function appendLine(ws: string, msg: TranscriptMessage): void {
  appendFileSync(path.join(ws, CONVERSATION_REL), JSON.stringify(msg) + '\n', 'utf-8');
}

/** 从文件尾部找最后一条指定角色的合法 message 条目（用于 user 去重；坏行跳过）。 */
function lastTranscriptMessage(ws: string, role?: 'user' | 'assistant'): TranscriptMessage | null {
  const file = path.join(ws, CONVERSATION_REL);
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size <= 0) return null;
    const tailBytes = Math.min(st.size, MAX_SCAN_BYTES);
    const buf = Buffer.alloc(tailBytes);
    readSync(fd, buf, 0, tailBytes, st.size - tailBytes);
    const text = new StringDecoder('utf-8').end(buf);
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{'));
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]!) as TranscriptMessage;
        if (
          parsed &&
          parsed.type === 'message' &&
          (parsed.role === 'user' || parsed.role === 'assistant') &&
          (!role || parsed.role === role)
        ) {
          return parsed;
        }
      } catch {
        /* 坏行：跳过 */
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * 追加一条 user 消息。去重守卫：末行已是同内容同图片的 user 消息则跳过
 * （重试 / regenerate 不新增 user 消息，避免 transcript 重复）。mode 标注写入来源
 * （'llm' / 'agent'），供对话历史列表按模式隔离。
 */
export function persistTranscriptUser(
  ws: string,
  msg: { content: string; images?: string[] },
  mode: 'llm' | 'agent'
): void {
  const content = String(msg.content ?? '');
  const images = msg.images?.length ? msg.images : undefined;
  if (!content.trim() && !images?.length) return;
  try {
    // 去重守卫：transcript 末尾最近一条 user 消息已含同内容同图片 → 跳过。
    // 覆盖重试 / regenerate（不新增 user 消息）：失败轮重发（末行为 user）与
    // 已完成轮 regenerate（末行为旧 assistant，其前仍为同一 user）都不再重复落盘 user。
    const last = lastTranscriptMessage(ws, 'user');
    if (
      last &&
      last.content === content &&
      JSON.stringify(last.images ?? []) === JSON.stringify(images ?? [])
    ) {
      return;
    }
    appendLine(ws, {
      type: 'message',
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content,
      mode,
      ...(images?.length ? { images } : {}),
      ts: Date.now(),
    });
  } catch {
    /* best-effort：磁盘写失败不影响对话流 */
  }
}

/**
 * 追加一条 assistant 消息（正文 / 推理 / 工具步骤 / 产物文件；全部空则跳过）。
 * mode 标注写入来源（'llm' / 'agent'），供对话历史列表按模式隔离。
 */
export function persistTranscriptAssistant(
  ws: string,
  msg: {
    content: string;
    reasoning?: string;
    agentSteps?: HydratedStep[];
    files?: HydratedFile[];
    interrupted?: boolean;
  },
  mode: 'llm' | 'agent'
): void {
  const content = String(msg.content ?? '');
  const reasoning = msg.reasoning ? String(msg.reasoning) : undefined;
  if (
    !content.trim() &&
    !reasoning?.trim() &&
    !msg.agentSteps?.length &&
    !msg.files?.length
  ) {
    return;
  }
  try {
    appendLine(ws, {
      type: 'message',
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content,
      mode,
      ...(reasoning ? { reasoning } : {}),
      ...(msg.agentSteps?.length ? { agentSteps: msg.agentSteps } : {}),
      ...(msg.files?.length ? { files: msg.files } : {}),
      ...(msg.interrupted ? { interrupted: true } : {}),
      ts: Date.now(),
    });
  } catch {
    /* best-effort：磁盘写失败不影响对话流 */
  }
}

/** 单字段截断（与 pi 水合同口径）。 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return [...text].slice(0, max).join('');
}

/**
 * 水合 transcript → UI 历史（与 GET /chat/session 的 HydratedSession 形状一致，
 * 前端 piSessionApi.dtoToChatMessage 直接消费）。文件不存在 / 无消息返回空会话。
 */
export function hydrateChatTranscript(ws: string): HydratedSession {
  const file = path.join(ws, CONVERSATION_REL);
  if (!existsSync(file)) return { exists: false, messages: [], truncated: false };
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return { exists: false, messages: [], truncated: false };
  }
  const messages: HydratedMessage[] = [];
  let totalChars = 0;
  let truncated = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let entry: TranscriptMessage;
    try {
      entry = JSON.parse(trimmed) as TranscriptMessage;
    } catch {
      continue; // 容错：跳过损坏行
    }
    if (entry.type !== 'message' || (entry.role !== 'user' && entry.role !== 'assistant')) continue;
    if (totalChars > MAX_TOTAL_CHARS) {
      truncated = true;
      break;
    }
    const content = clip(String(entry.content ?? ''), MAX_FIELD_CHARS);
    const msg: HydratedMessage = {
      id: typeof entry.id === 'string' && entry.id ? entry.id : `t-${messages.length}`,
      role: entry.role,
      content,
      ...(typeof entry.ts === 'number' && entry.ts > 0 ? { ts: entry.ts } : {}),
    };
    totalChars += content.length;
    if (entry.reasoning) {
      const reasoning = clip(String(entry.reasoning), MAX_FIELD_CHARS);
      msg.reasoning = reasoning;
      totalChars += reasoning.length;
    }
    if (Array.isArray(entry.agentSteps) && entry.agentSteps.length) msg.agentSteps = entry.agentSteps;
    if (Array.isArray(entry.files) && entry.files.length) msg.files = entry.files;
    if (entry.interrupted) msg.interrupted = true;
    messages.push(msg);
  }
  return { exists: messages.length > 0, messages, truncated };
}

/** transcript 头部扫描：创建时间（首条 ts）/ 首条 user 文本（标题源）/ 轮次近似值 / 来源模式。
 * 模式判定：优先取行内显式 mode（新写入带标）；未标注的旧 transcript 回退启发式
 * （assistant 行含 agentSteps → 'agent'，否则 'llm'）。 */
function readTranscriptHead(
  file: string
): { createdAt: number | null; firstUserText: string; userTurns: number; mode: 'llm' | 'agent' } {
  const empty = { createdAt: null, firstUserText: '', userTurns: 0, mode: 'llm' as const };
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return empty;
  }
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size <= 0) return empty;
    const len = Math.min(st.size, MAX_SCAN_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, 0);
    const text = new StringDecoder('utf-8').end(buf);
    let createdAt: number | null = null;
    let firstUserText = '';
    let userTurns = 0;
    let mode: 'llm' | 'agent' = 'llm';
    let explicitMode: 'llm' | 'agent' | null = null;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      let entry: TranscriptMessage;
      try {
        entry = JSON.parse(trimmed) as TranscriptMessage;
      } catch {
        continue;
      }
      if (entry.type !== 'message' || (entry.role !== 'user' && entry.role !== 'assistant')) continue;
      if (createdAt === null && typeof entry.ts === 'number' && entry.ts > 0) createdAt = entry.ts;
      if (entry.mode === 'llm' || entry.mode === 'agent') explicitMode = entry.mode;
      if (entry.role === 'user') {
        userTurns += 1;
        if (!firstUserText && typeof entry.content === 'string') firstUserText = entry.content;
      }
      // 启发式回退：未标注模式的旧 transcript 按是否存在工具步骤判定
      if (explicitMode === null && entry.role === 'assistant' && Array.isArray(entry.agentSteps) && entry.agentSteps.length) {
        mode = 'agent';
      }
    }
    return { createdAt, firstUserText, userTurns, mode: explicitMode ?? mode };
  } finally {
    closeSync(fd);
  }
}

/**
 * 列出该用户的对话历史，按模式严格隔离（三模式互不混显）：
 * - mode='pi'（默认）：仅 pi 会话（chat.jsonl），即原 listPiConversations 语义，pi 节点抽屉行为不变；
 * - mode='llm'：仅 LLM API 的 transcript 会话（conversation.jsonl 且行内标注/启发式判定为 llm）；
 * - mode='agent'：仅 FastClaw Agent 的 transcript 会话。
 * 各模式内部排序一致（置顶在前 / pinnedAt 倒序 / 其余 updatedAt 倒序）。
 * 跨节点列表不传 node_id（来源节点由前端按 workspaceId 前缀标注），传则按 `{nodeId}_` 前缀过滤。
 */
export function listChatConversations(
  userId: number,
  nodeId?: string,
  mode: 'pi' | 'llm' | 'agent' = 'pi'
): ConversationSummary[] {
  const piSessions = listPiConversations(userId, nodeId);
  if (mode === 'pi') return piSessions;
  // pi 工作区目录仅用于识别跳过，绝不混入 transcript 结果
  const piWs = new Set(piSessions.map((s) => s.workspaceId));

  const root = workspaceRoot(userId);
  const prefix = nodeId ? `${sanitizeWorkspaceId(nodeId)}_` : null;
  const out: ConversationSummary[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const dir of entries) {
    if (piWs.has(dir)) continue;
    if (prefix && !dir.startsWith(prefix)) continue;
    if (dir === '.' || dir === '..' || dir.includes('/') || dir.includes('\\')) continue;
    const ws = path.join(root, dir);
    try {
      if (!statSync(ws).isDirectory()) continue;
    } catch {
      continue;
    }
    const file = path.join(ws, CONVERSATION_REL);
    if (!existsSync(file)) continue;
    let st;
    try {
      st = statSync(file);
    } catch {
      continue;
    }
    const meta = readConversationMeta(ws);
    const { createdAt: sessTs, firstUserText, userTurns, mode: sessMode } = readTranscriptHead(file);
    if (sessMode !== mode) continue;
    const createdAt = sessTs ?? (st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs);
    let wsMtime = st.mtimeMs;
    try {
      wsMtime = statSync(ws).mtimeMs;
    } catch {
      /* 目录被并发删除：用文件时间兜底 */
    }
    const updatedAt = Math.max(st.mtimeMs, wsMtime);
    const stripped = titleFromUserText(firstUserText);
    const title = meta.title?.trim() || stripped || `对话 ${formatFallbackTime(createdAt)}`;
    out.push({
      workspaceId: dir,
      title,
      pinned: !!meta.pinned,
      pinnedAt: typeof meta.pinnedAt === 'number' ? meta.pinnedAt : null,
      createdAt,
      updatedAt,
      messageCount: userTurns,
    });
  }
  return out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const pa = a.pinnedAt ?? 0;
    const pb = b.pinnedAt ?? 0;
    if (pa !== pb) return pb - pa;
    return b.updatedAt - a.updatedAt;
  });
}

/**
 * 完整删除一条对话：pi 会话走原链路（杀 RPC 进程 + 子代理清理 + 删目录）；
 * LLM / FastClaw transcript 会话无进程语义，直接整目录删除（产物 / 上传附件一并清除）。
 * 目录不存在返回 false。注意：FastClaw 侧的远端会话状态不在本端可清除范围（Route A 本地遗忘）。
 */
export async function deleteChatConversation(userId: number, workspaceId: string): Promise<boolean> {
  const sanitized = sanitizeWorkspaceId(workspaceId);
  if (!sanitized) return false;
  const root = workspaceRoot(userId);
  const ws = path.join(root, sanitized);
  if (ws !== root && !ws.startsWith(root + path.sep)) return false;
  if (!existsSync(ws)) return false;
  if (resolvePiSessionFile(ws)) return deletePiConversation(userId, sanitized);
  rmSync(ws, { recursive: true, force: true });
  return true;
}
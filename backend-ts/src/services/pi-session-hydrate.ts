import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { mimeOf, skillFileDownloadUrl } from './file-utils.js';

/**
 * pi 会话水合（服务端为真相源）：
 * 把 .pi-agent/run/chat.jsonl（pi 会话 jsonl v3，append-only 条目树）反向映射为
 * chat 节点可渲染的 UI 历史（含工具调用卡片、推理文本、内联图片占位与产物引用），
 * 供 GET /chat/session 端点在前端挂载/收尾时拉取，替代脆弱的客户端镜像。
 *
 * 映射口径（v1，子进程 CLI 模式实际为线性追加，不做分支回溯）：
 * - message/user：text → content；image 块 → 鉴权图片卡（base64 不直接下发）
 * - message/assistant：text → content、thinking → reasoning、toolCall → agent_tool_call 步骤；
 *   stopReason=aborted → interrupted；errorMessage → agent_status 错误步骤
 * - message/toolResult：按 toolCallId 归并出 agent_tool_result 步骤，附到对应 assistant 消息
 * - compaction：合成一条「上下文已压缩」状态消息；session/model_change 等元数据条目跳过
 * - 容错：坏行静默跳过；字段级防御（null content / 超长截断）
 */

/** 单条 UI 消息上限（content/reasoning 各自截断），防止超大轮次拖垮响应。 */
const MAX_FIELD_CHARS = 20_000;
/** 工具结果摘要上限。 */
const MAX_RESULT_CHARS = 2_000;
/** 工具参数摘要上限。 */
const MAX_ARGS_CHARS = 1_000;
/** 全部消息正文字符总量软上限（超出即停止并标记 truncated）。 */
const MAX_TOTAL_CHARS = 600_000;

export interface HydratedFile {
  url: string;
  name: string;
  mime: string;
  size: number;
  path: string;
}

export interface HydratedStep {
  type: 'agent_tool_call' | 'agent_tool_result' | 'agent_status';
  id?: string;
  name?: string;
  arguments?: string;
  result?: string;
  isError?: boolean;
  message?: string;
}

export interface HydratedMessage {
  /** pi 条目短 id（稳定，撤销/恢复可靠） */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  agentSteps?: HydratedStep[];
  files?: HydratedFile[];
  interrupted?: boolean;
  ts?: number;
}

export interface HydratedSession {
  /** 工作区是否存在会话文件 */
  exists: boolean;
  messages: HydratedMessage[];
  /** 因超限被截断（早期轮次可能不完整） */
  truncated: boolean;
}

/** 会话文件落点：优先 .pi-agent/run/chat.jsonl，回退历史版本的根级 chat.jsonl。 */
export function resolvePiSessionFile(ws: string): string | null {
  const runLevel = path.join(ws, '.pi-agent', 'run', 'chat.jsonl');
  if (existsSync(runLevel)) return runLevel;
  const legacyRoot = path.join(ws, '.pi-agent', 'chat.jsonl');
  return existsSync(legacyRoot) ? legacyRoot : null;
}

interface PiContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  data?: string;
  mimeType?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}

interface PiMessage {
  role?: string;
  content?: string | PiContentBlock[] | null;
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
  // ToolResultMessage 字段（都在 message 内层）
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

interface PiEntry {
  type?: string;
  id?: string;
  message?: PiMessage;
  toolCallId?: string;
  toolName?: string;
  content?: PiContentBlock[] | null;
  isError?: boolean;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[已截断]` : text;
}

function textOfBlocks(content: PiMessage['content'], pick: (b: PiContentBlock) => string): string {
  if (typeof content === 'string') return pick({ type: 'text', text: content });
  if (!Array.isArray(content)) return '';
  return content.map(pick).filter(Boolean).join('');
}

/** 图片块 → 鉴权图片卡（复用 skill-files 卡片管线：<img> 无法带 Authorization，由前端 fetch→blob 渲染）。 */
function imageCard(entryId: string, blockIndex: number, mime: string, workspaceId: string): HydratedFile {
  const url =
    `/api/modules/bookplate/chat/session/image?workspace_id=${encodeURIComponent(workspaceId)}` +
    `&entry=${encodeURIComponent(entryId)}&block=${blockIndex}`;
  return { url, name: `会话图片-${entryId}-${blockIndex}`, mime, size: 0, path: url };
}

/** write/edit 类工具调用的目标路径 → 工作区产物文件卡（仅接受落在工作区内的路径）。 */
function writeFileCard(
  args: Record<string, unknown>,
  ws: string,
  workspaceId: string
): HydratedFile | null {
  const raw = args?.['path'] ?? args?.['file_path'] ?? args?.['file'] ?? args?.['filename'];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const abs = path.isAbsolute(raw) ? raw : path.resolve(ws, raw);
  // 统一正斜杠口径：path.relative 在 Windows 下产生反斜杠，排除前缀与 skill-files
  // 参数均以 / 为约定（与 walkWorkspace/skillFileDownloadUrl 一致）
  const rel = path.relative(ws, abs).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (rel.startsWith('.agents/') || rel.startsWith('.pi/') || rel.startsWith('.pi-agent/') || rel.startsWith('inputs/')) {
    return null;
  }
  return {
    url: skillFileDownloadUrl(rel, workspaceId),
    name: path.basename(rel),
    mime: mimeOf(rel),
    size: 0,
    path: rel,
  };
}

/**
 * 解析会话 jsonl 为 UI 历史。workspaceId 用于构造鉴权下载 URL；
 * 文件不存在返回 { exists: false, messages: [], truncated: false }。
 */
export function hydratePiSession(ws: string, workspaceId: string): HydratedSession {
  const file = resolvePiSessionFile(ws);
  if (!file) return { exists: false, messages: [], truncated: false };

  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return { exists: false, messages: [], truncated: false };
  }

  const messages: HydratedMessage[] = [];
  // toolCallId → 所属 assistant 消息（toolResult 条目到达时归并结果步骤）
  const callOwner = new Map<string, HydratedMessage>();
  let totalChars = 0;
  let truncated = false;

  const overflowed = (): boolean => totalChars > MAX_TOTAL_CHARS;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let entry: PiEntry;
    try {
      entry = JSON.parse(trimmed) as PiEntry;
    } catch {
      continue; // 容错：跳过损坏行
    }
    if (!entry || typeof entry.type !== 'string') continue;
    if (overflowed()) {
      truncated = true;
      break;
    }

    if (entry.type === 'compaction') {
      messages.push({
        id: entry.id ?? `compact-${messages.length}`,
        role: 'assistant',
        content: '',
        agentSteps: [{ type: 'agent_status', message: '上下文已压缩（更早日次已摘要归档）' }],
      });
      continue;
    }
    if (entry.type !== 'message' || !entry.message) continue;

    const msg = entry.message;
    const entryId = entry.id ?? `msg-${messages.length}`;

    if (msg.role === 'user') {
      const content = clip(textOfBlocks(msg.content, (b) => (b.type === 'text' ? b.text ?? '' : '')), MAX_FIELD_CHARS);
      totalChars += content.length;
      const files: HydratedFile[] = [];
      if (Array.isArray(msg.content)) {
        msg.content.forEach((b, i) => {
          if (b.type === 'image' && typeof b.data === 'string' && b.data) {
            files.push(imageCard(entryId, i, b.mimeType || 'image/png', workspaceId));
          }
        });
      }
      messages.push({
        id: entryId,
        role: 'user',
        content,
        ...(files.length ? { files } : {}),
        ...(typeof msg.timestamp === 'number' ? { ts: msg.timestamp } : {}),
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const content = clip(textOfBlocks(msg.content, (b) => (b.type === 'text' ? b.text ?? '' : '')), MAX_FIELD_CHARS);
      const reasoning = clip(textOfBlocks(msg.content, (b) => (b.type === 'thinking' ? b.thinking ?? '' : '')), MAX_FIELD_CHARS);
      totalChars += content.length + reasoning.length;
      // toolCall 块 → 调用步骤；后续 toolResult 条目经 callOwner 归并结果到同一消息
      const callSteps: HydratedStep[] = [];
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b.type !== 'toolCall' || !b.id) continue;
          let argsJson = '{}';
          try {
            argsJson = JSON.stringify(b.arguments ?? {});
          } catch {
            /* 参数不可序列化：保留空对象 */
          }
          callSteps.push({
            type: 'agent_tool_call',
            id: b.id,
            name: b.name ?? 'tool',
            arguments: clip(argsJson, MAX_ARGS_CHARS),
          });
        }
      }
      const errorSteps: HydratedStep[] = msg.errorMessage
        ? [{ type: 'agent_status', message: clip(`本轮执行出错：${msg.errorMessage}`, MAX_RESULT_CHARS) }]
        : [];
      const steps = [...callSteps, ...errorSteps];
      const interrupted = msg.stopReason === 'aborted';
      // 全空消息（无正文/推理/步骤且非中断）不入列，避免空气泡脏历史
      if (!content && !reasoning && !steps.length && !interrupted) continue;
      const out: HydratedMessage = {
        id: entryId,
        role: 'assistant',
        content,
        ...(reasoning ? { reasoning } : {}),
        ...(steps.length ? { agentSteps: steps } : {}),
        ...(interrupted ? { interrupted: true } : {}),
        ...(typeof msg.timestamp === 'number' ? { ts: msg.timestamp } : {}),
      };
      messages.push(out);
      for (const s of callSteps) if (s.id) callOwner.set(s.id, out);
      continue;
    }

    if (msg.role === 'toolResult') {
      // pi 格式：toolCallId/toolName/isError 都在 message 内层（ToolResultMessage）
      const owner = msg.toolCallId ? callOwner.get(msg.toolCallId) : undefined;
      if (!owner || !msg.toolCallId) continue;
      owner.agentSteps = owner.agentSteps ?? [];
      const resultText = clip(
        textOfBlocks(msg.content, (b) => (b.type === 'text' ? b.text ?? '' : '')).trim() ||
          '[无文本输出]',
        MAX_RESULT_CHARS
      );
      owner.agentSteps.push({
        type: 'agent_tool_result',
        id: msg.toolCallId,
        name:
          msg.toolName ??
          owner.agentSteps.find((s) => s.type === 'agent_tool_call' && s.id === msg.toolCallId)?.name ??
          'tool',
        result: resultText,
        ...(msg.isError ? { isError: true } : {}),
      });
      // 工具结果中的图片（如生图返回）也转文件卡
      if (Array.isArray(msg.content)) {
        msg.content.forEach((b, i) => {
          if (b.type === 'image' && typeof b.data === 'string' && b.data) {
            const card = imageCard(entryId, i, b.mimeType || 'image/png', workspaceId);
            owner.files = [...(owner.files ?? []), card];
          }
        });
      }
      continue;
    }
  }

  // write/edit 工具的产物卡：从调用参数推导（size 未知记 0）
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.agentSteps) continue;
    for (const s of m.agentSteps) {
      if (s.type !== 'agent_tool_call' || !s.name || !/^write$|^edit$/i.test(s.name)) continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(s.arguments ?? '{}') as Record<string, unknown>;
      } catch {
        continue;
      }
      const card = writeFileCard(args, ws, workspaceId);
      if (card && !(m.files ?? []).some((f) => f.path === card.path)) {
        m.files = [...(m.files ?? []), card];
      }
    }
  }

  return { exists: true, messages, truncated };
}

/** 按 entryId+blockIndex 读取会话中的内联图片块（鉴权图片端点用）。 */
export function readSessionImageBlock(
  ws: string,
  entryId: string,
  blockIndex: number
): { data: Buffer; mime: string } | null {
  const file = resolvePiSessionFile(ws);
  if (!file || !entryId || !Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex > 64) {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let entry: PiEntry;
    try {
      entry = JSON.parse(trimmed) as PiEntry;
    } catch {
      continue;
    }
    if (entry.id !== entryId) continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) return null;
    const block = content[blockIndex];
    if (block?.type !== 'image' || typeof block.data !== 'string' || !block.data) return null;
    let buf: Buffer;
    try {
      buf = Buffer.from(block.data, 'base64');
    } catch {
      return null;
    }
    if (!buf.length) return null;
    return { data: buf, mime: block.mimeType || 'image/png' };
  }
  return null;
}

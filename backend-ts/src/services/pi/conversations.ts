import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { sanitizeWorkspaceId, workspaceRoot } from '../skill-agent-service.js';
import { resolvePiSessionFile } from '../pi-session-hydrate.js';
import { killPiProcess } from './registry.js';
import { cleanupSubagentAsyncRuns } from './subagents/cleanup.js';

/**
 * pi 对话历史列表 / 置顶 / 删除。
 *
 * - 列表：扫描 runtime/{userId}/workspace/ 下含 pi 会话文件（.pi-agent/run/chat.jsonl 或遗留
 *   根级 chat.jsonl）的工作区，汇总标题（meta 优先 → 首条用户消息剥离注入上下文 → 时间兜底）、
 *   轮次数、创建/更新时间；置顶在前（按置顶时间倒序），其余按更新时间倒序。
 * - 置顶：写入 {ws}/.pi-agent/meta.json（.pi-agent/ 被产物差分排除、不受 pi jsonl 迁移影响）。
 * - 删除：作废活跃 RPC 子进程 + 清理子代理残留后整目录删除（含会话/产物/上传附件）。
 */

/** 会话级元数据（置顶 / 标题等）落点（相对工作区根）。 */
export const PI_SESSION_META_REL = path.join('.pi-agent', 'meta.json');
/**
 * 单会话扫描字节上限：只读文件头（会话起点 + 首条用户消息均在头部），
 * 避免超大 jsonl 每次列表请求整读整解析拖垮响应；头部内的轮次计数为近似值。
 */
const MAX_SCAN_BYTES = 256 * 1024;
/** 自动标题最长字符数（按码点截断）。 */
const MAX_TITLE_CHARS = 40;

export interface ConversationSummary {
  workspaceId: string;
  title: string;
  pinned: boolean;
  pinnedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** 用户轮次数（user 消息条数；达到扫描上限后为已扫描部分的近似值）。 */
  messageCount: number;
}

interface ConversationMeta {
  pinned?: boolean;
  pinnedAt?: number;
  title?: string;
}

/** 读取工作区会话元数据（best-effort；无文件/坏 JSON 返回空）。 */
export function readConversationMeta(ws: string): ConversationMeta {
  try {
    const parsed = JSON.parse(readFileSync(path.join(ws, PI_SESSION_META_REL), 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        ...(typeof parsed.pinned === 'boolean' ? { pinned: parsed.pinned } : {}),
        ...(typeof parsed.pinnedAt === 'number' ? { pinnedAt: parsed.pinnedAt } : {}),
        ...(typeof parsed.title === 'string' ? { title: parsed.title } : {}),
      };
    }
  } catch {
    /* 无文件 / 非法 JSON：空元数据 */
  }
  return {};
}

/** 写回工作区会话元数据（merge 语义由调用方保证）。 */
function writeConversationMeta(ws: string, meta: ConversationMeta): void {
  const file = path.join(ws, PI_SESSION_META_REL);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(meta, null, 2), 'utf-8');
}

/** 设置置顶状态：置顶记录 pinnedAt，取消置顶清除该字段。 */
export function setConversationPinned(ws: string, pinned: boolean): void {
  const meta = readConversationMeta(ws);
  meta.pinned = pinned;
  if (pinned) meta.pinnedAt = Date.now();
  else delete meta.pinnedAt;
  writeConversationMeta(ws, meta);
}

/** 手动标题最长字符数（按码点截断；自动标题 MAX_TITLE_CHARS=40，手动放宽到 100）。 */
const MAX_MANUAL_TITLE_CHARS = 100;

/**
 * 重命名会话：写入/清除 {ws}/.pi-agent/meta.json 的 title 字段（与置顶同一元数据文件）。
 * - 空白标题 = 清除自定义标题，列表回退自动标题（「恢复默认名」）；
 * - 工作区不存在返回 false（用只读路径解析，不落空目录——与 pin 的 nodeWorkspace 建目录语义区分）。
 */
export function setConversationTitle(ws: string, title: string): boolean {
  if (!existsSync(ws)) return false;
  const meta = readConversationMeta(ws);
  const normalized = [...String(title ?? '').replace(/\s+/g, ' ').trim()]
    .slice(0, MAX_MANUAL_TITLE_CHARS)
    .join('');
  if (normalized) meta.title = normalized;
  else delete meta.title;
  writeConversationMeta(ws, meta);
  return true;
}

/** 用户消息文本 → 列表标题：剥离注入上下文前缀（与前端 stripInjectedContext 通用口径一致），单行化 + 截断。 */
export function titleFromUserText(text: string): string {
  let title = text.trim();
  if (title.startsWith('【')) {
    const lastSep = title.lastIndexOf('\n\n');
    if (lastSep !== -1) {
      const prefix = title.slice(0, lastSep);
      if (prefix.startsWith('【') && prefix.includes('】')) {
        title = title.slice(lastSep + 2).trim();
      }
    }
  }
  return [...title.replace(/\s+/g, ' ')].slice(0, MAX_TITLE_CHARS).join('').trim();
}

/** 兜底标题时间格式：MM-DD HH:mm（跨年带年份）。 */
export function formatFallbackTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const date =
    d.getFullYear() === now.getFullYear()
      ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 会话文件头部扫描（最多读 MAX_SCAN_BYTES 字节，不整读全文件）：
 * - 会话起始时间（首行 session 条目 ISO 时间戳）+ 首条用户消息文本（列表标题源）；
 * - 用户轮次计数：仅统计头部内可见部分（超大会话为近似值，与旧 MAX_SCAN_LINES 语义一致）；
 * - 截断处由 StringDecoder 收尾，不残留半个多字节 UTF-8 字符；坏行（含截断半行）逐条跳过。
 */
function readSessionMeta(
  file: string
): { createdAt: number | null; firstUserText: string; userTurns: number } {
  const empty = { createdAt: null, firstUserText: '', userTurns: 0 };
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return empty;
  }
  try {
    const buf = Buffer.alloc(MAX_SCAN_BYTES);
    const bytesRead = readSync(fd, buf, 0, MAX_SCAN_BYTES, 0);
    if (bytesRead <= 0) return empty;
    // StringDecoder.end 丢弃截断处的残缺字节序列（不会在末尾产生 U+FFFD 替换符污染标题）
    const text = new StringDecoder('utf-8').end(buf.subarray(0, bytesRead));
    let createdAt: number | null = null;
    let firstUserText = '';
    let userTurns = 0;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      if (createdAt === null && trimmed.startsWith('{"type":"session"')) {
        try {
          const entry = JSON.parse(trimmed) as { timestamp?: string };
          if (entry.timestamp) {
            const t = Date.parse(entry.timestamp);
            if (Number.isFinite(t)) createdAt = t;
          }
        } catch {
          /* 坏行：跳过 */
        }
        continue;
      }
      if (!trimmed.includes('"type":"message"') || !trimmed.includes('"role":"user"')) continue;
      userTurns += 1;
      if (firstUserText) continue;
      try {
        const entry = JSON.parse(trimmed) as { message?: { content?: unknown } };
        const content = entry.message?.content;
        if (typeof content === 'string') {
          firstUserText = content;
        } else if (Array.isArray(content)) {
          const textBlock = content.find(
            (b): b is { type: string; text: string } =>
              !!b &&
              typeof b === 'object' &&
              (b as { type?: unknown }).type === 'text' &&
              typeof (b as { text?: unknown }).text === 'string'
          );
          if (textBlock) firstUserText = textBlock.text;
        }
      } catch {
        /* 坏行：跳过 */
      }
    }
    return { createdAt, firstUserText, userTurns };
  } finally {
    closeSync(fd);
  }
}

/**
 * 列出该用户的 pi 对话历史（含置顶/标题/轮次/时间）。仅收录存在 pi 会话文件的工作区；
 * nodeId 提供时按 `{nodeId}_` 前缀过滤（chat 节点工作区命名约定，见 PiChatNodeHost）。
 */
export function listPiConversations(userId: number, nodeId?: string): ConversationSummary[] {
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
    if (prefix && !dir.startsWith(prefix)) continue;
    // 防御双保险：readdir 本身无穿越风险，此处再拦相对跳转目录名
    if (dir === '.' || dir === '..' || dir.includes('/') || dir.includes('\\')) continue;
    const ws = path.join(root, dir);
    let st;
    try {
      st = statSync(ws);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const sessionFile = resolvePiSessionFile(ws);
    if (!sessionFile) continue; // 无 pi 会话（FastClaw/LLM 节点工作区或空目录）不入列
    let sessionStat;
    try {
      sessionStat = statSync(sessionFile);
    } catch {
      continue;
    }
    const meta = readConversationMeta(ws);
    const { createdAt: sessTs, firstUserText, userTurns } = readSessionMeta(sessionFile);
    const createdAt =
      sessTs ?? (st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs);
    const updatedAt = Math.max(sessionStat.mtimeMs, st.mtimeMs);
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
  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const pa = a.pinnedAt ?? 0;
    const pb = b.pinnedAt ?? 0;
    if (pa !== pb) return pb - pa;
    return b.updatedAt - a.updatedAt;
  });
  return out;
}

/**
 * 完整删除一条 pi 对话：终止活跃 RPC 子进程（问卷等待/流式中，Windows 需等其真正退出防文件锁）、
 * 清理该工作区子代理残留后整目录删除。目录不存在返回 false。
 */
export async function deletePiConversation(userId: number, workspaceId: string): Promise<boolean> {
  const sanitized = sanitizeWorkspaceId(workspaceId);
  if (!sanitized) return false;
  const root = workspaceRoot(userId);
  const ws = path.join(root, sanitized);
  // 双保险：目标必须落在该用户 workspace 根内（sanitizeWorkspaceId 已拒绝穿越字符）
  if (ws !== root && !ws.startsWith(root + path.sep)) return false;
  if (!existsSync(ws)) return false;
  await killPiProcess(userId, sanitized);
  try {
    cleanupSubagentAsyncRuns(userId, sanitized);
  } catch {
    /* 清理失败不阻塞删除主流程 */
  }
  rmSync(ws, { recursive: true, force: true });
  return true;
}
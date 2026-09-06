import path from 'node:path';
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * 通用文件工具（与 pi agent 无关的中立模块）。
 *
 * 集中管理：
 * - 扩展名 → MIME 推断（mimeOf）
 * - skill-files 下载/预览 URL（skillFileDownloadUrl）
 * - data URL 图片落盘（saveInputImages）
 * - 任意格式文件落盘工作区 inputs/（sanitizeUploadFileName / saveInputFile）
 * - 安全工作区路径删除（removePathSafe）
 *
 * 从 pi-agent-service 中拆出，供 skills / fastclaw-artifacts / pi-session-hydrate 等
 * 跨模块共用，避免无关模块从 pi 专属服务伸手拿工具函数的耦合。
 */

// ---------------------------------------------------------------------------
// MIME 推断
// ---------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

/** 按扩展名返回 MIME（未知扩展名按二进制处理）；供 skill-files 接口与 agent_file 事件共用。 */
export function mimeOf(fileName: string): string {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// 下载 URL
// ---------------------------------------------------------------------------

/** skill-files 下载/预览 URL（工作区相对路径 + workspace_id；agent_file 事件统一口径）。 */
export function skillFileDownloadUrl(rel: string, workspaceId: string): string {
  return `/api/modules/bookplate/skill-files?path=${encodeURIComponent(rel)}&workspace_id=${encodeURIComponent(workspaceId)}`;
}

// ---------------------------------------------------------------------------
// 任意格式文件落盘（工作区 inputs/）
// ---------------------------------------------------------------------------

/**
 * 上传文件名清洗：去路径成分（只留 basename）、去控制字符、截断超长名（保留扩展名）。
 * 空结果（或 . / ..）回退 fallback，防止目录穿越与空文件名落盘。
 */
export function sanitizeUploadFileName(raw: unknown, fallback = 'file'): string {
  let name = String(raw ?? '').trim().replace(/\\/g, '/').split('/').pop() ?? '';
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name || name === '.' || name === '..') name = fallback;
  const MAX = 120;
  if (name.length > MAX) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    name = name.slice(0, Math.max(1, MAX - ext.length)) + ext;
  }
  return name;
}

/**
 * 在 {ws}/inputs/ 下生成不冲突的文件名（同名追加「 (n)」），并确保目录存在。
 * 返回最终文件名（不含目录前缀）。
 */
export function uniqueInputFileName(ws: string, fileName: string): string {
  const dir = path.join(ws, 'inputs');
  mkdirSync(dir, { recursive: true });
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let candidate = fileName;
  let n = 1;
  while (existsSync(path.join(dir, candidate))) {
    candidate = `${stem} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

/**
 * 把任意格式字节写入 {ws}/inputs/（文件名清洗 + 同名去重），返回工作区相对路径
 * （inputs/<name>，正斜杠口径；与 agent_file 事件 / skill-files 接口的 path 一致）。
 */
export function saveInputFile(ws: string, fileName: string, data: Buffer | Uint8Array): string {
  const name = uniqueInputFileName(ws, sanitizeUploadFileName(fileName));
  writeFileSync(path.join(ws, 'inputs', name), data);
  return `inputs/${name}`;
}

// ---------------------------------------------------------------------------
// data URL 图片落盘
// ---------------------------------------------------------------------------

/**
 * 解析 data URL（仅 image/*，base64 编码）为 Buffer + 扩展名；非法返回 null。
 * 供 /chat/import 的 data_urls 通道（图片上传节点等 base64 输出）使用；
 * 调用方应再以魔数校验（detectImageExt）确认字节确为图片。
 */
export function decodeDataUrlImage(raw: unknown): { data: Buffer; ext: string } | null {
  const s = String(raw ?? '').trim();
  const idx = s.indexOf(',');
  if (idx < 0 || !s.startsWith('data:')) return null;
  const mimeMatch = /^data:image\/([a-z0-9.+-]+)/i.exec(s.slice(0, idx));
  if (!mimeMatch?.[1]) return null;
  const ext = mimeMatch[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  if (!/^[a-z0-9]{1,6}$/.test(ext)) return null;
  let data: Buffer;
  try {
    data = Buffer.from(s.slice(idx + 1), 'base64');
  } catch {
    return null;
  }
  if (!data.length) return null;
  return { data, ext };
}

/** 解析 data URL 图片并落盘到 ws/inputs/img-N.ext；返回供 @file 附加的相对路径。 */
export function saveInputImages(ws: string, images: string[]): string[] {
  const dir = path.join(ws, 'inputs');
  mkdirSync(dir, { recursive: true });
  const rels: string[] = [];
  for (const dataUrl of images.slice(0, 4)) {
    const idx = typeof dataUrl === 'string' ? dataUrl.indexOf(',') : -1;
    if (idx < 0 || !dataUrl.startsWith('data:image/')) continue;
    const meta = dataUrl.slice(0, idx);
    const extMatch = /^data:image\/([a-z0-9.+-]+)/i.exec(meta);
    if (!extMatch?.[1]) continue;
    const ext = extMatch[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    let buf: Buffer;
    try {
      buf = Buffer.from(dataUrl.slice(idx + 1), 'base64');
    } catch {
      continue;
    }
    if (!buf.length) continue;
    const rel = `inputs/img-${rels.length + 1}.${ext}`;
    writeFileSync(path.join(ws, rel), buf);
    rels.push(rel);
  }
  return rels;
}

// ---------------------------------------------------------------------------
// 路径删除
// ---------------------------------------------------------------------------

/** 安全的路径删除：目标缺失时静默忽略（与链路中 removePathSafe 语义一致）。 */
export function removePathSafe(p: string): void {
  try {
    rmSync(p, { force: true });
  } catch {
    /* 目录残留或不存在：忽略 */
  }
}

/** 工作区文件删除保护的相对路径前缀：装配物与会话配置（.pi-agent/ 内含 chat.jsonl、
 * artifacts.jsonl、snapshot.json、meta.json 等），删除列表（/chat/files）永不展示它们。 */
const DELETION_PROTECTED_PREFIXES = ['.agents/', '.pi/', '.pi-agent/'];

/** 工作区根级受保护文件（AGENTS.md 软链指向共享 agent 配置，误删影响后续装配）。 */
const DELETION_PROTECTED_FILES = new Set(['AGENTS.md']);

/**
 * 安全工作区文件删除（产物 / inputs/ 上传文件）：
 * - 词法层：拼接结果必须落在工作区根内（拒绝 ../ 越界与绝对路径）；
 * - 保护层：拒绝装配物 / 会话路径（.agents/ .pi/ .pi-agent/ AGENTS.md）；
 * - 符号层：realpath 穿透后必须仍落在工作区 realpath 内（防软链目录指向工作区外）；
 * - 只删文件 / 软链本身（目录整删风险大，拒绝；软链 unlink 只移除链接不穿透目标）。
 * 文件不存在或不可删除返回 false。
 */
export function deleteWorkspaceFileSafe(ws: string, rel: string): boolean {
  const cleaned = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/g, '');
  if (!cleaned || cleaned === '.' || cleaned === '..') return false;
  if (
    DELETION_PROTECTED_FILES.has(cleaned) ||
    DELETION_PROTECTED_PREFIXES.some((p) => cleaned.startsWith(p))
  ) {
    return false;
  }
  const target = path.resolve(ws, cleaned);
  if (target !== ws && !target.startsWith(ws + path.sep)) return false;
  let wsReal: string;
  let targetReal: string;
  try {
    wsReal = realpathSync(ws);
    targetReal = realpathSync(target);
  } catch {
    return false;
  }
  if (targetReal !== wsReal && !targetReal.startsWith(wsReal + path.sep)) return false;
  let st;
  try {
    st = lstatSync(target);
  } catch {
    return false;
  }
  if (st.isDirectory()) return false; // 只删文件，目录（含产物子目录）不整删
  try {
    unlinkSync(target);
    return true;
  } catch {
    return false; // 文件被占用（如 Windows 锁定）等：调用方提示重试
  }
}
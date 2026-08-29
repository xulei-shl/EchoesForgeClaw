import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

/**
 * 通用文件工具（与 pi agent 无关的中立模块）。
 *
 * 集中管理：
 * - 扩展名 → MIME 推断（mimeOf）
 * - skill-files 下载/预览 URL（skillFileDownloadUrl）
 * - data URL 图片落盘（saveInputImages）
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
// data URL 图片落盘
// ---------------------------------------------------------------------------

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
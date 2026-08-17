import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from '../config/database.js';
import { appSettings, promptMetadata } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Bifrost Prompt Repository 代理服务（对应 Python `app/services/bifrost_service.py`）。
 *
 * Bifrost Management API（所有 `/api/prompt-repo/*`）鉴权（自部署默认）：
 * - 主方案：Basic Auth（bifrost.username / bifrost.password，密码仅掩码回传）；
 * - 兼容方案：Bearer Management API Key（bifrost.api_key，旧部署回退）。
 * 两者都配置时 Basic 优先。
 *
 * 正文提取：提示词内容必须 Commit 成 Version 才存在，取 `latest_version`
 * （缺省回退 versions 数组）。真实结构为 `messages[].message.payload.content`。
 *
 * 预览图：本地存储（static/prompt-previews + prompt_metadata 表），列表/详情合并返回。
 */

export class BifrostError extends Error {}
export class BifrostNotConfiguredError extends BifrostError {}
export class BifrostNotFoundError extends BifrostError {}

const STATIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../static');
export const PREVIEW_DIR = path.join(STATIC_DIR, 'prompt-previews');
export const PREVIEW_PREFIX = '/static/prompt-previews';
export const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_MAGIC_PREFIXES: Array<[Uint8Array, string]> = [
  [new Uint8Array([0xff, 0xd8, 0xff]), '.jpg'],
  [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), '.png'],
  [new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), '.gif'],
  [new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), '.gif'],
];

/** 通过文件头魔数判断字节是否为真实图片；是则返回扩展名，否则 null。 */
export function detectImageExt(content: Uint8Array): string | null {
  if (!content.length) return null;
  for (const [magic, ext] of IMAGE_MAGIC_PREFIXES) {
    if (magic.length <= content.length && magic.every((b, i) => content[i] === b)) return ext;
  }
  // WebP: "RIFF....WEBP"
  if (
    content.length >= 12 &&
    content[0] === 0x52 && content[1] === 0x49 && content[2] === 0x46 && content[3] === 0x46 &&
    content[8] === 0x57 && content[9] === 0x45 && content[10] === 0x42 && content[11] === 0x50
  ) {
    return '.webp';
  }
  return null;
}

/** 把 prompt_id 清洗为安全的文件名基名（Bifrost 为 UUID，防御性兜底）。 */
export function sanitizePromptId(promptId: string): string {
  return promptId.replace(/[^A-Za-z0-9_-]/g, '') || 'prompt';
}

interface BifrostAuthConfig {
  base_url: string;
  username: string;
  password: string;
  api_key: string;
  allowed_folders: string[];
}

function bifrostConfig(db: DB): BifrostAuthConfig {
  const rows = db.select().from(appSettings).all();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  const allowedRaw = (map['bifrost.allowed_folders'] ?? '').trim();
  const allowed = Array.from(
    new Set(allowedRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  ).sort();
  return {
    base_url: (map['bifrost.base_url'] ?? '').trim().replace(/\/+$/, ''),
    username: (map['bifrost.username'] ?? '').trim(),
    password: map['bifrost.password'] ?? '',
    api_key: (map['bifrost.api_key'] ?? '').trim(),
    allowed_folders: allowed,
  };
}

function headersOf(cfg: BifrostAuthConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cfg.username && cfg.password) {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`;
  } else if (cfg.api_key) {
    headers.Authorization = `Bearer ${cfg.api_key}`;
  }
  return headers;
}

function folderAllowed(cfg: BifrostAuthConfig, folderId: unknown, folderName: unknown): boolean {
  if (!cfg.allowed_folders.length) return true;
  const id = folderId != null ? String(folderId).trim().toLowerCase() : '';
  const name = folderName != null ? String(folderName).trim().toLowerCase() : '';
  return cfg.allowed_folders.includes(id) || cfg.allowed_folders.includes(name);
}

function requireConfig(db: DB): BifrostAuthConfig {
  const cfg = bifrostConfig(db);
  if (!cfg.base_url) {
    throw new BifrostNotConfiguredError('Bifrost 未配置：请在「系统设置」中添加 bifrost.base_url');
  }
  if (!((cfg.username && cfg.password) || cfg.api_key)) {
    throw new BifrostNotConfiguredError(
      'Bifrost 未配置：请在「系统设置」中添加 bifrost.username / bifrost.password（或兼容的 bifrost.api_key）'
    );
  }
  return cfg;
}

async function getJson(
  cfg: BifrostAuthConfig,
  apiPath: string,
  params?: Record<string, string>,
  raw = false
): Promise<unknown> {
  const url = `${cfg.base_url}${apiPath}`;
  let resp: Response;
  try {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    resp = await fetch(url + qs, {
      headers: headersOf(cfg),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new BifrostError(`连接 Bifrost 失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (resp.status === 404) throw new BifrostNotFoundError('Bifrost 资源不存在（可能已被删除）');
  if (resp.status !== 200) {
    let detail = '';
    try {
      detail = (await resp.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new BifrostError(`Bifrost API 返回 HTTP ${resp.status}: ${detail}`);
  }
  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    throw new BifrostError('Bifrost 返回了非 JSON 响应');
  }
  // Bifrost 部分错误以 HTTP 200 + is_bifrost_error 标记返回（网关形态）
  if (!raw && data && typeof data === 'object' && (data as { is_bifrost_error?: boolean }).is_bifrost_error) {
    const d = data as { status_code?: number; error?: { message?: string } | unknown; type?: string };
    if (d.status_code === 404) throw new BifrostNotFoundError('Bifrost 资源不存在（可能已被删除）');
    const err = d.error;
    const message = err && typeof err === 'object' && (err as { message?: unknown }).message
      ? String((err as { message: unknown }).message)
      : '';
    throw new BifrostError(message || `Bifrost 返回错误: ${d.type ?? d.status_code ?? '未知'}`);
  }
  return data;
}

function asList(payload: unknown, key: string): Array<Record<string, any>> {
  if (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>)[key])) {
    return (payload as Record<string, unknown[]>)[key] as Array<Record<string, any>>;
  }
  if (Array.isArray(payload)) return payload as Array<Record<string, any>>;
  return [];
}

function messageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const m = message as Record<string, any>;
  const payload = m.payload;
  if (payload && typeof payload === 'object') {
    const content = payload.content;
    if (typeof content === 'string' && content.trim()) return content.trim();
  }
  const content = m.content;
  if (typeof content === 'string') return content.trim();
  return '';
}

function pickMessageSource(prompt: Record<string, any>): { source?: Record<string, any>; kind: string } {
  const latest = prompt.latest_version;
  if (latest && typeof latest === 'object' && Array.isArray(latest.messages) && latest.messages.length) {
    return { source: latest, kind: 'latest_version' };
  }
  const versions = prompt.versions;
  if (Array.isArray(versions) && versions.length) {
    const ordered = versions
      .filter((v) => v && typeof v === 'object' && Array.isArray(v.messages) && v.messages.length)
      .sort((a, b) => {
        const an = typeof (a as { version_number?: unknown }).version_number === 'number'
          ? (a as { version_number: number }).version_number
          : (a as { id?: unknown }).id ?? 0;
        const bn = typeof (b as { version_number?: unknown }).version_number === 'number'
          ? (b as { version_number: number }).version_number
          : (b as { id?: unknown }).id ?? 0;
        return Number(bn) - Number(an);
      });
    if (ordered.length) return { source: ordered[0] as Record<string, any>, kind: 'versions' };
  }
  return { source: latest && typeof latest === 'object' ? latest : undefined, kind: 'latest_version' };
}

function extractPromptText(prompt: Record<string, any>): string {
  const { source } = pickMessageSource(prompt);
  if (!source) return '';
  const messages = source.messages ?? [];
  const parts: string[] = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const msg = (m as Record<string, any>).message;
    const text = messageText(msg && typeof msg === 'object' ? msg : m);
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

function folderNameOf(prompt: Record<string, any>): unknown {
  const folder = prompt.folder;
  if (folder && typeof folder === 'object') return (folder as { name?: unknown }).name;
  return null;
}

function previewMap(db: DB, promptIds: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!promptIds.length) return out;
  for (const id of promptIds) {
    const row = db.select().from(promptMetadata).where(eq(promptMetadata.promptId, id)).get();
    if (row?.previewImage) out.set(id, row.previewImage);
  }
  return out;
}

function compactPrompt(prompt: Record<string, any>, previewImage: string | null): Record<string, any> {
  const { source } = pickMessageSource(prompt);
  return {
    id: prompt.id ?? '',
    name: prompt.name ?? '',
    folder_id: prompt.folder_id ?? null,
    folder_name: folderNameOf(prompt) ?? null,
    content: extractPromptText(prompt),
    preview_image: previewImage ?? null,
    created_at: prompt.created_at ?? null,
    updated_at: prompt.updated_at ?? null,
    version_number: source?.version_number ?? null,
    commit_message: source?.commit_message ?? null,
  };
}

/** 列出文件夹（配置白名单时默认仅返回白名单文件夹）。 */
export async function listFolders(db: DB, includeAll = false): Promise<Record<string, any>[]> {
  const cfg = requireConfig(db);
  const payload = await getJson(cfg, '/api/prompt-repo/folders');
  let folders = asList(payload, 'folders');
  if (cfg.allowed_folders.length && !includeAll) {
    folders = folders.filter((f) => f && folderAllowed(cfg, f.id, f.name));
  }
  return folders;
}

// 列表 / 检索的 TTL 内存缓存（对应 Python async_ttl_cache，300s）
const ttlCache = new Map<string, { value: unknown; expiresAt: number }>();
const TTL_MS = 300_000;

function cached<T>(key: string, compute: () => Promise<T>, force = false): Promise<T> {
  const now = Date.now();
  if (!force) {
    const hit = ttlCache.get(key);
    if (hit && hit.expiresAt > now) return Promise.resolve(hit.value as T);
  }
  return compute().then((value) => {
    ttlCache.set(key, { value, expiresAt: now + TTL_MS });
    return value;
  });
}

/** 列出提示词（可选按文件夹过滤 / 关键词 q 对名称+正文过滤），合并本地预览图。
 *  force=true 时绕过 5 分钟 TTL 缓存强制拉取 Bifrost（关键词过滤在缓存全量上本地做，故 q 不进缓存 key）。 */
export async function listPrompts(
  db: DB,
  folderId: string | null = null,
  q = '',
  force = false
): Promise<Record<string, any>[]> {
  const cfg = requireConfig(db);
  const cacheKey = `list:${cfg.base_url}:${folderId ?? ''}`;
  const payload = await cached(
    cacheKey,
    () => getJson(cfg, '/api/prompt-repo/prompts', folderId ? { folder_id: folderId } : undefined),
    force
  );
  const prompts = asList(payload, 'prompts');
  if (!prompts.length) return [];
  const previews = previewMap(db, prompts.map((p) => p.id).filter(Boolean));
  const keyword = q.trim().toLowerCase();
  const items: Record<string, any>[] = [];
  for (const p of prompts) {
    const pid = p.id;
    if (!pid) continue;
    if (!folderAllowed(cfg, p.folder_id, folderNameOf(p))) continue;
    const item = compactPrompt(p, previews.get(pid) ?? null);
    if (keyword) {
      const haystack = `${item.name}\n${item.content}`.toLowerCase();
      if (!haystack.includes(keyword)) continue;
    }
    items.push(item);
  }
  return items;
}

/** 提示词列表的 Bifrost 原始响应（调试用）。 */
export async function listPromptsRaw(db: DB, folderId: string | null = null): Promise<unknown> {
  const cfg = requireConfig(db);
  return getJson(cfg, '/api/prompt-repo/prompts', folderId ? { folder_id: folderId } : undefined, true);
}

/** 单个提示词详情（含提取的正文 + 本地预览图；白名单过滤同样作用于详情）。 */
export async function getPrompt(db: DB, promptId: string): Promise<Record<string, any>> {
  const cfg = requireConfig(db);
  const payload = await getJson(cfg, `/api/prompt-repo/prompts/${promptId}`);
  if (!payload || typeof payload !== 'object') throw new BifrostError('Bifrost 返回了非预期的提示词数据');
  const prompt = (payload as { prompt?: unknown }).prompt ?? payload;
  if (!prompt || typeof prompt !== 'object') throw new BifrostError('Bifrost 返回了非预期的提示词数据');
  const p = prompt as Record<string, any>;
  if (!folderAllowed(cfg, p.folder_id, folderNameOf(p))) {
    throw new BifrostNotFoundError('Bifrost 资源不存在（可能已被删除）');
  }
  const previews = previewMap(db, [promptId]);
  return compactPrompt(p, previews.get(promptId) ?? null);
}

/** 单个提示词的 Bifrost 原始响应（调试用）。 */
export async function getPromptRaw(db: DB, promptId: string): Promise<unknown> {
  const cfg = requireConfig(db);
  return getJson(cfg, `/api/prompt-repo/prompts/${promptId}`, undefined, true);
}

/** 检索 Bifrost Skills 仓库（按名称/描述）；force=true 绕过 5 分钟 TTL 缓存强制拉取远端。 */
export async function searchBifrostSkills(db: DB, q = '', limit = 50, force = false): Promise<Record<string, any>[]> {
  const cfg = requireConfig(db);
  const params: Record<string, string> = { limit: String(Math.min(Math.max(limit, 1), 100)) };
  if (q.trim()) params.search = q.trim();
  const cacheKey = `skills:${cfg.base_url}:${params.search ?? ''}:${params.limit}`;
  const payload = await cached(cacheKey, () => getJson(cfg, '/api/skills', params), force);
  const skills = asList(payload, 'skills');
  return skills.map((s) => ({
    id: s.id ?? '',
    name: s.name ?? '',
    description: s.description ?? '',
    license: s.license ?? '',
    compatibility: s.compatibility ?? '',
    skill_md_body: s.skill_md_body ?? '',
    latest_version: s.latest_version ?? '',
    file_count: s.file_count ?? 0,
    files: (Array.isArray(s.files) ? s.files : []).map((f) => ({ path: f?.path ?? '' })),
    created_at: s.created_at ?? null,
    updated_at: s.updated_at ?? null,
  }));
}

/** 下载单个 skill 的完整 ZIP（Serving API，公开接口）。 */
export async function downloadBifrostSkillZip(db: DB, skillName: string): Promise<Uint8Array> {
  const cfg = bifrostConfig(db);
  if (!cfg.base_url) {
    throw new BifrostNotConfiguredError('Bifrost 未配置：请在「系统设置」中添加 bifrost.base_url');
  }
  if (!skillName.trim()) throw new BifrostError('skill 名称不能为空');
  const url = `${cfg.base_url}/api/skills/serve/${encodeURIComponent(skillName.trim())}/download.zip`;
  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new BifrostError(`连接 Bifrost 失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (resp.status === 404) throw new BifrostNotFoundError('skill 不存在（可能已被删除）');
  if (resp.status !== 200) {
    let detail = '';
    try {
      detail = (await resp.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new BifrostError(`Bifrost 返回 HTTP ${resp.status}: ${detail}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

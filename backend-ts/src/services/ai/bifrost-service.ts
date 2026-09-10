import path from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DB } from '../../config/database.js';
import { appSettings, promptMetadata } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { RUNTIME_ROOT, listSharedBifrostSkills } from './skill-agent-service.js';
import {
  RESOURCE_TYPE_BIFROST_SKILL,
  getUserAnnotationMap,
} from '../platform/annotation-service.js';

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
 * 预览图：物理文件在根目录 runtime/prompt-previews（运行时数据目录，与 covers/generated
 * 同一持久化口径，不随应用目录重建丢失），prompt_metadata 表记录公开 URL，
 * 列表/详情合并返回；文件缺失（如仅恢复了 DB）时视为无预览图，前端自愈展示「暂无」。
 */

export class BifrostError extends Error {}
export class BifrostNotConfiguredError extends BifrostError {}
export class BifrostNotFoundError extends BifrostError {}

/** 旧版物理位置（代码目录内，升级有丢失风险）；启动时由 migrateLegacyPreviewFiles 搬迁。 */
const LEGACY_PREVIEW_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../static/prompt-previews'
);
export const PREVIEW_DIR = path.join(RUNTIME_ROOT, 'prompt-previews');
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
  raw = false,
  timeoutMs = 30_000
): Promise<unknown> {
  const url = `${cfg.base_url}${apiPath}`;
  let resp: Response;
  try {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    resp = await fetch(url + qs, {
      headers: headersOf(cfg),
      signal: AbortSignal.timeout(timeoutMs),
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
    if (row?.previewImage) {
      const filename = row.previewImage.split('/').pop();
      // 文件缺失（DB 悬空引用）：不返回该 URL，前端展示「暂无预览图」而非破图
      if (filename && existsSync(path.join(PREVIEW_DIR, filename))) out.set(id, row.previewImage);
    }
  }
  return out;
}

/**
 * 旧部署升级搬迁：backend-ts/static/prompt-previews → runtime/prompt-previews（幂等）。
 * URL 前缀不变，prompt_metadata 无需数据迁移；目标已存在同名文件则跳过（保留旧副本，宁可冗余不可丢失），
 * 旧目录搬空后尝试清理。启动时调用。
 */
export function migrateLegacyPreviewFiles(): void {
  if (!existsSync(LEGACY_PREVIEW_DIR)) return;
  try {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    for (const name of readdirSync(LEGACY_PREVIEW_DIR)) {
      try {
        const source = path.join(LEGACY_PREVIEW_DIR, name);
        if (!statSync(source).isFile()) continue;
        const target = path.join(PREVIEW_DIR, name);
        if (existsSync(target)) continue; // 同名冲突：保留旧副本，宁可冗余不可丢失
        copyFileSync(source, target);
        unlinkSync(source); // 复制成功后才删源；失败则旧目录搬不空，下次启动重试
      } catch {
        /* 单文件失败不阻断其余文件搬迁 */
      }
    }
    if (!readdirSync(LEGACY_PREVIEW_DIR).length) rmdirSync(LEGACY_PREVIEW_DIR);
  } catch {
    /* 搬迁失败不阻断启动：旧目录仍在时下次启动重试 */
  }
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

/** 列出文件夹（配置白名单时默认仅返回白名单文件夹）。支持 300s TTL 缓存，force=true 时强制穿透。 */
export async function listFolders(db: DB, includeAll = false, force = false): Promise<Record<string, any>[]> {
  const cfg = requireConfig(db);
  const cacheKey = `folders:${cfg.base_url}`;
  const payload = await cached(cacheKey, () => getJson(cfg, '/api/prompt-repo/folders'), force);
  let folders = asList(payload, 'folders');
  if (cfg.allowed_folders.length && !includeAll) {
    folders = folders.filter((f) => f && folderAllowed(cfg, f.id, f.name));
  }
  return folders;
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

// ---- Bifrost Skills 目录检索（区别于 prompts：全量目录按 base_url 缓存，关键词本地过滤）----

/** Bifrost /api/skills 单页 limit 上限（官方接口约束）。 */
const SKILLS_PAGE_SIZE = 100;
/** 目录拉取的防御性上限（防止分页异常时死循环）。 */
const SKILLS_CATALOG_MAX = 2000;
/** 单页拉取超时：检索路径要快（交互场景），远小于 prompts 的 30s。 */
const SKILLS_FETCH_TIMEOUT_MS = 8_000;
/** 拉取失败后的「不可达」负缓存窗口：期间直接跳过远端，仅用本地缓存。 */
const SKILLS_UNREACHABLE_TTL_MS = 60_000;

/** Bifrost 不可达负缓存：base_url → 窗口截止时间。 */
const unreachableUntil = new Map<string, number>();
function markSkillsUnreachable(baseUrl: string): void {
  unreachableUntil.set(baseUrl, Date.now() + SKILLS_UNREACHABLE_TTL_MS);
}
function isSkillsUnreachable(baseUrl: string): boolean {
  const until = unreachableUntil.get(baseUrl) ?? 0;
  if (until <= Date.now()) unreachableUntil.delete(baseUrl);
  return until > Date.now();
}

/** 压缩远端 skill 原始对象为检索元数据（与旧 searchBifrostSkills 输出口径一致）。 */
function compactSkill(s: Record<string, any>): Record<string, any> {
  return {
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
  };
}

/** 分页拉取 Bifrost Skills 全量目录（updated_at desc；单页 100 条，直到 total 或不足一页）。 */
async function fetchSkillCatalog(db: DB): Promise<Record<string, any>[]> {
  const cfg = requireConfig(db);
  const collected: Record<string, any>[] = [];
  const seen = new Set<string>();
  const maxPages = Math.ceil(SKILLS_CATALOG_MAX / SKILLS_PAGE_SIZE);
  for (let page = 0; page < maxPages; page++) {
    const payload = await getJson(
      cfg,
      '/api/skills',
      {
        limit: String(SKILLS_PAGE_SIZE),
        offset: String(page * SKILLS_PAGE_SIZE),
        sort_by: 'updated_at',
        order: 'desc',
      },
      false,
      SKILLS_FETCH_TIMEOUT_MS
    );
    const skills = asList(payload, 'skills');
    if (!skills.length) break;
    for (const s of skills) {
      const name = String(s.name ?? '');
      if (name && !seen.has(name)) {
        seen.add(name);
        collected.push(s);
      }
    }
    const total =
      payload && typeof payload === 'object' && typeof (payload as { total?: unknown }).total === 'number'
        ? (payload as { total: number }).total
        : undefined;
    if (total != null && collected.length >= total) break;
    if (skills.length < SKILLS_PAGE_SIZE) break; // 无 total 时按「不足一页」判定结束
  }
  return collected;
}

/** 本地过滤全量目录（名称/描述/正文），截取前 limit 条。 */
function filterSkillCatalog(catalog: Record<string, any>[], q: string, limit: number): Record<string, any>[] {
  const keyword = q.trim().toLowerCase();
  const out: Record<string, any>[] = [];
  for (const s of catalog) {
    if (keyword) {
      const hay = `${s.name ?? ''}\n${s.description ?? ''}\n${s.skill_md_body ?? ''}`.toLowerCase();
      if (!hay.includes(keyword)) continue;
    }
    out.push(compactSkill(s));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 检索 Bifrost Skills 仓库（全量目录 TTL 缓存 + 本地关键词过滤）。
 * - 目录按 base_url 缓存 5 分钟（force=true 绕过），关键词不进缓存 key → 逐词搜索不再穿透远端；
 * - 拉取失败（连接/HTTP 错误）进入 60s 不可达负缓存，期间抛 BifrostError（调用方降级为仅本地缓存）；
 * - 未配置（BifrostNotConfiguredError）不缓存失败，配置后立即生效。
 */
export async function searchBifrostSkills(db: DB, q = '', limit = 50, force = false): Promise<Record<string, any>[]> {
  const cfg = requireConfig(db);
  const cappedLimit = Math.min(Math.max(limit, 1), SKILLS_CATALOG_MAX);
  const catalogKey = `skills-catalog:${cfg.base_url}`;
  if (!force) {
    if (isSkillsUnreachable(cfg.base_url)) {
      throw new BifrostError('Bifrost 暂不可达（负缓存窗口内，请稍后重试）');
    }
    const hit = ttlCache.get(catalogKey);
    if (hit && hit.expiresAt > Date.now()) {
      return filterSkillCatalog(hit.value as Record<string, any>[], q, cappedLimit);
    }
  }
  let catalog: Record<string, any>[];
  try {
    catalog = await fetchSkillCatalog(db);
  } catch (err) {
    if (err instanceof BifrostError && !(err instanceof BifrostNotConfiguredError)) {
      markSkillsUnreachable(cfg.base_url);
    }
    throw err;
  }
  ttlCache.set(catalogKey, { value: catalog, expiresAt: Date.now() + TTL_MS });
  return filterSkillCatalog(catalog, q, cappedLimit);
}

/**
 * 按名称查单个 skill 的远端最新版本号（用于下载/同步时记录缓存版本戳）。
 * 优先复用 TTL 内的目录缓存（零网络请求）；仅当缓存缺失时拉取一次目录。
 * 任何失败（未配置/不可达/超时）返回 ''，版本标记是尽力而为，不应阻断下载。
 */
export async function lookupBifrostSkillVersion(db: DB, skillName: string): Promise<string> {
  const name = (skillName ?? '').trim();
  if (!name) return '';
  try {
    const cfg = requireConfig(db);
    const catalogKey = `skills-catalog:${cfg.base_url}`;
    const hit = ttlCache.get(catalogKey);
    if (hit && hit.expiresAt > Date.now()) {
      const found = (hit.value as Record<string, any>[]).find((s) => String(s.name) === name);
      return String(found?.latest_version ?? '');
    }
    const catalog = await fetchSkillCatalog(db);
    ttlCache.set(catalogKey, { value: catalog, expiresAt: Date.now() + TTL_MS });
    const found = catalog.find((s) => String(s.name) === name);
    return String(found?.latest_version ?? '');
  } catch {
    return ''; // 未配置/不可达：不记录版本（读取端回退 updated_at 口径），不影响安装
  }
}

/**
 * 单个 skill 的完整元数据（SKILL.md 正文 + 文件树），供列表瘦身后的详情展示。
 * 本地共享区已缓存则直接读盘返回；否则按 name 定位远端 id 后拉取 Management 详情。
 * 不存在返回 null。
 */
export async function getBifrostSkillDetail(db: DB, skillName: string): Promise<Record<string, any> | null> {
  const name = (skillName ?? '').trim();
  if (!name) return null;
  const local = listSharedBifrostSkills().find((s) => String(s.name) === name);
  if (local) {
    const detail: Record<string, any> = { ...local, cached: true };
    if (typeof detail.file_count !== 'number') {
      detail.file_count = Array.isArray(detail.files) ? (detail.files as unknown[]).length : 0;
    }
    return detail;
  }

  // 未缓存：从目录定位 id → Management 详情
  const cfg = requireConfig(db);
  if (isSkillsUnreachable(cfg.base_url)) {
    throw new BifrostError('Bifrost 暂不可达（负缓存窗口内，请稍后重试）');
  }
  const catalogKey = `skills-catalog:${cfg.base_url}`;
  let catalog: Record<string, any>[];
  const hit = ttlCache.get(catalogKey);
  if (hit && hit.expiresAt > Date.now()) {
    catalog = hit.value as Record<string, any>[];
  } else {
    try {
      catalog = await fetchSkillCatalog(db);
      ttlCache.set(catalogKey, { value: catalog, expiresAt: Date.now() + TTL_MS });
    } catch (err) {
      if (err instanceof BifrostError && !(err instanceof BifrostNotConfiguredError)) {
        markSkillsUnreachable(cfg.base_url);
      }
      throw err;
    }
  }
  const found = catalog.find((s) => String(s.name) === name);
  if (!found?.id) return null;
  const payload = await getJson(
    cfg,
    `/api/skills/${encodeURIComponent(String(found.id))}`,
    undefined,
    false,
    SKILLS_FETCH_TIMEOUT_MS
  );
  const skill =
    payload && typeof payload === 'object' && (payload as { skill?: unknown }).skill
      ? (payload as { skill: Record<string, any> }).skill
      : payload;
  if (!skill || typeof skill !== 'object') throw new BifrostError('Bifrost 返回了非预期的 skill 数据');
  const raw = skill as Record<string, any>;
  const compact = compactSkill(raw);
  return {
    ...compact,
    body: compact.skill_md_body ?? '',
    cached: false,
    // 详情弹窗按路径字符串渲染，与管理端列表（本地缓存）口径一致
    files: (Array.isArray(raw.files) ? raw.files : []).map((f) => String((f as { path?: unknown })?.path ?? '')),
  };
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

export interface MergedBifrostSkillOptions {
  db: DB;
  userId?: number;
  q?: string;
  limit?: number;
  force?: boolean;
}

export interface MergedBifrostSkillsResult {
  skills: Record<string, any>[];
  remote_available: boolean;
}

/**
 * 混合检索 Bifrost Skills（共享区本地缓存优先 + 远端合并浏览 + 离线优雅降级）。
 * 供 Admin 管理端（/api/admin/bifrost-skills）与画布节点检索（/api/modules/bookplate/skills/bifrost-search）公用。
 */
export async function getMergedBifrostSkills(
  options: MergedBifrostSkillOptions
): Promise<MergedBifrostSkillsResult> {
  const { db, userId, q = '', limit = 50, force = false } = options;
  const keyword = q.trim().toLowerCase();

  // 1. 本地共享区缓存（浅拷贝：下方合并会写回远端富化字段，避免污染共享列表缓存）
  const localSkills = listSharedBifrostSkills().map((s) => ({ ...s }));
  const localNames = new Set<string>();
  for (const s of localSkills) {
    if (s?.name) localNames.add(String(s.name));
  }

  // 2. 尝试向远端发起检索（带 force / limit）
  let remoteAvailable = false;
  let remote: Record<string, any>[] = [];
  try {
    remote = await searchBifrostSkills(db, q, limit, force);
    remoteAvailable = true;
  } catch {
    /* Bifrost 不可达 / 未配置：静默降级为仅本地缓存 */
  }

  const remoteMap = new Map<string, Record<string, any>>();
  for (const r of remote) {
    if (r?.name) remoteMap.set(String(r.name), r);
  }

  const merged: Record<string, any>[] = [];

  // 3. 组装本地技能（若有搜索词，本地进行名称/描述/正文匹配）
  for (const s of localSkills) {
    const name = String(s.name ?? '');
    const desc = String(s.description ?? '');
    const body = String(s.body ?? '');
    if (keyword) {
      const match =
        name.toLowerCase().includes(keyword) ||
        desc.toLowerCase().includes(keyword) ||
        body.toLowerCase().includes(keyword);
      if (!match) continue;
    }

    const r = remoteMap.get(name);
    if (r) {
      s.latest_version = r.latest_version ?? '';
      s.license = r.license ?? '';
      s.compatibility = r.compatibility ?? '';
      s.file_count = r.file_count ?? 0;
      s.remote_updated_at = r.updated_at ?? null;
    }
    if (typeof s.file_count !== 'number') {
      s.file_count = Array.isArray(s.files) ? (s.files as unknown[]).length : 0;
    }
    s.cached = true;
    merged.push(s);
  }

  // 4. 追加远端有、本地未缓存的技能
  for (const r of remote) {
    const name = String(r.name ?? '');
    if (!name || localNames.has(name)) continue;
    merged.push({
      cached: false,
      id: r.id ?? '',
      name,
      description: r.description ?? '',
      body: r.skill_md_body ?? '',
      files: [],
      latest_version: r.latest_version ?? '',
      license: r.license ?? '',
      compatibility: r.compatibility ?? '',
      file_count: r.file_count ?? 0,
      remote_updated_at: r.updated_at ?? null,
    });
  }

  // 5. 富化当前用户的打标与私有备注
  if (userId && merged.length) {
    const skillNames = merged.map((s) => String(s.name ?? '')).filter(Boolean);
    const annotations = getUserAnnotationMap(db, userId, RESOURCE_TYPE_BIFROST_SKILL, skillNames);
    for (const s of merged) {
      const ann = annotations.get(String(s.name ?? ''));
      s.user_rating = ann?.rating ?? 0;
      s.user_note = ann?.note ?? '';
      s.note = ann?.note ?? '';
    }
  }

  // 6. 列表瘦身：检索/管理列表仅需元数据（body/files 由详情接口按需返回），
  //    支撑数百 skill 目录的轻量响应（详情弹窗改走 GET /api/admin/bifrost-skills/:name）
  for (const s of merged) {
    delete s.body;
    delete s.skill_md_body;
    delete s.files;
  }

  return { skills: merged, remote_available: remoteAvailable };
}


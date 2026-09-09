import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AsyncRateLimiter, COVER_REFERERS, USER_AGENTS } from '../../services/node/douban-service.js';
import { getDb } from '../../config/database.js';
import { bookCache } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { RUNTIME_ROOT } from '../../services/ai/skill-agent-service.js';

/**
 * 豆瓣封面本地缓存（对应 Python `router.py` 的封面下载/缓存逻辑）。
 *
 * 豆瓣图片 CDN 有 Referer 防盗链（非豆瓣 Referer 直接 403），且 <img> 标签无法携带
 * Authorization 头，因此统一由后端携带 Referer 下载一次并缓存到 `runtime/covers`（跨用户共享，
 * 与全局 book_cache 表口径一致），前端从 /static/covers/... 直接加载（URL 前缀不变，
 * 物理文件由 server.ts 的白名单公开路由服务）。
 * 反爬时豆瓣 CDN 返回「HTTP 200 + JS 挑战页」，必须校验文件头魔数（命中则轮换
 * Referer 重试），损坏的旧缓存会被删除重下。
 */

export const COVERS_DIR = path.join(RUNTIME_ROOT, 'covers');
export const COVERS_PREFIX = '/static/covers';

const MAX_COVER_BYTES = 5 * 1024 * 1024;

const _IMAGE_MAGIC_PREFIXES: Array<[number[], string]> = [
  [[0xff, 0xd8, 0xff], '.jpg'],
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '.png'],
  [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], '.gif'],
  [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], '.gif'],
];

/** 通过文件头魔数判断字节是否为真实图片；是则返回扩展名，否则 null。 */
export function detectImageExt(content: Uint8Array): string | null {
  if (!content.length) return null;
  for (const [magic, ext] of _IMAGE_MAGIC_PREFIXES) {
    if (magic.every((b, i) => content[i] === b)) return ext;
  }
  if (
    content.length >= 12 &&
    String.fromCharCode(...content.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...content.subarray(8, 12)) === 'WEBP'
  ) {
    return '.webp';
  }
  return null;
}

function digestOf(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

/** 是否 doubanio.com 域名的图片 URL（SSRF 面受控）。 */
function isDoubanImageUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.doubanio.com');
  } catch {
    return false;
  }
}

/** 查询本地缓存中是否已有该封面的有效图片；命中返回本地 URL，否则 null。 */
export function cachedCoverUrl(url: string): string | null {
  if (!isDoubanImageUrl(url)) return null;
  const digest = digestOf(url);
  if (!existsSync(COVERS_DIR)) return null;
  const names = readdirSync(COVERS_DIR).filter((n) => n.startsWith(digest + '.'));
  for (const name of names) {
    const full = path.join(COVERS_DIR, name);
    try {
      const head = new Uint8Array(readFileSync(full).subarray(0, 12));
      if (detectImageExt(head)) return `${COVERS_PREFIX}/${name}`;
      unlinkSync(full); // 损坏缓存：删除重下
    } catch {
      /* 继续 */
    }
  }
  return null;
}

/** cover_image_local 记录的本地文件是否已失效（不存在即视为缺失）。 */
export function coverLocalMissing(localUrl: string | null): boolean {
  if (!localUrl) return true;
  const name = localUrl.split('/').pop()!;
  return !existsSync(path.join(COVERS_DIR, name));
}

/** 封面下载默认限流器（模块级共享，画廊多图并发加载时统一节奏）。 */
const coverLimiter = new AsyncRateLimiter(2, 0.5);

export interface CoverFetchOptions {
  proxy?: string;
  isDisconnected?: () => Promise<boolean>;
}

/** 将豆瓣封面下载到本地缓存并返回本地 URL；失败返回 null。 */
export async function downloadDoubanCover(
  url: string,
  opts: CoverFetchOptions = {}
): Promise<string | null> {
  if (!isDoubanImageUrl(url)) return null;
  const cached = cachedCoverUrl(url);
  if (cached) return cached;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (opts.isDisconnected && (await opts.isDisconnected())) return null;
    const headers = {
      Referer: COVER_REFERERS[attempt % COVER_REFERERS.length]!,
      'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!,
    };
    let resp: Response | null = null;
    try {
      await coverLimiter.acquire();
      try {
        resp = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
      } finally {
        coverLimiter.release();
      }
    } catch {
      resp = null; // 网络异常（超时/断连）短暂等待后重试
    }
    if (resp && resp.status === 200) {
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const ext = detectImageExt(bytes.subarray(0, 12));
      if (ext) {
        if (bytes.length > MAX_COVER_BYTES) return null;
        const filename = `${digestOf(url)}${ext}`;
        mkdirSync(COVERS_DIR, { recursive: true });
        writeFileSync(path.join(COVERS_DIR, filename), bytes);
        return `${COVERS_PREFIX}/${filename}`;
      }
      // 200 但非图片（JS 反爬挑战页）：轮换 Referer + 延迟后重试
    } else if (resp && resp.status === 404) {
      return null;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 + attempt * 1000));
  }
  return null;
}

/** 返回封面图片原始字节（用于多模态分析），失败返回 null。 */
export async function fetchCoverBytes(url: string, opts: CoverFetchOptions = {}): Promise<Uint8Array | null> {
  if (!isDoubanImageUrl(url)) return null;
  const cached = cachedCoverUrl(url);
  if (cached) {
    const name = cached.split('/').pop()!;
    try {
      return new Uint8Array(readFileSync(path.join(COVERS_DIR, name)));
    } catch {
      /* 文件异常，回退重新下载 */
    }
  }
  const local = await downloadDoubanCover(url, opts);
  if (!local) return null;
  const name = local.split('/').pop()!;
  try {
    return new Uint8Array(readFileSync(path.join(COVERS_DIR, name)));
  } catch {
    return null;
  }
}

/**
 * 手动上传封面兜底：校验图片魔数后落盘 runtime/covers（沿用 digest 命名规则，
 * 以 `manual:{isbn}` 为摘要来源，同一 ISBN 稳定同名、可覆盖旧扩展名），
 * 并回写 book_cache.cover_image_local；非法图片返回 null。
 */
export function saveManualCover(isbn: string, bytes: Uint8Array): string | null {
  const ext = detectImageExt(bytes.subarray(0, 12));
  if (!ext) return null;
  if (bytes.length > MAX_COVER_BYTES) return null;
  const filename = `${digestOf(`manual:${isbn}`)}${ext}`;
  mkdirSync(COVERS_DIR, { recursive: true });
  // 扩展名可能变化：覆盖前清掉同基名的所有历史文件
  for (const name of readdirSync(COVERS_DIR)) {
    if (name.split('.')[0] === digestOf(`manual:${isbn}`)) {
      try {
        unlinkSync(path.join(COVERS_DIR, name));
      } catch {
        /* 忽略清理失败 */
      }
    }
  }
  writeFileSync(path.join(COVERS_DIR, filename), bytes);
  const local = `${COVERS_PREFIX}/${filename}`;
  getDb()
    .update(bookCache)
    .set({ coverImageLocal: local })
    .where(eq(bookCache.isbn, isbn))
    .run();
  return local;
}

/** 后台任务：下载封面到本地缓存并回写 book_cache.cover_image_local。 */
export async function backgroundCoverTask(
  isbn: string,
  coverImage: string,
  proxy = ''
): Promise<void> {
  const local = await downloadDoubanCover(coverImage, { proxy });
  if (!local) return;
  const row = getDb().select().from(bookCache).where(eq(bookCache.isbn, isbn)).get();
  if (row && row.coverImageLocal !== local) {
    getDb().update(bookCache).set({ coverImageLocal: local }).where(eq(bookCache.isbn, isbn)).run();
  }
}


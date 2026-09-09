import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, setDb } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { PREVIEW_DIR, migrateLegacyPreviewFiles } from '../../src/services/ai/bifrost-service.js';

/**
 * Bifrost 提示词预览图持久化：
 * - /static/prompt-previews/:file 白名单路由（物理文件在根目录 runtime/ 下，no-cache 协商缓存）；
 * - 旧目录 backend-ts/static/prompt-previews → runtime/prompt-previews 启动搬迁（幂等、同名冲突保留旧副本）。
 *
 * 注意：vitest 多文件并行且共享真实目录，本文件只清理自建文件，不做整目录删除。
 */

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEGACY_DIR = path.join(BACKEND_ROOT, 'static', 'prompt-previews');
// 与 bifrost-service.ts 的 LEGACY_PREVIEW_DIR 同口径（src/services 向上两层）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let app: Awaited<ReturnType<typeof buildApp>>;

function safeUnlink(dir: string, name: string): void {
  // 仅删除确认位于 dir 内的文件（防路径拼接意外）
  const full = path.join(dir, name);
  if (!full.startsWith(dir + path.sep)) return;
  if (existsSync(full)) unlinkSync(full);
}

beforeAll(async () => {
  setDb(initDb(':memory:'));
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  for (const f of ['p1.png', 'legacy-a.jpg', 'only-one.png']) {
    safeUnlink(PREVIEW_DIR, f);
    safeUnlink(LEGACY_DIR, f);
  }
});

describe('Bifrost 预览图白名单路由', () => {
  it('GET 命中文件返回 200，协商缓存（同名覆盖不可 immutable 长缓存）', async () => {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    writeFileSync(path.join(PREVIEW_DIR, 'p1.png'), PNG);
    const res = await app.inject({ method: 'GET', url: '/static/prompt-previews/p1.png' });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['cache-control'])).toContain('no-cache');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('路径穿越与不存在的文件 → 404', async () => {
    const traversal = await app.inject({ method: 'GET', url: '/static/prompt-previews/..%2F..%2Fpackage.json' });
    expect(traversal.statusCode).toBe(404);
    const missing = await app.inject({ method: 'GET', url: '/static/prompt-previews/nope.png' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('旧预览图目录启动搬迁（migrateLegacyPreviewFiles）', () => {
  it('搬迁到 runtime；同名冲突跳过并保留旧副本；幂等重跑安全', () => {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    writeFileSync(path.join(PREVIEW_DIR, 'p1.png'), PNG); // 模拟 runtime 已有同名
    mkdirSync(LEGACY_DIR, { recursive: true });
    writeFileSync(path.join(LEGACY_DIR, 'legacy-a.jpg'), Buffer.from('a'));
    writeFileSync(path.join(LEGACY_DIR, 'p1.png'), PNG); // 与 runtime 冲突
    try {
      migrateLegacyPreviewFiles();
      expect(existsSync(path.join(PREVIEW_DIR, 'legacy-a.jpg'))).toBe(true);
      expect(existsSync(path.join(PREVIEW_DIR, 'p1.png'))).toBe(true);
      expect(existsSync(path.join(LEGACY_DIR, 'legacy-a.jpg'))).toBe(false);
      expect(existsSync(path.join(LEGACY_DIR, 'p1.png'))).toBe(true); // 冲突副本保留
      migrateLegacyPreviewFiles(); // 幂等重跑不报错、不丢文件
      expect(existsSync(path.join(PREVIEW_DIR, 'legacy-a.jpg'))).toBe(true);
    } finally {
      safeUnlink(LEGACY_DIR, 'legacy-a.jpg');
      safeUnlink(LEGACY_DIR, 'p1.png');
    }
  });

  it('搬空后清理旧目录', () => {
    rmSync(LEGACY_DIR, { recursive: true, force: true });
    safeUnlink(PREVIEW_DIR, 'only-one.png');
    mkdirSync(LEGACY_DIR, { recursive: true });
    writeFileSync(path.join(LEGACY_DIR, 'only-one.png'), PNG);
    try {
      migrateLegacyPreviewFiles();
      expect(existsSync(LEGACY_DIR)).toBe(false);
      expect(existsSync(path.join(PREVIEW_DIR, 'only-one.png'))).toBe(true);
    } finally {
      safeUnlink(LEGACY_DIR, 'only-one.png');
    }
  });
});

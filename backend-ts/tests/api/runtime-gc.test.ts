import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb, setDb, getDb } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { IMAGE_GC_TTL_MS, runRuntimeGc } from '../../src/services/runtime-gc.js';
import { extractRuntimeImageUrls } from '../../src/services/image-service.js';
import { RUNTIME_ROOT } from '../../src/services/skill-agent-service.js';
import { generations, users } from '../../src/db/schema.js';
import { now } from '../../src/shared/datetime.js';
import { eq } from 'drizzle-orm';

/**
 * 运行时图片 GC 与历史级联删除：
 * - runRuntimeGc：临时 runtimeRoot 注入（绝不触碰真实 runtime），旧/新 × 引用/未引用矩阵；
 * - DELETE /api/generations/:id：级联清理 result_url 与 stage_results 内嵌的 search-images 文件。
 *
 * 级联测试使用独立用户目录 CASCADE_UID（本文件独占，并行安全）。
 */

const DAY = 24 * 60 * 60 * 1000;
/** 本文件独占的真实 runtime 用户目录（其余测试文件不使用该 id） */
const CASCADE_UID = 987311;
const CASCADE_DIR = path.join(RUNTIME_ROOT, String(CASCADE_UID));

let app: Awaited<ReturnType<typeof buildApp>>;
let adminToken = '';

function ageFile(abs: string, daysAgo = 8): void {
  const past = new Date(Date.now() - daysAgo * DAY);
  utimesSync(abs, past, past);
}

beforeAll(async () => {
  setDb(initDb(':memory:'));
  app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  });
  adminToken = (res.json() as { token: string }).token;
});

afterAll(async () => {
  await app?.close();
  setDb(null);
  // 仅清理本文件自建的用户子目录与临时根目录
  rmSync(CASCADE_DIR, { recursive: true, force: true });
});

describe('extractRuntimeImageUrls', () => {
  it('抽取四个受管前缀并去重；忽略非受管前缀与旧格式', () => {
    const urls = extractRuntimeImageUrls([
      '看 [图](/static/search-images/42/a.jpg) 和 /static/generated/7/b.png?v=1',
      '/static/map-posters/3/c.png /static/map-arts/9/d.png',
      '/static/search-images/42/a.jpg', // 跨字段重复 → 去重
      '/static/covers/cover.png', // 非受管目录
      '/static/prompt-previews/p.png', // 非受管目录
      '/static/generated/legacy.png', // 旧格式（无 userId）不匹配
    ]);
    expect(urls.sort()).toEqual([
      '/static/generated/7/b.png',
      '/static/map-arts/9/d.png',
      '/static/map-posters/3/c.png',
      '/static/search-images/42/a.jpg',
    ]);
  });

  it('对象输入经 JSON 序列化后抽取，null 跳过', () => {
    const urls = extractRuntimeImageUrls([
      { stage3: { image_url: '/static/generated/1/x.svg' }, steps: [{ md: '![i](/static/search-images/1/y.jpg)' }] },
      null,
      undefined,
    ]);
    expect(urls.sort()).toEqual(['/static/generated/1/x.svg', '/static/search-images/1/y.jpg']);
  });
});

describe('runRuntimeGc（临时 runtimeRoot）', () => {
  it('删除「超 TTL 且未被引用」文件；DB 引用（result_url / 嵌套 / markdown）与新文件保留；非受管目录不动', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'runtime-gc-test-'));
    try {
      const mk = (rel: string): string => {
        const abs = path.join(root, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, 'x');
        return abs;
      };

      const deletedOld = mk('42/generated/gc-deleted-old.png');
      const keptResult = mk('42/generated/gc-kept-result.png');
      const keptStage = mk('42/generated/gc-kept-stage.png');
      const keptMarkdown = mk('42/search-images/gc-kept-markdown.jpg');
      const freshUnref = mk('42/search-images/gc-fresh-unref.jpg');
      const posterOld = mk('42/map-posters/gc-poster-old.png');
      const artOld = mk('42/map-arts/gc-art-old.png');
      const workspaceNote = mk('42/workspace/gc-note.txt'); // 非受管子目录
      const coverFile = mk('covers/gc-cover.png'); // 非用户目录
      const nonNumeric = mk('abc/generated/gc-x.png'); // 非数字用户目录
      for (const f of [deletedOld, keptResult, keptStage, keptMarkdown, posterOld, artOld, workspaceNote, coverFile, nonNumeric]) {
        ageFile(f);
      }

      const db = getDb();
      db.insert(users).values({ id: 424242, username: 'gc-matrix', passwordHash: 'x', role: 'user' }).run();
      db.insert(generations)
        .values({
          id: 900001,
          userId: 424242,
          nodeType: 'image_generation',
          name: 'gc-matrix',
          stageResults: JSON.stringify({
            stage2: { prompt: '[参考](/static/search-images/42/gc-kept-markdown.jpg)' },
            stage3: { image_url: '/static/generated/42/gc-kept-stage.png' },
          }),
          resultUrl: '/static/generated/42/gc-kept-result.png',
          status: 'completed',
          createdAt: now(),
        })
        .run();

      const result = runRuntimeGc({ runtimeRoot: root });

      expect(result.failed).toBe(0);
      expect(result.scanned).toBe(7); // 受管目录内文件总数
      expect(result.deleted).toBe(3);
      expect(existsSync(deletedOld)).toBe(false);
      expect(existsSync(posterOld)).toBe(false);
      expect(existsSync(artOld)).toBe(false);
      // 引用保护
      expect(existsSync(keptResult)).toBe(true);
      expect(existsSync(keptStage)).toBe(true);
      expect(existsSync(keptMarkdown)).toBe(true);
      // TTL 保护（在途会话窗口）
      expect(existsSync(freshUnref)).toBe(true);
      // 非受管范围不动
      expect(existsSync(workspaceNote)).toBe(true);
      expect(existsSync(coverFile)).toBe(true);
      expect(existsSync(nonNumeric)).toBe(true);

      // 清理 DB 行，避免影响后续用例的引用集合
      db.delete(generations).where(eq(generations.id, 900001)).run();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('TTL 边界：刚好等于 7 天的未引用文件被删除，超过则必然删除', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'runtime-gc-edge-'));
    try {
      const abs = path.join(root, '42/generated/edge.png');
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, 'x');
      const exactly = new Date(Date.now() - IMAGE_GC_TTL_MS - 1000); // 过线 1s
      utimesSync(abs, exactly, exactly);
      const result = runRuntimeGc({ runtimeRoot: root, nowMs: Date.now() });
      expect(result.deleted).toBe(1);
      expect(existsSync(abs)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('DELETE /api/generations/:id 级联删盘', () => {
  it('同时清理 result_url 与 stage_results 内嵌的 search-images 文件，无关文件保留', async () => {
    const ts = Date.now();
    const mainAbs = path.join(CASCADE_DIR, 'generated', `casc-main-${ts}.png`);
    const nestedAbs = path.join(CASCADE_DIR, 'search-images', `casc-nested-${ts}.jpg`);
    const keepAbs = path.join(CASCADE_DIR, 'generated', `casc-keep-${ts}.png`);
    for (const f of [mainAbs, nestedAbs, keepAbs]) {
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, 'x');
    }
    const mainUrl = `/static/generated/${CASCADE_UID}/casc-main-${ts}.png`;
    const nestedUrl = `/static/search-images/${CASCADE_UID}/casc-nested-${ts}.jpg`;

    const created = await app.inject({
      method: 'POST',
      url: '/api/generations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        node_type: 'image_generation',
        stage_results: {
          stage1: { metadata: { title: '级联删除测试' } },
          stage2: { prompt: `参考图 [img](${nestedUrl})` },
          stage3: { image_url: mainUrl },
        },
        result_url: mainUrl,
        status: 'completed',
      },
    });
    expect(created.statusCode).toBe(200);
    const id = (created.json() as { id: number }).id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/generations/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode).toBe(200);
    expect(existsSync(mainAbs)).toBe(false);
    expect(existsSync(nestedAbs)).toBe(false);
    expect(existsSync(keepAbs)).toBe(true);
  });

  it('deleteFile 对旧格式（无 userId）URL 安全拒绝', async () => {
    const { imageService } = await import('../../src/services/image-service.js');
    expect(imageService.deleteFile('/static/generated/no-user-id.png')).toBe(false);
    expect(imageService.deleteFile('/static/covers/whatever.png')).toBe(false);
    expect(imageService.deleteFile('')).toBe(false);
  });
});

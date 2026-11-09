/** 管理端 FastClaw Agent 技能配置 API 契约：名单持久化 / 保存即同步 / 手动重推 / 非法输入。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { FASTCLAW_DATA_ROOT_SETTING_KEY } from '../../src/services/ai/fastclaw-artifacts.js';

let db: DB;
let app: Awaited<ReturnType<typeof buildApp>>;
let adminToken = '';
let dataRoot: string;

const auth = () => ({ authorization: `Bearer ${adminToken}` });

beforeAll(async () => {
  dataRoot = mkdtempSync(path.join(os.tmpdir(), 'fc-admin-root-'));
  db = initDb(':memory:');
  setDb(db);
  const schema = await import('../../src/db/schema.js');
  db.insert(schema.users)
    .values({ username: 'admin', passwordHash: hashSync('admin123', 10), role: 'admin', isActive: true })
    .run();
  app = await buildApp();

  // buildApp 的 seedStartup 会写入默认 /opt/fastclaw-data；测试中改指到临时目录
  const existing = db.select().from(schema.appSettings)
    .where(eq(schema.appSettings.key, FASTCLAW_DATA_ROOT_SETTING_KEY)).get();
  if (existing) {
    db.update(schema.appSettings).set({ value: dataRoot })
      .where(eq(schema.appSettings.key, FASTCLAW_DATA_ROOT_SETTING_KEY)).run();
  } else {
    db.insert(schema.appSettings).values({
      key: FASTCLAW_DATA_ROOT_SETTING_KEY,
      value: dataRoot,
      description: 'test',
    }).run();
  }

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  });
  adminToken = (login.json() as { token: string }).token;
});

afterAll(async () => {
  await app.close();
  setDb(null);
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('FastClaw Agent 技能配置', () => {
  it('候选列表接口可用', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/fastclaw-agents/skills',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray((res.json() as { skills: unknown[] }).skills)).toBe(true);
  });

  it('新建时持久化技能名单并尝试同步；列表回带 skills', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/fastclaw-agents',
      headers: auth(),
      payload: {
        name: '技能 Agent',
        base_url: 'http://fc',
        agent_id: 'agt_test_1',
        api_key: 'sk',
        agent_name: '技能 Agent',
        skills: ['not-installed-skill'],
      },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as {
      id: number;
      skills: string[];
      skill_sync?: { root: string | null; target_dir: string; skipped: string[] };
    };
    expect(body.skills).toEqual(['not-installed-skill']);
    // 数据根已配置 → 即使源包不存在也只是 best-effort 跳过，不影响配置保存
    expect(body.skill_sync?.root).toBe(path.resolve(dataRoot));
    expect(body.skill_sync?.target_dir).toContain(path.join('agents', 'agt_test_1', 'agent', 'skills'));
    expect(body.skill_sync?.skipped).toEqual(['not-installed-skill']);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/fastclaw-agents',
      headers: auth(),
    });
    const row = (list.json() as Array<{ id: number; skills: string[] }>).find((r) => r.id === body.id);
    expect(row?.skills).toEqual(['not-installed-skill']);
  });

  it('非法技能名返回 400；仅启停不触发同步', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/fastclaw-agents',
      headers: auth(),
      payload: { name: '校验 Agent', agent_name: '校验 Agent', agent_id: 'agt_test_2', api_key: 'sk', skills: [] },
    });
    const id = (created.json() as { id: number }).id;

    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/admin/fastclaw-agents/${id}`,
      headers: auth(),
      payload: { skills: ['../escape'] },
    });
    expect(bad.statusCode).toBe(400);

    const toggled = await app.inject({
      method: 'PATCH',
      url: `/api/admin/fastclaw-agents/${id}`,
      headers: auth(),
      payload: { is_active: false },
    });
    expect(toggled.statusCode).toBe(200);
    expect((toggled.json() as { skill_sync?: unknown }).skill_sync).toBeUndefined();
  });

  it('手动重推按当前配置返回同步结果；复制配置继承技能名单', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/fastclaw-agents',
      headers: auth(),
      payload: { name: '重推 Agent', agent_name: '重推 Agent', agent_id: 'agt_test_3', api_key: 'sk', skills: [] },
    });
    const id = (created.json() as { id: number }).id;

    const synced = await app.inject({
      method: 'POST',
      url: `/api/admin/fastclaw-agents/${id}/sync-skills`,
      headers: auth(),
    });
    expect(synced.statusCode).toBe(200);
    const result = synced.json() as { root: string | null; synced: string[]; warning?: string };
    expect(result.root).toBe(path.resolve(dataRoot));
    expect(result.synced).toEqual([]);
    expect(result.warning).toBeUndefined();

    const dup = await app.inject({
      method: 'POST',
      url: `/api/admin/fastclaw-agents/${id}/duplicate`,
      headers: auth(),
    });
    expect((dup.json() as { skills: string[] }).skills).toEqual([]);
  });
});

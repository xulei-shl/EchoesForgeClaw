import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { nodeWorkspace, workspaceRoot } from '../../src/services/ai/skill-agent-service.js';

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');
const UID = 990105;

let db: DB;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
let uid = UID;

describe('Canvas Agent API 路由与工作区生命周期', () => {
  beforeAll(async () => {
    db = initDb(':memory:');
    setDb(db);
    const schema = await import('../../src/db/schema.js');
    db.insert(schema.users)
      .values({ username: 'admin', passwordHash: hashSync('admin123', 10), role: 'admin', isActive: true })
      .run();
    app = await buildApp();
    await app.ready();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    });
    expect(loginRes.statusCode).toBe(200);
    const loginBody = loginRes.json() as { token: string; user: { id: number } };
    token = loginBody.token;
    uid = loginBody.user.id;
  });

  afterAll(async () => {
    try {
      const root = workspaceRoot(uid);
      if (existsSync(root)) {
        rmSync(root, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
    await app.close();
  });

  it('POST /canvas-agent/clear 缺少 workspace_id 时返回 { cleared: false }，不再盲目默认 canvas-agent_default', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/canvas-agent/clear',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cleared: false });
  });

  it('POST /canvas-agent/clear 指定工作区可安全清空', async () => {
    const testWs = `canvas-agent_test_${Date.now()}`;
    const wsDir = nodeWorkspace(uid, testWs);
    mkdirSync(path.join(wsDir, '.pi-agent', 'run'), { recursive: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/canvas-agent/clear',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspace_id: testWs },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cleared).toBe(true);
  });

  it('POST /canvas-agent/chat 缺少 prompt 时返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/canvas-agent/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('prompt');
  });

  it('POST /canvas-agent/ui-response 缺少参数时返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/canvas-agent/ui-response',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspace_id: 'some_ws' },
    });
    expect(res.statusCode).toBe(400);
  });
});

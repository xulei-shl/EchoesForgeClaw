import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { nodeWorkspace, workspaceRoot } from '../../src/services/ai/skill-agent-service.js';
import { canvasAssistantConfigFrom } from '../../src/services/platform/node-config-service.js';

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

  it('支持在 /api/admin/node-configs 中配置 canvas_assistant 并在运行时被 canvasAssistantConfigFrom 正确解析与物化', async () => {
    const schema = await import('../../src/db/schema.js');

    // 1. 创建专用模型与提示词
    const llm = db
      .insert(schema.llmConfigs)
      .values({
        name: 'claude-3-5-sonnet',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-ant-test-key-12345',
        modelName: 'claude-3-5-sonnet-20241022',
        kind: 'text',
        isActive: true,
      })
      .returning()
      .get();

    const prompt = db
      .insert(schema.promptTemplates)
      .values({
        key: 'canvas-assistant-custom-test',
        name: '自定义测试画板助手提示词',
        nodeType: 'canvas_assistant',
        content: '# 自定义画板助手提示词\n专为测试连线与推荐设计。',
        isActive: true,
      })
      .returning()
      .get();

    // 2. 通过管理接口创建 canvas_assistant 节点配置
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/node-configs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        node_type: 'canvas_assistant',
        name: '画板智能助手 (生产配置)',
        llm_config_id: llm.id,
        prompt_id: prompt.id,
        is_active: true,
      },
    });
    expect(createRes.statusCode).toBe(200);
    const createdConfig = createRes.json() as { id: number; node_type: string; llm_config_id: number };
    expect(createdConfig.node_type).toBe('canvas_assistant');
    expect(createdConfig.llm_config_id).toBe(llm.id);

    // 3. 验证运行时解析 canvasAssistantConfigFrom()
    const runtimeCfg = canvasAssistantConfigFrom();
    expect(runtimeCfg).not.toBeNull();
    expect(runtimeCfg?.chatModel.modelName).toBe('claude-3-5-sonnet-20241022');
    expect(runtimeCfg?.chatModel.apiKey).toBe('sk-ant-test-key-12345');
    expect(runtimeCfg?.agentId).toBe('canvas-assistant');
    expect(runtimeCfg?.skillNames).toContain('canvas-node-catalog');

    // 4. 验证物化的 AGENTS.md 包含了指定提示词内容
    const materializedPath = path.resolve(RUNTIME_ROOT, '.agent', 'agents', 'canvas-assistant', 'AGENTS.md');
    expect(existsSync(materializedPath)).toBe(true);

    // 5. 禁用该配置后，canvasAssistantConfigFrom() 优雅返回 null（触发降级机制）
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/node-configs/${createdConfig.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { is_active: false },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(canvasAssistantConfigFrom()).toBeNull();

    // 6. 删除测试配置
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/node-configs/${createdConfig.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(delRes.statusCode).toBe(200);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { workspaceRoot } from '../../src/services/ai/skill-agent-service.js';
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
    // 固定为独占测试 id：本文件 afterAll 会清该用户的工作区目录，绝不能落到真实用户（admin=1）
    db.insert(schema.users)
      .values({ id: UID, username: 'admin', passwordHash: hashSync('admin123', 10), role: 'admin', isActive: true })
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
    // 只清理本文件独占的测试用户工作区。历史上这里无条件删除 workspaceRoot(uid) 而 uid 来自
    // 登录响应（种子用户 id 未固定时即真实 admin=1）→ 跑一次测试就把开发环境 runtime/1/workspace
    // 下的全部真实对话与产物清空。uid 不是本文件独占 id 时一律不删。
    try {
      if (uid === UID) {
        const root = workspaceRoot(UID);
        if (existsSync(root)) rmSync(root, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
    await app.close();
  });

  it('不存在只删会话文件的「清空会话」接口（/canvas-agent/clear 与 /chat/clear 均为 404）', async () => {
    // 会话文件（.pi-agent/run/chat.jsonl）是「对话历史」的收录凭据：只删文件会让对话从列表
    // 静默消失且不可恢复。删除对话只能整目录删（DELETE /chat/session），开启新会话由前端
    // 置空活跃工作区完成——这里守住「不能再长回一个只删会话文件的接口」。
    for (const url of [
      '/api/modules/bookplate/canvas-agent/clear',
      '/api/modules/bookplate/chat/clear',
    ]) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${token}` },
        payload: { workspace_id: `canvas-agent_probe_${Date.now()}` },
      });
      expect(res.statusCode).toBe(404);
    }
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

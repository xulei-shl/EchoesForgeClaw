import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { startMockOpenAIServer, sseChunk, type MockOpenAIServer } from '../helpers/mock-openai-server.js';

/**
 * 路由级契约测试（对应 Python 的端到端链路）：
 * - POST /api/auth/login（内存库 + bcrypt）
 * - GET  /api/modules/bookplate/node-registry
 * - POST /api/modules/bookplate/chat（LLM 模式：mock OpenAI 兼容端点；Agent 模式：mock FastClaw）
 * - POST /api/modules/bookplate/generate-image（LLM 模式：mock /images/generations）
 */

let db: DB;
let app: Awaited<ReturnType<typeof buildApp>>;
const openServers: MockOpenAIServer[] = [];

beforeAll(async () => {
  // 内存库 + 完整表结构
  db = initDb(':memory:');
  setDb(db);

  // 种子数据：admin + LLM 配置 + FastClaw 配置 + 节点配置 + 提示词模板
  db.insert((await import('../../src/db/schema.js')).users)
    .values({ username: 'admin', passwordHash: hashSync('admin123', 10), role: 'admin', isActive: true })
    .run();

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await Promise.all(openServers.splice(0).map((s) => s.close()));
  setDb(null);
});

/** 在内存库中插入 LLM 配置 + 节点配置（返回节点配置 id）。 */
async function seedNode(opts: {
  nodeType: string;
  llmConfig?: { baseUrl: string; modelName: string; kind?: string };
  agentConfig?: { baseUrl: string; agentId: string };
  promptContent?: string;
}) {
  const schema = await import('../../src/db/schema.js');
  let llmId: number | null = null;
  if (opts.llmConfig) {
    const row = db
      .insert(schema.llmConfigs)
      .values({
        name: `llm-${opts.nodeType}`,
        kind: opts.llmConfig.kind ?? 'text',
        apiKey: 'sk-test',
        baseUrl: opts.llmConfig.baseUrl,
        modelName: opts.llmConfig.modelName,
        isActive: true,
      })
      .returning({ id: schema.llmConfigs.id })
      .get();
    llmId = row.id;
  }
  let agentId: number | null = null;
  if (opts.agentConfig) {
    const row = db
      .insert(schema.fastclawAgentConfigs)
      .values({
        name: 'fc-agent',
        baseUrl: opts.agentConfig.baseUrl,
        apiKey: 'sk-fc',
        agentId: opts.agentConfig.agentId,
        isActive: true,
      })
      .returning({ id: schema.fastclawAgentConfigs.id })
      .get();
    agentId = row.id;
  }
  let promptId: number | null = null;
  if (opts.promptContent != null) {
    const row = db
      .insert(schema.promptTemplates)
      .values({ name: `prompt-${opts.nodeType}`, nodeType: opts.nodeType, content: opts.promptContent, isActive: true })
      .returning({ id: schema.promptTemplates.id })
      .get();
    promptId = row.id;
  }
  const row = db
    .insert(schema.nodeConfigs)
    .values({
      nodeType: opts.nodeType,
      name: `node-${opts.nodeType}`,
      llmConfigId: llmId,
      agentConfigId: agentId,
      promptId,
      isActive: true,
    })
    .returning({ id: schema.nodeConfigs.id })
    .get();
  return row.id;
}

let token: string;

describe('认证', () => {
  it('登录成功返回 token + user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.user.username).toBe('admin');
    expect(body.user.password_hash).toBeUndefined(); // 不泄漏
    token = body.token;
  });

  it('密码错误返回 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('无 token 访问受保护接口返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules/bookplate/node-registry' });
    expect(res.statusCode).toBe(401);
  });
});

describe('node-registry', () => {
  it('返回模板与配置变体', async () => {
    await seedNode({ nodeType: 'chat', llmConfig: { baseUrl: 'http://127.0.0.1:1/v1', modelName: 'm' } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/node-registry',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.templates.some((t: any) => t.type === 'chat')).toBe(true);
    expect(body.configs.some((c: any) => c.node_type === 'chat' && c.mode === 'llm')).toBe(true);
  });

  it('内置小工具模板（万年历 / 天气查询）无需配置即可用', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/node-registry',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const calendar = body.templates.find((t: any) => t.type === 'calendar');
    const weather = body.templates.find((t: any) => t.type === 'weather');
    expect(calendar).toBeDefined();
    expect(weather).toBeDefined();
    // 小工具类别 + 无需配置 + 文本输出（天气可接受文本输入城市）
    expect(calendar.category).toBe('tool');
    expect(calendar.configurable).toBe(false);
    expect(calendar.output_type).toBe('text');
    expect(weather.category).toBe('tool');
    expect(weather.configurable).toBe(false);
    expect(weather.output_type).toBe('text');
    expect(weather.input_types).toContain('text');
    // 模板声明即出现在「+」菜单：无需任何节点配置变体
    expect(body.configs.some((c: any) => c.node_type === 'calendar')).toBe(false);
  });
});

describe('chat 端点', () => {
  it('LLM 模式：多轮对话流式（mock OpenAI 兼容端点）', async () => {
    const srv = await startMockOpenAIServer((req, send) => {
      // 多轮历史：assistant 必须回传
      const roles = (req.body?.messages ?? []).map((m: any) => m.role);
      expect(roles).toContain('assistant');
      const base = { id: 'chatcmpl-api', object: 'chat.completion.chunk', created: 0, model: 'mock-model' };
      send(sseChunk({ ...base, choices: [{ index: 0, delta: { content: '第二轮回答' }, finish_reason: null }] }));
      send(sseChunk({ ...base, choices: [], usage: { total_tokens: 10 } }));
    });
    openServers.push(srv);
    const configId = await seedNode({
      nodeType: 'chat',
      llmConfig: { baseUrl: srv.baseURL, modelName: 'mock-model' },
      promptContent: '你是藏书票助手',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        messages: [
          { role: 'user', content: '第一轮提问' },
          { role: 'assistant', content: '第一轮回答' },
          { role: 'user', content: '第二轮提问' },
        ],
        config_id: configId,
      },
    });
    expect(res.statusCode).toBe(200);
    // AI SDK UI Message Stream：text-delta 增量包含完整回复
    const body = res.body;
    expect(body).toContain('"type":"text-delta"');
    expect(body).toContain('第二轮回答');
    expect(body).toContain('"type":"finish"');
  });

  it('Agent 模式：mock FastClaw 流式（data-agent_* part）', async () => {
    const srv = await startMockOpenAIServer((req, send) => {
      expect(req.path).toBe('/api/chat/stream');
      const base = { id: 'evt', type: 'x' };
      send(sseChunk({ ...base, type: 'tool_call', data: { id: 't1', name: 'search', arguments: '{}' } }));
      send(sseChunk({ ...base, type: 'tool_result', data: { id: 't1', name: 'search', result: '结果' } }));
      send(sseChunk({ ...base, type: 'content_delta', data: { delta: '正在回答' } }));
      send(sseChunk({ ...base, type: 'done', data: {} }));
    });
    openServers.push(srv);
    const configId = await seedNode({
      nodeType: 'chat',
      agentConfig: { baseUrl: srv.rootURL, agentId: 'agt_1' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: '帮我查一下', config_id: configId, node_id: 'n1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-agent_tool_call');
    expect(res.body).toContain('data-agent_tool_result');
    expect(res.body).toContain('正在回答');
  });

  it('未绑定配置回退 Mock 流式', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { messages: [{ role: 'user', content: '你好' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('【Mock 对话】');
  });
});

describe('generate-image 端点', () => {
  it('LLM 模式：mock /images/generations → { image_url }', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const srv = await startMockOpenAIServer((req, send) => {
      expect(req.path).toBe('/v1/images/generations');
      return JSON.stringify({ created: 0, data: [{ b64_json: png.toString('base64') }] });
    });
    openServers.push(srv);
    const configId = await seedNode({
      nodeType: 'image_generation',
      llmConfig: { baseUrl: srv.baseURL, modelName: 'mock-image-model', kind: 'image' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/generate-image',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: '藏书票', config_id: configId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mock).toBe(false);
    expect(body.image_url.startsWith('/static/generated/')).toBe(true);
    // 新落盘：runtime/{userId}/generated 下，公开路由可访问（无鉴权、Content-Type 正确）
    const img = await app.inject({ method: 'GET', url: body.image_url });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toContain('image/png');
    expect(Buffer.from(img.rawPayload).equals(png)).toBe(true);
  });

  it('无配置回退 Mock SVG', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/generate-image',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: '测试' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mock).toBe(true);
    expect(body.image_url.startsWith('/static/generated/')).toBe(true);
    // Mock SVG 经公开路由可访问
    const img = await app.inject({ method: 'GET', url: body.image_url });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toContain('image/svg+xml');
  });

  it('静态图片路由：非数字 userId / 目录穿越返回 404', async () => {
    const bad = [
      '/static/generated/abc/1.png',
      '/static/generated/1/../../etc/passwd',
      '/static/covers/../../etc/passwd',
      '/static/generated/1',
    ];
    for (const url of bad) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
    }
  });
});

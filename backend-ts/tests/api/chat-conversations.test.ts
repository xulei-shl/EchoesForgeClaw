import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  hydrateChatTranscript,
  persistTranscriptUser,
} from '../../src/services/chat-conversations.js';
import { hashSync } from 'bcryptjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import {
  startMockOpenAIServer,
  sseChunk,
  type MockOpenAIServer,
} from '../helpers/mock-openai-server.js';

/**
 * LLM / FastClaw 会话 transcript 契约测试（chat-conversations.ts + /chat 路由写入侧）：
 * - LLM 模式：多轮对话逐轮落盘 {ws}/conversation.jsonl（user/assistant 成对累积）；重试不重复 user 行；
 *   GET /chat/session 水合、GET /chat/sessions 列表（标题 = 首条 user 消息）、/chat/files 产物差分排除、
 *   DELETE /chat/session 整目录删除
 * - FastClaw 模式：会话 key 一对话一 key（含 workspaceId）；transcript 落盘含工具步骤；水合带步骤
 * - 置顶 / 重命名对 transcript 会话同样生效（meta.json 存储无关）
 */

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');
/** 本文件独占的节点前缀（清理时只删本文件创建的目录，避免误删其它测试文件数据）。 */
const NODE_ID = `chat-transcript-test-${Date.now()}`;
const openServers: MockOpenAIServer[] = [];

let db: DB;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
let uid = 1;

/** 造 chat 节点配置（LLM / FastClaw 二选一）。 */
async function seedChat(opts: {
  llmConfig?: { baseUrl: string; modelName: string };
  agentConfig?: { baseUrl: string; agentId: string };
}): Promise<number> {
  const schema = await import('../../src/db/schema.js');
  let llmId: number | null = null;
  if (opts.llmConfig) {
    const row = db
      .insert(schema.llmConfigs)
      .values({
        name: `llm-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'text',
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
        name: `fc-${Math.random().toString(36).slice(2, 8)}`,
        baseUrl: opts.agentConfig.baseUrl,
        apiKey: 'sk-fc',
        agentId: opts.agentConfig.agentId,
        isActive: true,
      })
      .returning({ id: schema.fastclawAgentConfigs.id })
      .get();
    agentId = row.id;
  }
  const row = db
    .insert(schema.nodeConfigs)
    .values({ nodeType: 'chat', name: 'node-t', llmConfigId: llmId, agentConfigId: agentId, isActive: true })
    .returning({ id: schema.nodeConfigs.id })
    .get();
  return row.id;
}

/** 读取 transcript 全部行（已 JSON 解析）。 */
function readTranscript(wsId: string): Array<Record<string, any>> {
  const file = path.join(RUNTIME_ROOT, String(uid), 'workspace', wsId, 'conversation.jsonl');
  return readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = initDb(':memory:');
  setDb(db);
  const schema = await import('../../src/db/schema.js');
  db.insert(schema.users)
    .values({ username: 'admin', passwordHash: hashSync('admin123', 10), role: 'admin', isActive: true })
    .run();
  app = await buildApp();
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  });
  const loginBody = login.json() as { token: string; user: { id: number } };
  token = loginBody.token;
  uid = loginBody.user.id;
});

afterAll(async () => {
  await app.close();
  await Promise.all(openServers.splice(0).map((s) => s.close()));
  setDb(null);
  // 仅清理本文件创建的会话目录（{NODE_ID}_ 前缀）
  const root = path.join(RUNTIME_ROOT, String(uid), 'workspace');
  try {
    for (const entry of readdirSync(root)) {
      if (entry.startsWith(`${NODE_ID}_`)) {
        rmSync(path.join(root, entry), { recursive: true, force: true });
      }
    }
  } catch {
    /* 目录不存在则忽略 */
  }
});

describe('LLM 模式 transcript', () => {
  it('多轮对话逐轮落盘；水合 / 列表 / 产物排除 / 删除闭环', async () => {
    const srv = await startMockOpenAIServer((_req, send) => {
      const base = { id: 'chatcmpl-x', object: 'chat.completion.chunk', created: 0, model: 'mock-model' };
      send(sseChunk({ ...base, choices: [{ index: 0, delta: { content: '回答A' }, finish_reason: null }] }));
      send(sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }));
    });
    openServers.push(srv);
    const configId = await seedChat({ llmConfig: { baseUrl: srv.baseURL, modelName: 'mock-model' } });
    const wsId = `${NODE_ID}_llm1`;

    // 第 1 轮：仅 user
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: {
        messages: [{ role: 'user', content: '第一轮问题' }],
        config_id: configId,
        node_id: NODE_ID,
        workspace_id: wsId,
      },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.body).toContain('data-agent_token_usage');
    // 第 2 轮：携带完整历史（useChat 每轮重发）
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: {
        messages: [
          { role: 'user', content: '第一轮问题' },
          { role: 'assistant', content: '回答A' },
          { role: 'user', content: '第二轮问题' },
        ],
        config_id: configId,
        node_id: NODE_ID,
        workspace_id: wsId,
      },
    });
    expect(r2.statusCode).toBe(200);

    // transcript：user/assistant 成对累积，首轮历史不丢；每行标注来源模式 llm
    const lines = readTranscript(wsId);
    expect(lines.map((l) => l.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(lines[0]!.content).toBe('第一轮问题');
    expect(lines[1]!.content).toBe('回答A');
    expect(lines[1]!.tokenUsage).toMatchObject({ totalTokens: 5 });
    expect(lines[2]!.content).toBe('第二轮问题');
    expect(lines[3]!.tokenUsage).toMatchObject({ totalTokens: 5 });
    expect(lines.every((l) => l.mode === 'llm')).toBe(true);

    // 水合：GET /chat/session 返回全部消息
    const h = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/session?workspace_id=${encodeURIComponent(wsId)}`,
      headers: auth(),
    });
    expect(h.statusCode).toBe(200);
    const hydrated = h.json() as {
      exists: boolean;
      messages: Array<{ role: string; content: string; tokenUsage?: { totalTokens: number } }>;
    };
    expect(hydrated.exists).toBe(true);
    expect(hydrated.messages).toHaveLength(4);
    expect(hydrated.messages[0]).toMatchObject({ role: 'user', content: '第一轮问题' });
    expect(hydrated.messages[1]).toMatchObject({ role: 'assistant', content: '回答A' });
    expect(hydrated.messages[1]?.tokenUsage).toMatchObject({ totalTokens: 5 });

    // 列表：标题 = 首条 user 消息，轮次计数正确（LLM 模式）
    const list = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/sessions?node_id=${NODE_ID}&mode=llm`,
      headers: auth(),
    });
    const sessions = (list.json() as { sessions: Array<{ workspaceId: string; title: string; messageCount: number }> }).sessions;
    const s = sessions.find((x) => x.workspaceId === wsId);
    expect(s?.title).toBe('第一轮问题');
    expect(s?.messageCount).toBe(2);

    // 产物列表：transcript 被差分排除，不得作为「AI 产物」出现
    const files = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/files?workspace_id=${encodeURIComponent(wsId)}`,
      headers: auth(),
    });
    const listFiles = (files.json() as { files: Array<{ path: string }> }).files;
    expect(listFiles.some((f) => f.path === 'conversation.jsonl')).toBe(false);

    // 删除：整目录删除（会话 / transcript 一并清除）
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/modules/bookplate/chat/session',
      headers: auth(),
      payload: { workspace_id: wsId },
    });
    expect((del.json() as { deleted: boolean }).deleted).toBe(true);
    expect(existsSync(path.join(RUNTIME_ROOT, String(uid), 'workspace', wsId))).toBe(false);
  });

  it('用户附带图片持久化并在水合时恢复（LLM 模式，含多轮历史）', async () => {
    const srv = await startMockOpenAIServer((_req, send) => {
      const base = { id: 'chatcmpl-x', object: 'chat.completion.chunk', created: 0, model: 'mock-model' };
      send(sseChunk({ ...base, choices: [{ index: 0, delta: { content: '看图回答' }, finish_reason: null }] }));
      send(sseChunk({ ...base, choices: [], usage: { total_tokens: 5 } }));
    });
    openServers.push(srv);
    const configId = await seedChat({ llmConfig: { baseUrl: srv.baseURL, modelName: 'mock-model' } });
    const wsId = `${NODE_ID}_llm-img`;
    const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    // 第 1 轮：user 消息携带图片
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: {
        messages: [{ role: 'user', content: '看这张图', images: [img] }],
        config_id: configId,
        node_id: NODE_ID,
        workspace_id: wsId,
      },
    });
    expect(r1.statusCode).toBe(200);
    // 第 2 轮：携带完整历史（useChat 每轮重发），确认旧轮图片随历史保留不重复落盘
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: {
        messages: [
          { role: 'user', content: '看这张图', images: [img] },
          { role: 'assistant', content: '看图回答' },
          { role: 'user', content: '再分析一下' },
        ],
        config_id: configId,
        node_id: NODE_ID,
        workspace_id: wsId,
      },
    });
    expect(r2.statusCode).toBe(200);

    // transcript：首轮 user 行带图片，后续轮不重复携带旧图
    const lines = readTranscript(wsId);
    expect(lines.map((l) => l.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(lines[0]!.images).toEqual([img]);
    expect(lines[2]!.images ?? []).toEqual([]);

    // 水合：历史 user 消息图片完整恢复（供展示与模型续聊重发）
    const h = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/session?workspace_id=${encodeURIComponent(wsId)}`,
      headers: auth(),
    });
    const hydrated = h.json() as {
      exists: boolean;
      messages: Array<{ role: string; content: string; images?: string[] }>;
    };
    expect(hydrated.exists).toBe(true);
    expect(hydrated.messages).toHaveLength(4);
    expect(hydrated.messages[0]).toMatchObject({ role: 'user', content: '看这张图', images: [img] });
    expect(hydrated.messages[1]).toMatchObject({ role: 'assistant', content: '看图回答' });
    expect(hydrated.messages[2]).toMatchObject({ role: 'user', content: '再分析一下' });
    expect(hydrated.messages[2]!.images ?? []).toEqual([]);
  });

  it('重试（regenerate，无新增 user 消息）不重复落盘 user 行', async () => {
    const srv = await startMockOpenAIServer((_req, send) => {
      const base = { id: 'chatcmpl-x', object: 'chat.completion.chunk', created: 0, model: 'mock-model' };
      send(sseChunk({ ...base, choices: [{ index: 0, delta: { content: '回答B' }, finish_reason: null }] }));
      send(sseChunk({ ...base, choices: [], usage: { total_tokens: 5 } }));
    });
    openServers.push(srv);
    const configId = await seedChat({ llmConfig: { baseUrl: srv.baseURL, modelName: 'mock-model' } });
    const wsId = `${NODE_ID}_llm2`;

    const post = () =>
      app.inject({
        method: 'POST',
        url: '/api/modules/bookplate/chat',
        headers: auth(),
        payload: {
          messages: [{ role: 'user', content: '同一个问题' }],
          config_id: configId,
          node_id: NODE_ID,
          workspace_id: wsId,
        },
      });
    expect((await post()).statusCode).toBe(200);
    expect((await post()).statusCode).toBe(200); // 重试：同一 user 消息重发

    const lines = readTranscript(wsId);
    expect(lines.filter((l) => l.role === 'user')).toHaveLength(1);
    expect(lines.filter((l) => l.role === 'assistant')).toHaveLength(2);
  });

  it('置顶 / 重命名对 transcript 会话同样生效（meta.json 存储无关）', async () => {
    const wsId = `${NODE_ID}_llm3`;
    // 手工造 transcript 会话（绕开 mock，验证列表元数据链路）
    const wsDir = path.join(RUNTIME_ROOT, String(uid), 'workspace', wsId);
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(
      path.join(wsDir, 'conversation.jsonl'),
      JSON.stringify({ type: 'message', id: 'u1', role: 'user', content: '置顶测试消息', ts: Date.now() }) + '\n',
      'utf-8'
    );

    const pin = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/session/pin',
      headers: auth(),
      payload: { workspace_id: wsId, pinned: true },
    });
    expect((pin.json() as { ok: boolean }).ok).toBe(true);

    const rename = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/session/rename',
      headers: auth(),
      payload: { workspace_id: wsId, title: '自定义标题' },
    });
    expect((rename.json() as { ok: boolean }).ok).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/sessions?node_id=${NODE_ID}&mode=llm`,
      headers: auth(),
    });
    const s = (list.json() as { sessions: Array<{ workspaceId: string; title: string; pinned: boolean }> }).sessions.find(
      (x) => x.workspaceId === wsId
    );
    expect(s?.title).toBe('自定义标题');
    expect(s?.pinned).toBe(true);
  });

  it('对话历史三模式严格隔离：pi / LLM / FastClaw 互不混显', async () => {
    const ts = Date.now();
    // LLM 会话（transcript 行带 mode='llm'）
    const llmWs = `${NODE_ID}_iso-llm`;
    const llmDir = path.join(RUNTIME_ROOT, String(uid), 'workspace', llmWs);
    mkdirSync(llmDir, { recursive: true });
    writeFileSync(
      path.join(llmDir, 'conversation.jsonl'),
      JSON.stringify({ type: 'message', id: 'u1', role: 'user', content: 'llm 会话', mode: 'llm', ts }) + '\n',
      'utf-8'
    );
    // FastClaw 会话（transcript 行带 mode='agent' + 工具步骤）
    const agtWs = `${NODE_ID}_iso-agent`;
    const agtDir = path.join(RUNTIME_ROOT, String(uid), 'workspace', agtWs);
    mkdirSync(agtDir, { recursive: true });
    writeFileSync(
      path.join(agtDir, 'conversation.jsonl'),
      JSON.stringify({ type: 'message', id: 'u1', role: 'user', content: 'agent 会话', mode: 'agent', ts }) +
        '\n' +
        JSON.stringify({
          type: 'message',
          id: 'a1',
          role: 'assistant',
          content: 'agent 回答',
          mode: 'agent',
          agentSteps: [{ type: 'agent_tool_call', id: 't1', name: 'search', arguments: '{}' }],
          ts: ts + 1,
        }) +
        '\n',
      'utf-8'
    );
    // pi 会话（.pi-agent/run/chat.jsonl）
    const piWs = `${NODE_ID}_iso-pi`;
    const piDir = path.join(RUNTIME_ROOT, String(uid), 'workspace', piWs);
    mkdirSync(path.join(piDir, '.pi-agent', 'run'), { recursive: true });
    writeFileSync(
      path.join(piDir, '.pi-agent', 'run', 'chat.jsonl'),
      '{"type":"message","role":"user","content":"pi 会话","ts":' + ts + '}\n',
      'utf-8'
    );

    const ids = async (mode?: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/modules/bookplate/chat/sessions?node_id=${NODE_ID}${mode ? `&mode=${mode}` : ''}`,
          headers: auth(),
        })
      ).json() as { sessions: Array<{ workspaceId: string }> };

    const pi = (await ids()).sessions.map((s) => s.workspaceId);
    expect(pi).toContain(piWs);
    expect(pi).not.toContain(llmWs);
    expect(pi).not.toContain(agtWs);

    const llm = (await ids('llm')).sessions.map((s) => s.workspaceId);
    expect(llm).toContain(llmWs);
    expect(llm).not.toContain(agtWs);
    expect(llm).not.toContain(piWs);

    const agt = (await ids('agent')).sessions.map((s) => s.workspaceId);
    expect(agt).toContain(agtWs);
    expect(agt).not.toContain(llmWs);
    expect(agt).not.toContain(piWs);
  });
});

describe('transcript 图片落盘/水合边界（服务层直测）', () => {
  const big = (mb: number) => `data:image/png;base64,${'A'.repeat(mb * 1024 * 1024)}`;

  it('异常图片在落盘时被丢弃（超长 / 非白名单协议 / 非字符串 / 超数量），正文不受影响', () => {
    const wsId = `${NODE_ID}_img-sanitize`;
    const wsDir = path.join(RUNTIME_ROOT, String(uid), 'workspace', wsId);
    mkdirSync(wsDir, { recursive: true });
    const huge = big(9); // 超单图上限（8MB）
    const ok = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    persistTranscriptUser(
      wsDir,
      { content: '正文1', images: [huge, 'ftp://not-an-image', ok, ok, ok, ok, ok] }, // 5 张合法但超 4 上限
      'llm'
    );
    const lines = readTranscript(wsId);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.content).toBe('正文1');
    // 仅保留 ≤4 张合法 data URL：huge 与 ftp 被丢弃
    expect(lines[0]!.images).toHaveLength(4);
    expect(lines[0]!.images!.every((i: string) => i === ok)).toBe(true);

    // 纯正文消息不受影响
    persistTranscriptUser(wsDir, { content: '正文2' }, 'llm');
    expect(readTranscript(wsId).map((l) => l.content)).toEqual(['正文1', '正文2']);
  });

  it('水合图片总量超限：丢弃最早轮次图片、保留最近（正文不丢）', () => {
    const wsId = `${NODE_ID}_img-budget`;
    const wsDir = path.join(RUNTIME_ROOT, String(uid), 'workspace', wsId);
    mkdirSync(wsDir, { recursive: true });
    // 两条 user 消息各 7MB 图片，合计 14MB > 12MB 总量预算；最近一条必须保留
    persistTranscriptUser(wsDir, { content: '旧轮', images: [big(7)] }, 'llm');
    persistTranscriptUser(wsDir, { content: '新轮', images: [big(7)] }, 'llm');

    const hydrated = hydrateChatTranscript(wsDir);
    expect(hydrated.messages.map((m) => m.content)).toEqual(['旧轮', '新轮']);
    expect(hydrated.messages[0]!.images ?? []).toEqual([]); // 最早轮被截断
    expect(hydrated.messages[1]!.images).toHaveLength(1);
    expect(hydrated.messages[1]!.images![0]!.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('FastClaw 模式 transcript', () => {
  it('会话 key 一对话一 key（含 workspaceId）；transcript 落盘含工具步骤；水合带步骤', async () => {
    let sessionId = '';
    const srv = await startMockOpenAIServer((req, send) => {
      sessionId = req.body?.sessionId ?? '';
      const base = { id: 'evt', type: 'x' };
      send(sseChunk({ ...base, type: 'tool_call', data: { id: 't1', name: 'search', arguments: '{}' } }));
      send(sseChunk({ ...base, type: 'tool_result', data: { id: 't1', name: 'search', result: '结果X' } }));
      send(sseChunk({ ...base, type: 'content_delta', data: { delta: '最终回答' } }));
      send(sseChunk({ ...base, type: 'done', data: {} }));
    });
    openServers.push(srv);
    const configId = await seedChat({ agentConfig: { baseUrl: srv.rootURL, agentId: 'agt_1' } });
    const wsId = `${NODE_ID}_fc1`;

    const r = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: { message: '帮我查一下', config_id: configId, node_id: NODE_ID, workspace_id: wsId },
    });
    expect(r.statusCode).toBe(200);

    // 会话 key：一对话一 key（与载入历史后继续对话的隔离粒度一致）
    expect(sessionId).toBe(`bookplate-${uid}-${wsId}`);

    const lines = readTranscript(wsId);
    expect(lines.map((l) => l.role)).toEqual(['user', 'assistant']);
    expect(lines[0]!.content).toBe('帮我查一下');
    expect(lines[1]!.content).toBe('最终回答');
    expect(lines.every((l) => l.mode === 'agent')).toBe(true);
    expect(lines[1]!.agentSteps.map((s: { type: string }) => s.type)).toEqual([
      'agent_tool_call',
      'agent_tool_result',
    ]);

    // 水合带工具步骤
    const h = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/session?workspace_id=${encodeURIComponent(wsId)}`,
      headers: auth(),
    });
    const hydrated = h.json() as {
      exists: boolean;
      messages: Array<{ role: string; content: string; agentSteps?: unknown[] }>;
    };
    expect(hydrated.exists).toBe(true);
    expect(hydrated.messages).toHaveLength(2);
    expect(hydrated.messages[1]!.agentSteps).toHaveLength(2);

    // 对话历史列表（FastClaw 节点视角 mode=agent）：真实落盘的会话必须可见，且不进 llm / pi 列表
    const listAgent = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/sessions?node_id=${NODE_ID}&mode=agent`,
      headers: auth(),
    });
    const agentList = (listAgent.json() as { sessions: Array<{ workspaceId: string }> }).sessions;
    expect(agentList.some((x) => x.workspaceId === wsId)).toBe(true);

    const listLlm = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/sessions?node_id=${NODE_ID}&mode=llm`,
      headers: auth(),
    });
    const llmList = (listLlm.json() as { sessions: Array<{ workspaceId: string }> }).sessions;
    expect(llmList.some((x) => x.workspaceId === wsId)).toBe(false);

    const listPi = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/sessions?node_id=${NODE_ID}`,
      headers: auth(),
    });
    const piList = (listPi.json() as { sessions: Array<{ workspaceId: string }> }).sessions;
    expect(piList.some((x) => x.workspaceId === wsId)).toBe(false);
  });

  it('用户附带图片持久化并在水合时恢复（FastClaw / agent 模式）', async () => {
    const srv = await startMockOpenAIServer((_req, send) => {
      const base = { id: 'evt', type: 'x' };
      send(sseChunk({ ...base, type: 'content_delta', data: { delta: '看到了图' } }));
      send(sseChunk({ ...base, type: 'done', data: {} }));
    });
    openServers.push(srv);
    const configId = await seedChat({ agentConfig: { baseUrl: srv.rootURL, agentId: 'agt_img' } });
    const wsId = `${NODE_ID}_fc-img`;
    const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const r = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: { message: '帮我看这张图', images: [img], config_id: configId, node_id: NODE_ID, workspace_id: wsId },
    });
    expect(r.statusCode).toBe(200);

    const lines = readTranscript(wsId);
    expect(lines.map((l) => l.role)).toEqual(['user', 'assistant']);
    expect(lines[0]!.content).toBe('帮我看这张图');
    expect(lines[0]!.images).toEqual([img]);
    expect(lines.every((l) => l.mode === 'agent')).toBe(true);

    const h = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/session?workspace_id=${encodeURIComponent(wsId)}`,
      headers: auth(),
    });
    const hydrated = h.json() as { messages: Array<{ content: string; images?: string[] }> };
    expect(hydrated.messages[0]!.content).toBe('帮我看这张图');
    expect(hydrated.messages[0]!.images).toEqual([img]);
  });

  it('跨 Agent 首条消息传输失败后重试：重新折叠历史 + 重新继承产物（不丢上下文、不重复落盘 user 行）', async () => {
    let bAttempts = 0;
    const srv = await startMockOpenAIServer((req, send) => {
      if (req.body?.agentId === 'agt_retryB' && bAttempts++ === 0) {
        // 首次调用 Agent B：FastClaw 传输层 500（消息从未被处理）
        return { raw: 'Internal Server Error', status: 500, contentType: 'text/plain' };
      }
      const base = { id: 'evt', type: 'x' };
      const reply = req.body?.agentId === 'agt_retryA' ? 'Agent A 答复' : 'B 最终答复';
      send(sseChunk({ ...base, type: 'content_delta', data: { delta: reply } }));
      send(sseChunk({ ...base, type: 'done', data: {} }));
    });
    openServers.push(srv);
    const cfgA = await seedChat({ agentConfig: { baseUrl: srv.rootURL, agentId: 'agt_retryA' } });
    const cfgB = await seedChat({ agentConfig: { baseUrl: srv.rootURL, agentId: 'agt_retryB' } });
    const wsId = `${NODE_ID}_fc-retry-fold`;
    const streamBodies = () =>
      srv.requests
        .filter((r) => r.path.endsWith('/api/chat/stream'))
        .map((r) => r.body as { message?: string; attachments?: Array<{ name: string }> });

    // 造历史产物（换 Agent 继承附件用）
    const wsDir = path.join(RUNTIME_ROOT, String(uid), 'workspace', wsId);
    mkdirSync(path.join(wsDir, 'outputs'), { recursive: true });
    const pdfBytes = Buffer.from('%PDF-1.4 mock', 'utf-8');
    writeFileSync(path.join(wsDir, 'outputs', 'report.pdf'), pdfBytes);
    const ts = Date.now();
    mkdirSync(path.join(wsDir, '.pi-agent'), { recursive: true });
    writeFileSync(
      path.join(wsDir, '.pi-agent', 'artifacts.jsonl'),
      JSON.stringify({ rel: 'outputs/report.pdf', mime: 'application/pdf', size: pdfBytes.length, mtimeMs: ts, ts }) + '\n',
      'utf-8'
    );

    // 轮 1：Agent A 正常回答
    const turn1 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: { message: '旧问题（Agent A）', config_id: cfgA, node_id: NODE_ID, workspace_id: wsId },
    });
    expect(turn1.statusCode).toBe(200);
    // 轮 2：切 Agent B，首条消息传输失败（500）
    const turn2 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: { message: '换 Agent B 续聊', config_id: cfgB, node_id: NODE_ID, workspace_id: wsId },
    });
    expect(turn2.statusCode).toBe(200);
    // 轮 3：用户重试同一消息（regenerate）→ 必须重新折叠 + 重新带附件
    const turn3 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: { message: '换 Agent B 续聊', config_id: cfgB, node_id: NODE_ID, workspace_id: wsId },
    });
    expect(turn3.statusCode).toBe(200);

    const bodies = streamBodies();
    expect(bodies).toHaveLength(3);
    expect(bodies[0]!.message).toBe('旧问题（Agent A）');
    // 首次切 B 已折叠（原语义）
    expect(bodies[1]!.message).toContain('用户：旧问题（Agent A）');
    expect(bodies[1]!.message).toContain('助手：Agent A 答复');
    expect(bodies[1]!.attachments ?? []).toHaveLength(1);
    // 修复点：失败后重试同样携带折叠历史与产物附件（FastClaw 会话仍是空的）
    expect(bodies[2]!.message).toContain('用户：旧问题（Agent A）');
    expect(bodies[2]!.message).toContain('助手：Agent A 答复');
    expect((bodies[2]!.message ?? '').endsWith('换 Agent B 续聊')).toBe(true);
    expect(bodies[2]!.attachments ?? []).toHaveLength(1);

    // transcript：user 行不因重试重复（去重守卫仍生效），重试成功后落 assistant 行
    const lines = readTranscript(wsId);
    expect(lines.map((l) => l.content)).toEqual(['旧问题（Agent A）', 'Agent A 答复', '换 Agent B 续聊', 'B 最终答复']);
    expect(lines.map((l) => l.agentKey)).toEqual([
      `agt_retryA@${srv.rootURL}`,
      `agt_retryA@${srv.rootURL}`,
      `agt_retryB@${srv.rootURL}`,
      `agt_retryB@${srv.rootURL}`,
    ]);

    // 轮 4：B 已确认（有 assistant 回执）→ 同 Agent 续发不再折叠、不再带附件
    const turn4 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: { message: '继续（仍是 Agent B）', config_id: cfgB, node_id: NODE_ID, workspace_id: wsId },
    });
    expect(turn4.statusCode).toBe(200);
    const b4 = streamBodies()[3]!;
    expect(b4.message).toBe('继续（仍是 Agent B）');
    expect(b4.attachments ?? []).toHaveLength(0);
  });

  it('跨 Agent 续聊（同 workspaceId 换 Agent）：首条消息折叠旧 transcript，并以签名 URL 附件继承历史产物', async () => {
    const srv = await startMockOpenAIServer((_req, send) => {
      const base = { id: 'evt', type: 'x' };
      send(sseChunk({ ...base, type: 'content_delta', data: { delta: 'Agent 答复' } }));
      send(sseChunk({ ...base, type: 'done', data: {} }));
    });
    openServers.push(srv);
    const streamBodies = () =>
      srv.requests
        .filter((r) => r.path.endsWith('/api/chat/stream'))
        .map((r) => r.body as { message?: string; attachments?: Array<{ url: string; name: string }> });

    // 同一节点同一工作区：先 Agent A（agt_foldA@同 rootURL），再切 Agent B
    const cfgA = await seedChat({ agentConfig: { baseUrl: srv.rootURL, agentId: 'agt_foldA' } });
    const cfgB = await seedChat({ agentConfig: { baseUrl: srv.rootURL, agentId: 'agt_foldB' } });
    const wsId = `${NODE_ID}_fc-fold`;

    const turn1 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: { message: '旧问题（Agent A）', config_id: cfgA, node_id: NODE_ID, workspace_id: wsId },
    });
    expect(turn1.statusCode).toBe(200);

    // 造历史产物：正常文件（进附件）+ 已删文件（进降级清单）+ 超限大文件（进降级清单）
    const wsDir = path.join(RUNTIME_ROOT, String(uid), 'workspace', wsId);
    const outputsDir = path.join(wsDir, 'outputs');
    mkdirSync(outputsDir, { recursive: true });
    const pdfBytes = Buffer.from('%PDF-1.4 mock report bytes', 'utf-8');
    writeFileSync(path.join(outputsDir, 'report.pdf'), pdfBytes);
    writeFileSync(path.join(outputsDir, 'huge.bin'), Buffer.alloc(8 * 1024 * 1024 + 1, 7)); // 超 INHERIT_MAX_BYTES_PER_FILE
    const artifactsDir = path.join(wsDir, '.pi-agent');
    mkdirSync(artifactsDir, { recursive: true });
    const ts = Date.now();
    writeFileSync(
      path.join(artifactsDir, 'artifacts.jsonl'),
      [
        { rel: 'outputs/report.pdf', mime: 'application/pdf', size: pdfBytes.length, mtimeMs: ts, ts },
        { rel: 'outputs/gone.png', mime: 'image/png', size: 100, mtimeMs: ts, ts }, // 磁盘不存在
        { rel: 'outputs/huge.bin', mime: 'application/octet-stream', size: 8 * 1024 * 1024 + 1, mtimeMs: ts, ts },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n',
      'utf-8'
    );

    const turn2 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: {
        message: '换 Agent B 续聊：按历史继续',
        config_id: cfgB,
        node_id: NODE_ID,
        workspace_id: wsId,
      },
    });
    expect(turn2.statusCode).toBe(200);

    const bodies = streamBodies();
    expect(bodies).toHaveLength(2);
    // 首条 = 折叠历史 + 降级清单 + 新消息；原文照常落盘
    expect(bodies[0]!.message).toBe('旧问题（Agent A）');
    expect(bodies[1]!.message).toContain('用户：旧问题（Agent A）');
    expect(bodies[1]!.message).toContain('助手：Agent 答复');
    expect(bodies[1]!.message).toContain('【历史产物文件（超出附带限制，仅列出文件名供参考）】');
    expect(bodies[1]!.message).toContain('gone.png');
    expect(bodies[1]!.message).toContain('huge.bin');
    expect(bodies[1]!.message!.endsWith('换 Agent B 续聊：按历史继续')).toBe(true);
    // 历史产物以签名 URL 附件传给 FastClaw（仅限内的真实文件）
    const atts = bodies[1]!.attachments ?? [];
    expect(atts).toHaveLength(1);
    expect(atts[0]!.name).toBe('report.pdf');
    const u = new URL(atts[0]!.url);
    expect(u.pathname).toBe('/api/modules/bookplate/chat/inherit-file');
    // 签名 URL 可实际取回文件字节（无鉴权端点，签名即鉴权）
    const dl = await app.inject({ method: 'GET', url: u.pathname + u.search });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(pdfBytes)).toBe(true);
    // 篡改签名 / 越权 rel 均被拒
    const tampered = new URL(atts[0]!.url);
    tampered.searchParams.set('sig', 'deadbeef');
    const bad = await app.inject({ method: 'GET', url: tampered.pathname + tampered.search });
    expect(bad.statusCode).toBe(403);
    const escape = new URL(atts[0]!.url);
    escape.searchParams.set('rel', '../conversation.jsonl');
    const esc = await app.inject({ method: 'GET', url: escape.pathname + escape.search });
    expect(esc.statusCode).toBe(403);

    // transcript 逐行标注该轮实际 Agent（agentKey = agent_id@base_url）；原文未被折叠/清单污染
    const lines = readTranscript(wsId);
    expect(lines.map((l) => l.content)).toEqual([
      '旧问题（Agent A）',
      'Agent 答复',
      '换 Agent B 续聊：按历史继续',
      'Agent 答复',
    ]);
    expect(lines.map((l) => l.agentKey)).toEqual([`agt_foldA@${srv.rootURL}`, `agt_foldA@${srv.rootURL}`, `agt_foldB@${srv.rootURL}`, `agt_foldB@${srv.rootURL}`]);
    // 折叠 + 附件继承仅首轮生效：第三轮仍用 Agent B（同 workspaceId）不再折叠、不再带附件
    const turn3 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: { message: '继续（仍是 Agent B）', config_id: cfgB, node_id: NODE_ID, workspace_id: wsId },
    });
    expect(turn3.statusCode).toBe(200);
    const b3 = streamBodies()[2]!;
    expect(b3.message).toBe('继续（仍是 Agent B）');
    expect(b3.attachments ?? []).toHaveLength(0);
  });

  it('同 Agent 同 workspaceId 续聊：不回折叠历史，只发最新消息', async () => {
    const srv = await startMockOpenAIServer((_req, send) => {
      const base = { id: 'evt', type: 'x' };
      send(sseChunk({ ...base, type: 'content_delta', data: { delta: '同 Agent 答复' } }));
      send(sseChunk({ ...base, type: 'done', data: {} }));
    });
    openServers.push(srv);
    const streamMsgs = () =>
      srv.requests
        .filter((r) => r.path.endsWith('/api/chat/stream'))
        .map((r) => (r.body as { message?: string }).message ?? '');
    const streamBodies = () =>
      srv.requests
        .filter((r) => r.path.endsWith('/api/chat/stream'))
        .map((r) => r.body as { message?: string; attachments?: Array<{ url: string; name: string }> });
    const cfg = await seedChat({ agentConfig: { baseUrl: srv.rootURL, agentId: 'agt_same' } });
    const wsId = `${NODE_ID}_fc-same`;

    const turn1 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: { message: '问题一', config_id: cfg, node_id: NODE_ID, workspace_id: wsId },
    });
    expect(turn1.statusCode).toBe(200);
    const turn2 = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat',
      headers: auth(),
      payload: { message: '问题二', config_id: cfg, node_id: NODE_ID, workspace_id: wsId },
    });
    expect(turn2.statusCode).toBe(200);

    // 同 Agent：sessionKey 相同 = FastClaw 服务端会话自动连续，只发最新消息
    const msgs = streamMsgs();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toBe('问题一');
    expect(msgs[1]).toBe('问题二');
    // 同 Agent 续聊不触发跨 Agent 折中：不折叠、不带继承附件
    const atts = streamBodies().map((b) => b.attachments ?? []);
    expect(atts).toEqual([[], []]);
  });
});
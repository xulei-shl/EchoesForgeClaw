import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { startMockOpenAIServer, sseChunk, type MockOpenAIServer } from '../helpers/mock-openai-server.js';

/**
 * 平台 API 契约测试（对应 Python 的端到端链路）：
 * - 生成记录：创建（题名提取）/ 列表 / 删除（级联清理收藏）
 * - 收藏 / 公开画廊：幂等添加 / 列表 / 取消
 * - 管理端：模型配置 CRUD + 连通性测试 / 提示词 / 节点配置（模式互斥）/ 系统设置（敏感掩码）
 *   / FastClaw Agent（懒解析名字）/ Skill Agent（AGENTS.md 物化）/ Bifrost（文件夹/预览图）
 */

let db: DB;
let app: Awaited<ReturnType<typeof buildApp>>;
const openServers: MockOpenAIServer[] = [];
let adminToken = '';
let userToken = '';

// runtime/ 在仓库根目录下（与 skill-agent-service.ts 的 REAL_AGENTS_ROOT 口径一致），测试文件位于 backend-ts/tests/api/，向上三层
const REAL_AGENTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime/.agent/agents');

function agentMdPath(id: number): string {
  return path.join(REAL_AGENTS_ROOT, String(id), 'AGENTS.md');
}

beforeAll(async () => {
  db = initDb(':memory:');
  setDb(db);
  const schema = await import('../../src/db/schema.js');
  db.insert(schema.users)
    .values({ username: 'admin', passwordHash: hashSync('admin123', 10), role: 'admin', isActive: true })
    .run();
  db.insert(schema.users)
    .values({ username: 'user2', passwordHash: hashSync('user123', 10), role: 'user', isActive: true })
    .run();
  app = await buildApp();

  const login = async (username: string, password: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password },
    });
    return (res.json() as { token: string }).token;
  };
  adminToken = await login('admin', 'admin123');
  userToken = await login('user2', 'user123');
});

afterAll(async () => {
  await app.close();
  await Promise.all(openServers.splice(0).map((s) => s.close()));
  setDb(null);
  // 清理测试产生的 AGENTS.md 及其空父目录（非空 = 含真实数据，跳过）
  for (let i = 1; i <= 20; i++) {
    if (existsSync(agentMdPath(i))) rmSync(agentMdPath(i), { recursive: true });
    const dir = path.dirname(agentMdPath(i));
    try {
      if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 不存在或非空：跳过 */
    }
  }
});

/** 创建一条生成记录（带题名元数据）。 */
async function createGeneration(token: string, opts: { title?: string; nodeType?: string } = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/generations',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      node_type: opts.nodeType ?? 'image_generation',
      stage_results: { stage1: { metadata: { title: opts.title ?? '我的藏书票' } }, stage3: {} },
      result_url: '/static/generated/demo.png',
      status: 'completed',
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    id: number;
    name: string;
    is_favorited: boolean;
    is_public: boolean;
    stage_results: Record<string, unknown>;
  };
}

describe('生成记录', () => {
  it('创建：自动提取题名，初始未收藏/未公开', async () => {
    const gen = await createGeneration(adminToken, { title: '深海的藏书票' });
    expect(gen.name).toBe('深海的藏书票');
    expect(gen.is_favorited).toBe(false);
    expect(gen.is_public).toBe(false);
    expect((gen.stage_results as any).stage1.metadata.title).toBe('深海的藏书票');
  });

  it('列表：分页 + 类型计数（不受 keyword 过滤影响）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/generations?keyword=藏书票&limit=5',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.node_type_counts.some((c: any) => c.node_type === 'image_generation')).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  it('删除：级联清理其他用户的收藏', async () => {
    const gen = await createGeneration(adminToken, { title: '待删除' });
    // user2 收藏
    const favRes = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { generation_id: gen.id },
    });
    expect(favRes.statusCode).toBe(200);
    // 删除
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/generations/${gen.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode).toBe(200);
    // user2 的收藏列表不再包含它
    const favList = await app.inject({
      method: 'GET',
      url: '/api/favorites',
      headers: { authorization: `Bearer ${userToken}` },
    });
    const items = (favList.json() as { items: { id: number }[] }).items;
    expect(items.some((i) => i.id === gen.id)).toBe(false);
  });
});

describe('收藏 / 公开画廊', () => {
  it('收藏他人作品：幂等，返回带 username', async () => {
    const gen = await createGeneration(adminToken, { title: '画廊作品' });
    const fav = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { generation_id: gen.id },
    });
    expect(fav.statusCode).toBe(200);
    const body = fav.json();
    expect(body.username).toBe('admin');
    expect(body.is_favorited).toBe(true);
    // 幂等：重复收藏仍成功
    const again = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { generation_id: gen.id },
    });
    expect(again.statusCode).toBe(200);
    // 取消收藏
    const rm = await app.inject({
      method: 'DELETE',
      url: `/api/favorites/${gen.id}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(rm.statusCode).toBe(200);
    expect(rm.json().is_favorited).toBe(false);
  });

  it('公开画廊：分享（幂等）→ 他人可见 → 撤下', async () => {
    const gen = await createGeneration(adminToken, { title: '公开作品' });
    const share = await app.inject({
      method: 'POST',
      url: '/api/public',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { generation_id: gen.id },
    });
    expect(share.statusCode).toBe(200);
    expect(share.json().is_public).toBe(true);

    const gallery = await app.inject({
      method: 'GET',
      url: '/api/public',
      headers: { authorization: `Bearer ${userToken}` },
    });
    const items = (gallery.json() as { items: { id: number; username: string }[] }).items;
    expect(items.some((i) => i.id === gen.id && i.username === 'admin')).toBe(true);

    const unshare = await app.inject({
      method: 'DELETE',
      url: `/api/public/${gen.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(unshare.json().is_public).toBe(false);
  });

  it('公开他人的记录：404', async () => {
    const gen = await createGeneration(adminToken);
    const res = await app.inject({
      method: 'POST',
      url: '/api/public',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { generation_id: gen.id },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('管理端：模型配置', () => {
  it('CRUD：api_key 永不回传，留空保存不修改', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-configs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'DeepSeek', kind: 'text', api_key: 'sk-1', base_url: 'https://api.deepseek.com/v1', model_name: 'deepseek-chat' },
    });
    expect(create.statusCode).toBe(200);
    const cfg = create.json();
    expect(cfg.has_api_key).toBe(true);
    expect(cfg.api_key).toBeUndefined();
    const id = cfg.id as number;

    // 修改不传 api_key → 保留
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/llm-configs/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'DeepSeek 改', api_key: '' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe('DeepSeek 改');
    expect(patch.json().has_api_key).toBe(true);
  });

  it('连通性测试：image 走 /models 探测', async () => {
    const srv = await startMockOpenAIServer(() =>
      JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] })
    );
    openServers.push(srv);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-configs/test',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { kind: 'image', api_key: 'sk-x', base_url: srv.baseURL, model_name: 'dall-e' },
    });
    expect(res.statusCode).toBe(200);
    expect(srv.requests[0]?.path).toBe('/v1/models');
    expect(res.json().ok).toBe(true);
    expect(res.json().message).toContain('2 个模型');
  });

  it('连通性测试：text 走最小 chat 调用', async () => {
    // generateText 走非流式 chat.completions JSON 响应（不是 SSE）
    const srv = await startMockOpenAIServer(() =>
      JSON.stringify({
        id: 'c',
        object: 'chat.completion',
        created: 0,
        model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        usage: { total_tokens: 2 },
      })
    );
    openServers.push(srv);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-configs/test',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { kind: 'text', api_key: 'sk-x', base_url: srv.baseURL, model_name: 'mock' },
    });
    expect(res.statusCode).toBe(200);
    expect(srv.requests[0]?.path).toBe('/v1/chat/completions');
    expect(res.json().ok).toBe(true);
    expect(res.json().message).toContain('可正常响应');
  });
});

describe('管理端：提示词 / 节点配置', () => {
  it('提示词模板 CRUD', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/prompts',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: '对话提示词', node_type: 'chat', content: '你是助手' },
    });
    expect(create.statusCode).toBe(200);
    expect(create.json().content).toBe('你是助手');
  });

  it('节点配置：模式互斥校验 + 引用名称回填', async () => {
    // 先建模型配置与 Agent 配置
    const llm = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-configs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'LLM-A', kind: 'text', api_key: 'sk', base_url: 'http://x/v1', model_name: 'm' },
    });
    const llmId = (llm.json() as { id: number }).id;
    const agent = await app.inject({
      method: 'POST',
      url: '/api/admin/fastclaw-agents',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'FC-A', base_url: 'http://fc', agent_id: 'agt_1', api_key: 'sk' },
    });
    const agentId = (agent.json() as { id: number }).id;

    // 互斥：llm + agent 同选 → 400
    const bad = await app.inject({
      method: 'POST',
      url: '/api/admin/node-configs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { node_type: 'chat', name: '坏配置', llm_config_id: llmId, agent_config_id: agentId },
    });
    expect(bad.statusCode).toBe(400);

    // 合法：仅 agent → 200，名称回填
    const ok = await app.inject({
      method: 'POST',
      url: '/api/admin/node-configs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { node_type: 'chat', name: 'Agent 对话', agent_config_id: agentId },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.agent_config_name).toBe('FC-A');
    expect(body.llm_config_name).toBeNull();
  });
});

describe('管理端：系统设置', () => {
  it('敏感键值掩码回传，留空/掩码保存不修改', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { key: 'bifrost.password', value: 'real-secret', description: 'Bifrost 密码' },
    });
    expect(create.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const item = (list.json() as { key: string; value: string; sensitive: boolean }[]).find((s) => s.key === 'bifrost.password');
    expect(item?.sensitive).toBe(true);
    expect(item?.value).toBe('********');

    // 掩码保存 → 不修改
    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.password',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { value: '********' },
    });
    expect(put.json().value).toBe('********');
    // 真实值仍在库中（改个 description 验证仍可保存）
    const put2 = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.password',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { description: '改了描述' },
    });
    expect(put2.json().description).toBe('改了描述');
  });
});

describe('管理端：FastClaw / Skill Agent', () => {
  it('FastClaw Agent：复制带 (副本) 后缀；列表懒解析真实名字', async () => {
    const srv = await startMockOpenAIServer((req) => {
      expect(req.path).toBe('/api/agents');
      return JSON.stringify({ agents: [{ id: 'agt_real', name: 'Xulei' }] });
    });
    openServers.push(srv);
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/fastclaw-agents',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: '我的 Agent', base_url: srv.rootURL, agent_id: 'agt_real', api_key: 'sk' },
    });
    const id = (create.json() as { id: number }).id;

    const dup = await app.inject({
      method: 'POST',
      url: `/api/admin/fastclaw-agents/${id}/duplicate`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(dup.statusCode).toBe(200);
    expect((dup.json() as { name: string }).name).toBe('我的 Agent (副本)');

    // 列表懒解析：agent_name 从 mock FastClaw 回填
    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/fastclaw-agents',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const items = list.json() as { id: number; agent_name: string }[];
    expect(items.find((i) => i.id === id)?.agent_name).toBe('Xulei');
  });

  it('Skill Agent：必须引用模型配置；保存物化 AGENTS.md，删除清理', async () => {
    // 未选模型配置 → 400
    const bad = await app.inject({
      method: 'POST',
      url: '/api/admin/skill-agent-configs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: '无模型' },
    });
    expect(bad.statusCode).toBe(400);

    // 建模型配置 + 提示词
    const llm = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-configs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'SA-LLM', kind: 'text', api_key: 'sk', base_url: 'http://x/v1', model_name: 'm' },
    });
    const llmId = (llm.json() as { id: number }).id;
    const prompt = await app.inject({
      method: 'POST',
      url: '/api/admin/prompts',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'SA-系统提示词', node_type: 'chat', content: '你是 deepseek harness' },
    });
    const promptId = (prompt.json() as { id: number }).id;

    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/skill-agent-configs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Harness', llm_config_id: llmId, prompt_id: promptId },
    });
    expect(create.statusCode).toBe(200);
    const cfg = create.json();
    expect(cfg.llm_config_name).toBe('SA-LLM');
    // 展示字段从引用解析
    expect(cfg.base_url).toBe('http://x/v1');
    expect(cfg.system_prompt).toBe('你是 deepseek harness');
    const id = cfg.id as number;
    // AGENTS.md 已物化
    expect(existsSync(agentMdPath(id))).toBe(true);

    // 删除 → AGENTS.md 清理
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/skill-agent-configs/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode).toBe(200);
    expect(existsSync(agentMdPath(id))).toBe(false);
  });
});

describe('管理端：Bifrost', () => {
  beforeAll(async () => {
    // 配置 Bifrost 连接（Basic Auth）
    await app.inject({
      method: 'POST',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { key: 'bifrost.base_url', value: 'http://localhost:1', description: 'x' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { key: 'bifrost.username', value: 'u', description: 'x' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { key: 'bifrost.password', value: 'p', description: 'x' },
    });
  });

  it('文件夹列表 + 提示词列表（latest_version 正文提取）', async () => {
    const srv = await startMockOpenAIServer((req) => {
      if (req.path === '/api/prompt-repo/folders') {
        return JSON.stringify({ folders: [{ id: 'f1', name: '绘图' }] });
      }
      if (req.path === '/api/prompt-repo/prompts') {
        return JSON.stringify({
          prompts: [
            {
              id: 'p1',
              name: '藏书票',
              folder_id: 'f1',
              latest_version: {
                version_number: 2,
                messages: [{ message: { payload: { role: 'user', content: '第一段正文' } } }],
              },
            },
          ],
        });
      }
      if (req.path === '/api/prompt-repo/prompts/p1') {
        return JSON.stringify({
          id: 'p1',
          name: '藏书票',
          folder_id: 'f1',
          latest_version: {
            version_number: 2,
            messages: [{ message: { payload: { role: 'user', content: '第一段正文' } } }],
          },
        });
      }
      return JSON.stringify({});
    });
    openServers.push(srv);
    // 指向 mock 服务器
    await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.base_url',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { value: srv.rootURL },
    });

    const folders = await app.inject({
      method: 'GET',
      url: '/api/admin/bifrost/folders',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(folders.statusCode).toBe(200);
    expect((folders.json() as { folders: { id: string }[] }).folders[0]?.id).toBe('f1');

    const prompts = await app.inject({
      method: 'GET',
      url: '/api/admin/bifrost/prompts',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(prompts.statusCode).toBe(200);
    const items = (prompts.json() as { prompts: { id: string; content: string; version_number: number }[] }).prompts;
    expect(items[0]?.id).toBe('p1');
    expect(items[0]?.content).toBe('第一段正文');
    expect(items[0]?.version_number).toBe(2);
  });

  it('预览图上传：魔数校验 + prompt_metadata 落库', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const boundary = '----bookforgetest';
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="preview.png"\r\n` +
      `Content-Type: image/png\r\n\r\n` +
      png.toString('binary') +
      `\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/bifrost/prompts/p1/preview',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(body, 'binary'),
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { preview_image: string };
    expect(out.preview_image.startsWith('/static/prompt-previews/')).toBe(true);

    // 详情合并预览图
    const detail = await app.inject({
      method: 'GET',
      url: '/api/admin/bifrost/prompts/p1',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect((detail.json() as { preview_image: string }).preview_image).toBe(out.preview_image);

    // 删除
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/admin/bifrost/prompts/p1/preview',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect((del.json() as { preview_image: null }).preview_image).toBeNull();
    // 画布端提示词检索（普通用户 token 即可访问）
    const bookplatePrompts = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/bifrost/prompts',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(bookplatePrompts.statusCode).toBe(200);
    const bpItems = (bookplatePrompts.json() as { prompts: { id: string; content: string }[] }).prompts;
    expect(bpItems[0]?.id).toBe('p1');
    expect(bpItems[0]?.content).toBe('第一段正文');

    const bookplateDetail = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/bifrost/prompts/p1',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(bookplateDetail.statusCode).toBe(200);
    expect((bookplateDetail.json() as { id: string }).id).toBe('p1');
  });

  it('提示词列表 force=1 绕过 TTL 缓存强制拉取远端', async () => {
    const srv = await startMockOpenAIServer(() =>
      JSON.stringify({ prompts: [{ id: 'pf1', name: 'force-prompt', latest_version: { version_number: 1, messages: [] } }] })
    );
    openServers.push(srv);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.base_url',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { value: srv.rootURL },
    });
    const get = (url: string) =>
      app.inject({ method: 'GET', url: `/api/admin/bifrost/prompts${url}`, headers: { authorization: `Bearer ${adminToken}` } });
    const promptCalls = () => srv.requests.filter((r) => r.path === '/api/prompt-repo/prompts').length;

    await get('');
    expect(promptCalls()).toBe(1);
    await get('');
    expect(promptCalls()).toBe(1); // TTL 内命中缓存，不再请求 Bifrost
    const res = await get('?force=1');
    expect(promptCalls()).toBe(2); // force 绕过缓存强制拉取
    expect(res.statusCode).toBe(200);
    expect((res.json() as { prompts: { id: string }[] }).prompts[0]?.id).toBe('pf1');
  });
});

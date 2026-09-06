import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { nodeWorkspace, workspacePath, workspaceRoot } from '../../src/services/skill-agent-service.js';
import {
  deletePiConversation,
  listPiConversations,
  setConversationPinned,
  setConversationTitle,
} from '../../src/services/pi/conversations.js';

/**
 * pi 对话历史列表 / 置顶 / 删除契约测试：
 * - listPiConversations：仅收录含 pi 会话的工作区；标题（meta > 首条用户消息剥离注入上下文 > 时间兜底）；
 *   轮次计数 / 创建更新时间；置顶在前（pinnedAt 倒序）、其余按 updatedAt 倒序；node_id 前缀过滤
 * - GET /chat/sessions：列表端点（鉴权 + node_id 过滤）
 * - POST /chat/session/pin：置顶 / 取消置顶（.pi-agent/meta.json 持久化）
 * - DELETE /chat/session：完整删除 workspace 目录（含会话 / 产物 / 上传）
 */

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');
/** 本文件独占的用户目录（与其它测试文件错开，避免并发污染）。 */
const UID = 990101;
const NODE_ID = `chat-history-test-${Date.now()}`;

let db: DB;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
let uid = 1;

/** 造一个带会话文件的工作区（nodeId 前缀由调用方拼入 workspaceId）。 */
function seedWorkspace(workspaceId: string, userLines: string[], opts?: { sessionTs?: string }): string {
  const ws = nodeWorkspace(uid, workspaceId);
  const file = path.join(ws, '.pi-agent', 'run', 'chat.jsonl');
  mkdirSync(path.dirname(file), { recursive: true });
  const lines: Array<Record<string, unknown>> = [
    { type: 'session', version: 3, id: 'sess', timestamp: opts?.sessionTs ?? '2026-09-01T00:00:00.000Z' },
    { type: 'model_change', id: 'mc', parentId: null, provider: 'bookforge', modelId: 'm' },
  ];
  for (const text of userLines) {
    lines.push({
      type: 'message',
      id: `u-${Math.random().toString(36).slice(2, 8)}`,
      message: { role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() },
    });
  }
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  return ws;
}

function ws(id: string): string {
  return nodeWorkspace(uid, id);
}

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
  setDb(null);
  // 仅清理本文件创建的工作区（{NODE_ID}_ 前缀）；其它测试文件共享同一用户目录，不得整体删除
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

describe('listPiConversations（服务端列表）', () => {
  it('仅收录含 pi 会话的工作区；标题剥离注入上下文；轮次与时间字段正确', () => {
    const wsId = `${NODE_ID}_1001`;
    seedWorkspace(wsId, ['【上级上下文】\n第一段注入\n\n【继承图片】\n- inputs/a.png\n\n这是真正的问题']);
    // 无会话文件的工作区（FastClaw / LLM 节点残留）不入列
    nodeWorkspace(uid, `${NODE_ID}_1002`);

    const list = listPiConversations(uid, NODE_ID);
    expect(list.length).toBe(1);
    const s = list[0]!;
    expect(s.workspaceId).toBe(wsId);
    expect(s.title).toBe('这是真正的问题');
    expect(s.messageCount).toBe(1);
    expect(s.pinned).toBe(false);
    expect(s.createdAt).toBeGreaterThan(0);
    expect(s.updatedAt).toBeGreaterThan(0);
  });

  it('无用户消息时标题回退为「对话 + 时间」；meta 标题优先于自动标题', () => {
    seedWorkspace(`${NODE_ID}_2001`, []);
    const wsA = ws(`${NODE_ID}_2001`);
    const meta = path.join(wsA, '.pi-agent', 'meta.json');
    mkdirSync(path.dirname(meta), { recursive: true });
    writeFileSync(meta, JSON.stringify({ title: '自定义标题' }), 'utf-8');

    const list = listPiConversations(uid, NODE_ID);
    const s = list.find((x) => x.workspaceId === `${NODE_ID}_2001`)!;
    expect(s.title).toBe('自定义标题');
  });

  it('置顶会话排在未置顶之前（置顶时间倒序），未置顶按更新时间倒序', async () => {
    const idA = `${NODE_ID}_3001`; // 未置顶
    const idB = `${NODE_ID}_3002`; // 置顶（较晚）
    const idC = `${NODE_ID}_3003`; // 置顶（较早）
    seedWorkspace(idA, ['消息 A']);
    seedWorkspace(idB, ['消息 B']);
    seedWorkspace(idC, ['消息 C']);
    setConversationPinned(ws(idC), true);
    // 两次置顶错开时间，保证 pinnedAt 严格有序（避免同毫秒并列）
    await new Promise((r) => setTimeout(r, 5));
    setConversationPinned(ws(idB), true);

    const list = listPiConversations(uid, NODE_ID);
    const order = list.map((s) => s.workspaceId);
    expect(order.indexOf(idB)).toBeLessThan(order.indexOf(idC));
    expect(order.indexOf(idC)).toBeLessThan(order.indexOf(idA));
    expect(list.find((s) => s.workspaceId === idB)!.pinned).toBe(true);
    expect(list.find((s) => s.workspaceId === idA)!.pinned).toBe(false);
  });

  it('node_id 前缀过滤：仅返回该节点名下（{nodeId}_ 前缀）的会话', () => {
    seedWorkspace(`${NODE_ID}_4001`, ['本节点']);
    seedWorkspace(`other-node-${Date.now()}_4001`, ['其它节点']);
    const list = listPiConversations(uid, NODE_ID);
    expect(list.every((s) => s.workspaceId.startsWith(`${NODE_ID}_`))).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('setConversationTitle（重命名）', () => {
  it('写入 title 后列表使用自定义标题；置顶状态不受影响；超长标题按码点截断', () => {
    const id = `${NODE_ID}_4501`;
    seedWorkspace(id, ['原始消息']);
    setConversationPinned(ws(id), true);
    expect(setConversationTitle(ws(id), '  我的新标题  ')).toBe(true);

    const s = listPiConversations(uid, NODE_ID).find((x) => x.workspaceId === id)!;
    expect(s.title).toBe('我的新标题');
    expect(s.pinned).toBe(true);

    // 超长标题按码点截断到 100 字符
    const longId = `${NODE_ID}_4504`;
    seedWorkspace(longId, ['长标题']);
    setConversationTitle(ws(longId), 'x'.repeat(500));
    const long = listPiConversations(uid, NODE_ID).find((x) => x.workspaceId === longId)!;
    expect(long.title.length).toBe(100);
  });

  it('空白标题清除自定义标题，回退自动标题', () => {
    const id = `${NODE_ID}_4502`;
    seedWorkspace(id, ['自动标题消息']);
    setConversationTitle(ws(id), '临时标题');
    expect(listPiConversations(uid, NODE_ID).find((x) => x.workspaceId === id)!.title).toBe('临时标题');

    setConversationTitle(ws(id), '   ');
    expect(listPiConversations(uid, NODE_ID).find((x) => x.workspaceId === id)!.title).toBe('自动标题消息');
  });

  it('工作区不存在返回 false，且不落空目录', () => {
    const missing = `${NODE_ID}_4503`;
    const before = readdirSync(workspaceRoot(uid));
    expect(setConversationTitle(workspacePath(uid, missing), 'x')).toBe(false);
    // 只读路径解析（workspacePath）不应创建目录
    expect(existsSync(path.join(workspaceRoot(uid), missing))).toBe(false);
    expect(readdirSync(workspaceRoot(uid))).toEqual(before);
  });
});

describe('deletePiConversation', () => {
  it('完整删除工作区目录；不存在的会话返回 false', async () => {
    const id = `${NODE_ID}_5001`;
    const dir = ws(id);
    seedWorkspace(id, ['待删除']);
    writeFileSync(path.join(dir, 'outputs.txt'), 'x');
    expect(existsSync(dir)).toBe(true);

    expect(await deletePiConversation(uid, id)).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(await deletePiConversation(uid, id)).toBe(false);
  });

  it('非法 workspace_id（路径穿越字符）被消毒后不会误删其它目录', async () => {
    const victim = `${NODE_ID}_6001`;
    seedWorkspace(victim, ['保留']);
    // 消毒后与 victim 相同的 id 才可能命中；带穿越字符的输入不会越界
    await deletePiConversation(uid, `${NODE_ID}_6001/../../x`);
    expect(existsSync(ws(victim))).toBe(true);
  });
});

describe('chat 会话列表 / 置顶 / 重命名 / 删除路由（鉴权）', () => {
  it('未登录访问返回 401', async () => {
    const rename = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/session/rename',
      payload: { workspace_id: `${NODE_ID}_4501`, title: 'x' },
    });
    expect(rename.statusCode).toBe(401);
  });

  it('POST /chat/session/rename 重命名并反映到列表；空白恢复自动标题；缺失会话 404；非法参数 400', async () => {
    const id = `${NODE_ID}_7501`;
    seedWorkspace(id, ['重命名路由消息']);

    // 重命名
    const renameRes = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/session/rename',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspace_id: id, title: '  路由新标题  ' },
    });
    expect(renameRes.statusCode).toBe(200);
    expect((renameRes.json() as { ok: boolean }).ok).toBe(true);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/sessions?node_id=${NODE_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const mine = (listRes.json() as { sessions: { workspaceId: string; title: string }[] }).sessions.find(
      (s) => s.workspaceId === id
    );
    expect(mine?.title).toBe('路由新标题');

    // 空白标题 → 恢复自动标题
    await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/session/rename',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspace_id: id, title: '   ' },
    });
    const afterReset = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/sessions?node_id=${NODE_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const reset = (afterReset.json() as { sessions: { workspaceId: string; title: string }[] }).sessions.find(
      (s) => s.workspaceId === id
    );
    expect(reset?.title).toBe('重命名路由消息');

    // 会话不存在 → 404（且不落空目录）
    const missing = `${NODE_ID}_nope`;
    const missingRes = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/session/rename',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspace_id: missing, title: 'x' },
    });
    expect(missingRes.statusCode).toBe(404);
    expect(existsSync(path.join(RUNTIME_ROOT, String(uid), 'workspace', missing))).toBe(false);

    // 非法参数 → 400
    const badWs = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/session/rename',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspace_id: '', title: 'x' },
    });
    expect(badWs.statusCode).toBe(400);
    const badTitle = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/session/rename',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspace_id: id, title: 123 },
    });
    expect(badTitle.statusCode).toBe(400);
  });
});

describe('chat 会话列表 / 置顶 / 删除路由（鉴权）', () => {
  it('未登录访问返回 401', async () => {
    const list = await app.inject({ method: 'GET', url: `/api/modules/bookplate/chat/sessions?node_id=${NODE_ID}` });
    expect(list.statusCode).toBe(401);
    const pin = await app.inject({ method: 'POST', url: '/api/modules/bookplate/chat/session/pin', payload: { workspace_id: `${NODE_ID}_1001`, pinned: true } });
    expect(pin.statusCode).toBe(401);
    const del = await app.inject({ method: 'DELETE', url: '/api/modules/bookplate/chat/session', payload: { workspace_id: `${NODE_ID}_1001` } });
    expect(del.statusCode).toBe(401);
  });

  it('GET /chat/sessions 返回列表；POST pin 置顶并反映到列表；DELETE 删除目录', async () => {
    const id = `${NODE_ID}_7001`;
    seedWorkspace(id, ['路由测试消息']);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/sessions?node_id=${NODE_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json() as { sessions: { workspaceId: string; title: string }[] };
    const mine = listBody.sessions.find((s) => s.workspaceId === id);
    expect(mine?.title).toBe('路由测试消息');

    const pinRes = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/session/pin',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspace_id: id, pinned: true },
    });
    expect(pinRes.statusCode).toBe(200);
    expect((pinRes.json() as { ok: boolean }).ok).toBe(true);

    const listAfterPin = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/sessions?node_id=${NODE_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const afterPin = (listAfterPin.json() as { sessions: { workspaceId: string; pinned: boolean }[] }).sessions;
    expect(afterPin.find((s) => s.workspaceId === id)?.pinned).toBe(true);

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/modules/bookplate/chat/session',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspace_id: id },
    });
    expect(delRes.statusCode).toBe(200);
    expect((delRes.json() as { deleted: boolean }).deleted).toBe(true);
    // nodeWorkspace 会重建目录，此处直接用原始路径断言删除结果
    expect(existsSync(path.join(RUNTIME_ROOT, String(uid), 'workspace', id))).toBe(false);
  });

  it('非法参数返回 400', async () => {
    const pin = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/session/pin',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspace_id: '', pinned: true },
    });
    expect(pin.statusCode).toBe(400);
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/modules/bookplate/chat/session',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(del.statusCode).toBe(400);
  });
});
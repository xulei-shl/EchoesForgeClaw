import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { nodeWorkspace } from '../../src/services/skill-agent-service.js';
import { hydratePiSession, resolvePiSessionFile } from '../../src/services/pi-session-hydrate.js';

/**
 * pi 会话水合与产物列表契约测试：
 * - hydratePiSession：jsonl v3 条目 → UI 历史（文本/推理/工具卡/中断/压缩/坏行/截断）
 * - GET /chat/session：水合端点（鉴权）
 * - GET /chat/session/image：内联图片块鉴权取图
 * - GET /chat/files：工作区产物快照 ∪ manifest（删除标记）
 */

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');
const WS_ID = `pi-hydrate_${Date.now()}`;
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let db: DB;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
let uid = 1;

/** 写一条会话 jsonl 到测试工作区（先清掉两种落点的残留，保证用例间隔离）。 */
function seedSession(lines: unknown[], rel: 'run' | 'root' = 'run'): void {
  const ws = nodeWorkspace(uid, WS_ID);
  rmSync(path.join(ws, '.pi-agent', 'run'), { recursive: true, force: true });
  rmSync(path.join(ws, '.pi-agent', 'chat.jsonl'), { force: true });
  const file =
    rel === 'run'
      ? path.join(ws, '.pi-agent', 'run', 'chat.jsonl')
      : path.join(ws, '.pi-agent', 'chat.jsonl');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'), 'utf-8');
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
  // 仅清理本测试创建的工作区；空父目录按 skills.test.ts 同口径收敛
  rmSync(path.join(RUNTIME_ROOT, String(uid), 'workspace', WS_ID), { recursive: true, force: true });
  for (const p of [
    path.join(RUNTIME_ROOT, String(uid), 'workspace'),
    path.join(RUNTIME_ROOT, String(uid)),
  ]) {
    try {
      if (readdirSync(p).length === 0) rmSync(p, { recursive: true, force: true });
    } catch {
      /* 不存在或非空：跳过 */
    }
  }
});

describe('hydratePiSession（jsonl → UI 历史）', () => {
  it('无会话文件时返回 exists:false', () => {
    const ws = nodeWorkspace(uid, `pi-hydrate_empty_${Date.now()}`);
    try {
      const result = hydratePiSession(ws, 'any-ws');
      expect(result.exists).toBe(false);
      expect(result.messages).toEqual([]);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('完整映射：user 文本+图片 / assistant 推理+工具调用 / toolResult 归并 / 压缩标记 / 坏行跳过', () => {
    seedSession([
      'not-json-line',
      { type: 'session', version: 3, id: 'sess01', cwd: '/x' },
      { type: 'model_change', id: 'mc01', parentId: null, provider: 'bookforge', modelId: 'm' },
      {
        type: 'message',
        id: 'e-user-1',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '画一只猫' },
            { type: 'image', data: PNG_B64, mimeType: 'image/png' },
          ],
          timestamp: 1000,
        },
      },
      {
        type: 'message',
        id: 'e-asst-1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '用户想要一张猫图', thinkingSignature: 'reasoning_content' },
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'image_generate',
              arguments: { prompt: 'a cat', path: 'outputs/cat.png' },
            },
            { type: 'text', text: '好的，正在生成' },
          ],
          stopReason: 'toolUse',
          timestamp: 2000,
        },
      },
      {
        type: 'message',
        id: 'e-tool-1',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'image_generate',
          content: [{ type: 'text', text: '图片已生成 outputs/cat.png' }],
          isError: false,
        },
      },
      { type: 'compaction', id: 'cp-1', summary: '摘要', firstKeptEntryId: 'e-user-1' },
    ]);

    const ws = nodeWorkspace(uid, WS_ID);
    expect(resolvePiSessionFile(ws)).toContain(path.join('.pi-agent', 'run', 'chat.jsonl'));
    const result = hydratePiSession(ws, WS_ID);
    expect(result.exists).toBe(true);
    expect(result.truncated).toBe(false);

    // [user, assistant, compaction 标记] —— toolResult 不单独成消息
    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);

    const user = result.messages[0]!;
    expect(user.id).toBe('e-user-1');
    expect(user.content).toBe('画一只猫');
    expect(user.files?.length).toBe(1);
    expect(user.files![0]!.url).toContain('/chat/session/image?workspace_id=');
    expect(user.files![0]!.url).toContain('entry=e-user-1&block=1');

    const asst = result.messages[1]!;
    expect(asst.content).toBe('好的，正在生成');
    expect(asst.reasoning).toBe('用户想要一张猫图');
    expect(asst.interrupted).toBeUndefined();
    const steps = asst.agentSteps ?? [];
    expect(steps.map((s) => s.type)).toEqual(['agent_tool_call', 'agent_tool_result']);
    expect(steps[0]).toMatchObject({ id: 'call-1', name: 'image_generate' });
    expect(steps[1]).toMatchObject({ id: 'call-1', name: 'image_generate', result: '图片已生成 outputs/cat.png' });
    // write/edit 之外的工具不产文件卡
    expect(asst.files ?? []).toEqual([]);

    expect(result.messages[2]!.agentSteps![0]!.message).toContain('上下文已压缩');
  });

  it('中断与错误轮次：aborted 标记 interrupted；errorMessage 转状态步骤', () => {
    seedSession([
      {
        type: 'message',
        id: 'u1',
        message: { role: 'user', content: '继续', timestamp: 1 },
      },
      {
        type: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '部分输出' }],
          stopReason: 'aborted',
        },
      },
      {
        type: 'message',
        id: 'u2',
        message: { role: 'user', content: '再来', timestamp: 2 },
      },
      {
        type: 'message',
        id: 'a2',
        message: {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: 'Provider returned error 429',
        },
      },
    ]);
    const result = hydratePiSession(nodeWorkspace(uid, WS_ID), WS_ID);
    expect(result.messages.length).toBe(4); // u1, a1(interrupted), u2, a2(错误步骤承载，零正文不产空气泡)
    expect(result.messages[1]!.interrupted).toBe(true);
    expect(result.messages[3]!.content).toBe('');
    expect(result.messages[3]!.agentSteps![0]!.message).toContain('429');
  });

  it('write 工具调用推导工作区产物文件卡（越界/装配目录排除）', () => {
    seedSession([
      {
        type: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'c1', name: 'write', arguments: { path: 'outputs/report.md', content: '# r' } },
            { type: 'toolCall', id: 'c2', name: 'write', arguments: { path: '../../escape.txt' } },
            { type: 'toolCall', id: 'c3', name: 'write', arguments: { path: '.pi-agent/skills/x.md' } },
            { type: 'text', text: '完成' },
          ],
          stopReason: 'stop',
        },
      },
    ]);
    const result = hydratePiSession(nodeWorkspace(uid, WS_ID), WS_ID);
    const files = result.messages[0]!.files ?? [];
    expect(files.length).toBe(1);
    expect(files[0]!.path).toBe('outputs/report.md');
    expect(files[0]!.url).toContain('/skill-files?path=');
    expect(files[0]!.mime).toBe('text/markdown');
  });

  it('超长字段截断并保留可读标记；遗留根级 chat.jsonl 可回退解析', () => {
    seedSession(
      [
        {
          type: 'message',
          id: 'a1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'x'.repeat(30_000) }],
            stopReason: 'stop',
          },
        },
      ],
      'root'
    );
    const ws = nodeWorkspace(uid, WS_ID);
    expect(resolvePiSessionFile(ws)).toBe(path.join(ws, '.pi-agent', 'chat.jsonl'));
    const result = hydratePiSession(ws, WS_ID);
    expect(result.messages[0]!.content.length).toBeLessThan(30_000);
    expect(result.messages[0]!.content.endsWith('…[已截断]')).toBe(true);
  });
});

describe('chat 会话/图片/文件路由（鉴权）', () => {
  it('未登录访问返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/modules/bookplate/chat/session?workspace_id=${WS_ID}` });
    expect(res.statusCode).toBe(401);
    const img = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/session/image?workspace_id=${WS_ID}&entry=e-user-1&block=1`,
    });
    expect(img.statusCode).toBe(401);
    const files = await app.inject({ method: 'GET', url: `/api/modules/bookplate/chat/files?workspace_id=${WS_ID}` });
    expect(files.statusCode).toBe(401);
  });

  it('GET /chat/session 返回水合历史；image 端点按 entry/block 取图', async () => {
    seedSession([
      { type: 'session', version: 3, id: 's', cwd: '/x' },
      {
        type: 'message',
        id: 'img-entry',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '看这张图' },
            { type: 'image', data: PNG_B64, mimeType: 'image/png' },
          ],
        },
      },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/session?workspace_id=${WS_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { exists: boolean; messages: { id: string }[] };
    expect(body.exists).toBe(true);
    expect(body.messages[0]!.id).toBe('img-entry');

    const img = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/session/image?workspace_id=${WS_ID}&entry=img-entry&block=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toContain('image/png');
    expect(img.rawPayload.length).toBeGreaterThan(0);

    // 非图片块 / 不存在条目 → 404
    const miss = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/session/image?workspace_id=${WS_ID}&entry=img-entry&block=0`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(miss.statusCode).toBe(404);
  });

  it('GET /chat/files：快照 ∪ manifest 合并，缺失标 exists:false', async () => {
    const ws = nodeWorkspace(uid, WS_ID);
    mkdirSync(path.join(ws, 'outputs'), { recursive: true });
    writeFileSync(path.join(ws, 'outputs', 'alive.png'), Buffer.from(PNG_B64, 'base64'));
    appendManifestForTest(ws, [
      { rel: 'outputs/alive.png', mime: 'image/png', size: 70, mtimeMs: 1 },
      { rel: 'outputs/deleted.md', mime: 'text/markdown', size: 5, mtimeMs: 2 },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/files?workspace_id=${WS_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      files: { path: string; exists: boolean; url: string; size: number }[];
    };
    const alive = body.files.find((f) => f.path === 'outputs/alive.png');
    const deleted = body.files.find((f) => f.path === 'outputs/deleted.md');
    expect(alive?.exists).toBe(true);
    expect(alive?.size).toBeGreaterThan(0);
    expect(alive?.url).toContain('/skill-files?path=');
    expect(deleted?.exists).toBe(false);
    // 装配物/会话不入列
    expect(body.files.some((f) => f.path.includes('.pi-agent'))).toBe(false);
    expect(body.files.some((f) => f.path.startsWith('inputs/'))).toBe(false);
  });
});

/** 测试专用：直接写 manifest 行（绕过 pi 执行器）。 */
function appendManifestForTest(
  ws: string,
  records: { rel: string; mime: string; size: number; mtimeMs: number }[]
): void {
  const file = path.join(ws, '.pi-agent', 'artifacts.jsonl');
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

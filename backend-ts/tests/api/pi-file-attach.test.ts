import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { userGeneratedDir } from '../../src/services/multimodal/image-service.js';
import { nodeWorkspace } from '../../src/services/ai/skill-agent-service.js';

/**
 * Skill Agent 文件附件链路契约测试：
 * - POST /chat/upload：任意格式文件 → {ws}/inputs/（文件名清洗 + 同名去重）
 * - POST /chat/import：上游静态图片 URL → 拷入 {ws}/inputs/（白名单 + 越界拒绝）
 * - GET /chat/files?include_inputs=1：inputs/ 上传文件可检索（@ 引用数据源）
 * - GET /chat/files?include_agent_resources=1：.pi-agent 装配资源（skills/prompts）穿透可检索
 */

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');

let db: DB;
let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
let uid = 1;
const WS_ID = 'pi-attach_test';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function multipartBody(filename: string, bytes: Buffer, contentType = 'application/pdf'): {
  boundary: string;
  body: Buffer;
} {
  const boundary = '----piattachtest';
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return { boundary, body: Buffer.concat([Buffer.from(head, 'binary'), bytes, Buffer.from(tail, 'binary')]) };
}

function upload(filename: string, bytes: Buffer, contentType?: string) {
  const { boundary, body } = multipartBody(filename, bytes, contentType);
  return app.inject({
    method: 'POST',
    url: `/api/modules/bookplate/chat/upload?workspace_id=${WS_ID}`,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
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
  // 只清理测试自建的工作区（uid 是登录账号，仅删除本测试的 workspace 子目录）
  rmSync(path.join(RUNTIME_ROOT, String(uid), 'workspace', WS_ID), { recursive: true, force: true });
});

describe('POST /chat/upload（任意格式文件 → 工作区 inputs/）', () => {
  it('上传 pdf：落盘 inputs/，返回 path/mime/size；磁盘文件存在', async () => {
    const bytes = Buffer.from('%PDF-1.4 fake pdf content');
    const res = await upload('report.pdf', bytes);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; path: string; mime: string; size: number };
    expect(body).toEqual({ name: 'report.pdf', path: 'inputs/report.pdf', mime: 'application/pdf', size: bytes.length });
    const ws = nodeWorkspace(uid, WS_ID);
    expect(existsSync(path.join(ws, 'inputs', 'report.pdf'))).toBe(true);
    expect(readFileSync(path.join(ws, 'inputs', 'report.pdf')).equals(bytes)).toBe(true);
  });

  it('文件名清洗：路径成分 / 控制字符剥离，目录穿越无效', async () => {
    const res = await upload('..\\..\\evil\u0000name.txt', Buffer.from('x'));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { path: string; name: string };
    expect(body.name).toBe('evilname.txt');
    expect(body.path).toBe('inputs/evilname.txt');
    const ws = nodeWorkspace(uid, WS_ID);
    expect(existsSync(path.join(ws, 'inputs', '..', '..', 'evilname.txt'))).toBe(false);
    expect(existsSync(path.join(ws, 'inputs', 'evilname.txt'))).toBe(true);
  });

  it('>6MB 文件：每请求 limits 覆盖全局 6MB（bodyLimit 内放行）', async () => {
    const bytes = Buffer.alloc(7 * 1024 * 1024, 0x61); // 7MB
    const res = await upload('big.bin', bytes, 'application/octet-stream');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { size: number }).size).toBe(bytes.length);
    const ws = nodeWorkspace(uid, WS_ID);
    expect(existsSync(path.join(ws, 'inputs', 'big.bin'))).toBe(true);
  });

  it('同名去重：同名上传追加「 (n)」序号', async () => {
    const first = await upload('dup.txt', Buffer.from('a'));
    const second = await upload('dup.txt', Buffer.from('b'));
    expect((first.json() as { path: string }).path).toBe('inputs/dup.txt');
    expect((second.json() as { path: string }).path).toBe('inputs/dup (1).txt');
  });

  it('缺少 workspace_id → 400', async () => {
    const { boundary, body } = multipartBody('a.txt', Buffer.from('x'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/upload',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('未登录 → 401', async () => {
    const { boundary, body } = multipartBody('a.txt', Buffer.from('x'));
    const res = await app.inject({
      method: 'POST',
      url: `/api/modules/bookplate/chat/upload?workspace_id=${WS_ID}`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /chat/import（继承图片 URL → 拷入工作区 inputs/）', () => {
  it('白名单静态 URL（/static/generated/{uid}/{file}）拷入 inputs/ 并返回路径', async () => {
    const dir = userGeneratedDir(uid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'inherit.png'), Buffer.from(PNG_B64, 'base64'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/import',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { workspace_id: WS_ID, urls: [`/static/generated/${uid}/inherit.png`] },
    });
    expect(res.statusCode).toBe(200);
    const files = (res.json() as { files: { name: string; path: string; mime: string; size: number }[] }).files;
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('inputs/inherit.png');
    expect(files[0]!.mime).toBe('image/png');
    const ws = nodeWorkspace(uid, WS_ID);
    expect(existsSync(path.join(ws, 'inputs', 'inherit.png'))).toBe(true);
  });

  it('越界 / 非白名单 URL → 400（SSRF 防穿越）', async () => {
    for (const urls of [
      ['http://evil.example.com/x.png'],
      ['data:image/png;base64,AAAA'],
      ['/static/generated/../../package.json'],
      ['/api/modules/bookplate/skill-files?path=inputs/x.png'],
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/modules/bookplate/chat/import',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { workspace_id: WS_ID, urls },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { detail: string }).detail).toContain('无法导入图片');
    }
  });

  it('文件不存在（白名单前缀但缺文件）→ 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/import',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { workspace_id: WS_ID, urls: [`/static/generated/${uid}/missing.png`] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('data_urls：base64 图片（图片上传节点输出）→ 解码落盘 inputs/（魔数校验）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/import',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        workspace_id: WS_ID,
        data_urls: [`data:image/png;base64,${PNG_B64}`],
      },
    });
    expect(res.statusCode).toBe(200);
    const files = (res.json() as { files: { path: string; mime: string }[] }).files;
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('inputs/inherit-1.png');
    expect(files[0]!.mime).toBe('image/png');
    const ws = nodeWorkspace(uid, WS_ID);
    expect(existsSync(path.join(ws, 'inputs', 'inherit-1.png'))).toBe(true);
  });

  it('data_urls：非图片（魔数不符）→ 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/import',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        workspace_id: WS_ID,
        data_urls: [`data:image/png;base64,${Buffer.from('not an image').toString('base64')}`],
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { detail: string }).detail).toContain('无法导入图片');
  });

  it('封面代理：非豆瓣域名（fetchCoverBytes 白名单拒绝）→ 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/chat/import',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        workspace_id: WS_ID,
        urls: [`/api/modules/bookplate/cover?url=${encodeURIComponent('http://evil.example.com/x.png')}`],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /chat/files（include_inputs 控制 inputs/ 是否可检索）', () => {
  it('include_inputs=1：inputs/ 上传文件进入列表（@ 引用数据源）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/files?workspace_id=${WS_ID}&include_inputs=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const files = (res.json() as { files: { path: string; exists?: boolean }[] }).files;
    const inputs = files.filter((f) => f.path.startsWith('inputs/'));
    expect(inputs.some((f) => f.path === 'inputs/report.pdf')).toBe(true);
    expect(inputs.some((f) => f.path === 'inputs/dup (1).txt')).toBe(true);
    expect(inputs.every((f) => f.exists !== false)).toBe(true);
  });

  it('不带 include_inputs：inputs/ 不出现在产物列表（上传文件非 agent 产物）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/files?workspace_id=${WS_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const files = (res.json() as { files: { path: string }[] }).files;
    expect(files.some((f) => f.path.startsWith('inputs/'))).toBe(false);
  });

  it('非法 workspace_id → 空列表（sanitize 拦截）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/chat/files?workspace_id=..%2F..%2Fetc',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { files: unknown[] }).files).toEqual([]);
  });
});

describe('GET /chat/files（include_agent_resources 控制 .pi-agent 装配资源是否可检索）', () => {
  function listFiles(query: string) {
    return app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/files?workspace_id=${WS_ID}${query}`,
      headers: { authorization: `Bearer ${token}` },
    }).then((res) => {
      expect(res.statusCode).toBe(200);
      return (res.json() as { files: { path: string; exists?: boolean }[] }).files.map((f) => f.path);
    });
  }

  it('include_agent_resources=1：skills/prompts 穿透列出（含子目录），会话/配置/扩展不出现', async () => {
    const ws = nodeWorkspace(uid, WS_ID);
    // 装配资源（含子目录穿透）
    mkdirSync(path.join(ws, '.pi-agent', 'skills', 'demo-skill', 'sub'), { recursive: true });
    writeFileSync(path.join(ws, '.pi-agent', 'skills', 'demo-skill', 'SKILL.md'), '# demo');
    writeFileSync(path.join(ws, '.pi-agent', 'skills', 'demo-skill', 'sub', 'nested.md'), 'nested');
    mkdirSync(path.join(ws, '.pi-agent', 'prompts'), { recursive: true });
    writeFileSync(path.join(ws, '.pi-agent', 'prompts', 'review.md'), 'review');
    // 会话与配置：白名单外，不得出现在检索列表
    mkdirSync(path.join(ws, '.pi-agent', 'run'), { recursive: true });
    writeFileSync(path.join(ws, '.pi-agent', 'run', 'chat.jsonl'), '{"type":"session"}\n');
    writeFileSync(path.join(ws, '.pi-agent', 'models.json'), '{}');
    writeFileSync(path.join(ws, '.pi-agent', 'settings.json'), '{}');
    mkdirSync(path.join(ws, '.pi-agent', 'extensions', 'ctx'), { recursive: true });
    writeFileSync(path.join(ws, '.pi-agent', 'extensions', 'ctx', 'index.js'), 'export {};');

    const paths = await listFiles('&include_agent_resources=1');
    expect(paths).toContain('.pi-agent/skills/demo-skill/SKILL.md');
    expect(paths).toContain('.pi-agent/skills/demo-skill/sub/nested.md');
    expect(paths).toContain('.pi-agent/prompts/review.md');
    expect(paths.some((p) => p.startsWith('.pi-agent/run/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.pi-agent/extensions/'))).toBe(false);
    expect(paths).not.toContain('.pi-agent/models.json');
    expect(paths).not.toContain('.pi-agent/settings.json');
  });

  it('include_agent_resources=1：skills 软链装配（Bifrost 共享包）目标内容一并盘点', async () => {
    const ws = nodeWorkspace(uid, WS_ID);
    const shared = path.join(ws, '..', 'shared-skills-src', 'linked-skill');
    mkdirSync(shared, { recursive: true });
    writeFileSync(path.join(shared, 'SKILL.md'), '# shared');
    rmSync(path.join(ws, '.pi-agent', 'skills', 'linked-skill'), { force: true, recursive: true });
    symlinkSync(shared, path.join(ws, '.pi-agent', 'skills', 'linked-skill'), 'dir');

    const paths = await listFiles('&include_agent_resources=1');
    expect(paths).toContain('.pi-agent/skills/linked-skill/SKILL.md');
  });

  it('不带 include_agent_resources：.pi-agent 路径一律不出现（默认口径不变）', async () => {
    const paths = await listFiles('&include_inputs=1');
    expect(paths.some((p) => p.startsWith('.pi-agent/'))).toBe(false);
  });
});

describe('DELETE /chat/file（工作区文件删除：AI 产物 / inputs/ 上传）', () => {
  function del(pathArg: string, workspaceId = WS_ID) {
    return app.inject({
      method: 'DELETE',
      url: '/api/modules/bookplate/chat/file',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { workspace_id: workspaceId, path: pathArg },
    });
  }

  it('删除 inputs/ 上传文件 → 200 且磁盘文件移除，/chat/files 不再列出', async () => {
    const res = await del('inputs/report.pdf');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { deleted: boolean }).deleted).toBe(true);
    const ws = nodeWorkspace(uid, WS_ID);
    expect(existsSync(path.join(ws, 'inputs', 'report.pdf'))).toBe(false);
    const files = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/chat/files?workspace_id=${WS_ID}&include_inputs=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    const list = (files.json() as { files: { path: string }[] }).files;
    expect(list.some((f) => f.path === 'inputs/report.pdf')).toBe(false);
  });

  it('删除 AI 产物（非 inputs/ 工作区文件）→ 200 且磁盘移除', async () => {
    const ws = nodeWorkspace(uid, WS_ID);
    mkdirSync(path.join(ws, 'outputs'), { recursive: true });
    writeFileSync(path.join(ws, 'outputs', 'art.txt'), 'artifact');
    expect(existsSync(path.join(ws, 'outputs', 'art.txt'))).toBe(true);
    const res = await del('outputs/art.txt');
    expect(res.statusCode).toBe(200);
    expect(existsSync(path.join(ws, 'outputs', 'art.txt'))).toBe(false);
  });

  it('会话 / 装配物受保护：.pi-agent 与 AGENTS.md 拒绝删除且文件保留', async () => {
    const ws = nodeWorkspace(uid, WS_ID);
    const sessionFile = path.join(ws, '.pi-agent', 'run', 'chat.jsonl');
    mkdirSync(path.dirname(sessionFile), { recursive: true });
    writeFileSync(sessionFile, '{"type":"session"}\n');
    writeFileSync(path.join(ws, 'AGENTS.md'), '# agents');
    for (const rel of ['.pi-agent/run/chat.jsonl', 'AGENTS.md']) {
      const res = await del(rel);
      expect(res.statusCode).toBe(404);
      expect((res.json() as { detail: string }).detail).toContain('不可删除');
    }
    expect(existsSync(sessionFile)).toBe(true);
    expect(existsSync(path.join(ws, 'AGENTS.md'))).toBe(true);
  });

  it('目录穿越拒绝：../ 越界 404，外部文件不受影响', async () => {
    const outside = path.join(RUNTIME_ROOT, String(uid), 'workspace', '..', '..', 'escape.txt');
    writeFileSync(outside, 'x');
    try {
      const res = await del('../escape.txt');
      expect(res.statusCode).toBe(404);
      expect(existsSync(outside)).toBe(true);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it('文件不存在 / 目录目标 → 404（只删文件，不整删目录）', async () => {
    expect((await del('inputs/nope.txt')).statusCode).toBe(404);
    expect((await del('inputs')).statusCode).toBe(404);
  });

  it('缺少 workspace_id / path → 400', async () => {
    const missingPath = await app.inject({
      method: 'DELETE',
      url: '/api/modules/bookplate/chat/file',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { workspace_id: WS_ID, path: '' },
    });
    expect(missingPath.statusCode).toBe(400);
    const missingWs = await app.inject({
      method: 'DELETE',
      url: '/api/modules/bookplate/chat/file',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { workspace_id: '', path: 'inputs/x.txt' },
    });
    expect(missingWs.statusCode).toBe(400);
  });

  it('未登录 → 401', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/modules/bookplate/chat/file',
      headers: { 'content-type': 'application/json' },
      payload: { workspace_id: WS_ID, path: 'inputs/x.txt' },
    });
    expect(res.statusCode).toBe(401);
  });
});
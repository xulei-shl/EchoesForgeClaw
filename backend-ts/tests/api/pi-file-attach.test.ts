import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { userGeneratedDir } from '../../src/services/image-service.js';
import { nodeWorkspace } from '../../src/services/skill-agent-service.js';

/**
 * Skill Agent 文件附件链路契约测试：
 * - POST /chat/upload：任意格式文件 → {ws}/inputs/（文件名清洗 + 同名去重）
 * - POST /chat/import：上游静态图片 URL → 拷入 {ws}/inputs/（白名单 + 越界拒绝）
 * - GET /chat/files?include_inputs=1：inputs/ 上传文件可检索（@ 引用数据源）
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { startMockOpenAIServer, type MockOpenAIServer } from '../helpers/mock-openai-server.js';
import { nodeWorkspace } from '../../src/services/skill-agent-service.js';

/**
 * Skills 路由契约测试（对应 Python `app/modules/bookplate/router.py` 的 Skill 工作区部分）：
 * - GET /skills：列表（含 name/description/文件树）
 * - POST /skills/upload：zip 校验（SKILL.md + frontmatter）→ 私有登记安装
 * - POST /skills/install：Bifrost 下载 zip → 共享区安装 + 软链登记
 * - GET /skills/bifrost-search：Bifrost 仓库检索
 * - DELETE /skills/:name：移除
 * - GET /skill-files：工作区文件下载（路径越界拒绝）
 */

const TEST_UID = 99999;
// runtime/ 在仓库根目录下（与 skill-agent-service.ts 的 RUNTIME_ROOT 口径一致），测试文件位于 backend-ts/tests/api/，向上三层
const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');

let db: DB;
let app: Awaited<ReturnType<typeof buildApp>>;
const openServers: MockOpenAIServer[] = [];
let token = '';
let uid = 1;

/** 构造一个合法 skill zip（顶层目录 + SKILL.md frontmatter）。 */
function makeSkillZip(name: string, extraFiles: Record<string, string> = {}): Buffer {
  const zip = new AdmZip();
  const root = name;
  zip.addFile(`${root}/SKILL.md`, Buffer.from(`---\nname: ${name}\ndescription: 测试 skill\n---\n\n这是正文`, 'utf-8'));
  for (const [rel, content] of Object.entries(extraFiles)) {
    zip.addFile(`${root}/${rel}`, Buffer.from(content, 'utf-8'));
  }
  return zip.toBuffer();
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
  await Promise.all(openServers.splice(0).map((s) => s.close()));
  setDb(null);
  // 只清理测试自建的产物，绝不整体删除 runtime/{uid}（该目录在开发环境可能含真实用户数据）：
  // - 测试安装/上传的 skill 登记目录（skills/{name}）
  // - 测试创建的节点工作区（workspace/ws_test_1、workspace/other_ws，由 skill-files 用例的 nodeWorkspace 新建）
  // - 共享区真实包（runtime/.agent/skills/{name}）
  const testSkillNames = ['demo-skill', 'bifrost-skill', 'admin-skill', 'cache-skill', 'browse-skill', 'remote-only-skill', 'note-skill'];
  for (const name of testSkillNames) {
    rmSync(path.join(RUNTIME_ROOT, String(uid), 'skills', name), { recursive: true, force: true });
    rmSync(path.join(RUNTIME_ROOT, '.agent', 'skills', name), { recursive: true, force: true });
  }
  for (const ws of ['ws_test_1', 'other_ws']) {
    rmSync(path.join(RUNTIME_ROOT, String(uid), 'workspace', ws), { recursive: true, force: true });
  }
  // 测试期间 mkdir 出来的空父目录：仅当确为空才删除（非空 = 含真实数据，跳过）
  for (const p of [
    path.join(RUNTIME_ROOT, String(uid), 'workspace'),
    path.join(RUNTIME_ROOT, String(uid), 'skills'),
    path.join(RUNTIME_ROOT, String(uid)),
  ]) {
    try {
      if (readdirSync(p).length === 0) rmSync(p, { recursive: true, force: true });
    } catch {
      /* 不存在或非空：跳过 */
    }
  }
  // TEST_UID（99999）是测试专用用户 id，不存在真实数据冲突，仍整体清理
  rmSync(path.join(RUNTIME_ROOT, String(TEST_UID)), { recursive: true, force: true });
});

function uploadZip(zipBytes: Buffer) {
  const boundary = '----skilltest';
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="skill.zip"\r\n` +
    `Content-Type: application/zip\r\n\r\n` +
    zipBytes.toString('binary') +
    `\r\n--${boundary}--\r\n`;
  return app.inject({
    method: 'POST',
    url: '/api/modules/bookplate/skills/upload',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.from(body, 'binary'),
  });
}

describe('skills 上传 / 列表 / 移除', () => {
  it('上传合法 zip：校验 frontmatter → 安装到私有登记目录', async () => {
    const res = await uploadZip(makeSkillZip('demo-skill', { 'scripts/run.sh': 'echo hi' }));
    expect(res.statusCode).toBe(200);
    const meta = res.json();
    expect(meta.name).toBe('demo-skill');
    expect(meta.description).toBe('测试 skill');
    expect(meta.path).toBe('skills/demo-skill');
    expect(meta.files).toContain('SKILL.md');
    expect(meta.files).toContain('scripts/run.sh');
  });

  it('列表返回已安装 skill（含文件树）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skills',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const skills = (res.json() as { skills: { name: string }[] }).skills;
    expect(skills.some((s) => s.name === 'demo-skill')).toBe(true);
  });

  it('上传非法 zip（缺 SKILL.md）→ 400 中文原因', async () => {
    const zip = new AdmZip();
    zip.addFile('bad-skill/readme.txt', Buffer.from('hi'));
    const res = await uploadZip(zip.toBuffer());
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('SKILL.md');
  });

  it('上传缺 description frontmatter → 400', async () => {
    const zip = new AdmZip();
    zip.addFile('no-desc/SKILL.md', Buffer.from('---\nname: no-desc\n---\n\n正文', 'utf-8'));
    const res = await uploadZip(zip.toBuffer());
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('description');
  });

  it('移除已安装 skill → 列表不再包含', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/modules/bookplate/skills/demo-skill',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);
    const res = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skills',
      headers: { authorization: `Bearer ${token}` },
    });
    const skills = (res.json() as { skills: { name: string }[] }).skills;
    expect(skills.some((s) => s.name === 'demo-skill')).toBe(false);
  });

  it('移除不存在的 skill → 404', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/modules/bookplate/skills/not-exist',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('skills Bifrost 安装 / 检索', () => {
  it('bifrost-search：mock 仓库检索（普通用户可用）', async () => {
    const srv = await startMockOpenAIServer((req) => {
      expect(req.path).toBe('/api/skills');
      return JSON.stringify({
        skills: [{ id: 's1', name: 'deepseek-harness', description: '检索 skill', skill_md_body: '正文', file_count: 3 }],
      });
    });
    openServers.push(srv);
    await app.inject({
      method: 'POST',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'bifrost.base_url', value: srv.rootURL, description: 'x' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'bifrost.username', value: 'u', description: 'x' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { key: 'bifrost.password', value: 'p', description: 'x' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skills/bifrost-search?q=deepseek',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const skills = (res.json() as { skills: { name: string }[] }).skills;
    expect(skills[0]?.name).toBe('deepseek-harness');
  });

  it('bifrost-search：Bifrost 未配置/离线时，降级展示本地共享区缓存 skill', async () => {
    // 先把 bifrost base_url 指向一个无法连接的地址（模拟离线）
    await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.base_url',
      headers: { authorization: `Bearer ${token}` },
      payload: { value: 'http://127.0.0.1:59999' },
    });

    // 检索（之前安装的 bifrost-skill 会在共享区），应返回 200 且包含本地缓存项
    const res = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skills/bifrost-search',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: { name: string; cached?: boolean }[]; remote_available?: boolean };
    expect(body.remote_available).toBe(false);
    expect(Array.isArray(body.skills)).toBe(true);
  });

  it('install：从 Bifrost 下载 zip → 共享区安装 + 软链登记', async () => {
    const zipBytes = makeSkillZip('bifrost-skill');
    const srv = await startMockOpenAIServer((req) => {
      expect(req.path).toBe('/api/skills/serve/bifrost-skill/download.zip');
      return { raw: zipBytes, contentType: 'application/zip' };
    });
    openServers.push(srv);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.base_url',
      headers: { authorization: `Bearer ${token}` },
      payload: { value: srv.rootURL },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/skills/install',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'bifrost-skill' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { name: string }).name).toBe('bifrost-skill');

    // 列表可见
    const list = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skills',
      headers: { authorization: `Bearer ${token}` },
    });
    const names = (list.json() as { skills: { name: string }[] }).skills.map((s) => s.name);
    expect(names).toContain('bifrost-skill');
  });

  it('install：Bifrost 404 → 404', async () => {
    const srv = await startMockOpenAIServer((req) => {
      // HTTP 404：skill 不存在
      return { raw: 'not found', status: 404 };
    });
    openServers.push(srv);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.base_url',
      headers: { authorization: `Bearer ${token}` },
      payload: { value: srv.rootURL },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/skills/install',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'gone-skill' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('skill-files 下载', () => {
  it('下载装配后工作区内的文件（workspace_id 定位）', async () => {
    // 重新上传一个带文件的 skill
    await uploadZip(makeSkillZip('demo-skill', { 'output.txt': 'hello file' }));
    // 模拟 prepare_runtime_workspace：把 skill 装配进节点工作区（.pi-agent/skills/{name}）
    const ws = nodeWorkspace(uid, 'ws_test_1');
    const agentsSkills = `${ws}/.pi-agent/skills`;
    mkdirSync(agentsSkills, { recursive: true });
    cpSync(path.join(RUNTIME_ROOT, String(uid), 'skills', 'demo-skill'), `${agentsSkills}/demo-skill`, { recursive: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skill-files?path=.pi-agent/skills/demo-skill/output.txt&workspace_id=ws_test_1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('hello file');
    expect(res.headers['content-type']).toContain('text/plain');

    // 图片产物：按扩展名返回 image/png；中文文件名经 filename*（RFC 5987）携带
    mkdirSync(`${ws}/outputs`, { recursive: true });
    writeFileSync(`${ws}/outputs/藏书票.png`, Buffer.from('89504e47', 'hex'));
    const img = await app.inject({
      method: 'GET',
      url: `/api/modules/bookplate/skill-files?path=${encodeURIComponent('outputs/藏书票.png')}&workspace_id=ws_test_1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toContain('image/png');
    expect(img.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('藏书票.png')}`);

    // 音频/视频产物：按扩展名返回对应 Content-Type（前端内联预览依赖正确类型）
    writeFileSync(`${ws}/outputs/audio.mp3`, Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    const audio = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skill-files?path=outputs/audio.mp3&workspace_id=ws_test_1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers['content-type']).toContain('audio/mpeg');

    writeFileSync(`${ws}/outputs/video.mp4`, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]));
    const video = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skill-files?path=outputs/video.mp4&workspace_id=ws_test_1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(video.statusCode).toBe(200);
    expect(video.headers['content-type']).toContain('video/mp4');
    rmSync(`${ws}/outputs`, { recursive: true, force: true });

    // 未装配的路径（仅存在于登记目录，不在工作区）→ 404
    const miss = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skill-files?path=.pi-agent/skills/demo-skill/SKILL.md&workspace_id=other_ws',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(miss.statusCode).toBe(404);
    await app.inject({
      method: 'DELETE',
      url: '/api/modules/bookplate/skills/demo-skill',
      headers: { authorization: `Bearer ${token}` },
    });
  });

  it('路径越界（../）→ 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skill-files?path=../../package.json',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('密钥文件与装配配置直连下载被拦截（.env* / .pi-agent 非白名单子树 → 404；skills 白名单子树仍放行）', async () => {
    const ws = nodeWorkspace(uid, 'ws_test_1');
    mkdirSync(`${ws}/outputs`, { recursive: true });
    mkdirSync(`${ws}/.pi-agent`, { recursive: true });
    writeFileSync(`${ws}/.env`, 'SECRET=1');
    writeFileSync(`${ws}/outputs/.env.local`, 'NESTED=1');
    writeFileSync(`${ws}/.pi-agent/models.json`, '{"providers":{"bookforge":{"apiKey":"real-secret"}}}');

    const blocked = ['.env', encodeURIComponent('outputs/.env.local'), '.pi-agent/models.json'];
    for (const p of blocked) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/modules/bookplate/skill-files?path=${p}&workspace_id=ws_test_1`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    }

    // 装配资源白名单子树（.pi-agent/skills/）不受影响
    mkdirSync(`${ws}/.pi-agent/skills`, { recursive: true });
    writeFileSync(`${ws}/.pi-agent/skills/readme.md`, 'skill resource');
    const ok = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skill-files?path=.pi-agent/skills/readme.md&workspace_id=ws_test_1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('skill resource');

    // 非敏感装配文件（snapshot.json）可下载；运行态会话 jsonl（run/）拒绝
    writeFileSync(`${ws}/.pi-agent/snapshot.json`, '{}');
    const snap = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skill-files?path=.pi-agent/snapshot.json&workspace_id=ws_test_1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(snap.statusCode).toBe(200);
    mkdirSync(`${ws}/.pi-agent/run`, { recursive: true });
    writeFileSync(`${ws}/.pi-agent/run/chat.jsonl`, '{}');
    const run = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skill-files?path=.pi-agent/run/chat.jsonl&workspace_id=ws_test_1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(run.statusCode).toBe(404);

    rmSync(`${ws}/.env`, { force: true });
    rmSync(`${ws}/outputs/.env.local`, { force: true });
    rmSync(`${ws}/.pi-agent`, { recursive: true, force: true });
  });
});

describe('admin bifrost-skills 管理', () => {
  it('未登录 → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/bifrost-skills' });
    expect(res.statusCode).toBe(401);
  });

  it('列表：共享区缓存可见；Bifrost 不可达时仅返回本地信息', async () => {
    const zipBytes = makeSkillZip('admin-skill', { 'notes.txt': 'x' });
    const srv = await startMockOpenAIServer((req) => {
      if (req.path === '/api/skills') {
        return JSON.stringify({ skills: [{ id: 'a1', name: 'unrelated', latest_version: '9' }] });
      }
      if (req.path === '/api/skills/serve/admin-skill/download.zip') {
        return { raw: zipBytes, contentType: 'application/zip' };
      }
      return { raw: '{}', status: 404 };
    });
    openServers.push(srv);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.base_url',
      headers: { authorization: `Bearer ${token}` },
      payload: { value: srv.rootURL },
    });

    const install = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/skills/install',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'admin-skill' },
    });
    expect(install.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/bifrost-skills',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const found = (res.json() as { skills: (Record<string, any> & { name: string; updated_at?: number | null })[] }).skills.find(
      (s) => s.name === 'admin-skill'
    );
    expect(found).toBeTruthy();
    expect(found!.files).toContain('SKILL.md');
    expect(typeof found!.updated_at).toBe('number');
  });

  it('sync：拉取最新 zip 覆盖共享区（不动用户登记）', async () => {
    const zipBytes = makeSkillZip('admin-skill', { 'v2.txt': 'v2' });
    const srv = await startMockOpenAIServer((req) => ({
      raw: zipBytes,
      contentType: 'application/zip',
    }));
    openServers.push(srv);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.base_url',
      headers: { authorization: `Bearer ${token}` },
      payload: { value: srv.rootURL },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/bifrost-skills/admin-skill/sync',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const skill = (res.json() as { skill: { name: string; files: string[] } }).skill;
    expect(skill.name).toBe('admin-skill');
    expect(skill.files).toContain('v2.txt');
  });

  it('delete：从共享区删除并清理登记软链', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/bifrost-skills/admin-skill',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { message: string; cleaned_registries: number };
    expect(body.message).toContain('admin-skill');
    expect(typeof body.cleaned_registries).toBe('number');

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/bifrost-skills',
      headers: { authorization: `Bearer ${token}` },
    });
    const names = (list.json() as { skills: { name: string }[] }).skills.map((s) => s.name);
    expect(names).not.toContain('admin-skill');
  });

  it('非法名称（含 \\ ）→ 400', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/bifrost-skills/%5C%5Cserver%5Cshare',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('非法 skill 名称');
  });

  it('force=1 绕过 TTL 缓存强制拉取远端；不带 force 在 TTL 内走缓存', async () => {
    const srv = await startMockOpenAIServer(() =>
      JSON.stringify({ skills: [{ id: 's1', name: 'force-skill', latest_version: '1.0' }] })
    );
    openServers.push(srv);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.base_url',
      headers: { authorization: `Bearer ${token}` },
      payload: { value: srv.rootURL },
    });
    const get = (url: string) =>
      app.inject({ method: 'GET', url: `/api/admin/bifrost-skills${url}`, headers: { authorization: `Bearer ${token}` } });
    const searchCalls = () => srv.requests.filter((r) => r.path === '/api/skills').length;

    await get('');
    expect(searchCalls()).toBe(1);
    await get('');
    expect(searchCalls()).toBe(1); // TTL 内命中缓存，不再请求 Bifrost
    const res = await get('?force=1');
    expect(searchCalls()).toBe(2); // force 绕过缓存强制拉取
    expect(res.statusCode).toBe(200);
  });

  it('列表合并远端未缓存的 skill（cached 标记 + remote_available）', async () => {
    const zipBytes = makeSkillZip('browse-skill');
    const srv = await startMockOpenAIServer((req) => {
      if (req.path === '/api/skills') {
        return JSON.stringify({
          skills: [
            { id: 'b1', name: 'browse-skill', latest_version: '2.0' },
            { id: 'r1', name: 'remote-only-skill', latest_version: '1.5', description: '仅远端存在', file_count: 4 },
          ],
        });
      }
      if (req.path === '/api/skills/serve/browse-skill/download.zip') {
        return { raw: zipBytes, contentType: 'application/zip' };
      }
      return { raw: '{}', status: 404 };
    });
    openServers.push(srv);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.base_url',
      headers: { authorization: `Bearer ${token}` },
      payload: { value: srv.rootURL },
    });

    // 本地缓存 browse-skill
    const install = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/skills/install',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'browse-skill' },
    });
    expect(install.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/bifrost-skills',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: (Record<string, any> & { name: string })[]; remote_available: boolean };
    expect(body.remote_available).toBe(true);
    const local = body.skills.find((s) => s.name === 'browse-skill');
    expect(local?.cached).toBe(true);
    expect(local?.latest_version).toBe('2.0');
    expect(local?.files).toContain('SKILL.md');
    const remoteOnly = body.skills.find((s) => s.name === 'remote-only-skill');
    expect(remoteOnly).toBeTruthy();
    expect(remoteOnly!.cached).toBe(false);
    expect(remoteOnly!.latest_version).toBe('1.5');
    expect(remoteOnly!.file_count).toBe(4);
  });
});

describe('skill 全局备注（admin 侧车存储，独立于 skill 包）', () => {
  it('PUT note → admin 列表 / bifrost-search / install 响应可见；同步不触碰；空串清除', async () => {
    const zipBytes = makeSkillZip('note-skill', { 'v1.txt': 'x' });
    const srv = await startMockOpenAIServer((req) => {
      if (req.path === '/api/skills') {
        return JSON.stringify({
          skills: [{ id: 'n1', name: 'note-skill', latest_version: '1.0', description: '备注测试', file_count: 2 }],
        });
      }
      if (req.path === '/api/skills/serve/note-skill/download.zip') {
        return { raw: zipBytes, contentType: 'application/zip' };
      }
      return { raw: '{}', status: 404 };
    });
    openServers.push(srv);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.base_url',
      headers: { authorization: `Bearer ${token}` },
      payload: { value: srv.rootURL },
    });

    // 写入备注
    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/bifrost-skills/note-skill/note',
      headers: { authorization: `Bearer ${token}` },
      payload: { note: '团队内部备注：用于藏书票风格统一' },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { note: string }).note).toBe('团队内部备注：用于藏书票风格统一');

    // admin 列表合并备注（远端未缓存条目同样可见）
    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/bifrost-skills',
      headers: { authorization: `Bearer ${token}` },
    });
    const found = (list.json() as { skills: (Record<string, any> & { name: string })[] }).skills.find(
      (s) => s.name === 'note-skill'
    );
    expect(found).toBeTruthy();
    expect(found!.note).toBe('团队内部备注：用于藏书票风格统一');

    // 画布检索同样合并备注
    const search = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skills/bifrost-search?q=note',
      headers: { authorization: `Bearer ${token}` },
    });
    const hit = (search.json() as { skills: (Record<string, any> & { name: string })[] }).skills.find(
      (s) => s.name === 'note-skill'
    );
    expect(hit?.note).toBe('团队内部备注：用于藏书票风格统一');

    // 安装响应合并备注
    const install = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/skills/install',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'note-skill' },
    });
    expect(install.statusCode).toBe(200);
    expect((install.json() as { note?: string }).note).toBe('团队内部备注：用于藏书票风格统一');

    // 同步最新不触碰备注（备注独立于 skill 包存储）
    const sync = await app.inject({
      method: 'POST',
      url: '/api/admin/bifrost-skills/note-skill/sync',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(sync.statusCode).toBe(200);
    const list2 = await app.inject({
      method: 'GET',
      url: '/api/admin/bifrost-skills',
      headers: { authorization: `Bearer ${token}` },
    });
    const found2 = (list2.json() as { skills: (Record<string, any> & { name: string })[] }).skills.find(
      (s) => s.name === 'note-skill'
    );
    expect(found2?.note).toBe('团队内部备注：用于藏书票风格统一');

    // 空串/纯空白清除备注
    const clear = await app.inject({
      method: 'PUT',
      url: '/api/admin/bifrost-skills/note-skill/note',
      headers: { authorization: `Bearer ${token}` },
      payload: { note: '   ' },
    });
    expect(clear.statusCode).toBe(200);
    expect((clear.json() as { note: string }).note).toBe('');
    const list3 = await app.inject({
      method: 'GET',
      url: '/api/admin/bifrost-skills',
      headers: { authorization: `Bearer ${token}` },
    });
    const found3 = (list3.json() as { skills: (Record<string, any> & { name: string })[] }).skills.find(
      (s) => s.name === 'note-skill'
    );
    expect(found3?.note ?? '').toBe('');
  });
});

describe('install：本地共享缓存优先（registerExistingBifrostSkill）', () => {
  it('共享区已有该 skill 时跳过网络下载，仅登记软链（幂等）', async () => {
    const zipBytes = makeSkillZip('cache-skill', { 'data.txt': 'v1' });
    const srv = await startMockOpenAIServer((req) => {
      expect(req.path).toBe('/api/skills/serve/cache-skill/download.zip');
      return { raw: zipBytes, contentType: 'application/zip' };
    });
    openServers.push(srv);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/bifrost.base_url',
      headers: { authorization: `Bearer ${token}` },
      payload: { value: srv.rootURL },
    });

    // 第一次安装：命中远端，下载 zip
    const first = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/skills/install',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'cache-skill' },
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { name: string }).name).toBe('cache-skill');
    expect(srv.requests.filter((r) => r.path.includes('/download.zip')).length).toBe(1);

    // 第二次安装：共享区缓存命中，不再请求 Bifrost
    const second = await app.inject({
      method: 'POST',
      url: '/api/modules/bookplate/skills/install',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'cache-skill' },
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { files: string[] }).files).toContain('SKILL.md');
    expect(srv.requests.filter((r) => r.path.includes('/download.zip')).length).toBe(1); // 未再次下载
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
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
const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../runtime');

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
  // 清理测试产生的 runtime 目录（用户登记 + 共享区）
  rmSync(path.join(RUNTIME_ROOT, String(TEST_UID)), { recursive: true, force: true });
  rmSync(path.join(RUNTIME_ROOT, String(uid)), { recursive: true, force: true });
  for (const name of ['demo-skill', 'bifrost-skill']) {
    rmSync(path.join(RUNTIME_ROOT, '.agent', 'skills', name), { recursive: true, force: true });
  }
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
    // 模拟 prepare_runtime_workspace：把 skill 装配进节点工作区（.agents/skills/{name}）
    const ws = nodeWorkspace(uid, 'ws_test_1');
    const agentsSkills = `${ws}/.agents/skills`;
    mkdirSync(agentsSkills, { recursive: true });
    cpSync(path.join(RUNTIME_ROOT, String(uid), 'skills', 'demo-skill'), `${agentsSkills}/demo-skill`, { recursive: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skill-files?path=.agents/skills/demo-skill/output.txt&workspace_id=ws_test_1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('hello file');

    // 未装配的路径（仅存在于登记目录，不在工作区）→ 404
    const miss = await app.inject({
      method: 'GET',
      url: '/api/modules/bookplate/skill-files?path=.agents/skills/demo-skill/SKILL.md&workspace_id=other_ws',
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
});

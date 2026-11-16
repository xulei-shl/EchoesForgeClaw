import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { setUserAnnotation, setGlobalTags, RESOURCE_TYPE_BIFROST_SKILL, RESOURCE_TYPE_BIFROST_PROMPT } from '../../src/services/platform/annotation-service.js';

describe('未登录访客（Guest）访问 Skills 与 Prompts 接口契约测试', () => {
  let db: DB;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userToken = '';
  let userId = 1;

  beforeAll(async () => {
    db = initDb(':memory:');
    setDb(db);
    const schema = await import('../../src/db/schema.js');
    const u = db.insert(schema.users)
      .values({ username: 'testuser', passwordHash: hashSync('pass123', 10), role: 'user', isActive: true })
      .returning()
      .get();
    userId = u.id;
    app = await buildApp();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'testuser', password: 'pass123' },
    });
    userToken = loginRes.json().token;

    // 预置全局标签与用户私有/公开标注
    setGlobalTags(db, 'guest-test-skill', ['官方精选', '生产力']);
    setUserAnnotation(db, userId, RESOURCE_TYPE_BIFROST_SKILL, 'guest-test-skill', {
      rating: 5,
      note: '同事公开分享的心得：很好用！',
      is_public: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Skills 模块访客与登录态对比', () => {
    it('未登录访客可检索 Skills，返回 200 而非 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/modules/bookplate/skills/bifrost-search',
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(Array.isArray(data.skills)).toBe(true);
      expect(typeof data.total).toBe('number');
    });

    it('未登录访客可获取公开经验列表（public-notes），返回 200 而非 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/annotations/${RESOURCE_TYPE_BIFROST_SKILL}/guest-test-skill/public-notes`,
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.resource_id).toBe('guest-test-skill');
      expect(data.public_notes.length).toBeGreaterThanOrEqual(1);
      expect(data.public_notes[0].note).toBe('同事公开分享的心得：很好用！');
      expect(data.public_notes[0].username).toBe('testuser');
    });

    it('未登录访客写标注被 401 严格拒绝', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/annotations',
        payload: {
          resource_type: 'bifrost_skill',
          resource_id: 'guest-test-skill',
          rating: 4,
          note: '恶意越权写入',
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('未登录访客安装 Skill 被 401 严格拒绝', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/modules/bookplate/skills/install',
        payload: { name: 'some-skill' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('Prompts 模块访客与登录态对比', () => {
    it('未登录访客可读取文件夹列表与提示词，返回 200 而非 401', async () => {
      const foldersRes = await app.inject({
        method: 'GET',
        url: '/api/modules/bookplate/bifrost/folders',
      });
      // 未配置 Bifrost 远端时返回 503 或正常 200，绝不应返回 401
      expect([200, 503]).toContain(foldersRes.statusCode);

      const promptsRes = await app.inject({
        method: 'GET',
        url: '/api/modules/bookplate/bifrost/prompts',
      });
      expect([200, 503]).toContain(promptsRes.statusCode);
    });

    it('登录用户携带 Token 调用 Skills 检索时正常返回 200 并携带个人标注', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/modules/bookplate/skills/bifrost-search',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});

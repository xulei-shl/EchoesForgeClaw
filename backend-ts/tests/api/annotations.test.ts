import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSync } from 'bcryptjs';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { userAnnotations, users } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('用户通用标注（打标 1-5 星与私有备注）API 测试', () => {
  let db: DB;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminToken = '';
  let userToken = '';
  let adminId = 1;
  let userId = 2;

  beforeAll(async () => {
    db = initDb(':memory:');
    setDb(db);

    // 插入两个不同角色用户
    db.insert(users)
      .values([
        {
          username: 'admin',
          passwordHash: hashSync('admin123', 10),
          role: 'admin',
          isActive: true,
        },
        {
          username: 'normal_user',
          passwordHash: hashSync('user123', 10),
          role: 'user',
          isActive: true,
        },
      ])
      .run();

    app = await buildApp();

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    });
    const adminBody = adminLogin.json() as { token: string; user: { id: number } };
    adminToken = adminBody.token;
    adminId = adminBody.user.id;

    const userLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'normal_user', password: 'user123' },
    });
    const userBody = userLogin.json() as { token: string; user: { id: number } };
    userToken = userBody.token;
    userId = userBody.user.id;
  });

  afterAll(async () => {
    await app.close();
    setDb(null);
  });

  it('鉴权与参数校验', async () => {
    // 1. 未登录
    const noAuth = await app.inject({
      method: 'PUT',
      url: '/api/annotations',
      payload: { resource_type: 'bifrost_prompt', resource_id: 'p1', rating: 5 },
    });
    expect(noAuth.statusCode).toBe(401);

    // 2. 非法 resource_type
    const invalidType = await app.inject({
      method: 'PUT',
      url: '/api/annotations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { resource_type: 'unknown_type', resource_id: 'p1', rating: 5 },
    });
    expect(invalidType.statusCode).toBe(400);

    // 3. 缺少 resource_id
    const noId = await app.inject({
      method: 'PUT',
      url: '/api/annotations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { resource_type: 'bifrost_prompt', resource_id: '  ', rating: 5 },
    });
    expect(noId.statusCode).toBe(400);
  });

  it('写入与更新打标及备注，超界 rating 自动归一化', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/annotations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        resource_type: 'bifrost_prompt',
        resource_id: 'p_test_1',
        rating: 10, // 超出 5，应归一化为 5
        note: '测试提示词备注',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      resource_type: 'bifrost_prompt',
      resource_id: 'p_test_1',
      rating: 5,
      note: '测试提示词备注',
    });

    // 单个读取
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/annotations/bifrost_prompt/p_test_1',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual({
      resource_type: 'bifrost_prompt',
      resource_id: 'p_test_1',
      rating: 5,
      note: '测试提示词备注',
    });

    // 单独更新 rating（保留已有 note）
    const updateRating = await app.inject({
      method: 'PUT',
      url: '/api/annotations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        resource_type: 'bifrost_prompt',
        resource_id: 'p_test_1',
        rating: 3,
      },
    });
    expect(updateRating.statusCode).toBe(200);
    expect(updateRating.json()).toEqual({
      resource_type: 'bifrost_prompt',
      resource_id: 'p_test_1',
      rating: 3,
      note: '测试提示词备注',
    });
  });

  it('rating 为 0 且 note 为空时自动清理数据库记录', async () => {
    // 先写入一条
    await app.inject({
      method: 'PUT',
      url: '/api/annotations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        resource_type: 'bifrost_skill',
        resource_id: 'temp_skill',
        rating: 4,
        note: '临时备注',
      },
    });

    let row = db
      .select()
      .from(userAnnotations)
      .where(eq(userAnnotations.resourceId, 'temp_skill'))
      .get();
    expect(row).toBeTruthy();

    // 清空 rating 和 note
    const clearRes = await app.inject({
      method: 'PUT',
      url: '/api/annotations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        resource_type: 'bifrost_skill',
        resource_id: 'temp_skill',
        rating: 0,
        note: '  ',
      },
    });
    expect(clearRes.statusCode).toBe(200);
    expect(clearRes.json()).toEqual({
      resource_type: 'bifrost_skill',
      resource_id: 'temp_skill',
      rating: 0,
      note: '',
    });

    // 验证数据库行已删除
    row = db
      .select()
      .from(userAnnotations)
      .where(eq(userAnnotations.resourceId, 'temp_skill'))
      .get();
    expect(row).toBeUndefined();
  });

  it('多用户完全隔离：不同用户对同一资源的打标与备注互不干扰', async () => {
    const targetPrompt = 'shared_prompt_123';

    // 1. Admin 打 5 星 + 写备注 A
    await app.inject({
      method: 'PUT',
      url: '/api/annotations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        resource_type: 'bifrost_prompt',
        resource_id: targetPrompt,
        rating: 5,
        note: 'Admin 专享超棒提示词',
      },
    });

    // 2. 普通用户打 2 星 + 写备注 B
    await app.inject({
      method: 'PUT',
      url: '/api/annotations',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        resource_type: 'bifrost_prompt',
        resource_id: targetPrompt,
        rating: 2,
        note: 'User 觉得效果一般',
      },
    });

    // 3. Admin 读取自己视角
    const adminGet = await app.inject({
      method: 'GET',
      url: `/api/annotations/bifrost_prompt/${targetPrompt}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(adminGet.json()).toEqual({
      resource_type: 'bifrost_prompt',
      resource_id: targetPrompt,
      rating: 5,
      note: 'Admin 专享超棒提示词',
    });

    // 4. User 读取自己视角
    const userGet = await app.inject({
      method: 'GET',
      url: `/api/annotations/bifrost_prompt/${targetPrompt}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(userGet.json()).toEqual({
      resource_type: 'bifrost_prompt',
      resource_id: targetPrompt,
      rating: 2,
      note: 'User 觉得效果一般',
    });
  });
});

import { hashSync } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { env } from './env.js';
import { getDb } from './database.js';
import { appSettings, promptTemplates, users } from '../db/schema.js';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_COVER_SYSTEM_PROMPT } from '../services/llm-service.js';

/**
 * 启动种子（对应 Python `app/main.py::_startup_init`）：
 * - 默认管理员账号（admin / ADMIN_PASSWORD）；
 * - 默认系统设置（douban.* / bifrost.*）；
 * - 默认提示词模板（按固定 key 判重，name/content 的修改永远保留）。
 * 全部幂等：已存在则跳过。
 */

const DEFAULT_SETTINGS: Array<[string, string, string]> = [
  [
    'douban.base_url',
    'https://m.douban.com/rexxar/api/v2/book/isbn',
    '豆瓣 API 基础地址（一般无需修改）',
  ],
  ['douban.qps', '0.5', '豆瓣请求速率（次/秒），建议 ≤ 0.5 以防反爬'],
  ['douban.proxy', '', '豆瓣请求 HTTP 代理，如 http://127.0.0.1:7890（留空不使用）'],
  [
    'bifrost.base_url',
    '',
    'Bifrost Gateway 基础地址（本地可用 http://localhost:8080；远程请用 HTTPS）',
  ],
  [
    'bifrost.username',
    env.bifrostUsername,
    'Bifrost 管理账号（Basic Auth 用户名，初始来自 .env，可在本页修改）',
  ],
  [
    'bifrost.password',
    env.bifrostPassword,
    'Bifrost 管理密码（敏感，仅显示掩码；初始来自 .env，可在本页修改）',
  ],
];

export function seedStartup(): void {
  const db = getDb();

  // 默认管理员
  const admin = db.select().from(users).where(eq(users.username, env.adminUsername)).get();
  if (!admin) {
    db.insert(users)
      .values({
        username: env.adminUsername,
        passwordHash: hashSync(env.adminPassword, 12),
        role: 'admin',
        isActive: true,
      })
      .run();
  }

  // 默认系统设置（仅缺失时写入）
  for (const [key, value, description] of DEFAULT_SETTINGS) {
    const existing = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
    if (!existing) {
      db.insert(appSettings).values({ key, value, description }).run();
    } else if (key.startsWith('bifrost.') && value && !existing.value) {
      // 种子回填（仅 bifrost.*）：存量值为空且种子值非空时补写，绝不覆盖非空修改
      db.update(appSettings).set({ value }).where(eq(appSettings.key, key)).run();
    }
  }

  // 默认提示词模板（按固定 key 判重）
  const seeds = [
    {
      key: 'bookplate.prompt_generation.default',
      name: '藏书票图像生成默认提示词',
      nodeType: 'prompt_generation',
      content: DEFAULT_SYSTEM_PROMPT,
    },
    {
      key: 'bookplate.image_analysis.default',
      name: '封面分析默认提示词',
      nodeType: 'image_analysis',
      content: DEFAULT_COVER_SYSTEM_PROMPT,
    },
  ];
  for (const seed of seeds) {
    const exists = db.select().from(promptTemplates).where(eq(promptTemplates.key, seed.key)).get();
    if (!exists) {
      db.insert(promptTemplates)
        .values({ key: seed.key, name: seed.name, nodeType: seed.nodeType, content: seed.content, isActive: true })
        .run();
    }
  }
}

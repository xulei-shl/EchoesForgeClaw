import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { env } from './config/env.js';
import { seedStartup } from './config/seed.js';
import { registerAuth } from './shared/security.js';
import { registerAuthRouter } from './api/auth.js';
import { registerBookplateRouter } from './modules/bookplate/router.js';
import { registerUsersRouter } from './api/users.js';
import { registerGenerationsRouter } from './api/generations.js';
import { registerFavoritesRouter } from './api/favorites.js';
import { registerPublicRouter } from './api/public.js';
import { registerLLMConfigsAdminRouter } from './api/admin/llm-configs.js';
import { registerPromptsAdminRouter } from './api/admin/prompts.js';
import { registerNodeConfigsAdminRouter } from './api/admin/node-configs.js';
import { registerSettingsAdminRouter } from './api/admin/settings.js';
import { registerFastClawAgentsAdminRouter } from './api/admin/fastclaw-agents.js';
import { registerSkillAgentConfigsAdminRouter } from './api/admin/skill-agent-configs.js';
import { registerBifrostAdminRouter } from './api/admin/bifrost.js';

/**
 * BookForge TypeScript 后端入口（对应 Python `app/main.py`）。
 *
 * 已接入：CORS、静态目录（/static）、multipart、JWT 鉴权、登录、bookplate 模块路由
 * （chat / analyze-image / generate-prompt / generate-image / node-registry / fastclaw-probe / isbn / cover）、
 * 平台 API（users / generations / favorites / public）、管理端 API
 * （llm-configs / prompts / node-configs / settings / fastclaw-agents / skill-agent-configs / bifrost）、
 * 启动种子（admin / 系统设置 / 默认提示词）。
 *
 * 待接入（后续阶段）：skills 上传/检索路由、Skill Agent 执行（deepseek harness，第二阶段）。
 */

const STATIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../static');

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  await app.register(cors, {
    // CORS 来源可用 CORS_ORIGINS 环境变量覆盖（逗号分隔），部署脚本按前端端口写入
    origin: env.corsOrigins,
    credentials: true,
  });

  await app.register(fastifyStatic, { root: STATIC_DIR, prefix: '/static/' });

  // multipart（bifrost 预览图上传）
  await app.register(multipart, { limits: { fileSize: 6 * 1024 * 1024 } });

  // 启动种子（幂等：admin 账号 + 系统设置 + 默认提示词）
  seedStartup();

  // 认证（JWT + authenticate/requireAdmin preHandler）与登录
  await registerAuth(app);
  await registerAuthRouter(app);

  // bookplate 模块路由
  await registerBookplateRouter(app);

  // 平台 API：用户 / 生成记录 / 收藏 / 公开画廊
  await registerUsersRouter(app);
  await registerGenerationsRouter(app);
  await registerFavoritesRouter(app);
  await registerPublicRouter(app);

  // 管理端 API：模型配置 / 提示词 / 节点配置 / 系统设置 / FastClaw / Skill Agent / Bifrost
  await registerLLMConfigsAdminRouter(app);
  await registerPromptsAdminRouter(app);
  await registerNodeConfigsAdminRouter(app);
  await registerSettingsAdminRouter(app);
  await registerFastClawAgentsAdminRouter(app);
  await registerSkillAgentConfigsAdminRouter(app);
  await registerBifrostAdminRouter(app);

  app.get('/', async () => ({ message: 'Welcome to BookForge API (TypeScript)' }));

  // 健康检查（部署探针用）
  app.get('/health', async () => ({ status: 'ok', project: env.projectName }));

  return app;
}

// 直接运行时启动（tsx src/server.ts）；被测试 import 时不自动 listen。
// Windows 下 argv[1] 为反斜杠路径，需经 pathToFileURL 归一化后再比较。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 8000);
  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

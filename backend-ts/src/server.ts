import Fastify from 'fastify';
import type { FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { env } from './config/env.js';
import { seedStartup } from './config/seed.js';
import { registerAuth } from './shared/security.js';
import { registerAuthRouter } from './api/auth.js';
import { registerBookplateRouter } from './modules/bookplate/router.js';
import { userGeneratedDir, userMapPosterDir, userSearchImageDir } from './services/image-service.js';
import { COVERS_DIR } from './modules/bookplate/covers.js';
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
import { registerBifrostSkillsAdminRouter } from './api/admin/bifrost-skills.js';

/**
 * BookForge TypeScript 后端入口（对应 Python `app/main.py`）。
 *
 * 已接入：CORS、静态目录（/static）、multipart、JWT 鉴权、登录、bookplate 模块路由
 * （chat / analyze-image / generate-prompt / generate-image / node-registry / fastclaw-probe / isbn / cover）、
 * 平台 API（users / generations / favorites / public）、管理端 API
 * （llm-configs / prompts / node-configs / settings / fastclaw-agents / skill-agent-configs / bifrost / bifrost-skills）、
 * 启动种子（admin / 系统设置 / 默认提示词）。
 *
 * 待接入（后续阶段）：skills 上传/检索路由、Skill Agent 执行（deepseek harness，第二阶段）。
 */

const STATIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../static');

// ---------------------------------------------------------------------------
// runtime 公开图片（生成图 runtime/{userId}/generated、封面 runtime/covers）
// ---------------------------------------------------------------------------
// 这两类图片的物理文件在根目录 runtime/ 下（与 skills/workspace 同一运行时目录约定），
// 对外仍沿用 /static 前缀的公开 URL：<img> 无法携带鉴权头、公开画廊需跨用户展示。
// 仅白名单两个子路径，不暴露 runtime 下 skills/workspace/.agent 等私有数据。
// 文件名内容寻址（时间戳+随机 / URL 摘要），长缓存安全。

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** 词法防穿越：rel 解析后必须落在 root 内，否则返回 null。 */
function safeJoin(root: string, rel: string): string | null {
  const full = path.normalize(path.join(root, rel));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/** 发送图片文件；不存在返回 false。 */
function sendPublicImage(reply: FastifyReply, full: string | null): boolean {
  if (!full || !existsSync(full) || !statSync(full).isFile()) return false;
  reply.type(EXT_MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream');
  reply.header('Cache-Control', 'public, max-age=31536000, immutable');
  reply.send(createReadStream(full));
  return true;
}

export async function buildApp() {
  // bodyLimit 覆盖 Fastify 默认 1MB：AI 对话节点带图请求（base64 data URL 膨胀约 33%）
  // 加上每轮重发的历史图片，很容易超过 1MB 导致 413（图片契约：单张 ≤8MB × 最多 4 张）。
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 50 * 1024 * 1024,
  });

  await app.register(cors, {
    // CORS 来源可用 CORS_ORIGINS 环境变量覆盖（逗号分隔），部署脚本按前端端口写入
    origin: env.corsOrigins,
    credentials: true,
  });

  // 生成图片：/static/generated/{userId}/{file} → runtime/{userId}/generated/{file}
  app.get('/static/generated/:userId/:file', async (request, reply) => {
    const { userId, file } = request.params as { userId: string; file: string };
    if (!/^\d+$/.test(userId) || !file || file.includes('..')) return reply.code(404).send();
    if (sendPublicImage(reply, safeJoin(userGeneratedDir(Number(userId)), file))) return reply;
    return reply.code(404).send();
  });

  // 封面缓存：/static/covers/{file} → runtime/covers/{file}
  app.get('/static/covers/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    if (!file || file.includes('..')) return reply.code(404).send();
    if (sendPublicImage(reply, safeJoin(COVERS_DIR, file))) return reply;
    return reply.code(404).send();
  });

  // 地图海报（多模态工具，中间结果）：/static/map-posters/{userId}/{file} → runtime/{userId}/map-posters/{file}
  app.get('/static/map-posters/:userId/:file', async (request, reply) => {
    const { userId, file } = request.params as { userId: string; file: string };
    if (!/^\d+$/.test(userId) || !file || file.includes('..')) return reply.code(404).send();
    if (sendPublicImage(reply, safeJoin(userMapPosterDir(Number(userId)), file))) return reply;
    return reply.code(404).send();
  });

  // 图片检索选中图（多模态工具，中间结果）：/static/search-images/{userId}/{file} → runtime/{userId}/search-images/{file}
  app.get('/static/search-images/:userId/:file', async (request, reply) => {
    const { userId, file } = request.params as { userId: string; file: string };
    if (!/^\d+$/.test(userId) || !file || file.includes('..')) return reply.code(404).send();
    if (sendPublicImage(reply, safeJoin(userSearchImageDir(Number(userId)), file))) return reply;
    return reply.code(404).send();
  });

  // 其余 /static 资源（如 bifrost 提示词预览图 prompt-previews）仍由 backend-ts/static/ 提供
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
  await registerBifrostSkillsAdminRouter(app);

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

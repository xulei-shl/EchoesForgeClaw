import type { FastifyInstance } from 'fastify';

import { register as registerAiNodes } from './routes/ai-nodes.js';
import { register as registerBook } from './routes/book.js';
import { register as registerTools } from './routes/tools.js';
import { register as registerImageSearch } from './routes/image-search.js';
import { register as registerRegistry } from './routes/registry.js';
import { register as registerBifrost } from './routes/bifrost.js';
import { register as registerSkills } from './routes/skills.js';
import { register as registerMapPoster } from './routes/map-poster.js';
import { register as registerMapArt } from './routes/map-art.js';

/**
 * bookplate 模块路由（对应 Python `app/modules/bookplate/router.py`）。
 *
 * 流式协议（AI SDK UI Message Stream，前端 useChat 消费）：
 * - chat / generate-text / analyze-image / generate-image(agent)：统一流式输出，
 *   正文走 text parts，Agent 中间步骤走 `data-agent_*` 自定义 part；
 * - generate-image(LLM)：单结果 JSON（{ image_url, mock }）。
 *
 * 执行模式由节点配置决定：Skill Agent（第二阶段）> FastClaw Agent > LLM（AI SDK）> Mock。
 * 已移植：isbn/cover（豆瓣客户端）、skills（列表/检索/安装/上传/移除/文件下载）。
 * 尚未移植：Skill Agent 执行模式（第二阶段，deepseek harness）。
 */

export async function registerBookplateRouter(app: FastifyInstance): Promise<void> {
  await registerAiNodes(app);
  await registerBook(app);
  await registerTools(app);
  await registerImageSearch(app);
  await registerRegistry(app);
  await registerBifrost(app);
  await registerSkills(app);
  await registerMapPoster(app);
  await registerMapArt(app);
}

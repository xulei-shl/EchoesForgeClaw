import { hashSync } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { env } from './env.js';
import { getDb } from './database.js';
import { appSettings, nodeConfigs, llmConfigs, promptTemplates, users } from '../db/schema.js';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_COVER_SYSTEM_PROMPT } from '../services/ai/llm-service.js';
import { writeAgentMd } from '../services/ai/skill-agent-files.js';
import { now } from '../shared/datetime.js';

export const DEFAULT_CANVAS_ASSISTANT_PROMPT = `# 画布助手 Canvas Assistant

你是一个专业的画板助手，帮助用户理解需求并在画布上推荐创建节点和辅助接线。

## 核心原则
1. **单节点推荐优先**：深入理解用户当前最核心的需求，从 33 个默认节点中推荐 1 个最适合的节点，并给出合理的初始参数建议。
2. **确认后执行**：在调用 \`canvas_create_node\` 之前，向用户用自然语言简述方案，获得用户同意后再执行。
3. **渐进接线**：创建节点后，主动询问或建议连接上级/下级节点（调用 \`canvas_connect_nodes\`）。
4. **全场景反馈通道**：
   - 4 类受管 AI 节点（图像分析、图像生成、文本生成、AI对话）不能由普通用户直接在前端创建空白实例。遇到此类定制需求时，协助梳理参数并调用 \`canvas_send_feedback\` 推送到管理员企业微信；
   - 只要用户提出产品建议、遇到 Bug、或需要新增系统暂未支持的节点/数据源，主动整理成专业结构并调用 \`canvas_send_feedback\` 直送企业微信。
5. **按需阅读技能**：
   - 了解 33 个节点及其端口契约阅读 \`canvas-node-catalog\`
   - 了解多模态滤镜效果参数阅读 \`canvas-multimodal-presets\`
   - 了解典型接线模式阅读 \`canvas-workflow-patterns\`
   - 了解反馈与自定义节点提交规范阅读 \`canvas-feedback-guide\`
`;

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
  [
    'mxnzp.app_id',
    env.mxnzpAppId,
    '万年历节点（MXNZP 节假日/万年历 API）应用 ID，初始来自 .env，可在本页修改',
  ],
  [
    'mxnzp.app_secret',
    env.mxnzpAppSecret,
    '万年历节点 MXNZP 应用密钥（敏感，仅显示掩码；初始来自 .env，可在本页修改）',
  ],
  [
    'mxnzp.base_url',
    'https://www.mxnzp.com',
    '万年历节点 MXNZP API 基础地址（一般无需修改）',
  ],
  [
    'unsplash.access_key',
    '',
    '图片检索节点（Unsplash）Access Key（https://unsplash.com/developers 注册获取；敏感，仅显示掩码）',
  ],
  [
    'pixabay.api_key',
    '',
    '图片检索节点（Pixabay）API Key（https://pixabay.com/api/docs 获取；敏感，仅显示掩码）',
  ],
  [
    'harvard.api_key',
    '',
    '艺术图片检索节点（Harvard Art Museums）API Key（https://harvardartmuseums.org/collections/api 获取；敏感，仅显示掩码）',
  ],
  [
    'nypl.api_key',
    '',
    '艺术图片检索节点（NYPL Digital Collections）API Key（https://api.repo.nypl.org/ 获取；敏感，仅显示掩码）',
  ],
  [
    'smithsonian.api_key',
    '',
    '艺术图片检索节点（Smithsonian Open Access）API Key（https://api.data.gov/signup/ 获取；敏感，仅显示掩码）',
  ],
  [
    'paris.api_key',
    '',
    '艺术图片检索节点（Paris Musées）API Key（https://www.parismusees.paris.fr/fr/les-collections-en-ligne/lapi-collections 获取；敏感，仅显示掩码）',
  ],
  [
    'europeana.api_key',
    '',
    '艺术图片检索节点（Europeana）API Key（https://apis.europeana.eu/en/apis 获取；敏感，仅显示掩码）',
  ],
  [
    'loc.use_proxy',
    'true',
    '艺术图片检索节点美国国会图书馆（LoC）是否使用全局代理（true = 启用，false = 直连）',
  ],
  [
    'tavily.api_key',
    '',
    '网络搜索节点（Tavily）API Key（https://tavily.com 注册获取；敏感，仅显示掩码）',
  ],
  [
    'exa.api_key',
    '',
    '网络搜索节点（Exa）API Key（https://exa.ai 注册获取；敏感，仅显示掩码）',
  ],
  [
    'anysearch.api_key',
    '',
    '网络搜索节点（AnySearch）API Key（https://anysearch.com 注册获取；敏感，仅显示掩码；支持匿名调用）',
  ],
  [
    'doubao.api_key',
    '',
    '网络搜索节点（豆包搜索）API Key（https://console.volcengine.com/search-infinity 获取；敏感，仅显示掩码）',
  ],
  [
    'zhihu.access_secret',
    env.zhihuAccessSecret,
    '知乎检索节点（知乎开发者平台开放 API）Access Secret（敏感，仅显示掩码；初始来自 .env，可在本页修改）',
  ],
  [
    'deeplx.url',
    '',
    '文本翻译节点（DeepLX）服务器 URL，如 http://localhost:1188/translate（留空则仅使用 Google 免费翻译）',
  ],
  [
    'google_translate.use_proxy',
    'true',
    'Google 翻译是否使用全局代理（true = 启用，false = 直连）',
  ],
  [
    'http.proxy',
    '',
    '全局 HTTP 代理地址，如 http://127.0.0.1:7890。各服务是否使用代理由对应的 use_proxy 开关控制（留空 = 全部直连）',
  ],
  [
    'service.map_poster.base_url',
    'http://127.0.0.1:8100',
    '城市地图海报 FastAPI 基础地址（对应 services/maptoposter，生成城市路网海报）',
  ],
  [
    'service.map_art.base_url',
    'http://127.0.0.1:8101',
    '艺术地图海报 FastAPI 基础地址（对应 services/prettymaps，基于 OSM + matplotlib 渲染）',
  ],
  [
    'service.patterns.base_url',
    'http://127.0.0.1:8102',
    '中国传统纹样 FastAPI 基础地址（对应 services/chinese-traditional-patterns，检索与详情服务）',
  ],
  [
    'service.colors.base_url',
    'http://127.0.0.1:8103',
    '中国传统配色 FastAPI 基础地址（对应 services/zhongguo-traditional-colors，色卡与 5 色调色板生成）',
  ],
  [
    'pi.guardrails.enabled',
    'true',
    'Pi Agent 安全护栏总开关（false = 关闭全部 Guardrails 检查，不建议）',
  ],
  [
    'pi.guardrails.features.policies',
    'true',
    'Pi Agent 文件保护策略（.env / 私钥等敏感文件禁止 Agent 读取与修改）',
  ],
  [
    'pi.guardrails.features.permission_gate',
    'true',
    'Pi Agent 危险命令确认（递归删除 / 提权 / 格式化等危险命令触发确认）',
  ],
  [
    'pi.guardrails.features.path_access',
    'true',
    'Pi Agent 越界路径访问控制（工作区外的文件访问拦截）',
  ],
  [
    'pi.guardrails.path_access.mode',
    'block',
    'Pi Agent 越界路径访问模式：block = 越界一律拒绝（默认，headless 无询问通道）；allow = 放行并记录（放弃跨租户隔离，慎用）。注：ask 已不再支持，存量值按 block 生效并在装配期给出提示',
  ],
  [
    'pi.guardrails.path_access.allowed_paths',
    '[]',
    'Pi Agent 越界路径放行白名单（JSON 数组，如 [{"kind":"file","path":"/data/x.txt"},{"kind":"directory","path":"/data/y"}]；仅 mode=allow 时有意义；留空 = 不放行任何越界路径）',
  ],
  [
    'wechat.webhook_url',
    '',
    '企业微信群机器人 Webhook 地址（用于接收画板用户反馈通知，敏感，仅显示掩码）',
  ],
];

/** 废弃/已删除的系统设置键（启动时自动彻底清理存量历史数据） */
const DEPRECATED_SETTINGS = ['nasa.api_key', 'douban.proxy', 'loc.proxy', 'translation.use_proxy'];

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
    } else if (
      (key.startsWith('bifrost.') || key.startsWith('mxnzp.') || key.startsWith('zhihu.')) &&
      value &&
      !existing.value
    ) {
      // 种子回填（bifrost.* / mxnzp.* / zhihu.*）：存量值为空且种子值非空时补写，绝不覆盖非空修改
      db.update(appSettings).set({ value }).where(eq(appSettings.key, key)).run();
    }
  }

  // 清理已废弃的系统设置（如 NASA 公开图库已无需 api_key）
  for (const key of DEPRECATED_SETTINGS) {
    db.delete(appSettings).where(eq(appSettings.key, key)).run();
  }

  // 默认提示词模板（按固定 key 判重）
  const seeds = [
    {
      key: 'bookplate.text_generation.default',
      name: '藏书票图像生成提示词',
      nodeType: 'text_generation',
      content: DEFAULT_SYSTEM_PROMPT,
    },
    {
      key: 'bookplate.image_analysis.default',
      name: '封面分析提示词',
      nodeType: 'image_analysis',
      content: DEFAULT_COVER_SYSTEM_PROMPT,
    },
    {
      key: 'bookplate.canvas_assistant.default',
      name: '画板智能助手默认提示词',
      nodeType: 'canvas_assistant',
      content: DEFAULT_CANVAS_ASSISTANT_PROMPT,
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

  // 默认节点配置：若尚无 canvas_assistant 节点配置，自动创建一条默认激活的配置
  const existingAssistantNode = db
    .select()
    .from(nodeConfigs)
    .where(eq(nodeConfigs.nodeType, 'canvas_assistant'))
    .get();
  if (!existingAssistantNode) {
    const promptRow = db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.key, 'bookplate.canvas_assistant.default'))
      .get();
    const activeLlm = db
      .select()
      .from(llmConfigs)
      .where(eq(llmConfigs.isActive, true))
      .orderBy(llmConfigs.id)
      .get();
    db.insert(nodeConfigs)
      .values({
        nodeType: 'canvas_assistant',
        name: '画板智能助手',
        promptId: promptRow?.id ?? null,
        llmConfigId: activeLlm?.id ?? null,
        isActive: true,
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
  }

  // 确保磁盘预置有 AGENTS.md（即便无 DB 配置也能兜底）
  writeAgentMd('canvas-assistant', DEFAULT_CANVAS_ASSISTANT_PROMPT);
}

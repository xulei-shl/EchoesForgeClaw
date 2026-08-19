import type { FastifyRequest } from 'fastify';
import { type FastClawEvent } from '../../services/fastclaw-service.js';
import { type ChatStreamEvent } from './stream.js';
import { NODE_TYPES } from './node-types.js';
import { getDb } from '../../config/database.js';
import { findNodeConfigById, getAppSettingsMap } from '../../repositories/index.js';
import { type GlamProvider } from '../../services/glam-search-service.js';
import { type DoubanClientConfig } from '../../services/douban-service.js';

// ---------------------------------------------------------------------------
// 请求体（对应 Python Pydantic 模型）
// ---------------------------------------------------------------------------

export interface ChatRequest {
  messages?: unknown[];
  message?: string;
  images?: string[];
  config_id?: number | null;
  node_id?: string | null;
  epoch?: number;
  skills?: string[];
  workspace_id?: string | null;
  /** 节点内手动覆盖的模型名（仅 LLM 模式生效；空/缺省 = 跟随节点配置的默认模型） */
  model_name?: string | null;
  /** 节点内手动选择的 FastClaw Agent 配置 id（仅 Agent 模式生效；空/缺省 = 跟随节点配置） */
  agent_config_id?: number | null;
}

export interface AnalyzeImageRequest {
  image?: string | null;
  cover_url?: string | null;
  config_id?: number | null;
  node_id?: string | null;
  /** 节点内手动覆盖的模型名（仅 LLM 模式生效；空/缺省 = 跟随节点配置的默认模型） */
  model_name?: string | null;
}

export interface PromptRequest {
  metadata?: Record<string, unknown>;
  analysis?: string | null;
  text?: string | null;
  config_id?: number | null;
  node_id?: string | null;
  /** 节点内手动覆盖的模型名（仅 LLM 模式生效；空/缺省 = 跟随节点配置的默认模型） */
  model_name?: string | null;
}

export interface ImageGenRequest {
  prompt: string;
  size?: string | null;
  ratio?: string | null;
  image?: string[] | null;
  config_id?: number | null;
  node_id?: string | null;
  /** 节点内手动覆盖的模型名（仅 LLM 模式生效；空/缺省 = 跟随节点配置的默认模型） */
  model_name?: string | null;
}

// ---------------------------------------------------------------------------
// 工具函数（对应 Python router.py 内联逻辑）
// ---------------------------------------------------------------------------

export const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;

export const _IMAGE_MAGIC_PREFIXES: Array<[number[], string]> = [
  [[0xff, 0xd8, 0xff], '.jpg'],
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '.png'],
  [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], '.gif'],
  [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], '.gif'],
];

/** 节点类型 → 可用的 LLM 配置 kind（模型候选列表过滤用）；未列出的节点类型返回空 = 不限。 */
export function llmKindsForNodeType(nodeType: string): string[] {
  switch (nodeType) {
    case NODE_TYPES.CHAT:
      return ['text', 'multimodal']; // 多轮对话：文本 / 多模态（可带图）
    case NODE_TYPES.IMAGE_ANALYSIS:
      return ['multimodal']; // 视觉分析（需要视觉能力）
    case NODE_TYPES.TEXT_GENERATION:
      return ['text', 'multimodal']; // AI 文本生成：多模态模型同样可做文本生成
    case NODE_TYPES.IMAGE:
      return ['image']; // 图像生成
    default:
      return [];
  }
}

/** 艺术图片检索（GLAM 工具）可用源列表（与 glam-search-service 的 GlamProvider 一致）。 */
export const GLAM_PROVIDERS: GlamProvider[] = [
  'met',
  'rijks',
  'ai-chicago',
  'artsmia',
  'cleveland',
  'smk',
  'wellcome',
  'harvard',
  'nypl',
  'smithsonian',
  'paris',
  'europeana',
  'loc',
];

/**
 * 艺术图片检索保存接口的 SSRF 白名单：13 家博物馆图片服务器域名（主域 + 子域）。
 * 与 glam-search-service 各源返回的图片 URL 一一对应；其余域名一律拒绝。
 * loc.gov 主域覆盖 www.loc.gov / tile.loc.gov（检索 JSON 与 IIIF 图片服务）。
 */
export const GLAM_IMAGE_HOSTS = [
  'images.metmuseum.org', // MET
  'rijksmuseum.nl', // Rijksmuseum（Linked Art / IIIF）
  'googleusercontent.com', // Rijksmuseum 部分 IIIF 图片托管
  'artic.edu', // 芝加哥艺术学院 IIIF
  'api.artsmia.org', // 明尼阿波利斯美术馆
  'clevelandart.org', // 克利夫兰美术馆
  'smk.dk', // 丹麦国立美术馆
  'wellcomecollection.org', // Wellcome 收藏
  'harvardartmuseums.org', // 哈佛艺术博物馆
  'nrs.harvard.edu', // 哈佛图片（IIIF 重定向源）
  'nypl.org', // 纽约公共图书馆
  'si.edu', // 史密森尼学会
  'parismuseescollections.paris.fr', // 巴黎博物馆
  'europeana.eu', // Europeana（缩略图 / data）
  'loc.gov', // 美国国会图书馆（www.loc.gov / tile.loc.gov 图片服务）
];

/** 通过文件头魔数判断字节是否为真实图片；是则返回扩展名，否则 null。 */
export function detectImageExt(content: Uint8Array): string | null {
  if (!content.length) return null;
  for (const [magic, ext] of _IMAGE_MAGIC_PREFIXES) {
    if (magic.every((b, i) => content[i] === b)) return ext;
  }
  if (content.length >= 12 && String.fromCharCode(...content.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...content.subarray(8, 12)) === 'WEBP') {
    return '.webp';
  }
  return null;
}

/** 解析前端上传图片的 base64 data URL，返回原始图片字节（非法返回 null）。 */
export function decodeUploadedImage(dataUrl: string): Uint8Array | null {
  try {
    const idx = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, idx);
    const b64 = dataUrl.slice(idx + 1);
    if (!meta.includes('image/') || !b64) return null;
    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    if (!bytes.length || bytes.length > MAX_UPLOAD_IMAGE_BYTES) return null;
    if (!detectImageExt(bytes.subarray(0, 12))) return null;
    return bytes;
  } catch {
    return null;
  }
}

/** FastClaw 会话 key（同用户同节点重试共享上下文；epoch 清空对话后递增）。 */
export function agentSessionKey(userId: number, nodeId?: string | null, epoch = 0): string {
  return `bookplate-${userId}-${nodeId || 'anon'}-${epoch}`;
}

/** 元数据 + 图片分析文本 + 文本节点内容 → Agent 模式用户消息（不传图片，防 SSRF）。 */
export function agentPromptMessage(
  metadata: Record<string, unknown>,
  analysis = '',
  text = ''
): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(metadata)) {
    if (['cover_image', 'cover_image_local', 'coverUrl', 'image_url', 'image_url_local'].includes(k)) {
      continue;
    }
    lines.push(`${k}: ${String(v)}`);
  }
  let message = lines.length ? lines.join('\n') : JSON.stringify(metadata);
  if (analysis) message += '\n\n图片分析结果：\n' + analysis;
  if (text) message += '\n\n文本节点内容：\n' + text;
  return message;
}

/** FastClaw 归一化事件 → 统一 ChatStreamEvent（data-agent_* part 语义沿用旧事件名）。 */
export function* agentEventToStream(evt: FastClawEvent, contentEvent: 'content_delta' | 'text' = 'content_delta'): Generator<ChatStreamEvent> {
  switch (evt.type) {
    case 'content_delta':
    case 'content':
      yield { type: 'content_delta', delta: evt.data.delta };
      break;
    case 'tool_call':
      yield { type: 'tool_call', id: evt.data.id, name: evt.data.name, arguments: evt.data.arguments };
      break;
    case 'tool_result':
      yield { type: 'tool_result', id: evt.data.id, name: evt.data.name, result: evt.data.result };
      break;
    case 'status':
      yield { type: 'status', message: evt.data.message };
      break;
    case 'subagent_progress':
      yield { type: 'status', message: `子任务: ${String(evt.data.phase ?? '')}` };
      break;
    case 'error':
      yield { type: 'error', message: evt.data.message };
      break;
    case 'done':
      break;
  }
}

/** 客户端断开 → AbortSignal（停止生成/删除节点/关闭页面时中止底层流）。 */
export function requestAbortSignal(request: FastifyRequest): AbortSignal {
  const abort = new AbortController();
  request.raw.on('close', () => {
    if (request.raw.destroyed) abort.abort();
  });
  return abort.signal;
}

/** 豆瓣客户端配置（按系统设置组装；对应 Python _douban_client_config）。 */
export function doubanClientConfig(db = getDb()): Partial<DoubanClientConfig> {
  const s = getAppSettingsMap(db);
  const config: Partial<DoubanClientConfig> = {};
  if (s['douban.base_url']) config.base_url = s['douban.base_url'];
  if (s['douban.proxy']) config.proxy = s['douban.proxy'];
  const qps = Number(s['douban.qps'] ?? '0.5');
  if (Number.isFinite(qps) && qps > 0) config.qps = Math.min(qps, 2.0);
  return config;
}

/** 封面代理 URL（前端 <img> 经此加载，后端带 Referer 下载缓存）。 */
export function proxyCoverUrl(request: FastifyRequest, coverImage: string): string {
  return `${request.protocol}://${request.host}/api/modules/bookplate/cover?url=${encodeURIComponent(coverImage)}`;
}

/** 节点是否绑定 Skill Agent 模式（第二阶段迁移，暂不支持）。 */
export function hasSkillAgentBinding(configId: number | null): boolean {
  if (configId == null) return false;
  const nc = findNodeConfigById(getDb(), configId);
  return !!nc && nc.skillAgentConfigId != null && !!nc.isActive;
}

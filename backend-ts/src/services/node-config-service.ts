import { getDb } from '../config/database.js';
import { eq, and } from 'drizzle-orm';
import {
  findNodeConfigById,
  findLLMConfigById,
  findPromptTemplateById,
  findFastClawAgentConfigById,
  type LLMConfigRow,
} from '../repositories/index.js';
import { llmConfigs, skillAgentConfigs } from '../db/schema.js';
import type { TextModelConfig, VisionModelConfig, ImageModelConfig } from '../infrastructure/ai/types.js';
import type { FastClawRuntimeConfig } from './fastclaw-service.js';

/**
 * 节点配置 → 运行时模型配置解析（对应 Python `router.py` 的
 * `_resolve_node_config` / `_text_config_from` / `_vision_config_from` /
 * `_image_config_from` / `_agent_config_from`）。
 *
 * 按节点实例的 config_id 解析（而非全局阶段）；未绑定/未启用/类型不匹配时返回 null，
 * 由调用方回退环境变量 / Mock（与 Python 语义一致）。
 */

/** 解析指定节点模板类型的配置；未传/不存在/类型不符/未启用时返回 null。 */
function resolveNodeConfig(configId: number | null, nodeType: string) {
  if (configId == null) return null;
  const nc = findNodeConfigById(getDb(), configId);
  if (!nc || nc.nodeType !== nodeType || !nc.isActive) return null;
  return nc;
}

/** 从节点配置解析文本模型运行时配置（未绑定则 null，调用方回退环境变量）。 */
export function textConfigFrom(configId: number | null, nodeType: string): TextModelConfig | null {
  const nc = resolveNodeConfig(configId, nodeType);
  if (!nc?.llmConfigId) return null;
  const llm = findLLMConfigById(getDb(), nc.llmConfigId);
  if (!llm || !llm.apiKey || !llm.isActive) return null;
  const prompt = nc.promptId ? findPromptTemplateById(getDb(), nc.promptId) : undefined;
  return {
    apiKey: llm.apiKey,
    base_url: llm.baseUrl ?? '',
    model_name: llm.modelName || 'gpt-3.5-turbo',
    system_prompt: prompt?.content && prompt.isActive ? prompt.content : '',
  };
}

/** 从节点配置解析多模态模型运行时配置（未绑定则 null）。 */
export function visionConfigFrom(configId: number | null, nodeType: string): VisionModelConfig | null {
  const nc = resolveNodeConfig(configId, nodeType);
  if (!nc?.llmConfigId) return null;
  const llm = findLLMConfigById(getDb(), nc.llmConfigId);
  if (!llm || !llm.apiKey || !llm.isActive) return null;
  const prompt = nc.promptId ? findPromptTemplateById(getDb(), nc.promptId) : undefined;
  return {
    apiKey: llm.apiKey,
    base_url: llm.baseUrl ?? '',
    model_name: llm.modelName || 'gpt-4o-mini',
    system_prompt: prompt?.content && prompt.isActive ? prompt.content : '',
  };
}

/** 从节点配置解析图片模型运行时配置（仅模型三要素，图像参数由请求体按次传入）。 */
export function imageConfigFrom(configId: number | null, nodeType: string): ImageModelConfig | null {
  const nc = resolveNodeConfig(configId, nodeType);
  if (!nc?.llmConfigId) return null;
  const llm = findLLMConfigById(getDb(), nc.llmConfigId);
  if (!llm || !llm.apiKey || !llm.isActive) return null;
  return {
    apiKey: llm.apiKey,
    base_url: llm.baseUrl ?? '',
    model_name: llm.modelName ?? '',
  };
}

/** 从节点配置解析 FastClaw Agent 运行时配置（未绑定/未启用/无 Key 则 null）。 */
export function agentConfigFrom(
  configId: number | null,
  nodeType: string,
  userId: number
): FastClawRuntimeConfig | null {
  const nc = resolveNodeConfig(configId, nodeType);
  if (!nc?.agentConfigId) return null;
  const agent = findFastClawAgentConfigById(getDb(), nc.agentConfigId);
  if (!agent || !agent.isActive || !agent.apiKey) return null;
  return {
    base_url: agent.baseUrl ?? '',
    api_key: agent.apiKey,
    agent_id: agent.agentId ?? '',
    end_user: `bookplate-${userId}`,
  };
}

/**
 * 节点 Agent 配置解析（支持节点内手动选择的 Agent 覆盖）。
 * 仅当节点本身为 Agent 模式（bound 非 null）时覆盖才生效；
 * 覆盖项不存在/未启用/无 Key 时回退节点绑定配置，避免静默降级到 LLM 模式。
 */
export function agentConfigFromWithOverride(
  configId: number | null,
  overrideAgentConfigId: number | null,
  nodeType: string,
  userId: number
): FastClawRuntimeConfig | null {
  const bound = agentConfigFrom(configId, nodeType, userId);
  if (bound && overrideAgentConfigId != null) {
    const agent = findFastClawAgentConfigById(getDb(), overrideAgentConfigId);
    if (agent && agent.isActive && agent.apiKey) {
      return {
        base_url: agent.baseUrl ?? '',
        api_key: agent.apiKey,
        agent_id: agent.agentId ?? '',
        end_user: `bookplate-${userId}`,
      };
    }
  }
  return bound;
}

// ---------------------------------------------------------------------------
// Skill Agent（pi CLI）运行时解析
// ---------------------------------------------------------------------------

/** Skill Agent 运行时配置：对话模型 + 可选绘图模型。 */
export interface SkillAgentRuntimeConfig {
  configId: number;
  /** 对话大模型（pi 的 bookforge provider；缺失视为配置无效）。 */
  chat: { baseUrl: string; apiKey: string; modelName: string; kind: string } | null;
  /** 绘图模型（kind='image'）；未绑定且无全局启用项时为 null = 不加载绘图工具。 */
  image: { baseUrl: string; apiKey: string; modelName: string } | null;
}

/** 解析 SkillAgentConfig 引用的对话模型（llmConfigId 优先，回退旧字段三件套）。 */
function skillAgentChatModel(db: ReturnType<typeof getDb>, cfg: typeof skillAgentConfigs.$inferSelect) {
  if (cfg.llmConfigId != null) {
    const llm = findLLMConfigById(db, cfg.llmConfigId);
    if (llm && llm.isActive && llm.apiKey) {
      return {
        baseUrl: llm.baseUrl ?? '',
        apiKey: llm.apiKey,
        modelName: llm.modelName ?? '',
        kind: llm.kind ?? 'text',
      };
    }
    return null;
  }
  // 存量兼容：自身 baseUrl/apiKey/modelName 三件套
  if (cfg.apiKey && cfg.baseUrl && cfg.modelName) {
    return { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, modelName: cfg.modelName, kind: 'text' };
  }
  return null;
}

/** 解析绘图模型：SkillAgentConfig.imageLlmConfigId 优先（须 kind='image'），回退全局启用的 image 配置。 */
function resolveImageModel(
  db: ReturnType<typeof getDb>,
  imageLlmConfigId: number | null | undefined
): { baseUrl: string; apiKey: string; modelName: string } | null {
  let llm: LLMConfigRow | undefined;
  if (imageLlmConfigId != null) {
    const row = findLLMConfigById(db, imageLlmConfigId);
    if (row && row.kind === 'image') llm = row;
  } else {
    const row = db
      .select()
      .from(llmConfigs)
      .where(and(eq(llmConfigs.kind, 'image'), eq(llmConfigs.isActive, true)))
      .orderBy(llmConfigs.id)
      .get();
    llm = row;
  }
  if (!llm || !llm.isActive || !llm.apiKey) return null;
  return { baseUrl: llm.baseUrl ?? '', apiKey: llm.apiKey, modelName: llm.modelName ?? '' };
}

/**
 * 从节点配置解析 Skill Agent（pi）运行时配置。
 * 未绑定 / 节点或配置未启用 / 对话模型缺失时返回 null（调用方显式报错，不静默回退其它模式）。
 */
export function skillAgentConfigFrom(configId: number | null): SkillAgentRuntimeConfig | null {
  const nc = resolveNodeConfig(configId, 'chat');
  if (!nc?.skillAgentConfigId) return null;
  const db = getDb();
  const cfg = db.select().from(skillAgentConfigs).where(eq(skillAgentConfigs.id, nc.skillAgentConfigId)).get();
  if (!cfg || !cfg.isActive) return null;
  const chat = skillAgentChatModel(db, cfg);
  if (!chat) return null;
  return {
    configId: cfg.id,
    chat,
    image: resolveImageModel(db, cfg.imageLlmConfigId),
  };
}

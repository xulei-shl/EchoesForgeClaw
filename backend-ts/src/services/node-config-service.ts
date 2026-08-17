import { getDb } from '../config/database.js';
import {
  findNodeConfigById,
  findLLMConfigById,
  findPromptTemplateById,
  findFastClawAgentConfigById,
} from '../repositories/index.js';
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

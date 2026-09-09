import type { FastifyInstance } from 'fastify';
import { NODE_TEMPLATES, NODE_TYPES } from '../node-types.js';
import { getDb } from '../../../config/database.js';
import { fastclawAgentService, FastClawAgentError } from '../../../services/ai/fastclaw-service.js';
import {
  findNodeConfigById,
  findLLMConfigById,
  findFastClawAgentConfigById,
  listActiveFastClawAgents,
  listActiveLLMConfigModelNames,
  listActiveLLMConfigOptions,
  listActiveNodeConfigs,
} from '../../../repositories/index.js';
import { llmKindsForNodeType } from '../helpers.js';

export async function register(app: FastifyInstance): Promise<void> {
  // ---- 节点注册表（画板「+」菜单数据源） ----
  app.get(
    '/api/modules/bookplate/node-registry',
    { preHandler: app.authenticate },
    async () => {
      const db = getDb();
      const configs = listActiveNodeConfigs(db);
      const items = [];
      for (const nc of configs) {
        if (!nc.isActive || !NODE_TEMPLATES.some((t) => t.type === nc.nodeType)) continue;
        let mode: 'skill_agent' | 'agent' | 'llm' = 'llm';
        if (nc.skillAgentConfigId != null) mode = 'skill_agent';
        else if (nc.agentConfigId != null) mode = 'agent';
        items.push({
          id: nc.id,
          node_type: nc.nodeType,
          name: nc.name,
          group: nc.group,
          group_order: nc.groupOrder,
          mode,
          agent_name: null,
          skill_agent_config_name: null,
          llm_config_name: null,
          is_active: !!nc.isActive,
        });
      }
      return { templates: NODE_TEMPLATES, configs: items };
    }
  );

  // ---- 模型列表（各节点「模型」下拉数据源：admin llm-configs 已配置的模型名，不调服务商 API） ----
  app.get(
    '/api/modules/bookplate/llm-models',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const q = (request.query ?? {}) as { config_id?: string };
      const configId = Number(q.config_id) || null;
      if (configId == null) return reply.code(400).send({ detail: '缺少 config_id' });
      const db = getDb();
      const nc = findNodeConfigById(db, configId);
      // 不限节点类型：chat / text_generation / image_generation 等绑定模型配置的节点通用
      if (!nc || nc.llmConfigId == null || !nc.isActive) {
        return reply.code(400).send({ detail: '节点未绑定可用的模型配置' });
      }
      const llm = findLLMConfigById(db, nc.llmConfigId);
      if (!llm || !llm.apiKey || !llm.isActive) {
        return reply.code(400).send({ detail: '模型配置不可用（未启用或缺少 API Key）' });
      }

      // 候选列表 = admin 启用配置中、与节点类型匹配 kind 的配置名（去重，默认配置恒在首位）；
      // 前端发送配置 name → 后端自动关联完整 model_name / base_url / apiKey
      const defaultName = llm.name || '';
      const options = listActiveLLMConfigOptions(db, llmKindsForNodeType(nc.nodeType));
      const configs = [
        { name: defaultName, model_name: llm.modelName || defaultName },
        ...options.filter((o) => o.name !== defaultName).map((o) => ({ name: o.name, model_name: o.modelName })),
      ];
      return { default_model: defaultName, models: configs.map((c) => c.name) };
    }
  );

  // ---- FastClaw Agent 列表（AI 对话节点「Agent」下拉数据源；不含 api_key 等敏感字段） ----
  app.get(
    '/api/modules/bookplate/fastclaw-agents',
    { preHandler: app.authenticate },
    async (request) => {
      const q = (request.query ?? {}) as { config_id?: string };
      const configId = Number(q.config_id) || null;
      // 默认 Agent = 节点配置绑定的 Agent（供前端展示「默认」项）
      let defaultAgent: { id: number; name: string; agent_name: string | null } | null = null;
      if (configId != null) {
        const nc = findNodeConfigById(getDb(), configId);
        if (nc && nc.nodeType === NODE_TYPES.CHAT && nc.agentConfigId != null && nc.isActive) {
          const bound = findFastClawAgentConfigById(getDb(), nc.agentConfigId);
          if (bound) {
            defaultAgent = { id: bound.id, name: bound.name, agent_name: bound.agentName };
          }
        }
      }
      const agents = listActiveFastClawAgents(getDb()).map((a) => ({
        id: a.id,
        name: a.name,
        agent_name: a.agentName,
      }));
      return { default_agent: defaultAgent, agents };
    }
  );

  // ---- FastClaw 探测（admin 配置页「拉取」用） ----
  app.get(
    '/api/modules/bookplate/fastclaw-probe',
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const query = (request.query ?? {}) as { base_url?: string; api_key?: string; config_id?: string | number };
      let baseUrl = (query.base_url ?? '').trim();
      let apiKey = (query.api_key ?? '').trim();
      const configId = query.config_id != null && query.config_id !== '' ? Number(query.config_id) : null;

      if (configId != null && !Number.isNaN(configId)) {
        const cfg = findFastClawAgentConfigById(getDb(), configId);
        if (!cfg) {
          return reply.code(404).send({ detail: 'FastClaw Agent 配置不存在' });
        }
        if (!baseUrl) baseUrl = (cfg.baseUrl ?? '').trim();
        if (!apiKey) apiKey = (cfg.apiKey ?? '').trim();
      }

      if (!baseUrl || !apiKey) {
        return reply.code(400).send({ detail: '请填写 Base URL 与 API Key' });
      }
      try {
        const agents = await fastclawAgentService.listAgents(baseUrl, apiKey);
        return { agents };
      } catch (err) {
        return reply.code(502).send({ detail: err instanceof FastClawAgentError ? err.message : String(err) });
      }
    }
  );
}

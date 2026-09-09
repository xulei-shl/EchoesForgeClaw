import { authHeaders } from './authUtils';

/** FastClaw Agent 配置的展示形态（不含 api_key / base_url 等敏感字段）。 */
export interface FastClawAgentOption {
  id: number;
  name: string;
  agent_name: string | null;
}

/** 「Agent」下拉数据源：节点绑定默认 Agent + 全部启用 Agent。 */
export interface FastClawAgentList {
  /** 节点配置绑定的 Agent（供前端展示「默认」项；未绑定/非 Agent 模式为 null） */
  default_agent: FastClawAgentOption | null;
  /** 全部启用的 FastClaw Agent */
  agents: FastClawAgentOption[];
}

/** 拉取全部启用 FastClaw Agent 列表 + 节点绑定 Agent（key 仅服务端使用，前端只拿展示字段）。 */
export async function fetchFastClawAgentList(configId: number): Promise<FastClawAgentList> {
  const resp = await fetch(`/api/modules/bookplate/fastclaw-agents?config_id=${configId}`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

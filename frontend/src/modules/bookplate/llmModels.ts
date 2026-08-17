/** admin llm-configs 模型列表响应（节点「模型」下拉数据源）。 */
export interface LLMModelList {
  /** 节点配置绑定的默认模型名 */
  default_model: string;
  /** admin 全部启用配置的模型名列表（含默认模型，去重） */
  models: string[];
}

/** 拉取 admin llm-configs 已配置的模型列表（候选 = 后台配置，非服务商全量）。 */
export async function fetchLLMModelList(configId: number): Promise<LLMModelList> {
  const token = localStorage.getItem('token');
  const resp = await fetch(`/api/modules/bookplate/llm-models?config_id=${configId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

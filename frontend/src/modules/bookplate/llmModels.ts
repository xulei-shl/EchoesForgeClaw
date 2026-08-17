/** 服务商 /models 列表响应（节点「模型」下拉数据源；key 仅服务端使用）。 */
export interface LLMModelList {
  /** 节点配置绑定的默认模型名 */
  default_model: string;
  /** 服务商暴露的模型 id 列表（含默认模型，去重） */
  models: string[];
}

/** 拉取节点绑定模型配置的服务商模型列表（key 仅服务端使用，前端只拿模型 id）。 */
export async function fetchLLMModelList(configId: number): Promise<LLMModelList> {
  const token = localStorage.getItem('token');
  const resp = await fetch(`/api/modules/bookplate/llm-models?config_id=${configId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

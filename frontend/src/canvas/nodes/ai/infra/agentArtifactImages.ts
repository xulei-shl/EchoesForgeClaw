import { authHeaders } from './authUtils';
import type { AgentFile } from '../../../../shared/types';

/**
 * AI 产物图片选择器共享数据通道（图片加载节点复用，与 ChatNodeHost 文件面板同口径）：
 * - pi（skill_agent）/ LLM：GET /chat/files?workspace_id=...（复用 piSessionApi 的端点口径，含已删除过滤）
 * - FastClaw（agent）：GET /chat/fastclaw-files（从 ChatNodeHost 提为共享导出）
 * 两条通道均要求登录鉴权，字节获取统一 fetch → blob（<img> 无法携带 Authorization 头）。
 */

/** FastClaw（Agent 模式）会话文件列表（服务端会话目录，文件随 agent 工具调用产生，跨轮保留）。 */
export async function fetchFastClawWorkspaceFiles(params: {
  nodeId: string;
  epoch: number;
  configId: number | null;
  agentConfigId: number | null;
  /** 当前会话工作区（FastClaw 会话 key 一对话一 key，与服务端 /chat 同参） */
  workspaceId: string | null;
}): Promise<AgentFile[]> {
  const qs = new URLSearchParams({
    node_id: params.nodeId,
    epoch: String(params.epoch),
    config_id: params.configId != null ? String(params.configId) : '',
    agent_config_id: params.agentConfigId != null ? String(params.agentConfigId) : '',
    workspace_id: params.workspaceId ?? '',
  });
  const resp = await fetch(`/api/modules/bookplate/chat/fastclaw-files?${qs.toString()}`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { files?: AgentFile[] };
  return data.files ?? [];
}

/** 位图判定（选择器只列位图产物；SVG 以 raster 名单为准，后端魔法数校验口径一致） */
export function isRasterArtifact(f: AgentFile): boolean {
  if (f.previewable === false) return false;
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name) || /^image\//.test(f.mime);
}

/** 带鉴权下载单个产物文件字节（fetch → blob，失败抛错由调用方 toast）。 */
export async function fetchArtifactBlob(file: AgentFile): Promise<Blob> {
  const resp = await fetch(file.url, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.blob();
}

/** 产物字节 → data URL（FileReader 统一口径，与本地 fileToDataUrl 对齐）。 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('图片转换失败'));
    reader.readAsDataURL(blob);
  });
}

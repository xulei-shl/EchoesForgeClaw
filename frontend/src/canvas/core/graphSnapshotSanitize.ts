/**
 * 画板连线子图快照的节点数据清洗（保存历史前调用，纯函数无副作用）。
 *
 * 目标：在「公开画廊人人可复现完整连线」与「控制存储/传输体积」之间折中——
 * 结构和文本类内容保留，纯体积膨胀项裁剪，base64 大图与瞬态字段丢弃。
 *
 * 规则分层：
 * - 保留：节点 type/边拓扑/坐标/配置(configId)/文本类字段（content/output/analysis/prompt 等）
 * - 截断：单字段超长文本、chat 兜底消息、agentSteps 条数与单条长度
 * - 丢弃：瞬态字段(isGenerating/error/reasoning)、base64 data URL（中间节点图片即工作流可重算的产物）
 *
 * chat 节点会话恢复策略：全量历史以 workspaceId 为权柄——服务端按 workspace 落盘
 * transcript（LLM/FastClaw 为 {ws}/conversation.jsonl，pi 为 .pi-agent/run/chat.jsonl），
 * 导入重建后宿主按 workspaceId 从服务端水合即可完整恢复；内嵌 messages 仅作为
 * 跨用户公开画廊 / 会话已删等场景的兜底展示，只留最后一轮减小落库体积。
 */

export const MAX_TEXT_LEN = 20_000;
export const MAX_ARRAY_ITEMS = 200;
/** chat 兜底消息数（最后一轮 user+assistant；全量历史由 workspaceId 指向服务端 jsonl 恢复） */
export const MAX_CHAT_FALLBACK_MESSAGES = 2;
export const MAX_AGENT_STEPS = 10;
export const MAX_STEP_TEXT_LEN = 500;

/** 瞬态/运行时字段：不落库 */
const DROP_KEYS = new Set(['isGenerating', 'error', 'reasoning']);

const isBase64 = (v: unknown): boolean => typeof v === 'string' && v.startsWith('data:');

const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

/**
 * 递归清洗单值：base64 → undefined（丢弃）；超长字符串截断；
 * 数组按 MAX_ARRAY_ITEMS 保留末尾；对象递归并跳过 DROP_KEYS / undefined。
 */
function sanitizeValue(v: unknown, maxLen: number): unknown {
  if (typeof v === 'string') {
    if (isBase64(v)) return undefined;
    return truncate(v, maxLen);
  }
  if (Array.isArray(v)) {
    const capped = v.length > MAX_ARRAY_ITEMS ? v.slice(-MAX_ARRAY_ITEMS) : v;
    return capped.map((item) => sanitizeValue(item, maxLen)).filter((x) => x !== undefined);
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (DROP_KEYS.has(k)) continue;
      const cleaned = sanitizeValue(val, maxLen);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return v;
}

/** agentSteps 单条清洗：字符串字段截断到 MAX_STEP_TEXT_LEN，其余递归。 */
function sanitizeAgentStep(step: unknown): unknown {
  if (!step || typeof step !== 'object') return step;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(step as Record<string, unknown>)) {
    out[k] =
      typeof val === 'string'
        ? isBase64(val)
          ? undefined
          : truncate(val, MAX_STEP_TEXT_LEN)
        : sanitizeValue(val, MAX_STEP_TEXT_LEN);
  }
  // 清洗后仍可能带 undefined（base64），整体过滤一次
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

/**
 * 清洗节点 data（按类型特殊处理 chat 消息轮数与 agentSteps）。
 * 返回一个新对象；不含深拷贝其它语义。
 */
export function sanitizeNodeData(nodeType: string, data: unknown): any {
  if (!data || typeof data !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
    if (DROP_KEYS.has(key)) continue;
    // chat 节点：全量历史由 workspaceId（保持原样随快照携带）指向服务端 jsonl 恢复，
    // 此处仅保留最后一轮消息作为跨用户画廊 / 会话缺失时的兜底展示
    if (nodeType === 'chat' && key === 'messages' && Array.isArray(val)) {
      out[key] = val
        .slice(-MAX_CHAT_FALLBACK_MESSAGES)
        .map((m) => sanitizeValue(m, MAX_TEXT_LEN))
        .filter((x) => x !== undefined);
      continue;
    }
    // agentSteps：条数上限 + 单条字段截断
    if (key === 'agentSteps' && Array.isArray(val)) {
      out[key] = val.slice(-MAX_AGENT_STEPS).map(sanitizeAgentStep);
      continue;
    }
    const cleaned = sanitizeValue(val, MAX_TEXT_LEN);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}
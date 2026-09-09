import type { AgentStep } from '../../../../shared/types';

/**
 * 从 agentSteps 中提取所有 subagent 运行（流内卡片数据源）。
 *
 * 与 piQuestionnaireParser 同容错策略：
 * - 流式期间 agent_tool_result.result 是完整 JSON 信封（details.results 为结构化行）；
 * - 水合后 result 退化为纯文本摘要（服务端 session-hydrate 截断）→ 走 resultText 回退；
 * - 纯管理动作（list/status/doctor/…）无结果不产卡。
 */

/** 单个 subagent 运行的结构化解析结果。 */
export interface ParsedSubagentRun {
  toolCallId: string;
  /** 子代理名（scout / reviewer / worker …） */
  agent: string;
  /** 管理动作（list / status / doctor …）；普通运行无此字段 */
  action?: string;
  /** 是否后台运行（args.async === true 或 details.background） */
  background: boolean;
  /** 是否已有工具结果（水合后必有；流式中为 tool_result 是否到达） */
  hasResult: boolean;
  /** 流式完整结构（仅流式期解析出 details 时存在） */
  details?: {
    results?: SubagentResultRow[];
    background?: boolean;
    asyncId?: string;
  };
  /** 结果文本摘要（水合后唯一来源；流式期兜底） */
  resultText?: string;
}

/** 单个子代理结果行（安全字段投影）。 */
export interface SubagentResultRow {
  agent?: string;
  exitCode?: number;
  status?: string;
  usage?: { total?: number };
}

/** 管理动作集合：这些 action 不产生「运行」，仅当有结果时才渲染（无结果跳过）。 */
const MANAGEMENT_ACTION_EXACT = new Set([
  'list',
  'get',
  'models',
  'children.list',
  'guide',
  'validate',
  'doctor',
  'status',
  'dismiss',
  'debug.run',
  'create',
  'update',
  'delete',
  'eject',
  'disable',
  'enable',
  'reset',
  'interrupt',
  'resume',
  'steer',
  'stop',
]);
const MANAGEMENT_ACTION_PREFIXES = [
  'watchdog.',
  'schedule.',
  'mission.',
  'refine.',
  'inspector.',
  'project.',
  'lane.',
  'worktree.',
  'grant-',
];

function isManagementAction(action: string | undefined): boolean {
  if (!action) return false;
  if (MANAGEMENT_ACTION_EXACT.has(action)) return true;
  return MANAGEMENT_ACTION_PREFIXES.some((p) => action.startsWith(p));
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseResultDetails(raw: string | undefined): {
  details?: ParsedSubagentRun['details'];
  resultText?: string;
} {
  if (!raw || raw === 'null') return { resultText: raw };
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return { resultText: trimmed };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { resultText: trimmed }; // 半截 JSON：按文本回退
  }

  const detailsRaw = parsed.details as Record<string, unknown> | undefined;
  if (!detailsRaw || typeof detailsRaw !== 'object' || Array.isArray(detailsRaw)) {
    // 无 details：从 content 文本回退
    const contentText = Array.isArray(parsed.content)
      ? parsed.content
          .filter((b): b is { type?: string; text?: string } => !!b && typeof b === 'object')
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text ?? '')
          .join('\n')
      : '';
    return { resultText: contentText || trimmed };
  }

  const results = Array.isArray(detailsRaw.results)
    ? (detailsRaw.results as unknown[]).map(normalizeResultRow).filter((r): r is SubagentResultRow => r !== null)
    : [];
  const details: ParsedSubagentRun['details'] = {
    ...(results.length > 0 ? { results } : {}),
    ...(detailsRaw.background === true ? { background: true } : {}),
    ...(typeof detailsRaw.asyncId === 'string' && detailsRaw.asyncId
      ? { asyncId: detailsRaw.asyncId }
      : {}),
  };
  if (Object.keys(details).length === 0) {
    // 空 details（如管理动作纯文本结果）→ 文本回退
    const contentText = Array.isArray(parsed.content)
      ? parsed.content
          .filter((b): b is { type?: string; text?: string } => !!b && typeof b === 'object')
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text ?? '')
          .join('\n')
      : '';
    return { resultText: contentText || trimmed };
  }
  return { details };
}

function normalizeResultRow(raw: unknown): SubagentResultRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const row: SubagentResultRow = {};
  if (typeof r.agent === 'string') row.agent = r.agent;
  if (typeof r.exitCode === 'number') row.exitCode = r.exitCode;
  if (typeof r.status === 'string') row.status = r.status;
  if (r.usage && typeof r.usage === 'object' && !Array.isArray(r.usage)) {
    const usage = r.usage as Record<string, unknown>;
    if (typeof usage.total === 'number') row.usage = { total: usage.total };
  }
  if (!row.agent && row.exitCode === undefined && row.status === undefined) return null;
  return row;
}

/** 从 agentSteps 提取全部 subagent 运行（按步骤出现顺序）。 */
export function parseSubagentRuns(steps?: AgentStep[]): ParsedSubagentRun[] {
  if (!steps || !Array.isArray(steps) || steps.length === 0) return [];

  const runs: ParsedSubagentRun[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || step.type !== 'agent_tool_call') continue;
    if (step.name !== 'subagent') continue;

    const toolCallId = step.id || `subagent-${i}`;
    const args = parseArgs(step.arguments);
    const agent = typeof args.agent === 'string' ? args.agent : '';
    const action = typeof args.action === 'string' && args.action ? args.action : undefined;
    const asyncRequested = args.async === true;

    // 配对同 id 的 tool_result（容错：无 id 时按同 name 取最近的）
    const resultStep = steps.find(
      (s) => s && s.type === 'agent_tool_result' && (s.id === toolCallId || (!s.id && s.name === 'subagent'))
    );

    const { details, resultText } = parseResultDetails(resultStep?.result);
    const hasResult = !!resultStep;
    const background = details?.background === true || asyncRequested;

    // 纯管理动作且无结果 → 跳过（无展示价值）
    if (isManagementAction(action) && !hasResult) continue;

    runs.push({
      toolCallId,
      agent: agent || 'subagent',
      ...(action ? { action } : {}),
      background,
      hasResult,
      ...(details ? { details } : {}),
      ...(resultText ? { resultText } : {}),
    });
  }
  return runs;
}

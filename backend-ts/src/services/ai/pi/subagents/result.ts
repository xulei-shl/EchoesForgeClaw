/**
 * subagent 工具结果 → 运行总结面板（WidgetDraft）生产者。
 *
 * 工具结果信封（tool_result.result JSON）形态（以安装版本为准，本文件为解析契约）：
 *   { content: [{type:"text",text}], details: { mode, runId, results: [{agent, exitCode,
 *     status, usage:{input,output,total}, ...}], background?, asyncId? } }
 *
 * - 前台/后台统一由「结果」驱动：有 results → 逐行罗列；仅后台启动（无 results）→ 单行提示；
 * - 纯管理动作（mode="management" 且无 background）→ null（不产卡，无展示价值）；
 * - 字段解析属生产者内部实现，扩展包升级只影响本文件。
 */
import type { ToolCallInfo, ToolResultInfo, WidgetDraft } from '../../pi-widgets.js';

/** subagent 运行总结面板的 widget key / label。 */
export const SUBAGENT_RESULT_WIDGET_KEY = 'subagent-result';
export const SUBAGENT_RESULT_WIDGET_LABEL = '子代理运行';

interface SubagentResultRow {
  agent?: unknown;
  exitCode?: unknown;
  status?: unknown;
  usage?: { total?: unknown; input?: unknown; output?: unknown } | null;
}

interface SubagentResultDetails {
  mode?: unknown;
  background?: unknown;
  asyncId?: unknown;
  results?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function fmtTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`;
  return String(Math.max(0, Math.round(total)));
}

function rowStatusIcon(row: SubagentResultRow): string {
  const status = str(row.status);
  if (status === 'running') return '◐';
  if (status === 'complete' || status === 'completed') return '✓';
  if (row.exitCode !== 0 && row.exitCode !== undefined && row.exitCode !== null) return '✗';
  if (status === 'failed' || status === 'rejected') return '✗';
  if (status) return '·';
  return '·';
}

function parseDetails(result: string): { details: SubagentResultDetails; contentText: string } | null {
  if (!result || result === 'null') return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const details = isRecord(parsed.details) ? (parsed.details as SubagentResultDetails) : {};
  let contentText = '';
  if (Array.isArray(parsed.content)) {
    for (const block of parsed.content) {
      if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
        contentText += block.text;
      }
    }
  }
  return { details, contentText };
}

/** subagent 工具结果 → 运行总结面板；无结果/管理动作 → null。 */
export function subagentWidgetProducer(call: ToolCallInfo, result?: ToolResultInfo): WidgetDraft | null {
  if (!result) return null;
  const parsed = parseDetails(result.result);
  if (!parsed) return null;
  const { details } = parsed;
  // 后台运行判定：显式 background 或 asyncId 存在（扩展 async 启动结果无 background 字段，
  // 以 asyncId/asyncDir 标识分离运行；冒烟实测契约见 tmp-subagents-smoke.ts）
  const asyncId = typeof details.asyncId === 'string' && details.asyncId ? details.asyncId : undefined;
  const background = details.background === true || asyncId !== undefined;
  const results = Array.isArray(details.results) ? (details.results as SubagentResultRow[]) : [];

  // 纯管理动作（list/status/doctor/…）：无 results 且非后台 → 不产卡
  if (!background && results.length === 0) return null;

  const lines: string[] = [];
  if (background && results.length === 0) {
    lines.push(`后台运行已启动${asyncId ? ` · ${asyncId}` : ''}`);
  }
  for (const row of results) {
    const agent = str(row.agent) || 'subagent';
    const icon = rowStatusIcon(row);
    const usage = isRecord(row.usage) && typeof row.usage.total === 'number' ? row.usage.total : NaN;
    const tokens = Number.isFinite(usage) && usage >= 0 ? ` · ${fmtTokens(Math.floor(usage))} tokens` : '';
    lines.push(` ${icon} ${agent}${tokens}`);
  }
  if (lines.length === 0) return null;

  return {
    key: SUBAGENT_RESULT_WIDGET_KEY,
    label: SUBAGENT_RESULT_WIDGET_LABEL,
    lines,
    placement: 'aboveEditor',
    data: {
      mode: str(details.mode) || 'single',
      background,
      ...(asyncId ? { asyncId } : {}),
    },
  };
}

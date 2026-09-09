import React, { memo, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Select } from '../../../../shared/components/ui/Select';
import { fetchFastClawAgentList, type FastClawAgentList } from '../infra/fastclawAgents';

/**
 * 「Agent」下拉字段：全部启用 FastClaw Agent 列表，留空 = 节点配置绑定的默认 Agent。
 * 与 ModelOverrideField 对称（key 仅服务端使用，前端只拿展示字段）；目前仅 AI 对话节点使用，
 * 后续其他节点要支持 Agent 覆盖时直接复用。
 */
export interface AgentOverrideFieldProps {
  /** 当前选中的 FastClaw Agent 配置 id（undefined = 跟随节点配置） */
  value?: number;
  onChange: (value?: number) => void;
  /** 节点配置 id（解析节点绑定 Agent 作为「默认」项） */
  configId: number;
  /** 对话已开始 / 生成中等场景禁用 */
  disabled?: boolean;
}

const AgentOverrideFieldInner: React.FC<AgentOverrideFieldProps> = ({
  value,
  onChange,
  configId,
  disabled = false,
}) => {
  const [agentList, setAgentList] = useState<FastClawAgentList | null>(null);
  const [agentListFailed, setAgentListFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAgentList(null);
    setAgentListFailed(false);
    fetchFastClawAgentList(configId)
      .then((data) => {
        if (!cancelled) setAgentList(data);
      })
      .catch(() => {
        if (!cancelled) setAgentListFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [configId]);

  // 列表加载失败：Agent 覆盖按 id 选择，无手动输入回退，展示错误提示
  if (agentListFailed) {
    return (
      <div className="rounded-md border border-dashed border-error/30 px-2 py-1.5 text-[10px] text-error/80 font-sans">
        Agent 列表加载失败，请稍后重试
      </div>
    );
  }

  if (!agentList) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-ink-faint font-sans py-1">
        <Loader2 size={10} className="animate-spin" />
        正在加载 Agent 列表…
      </div>
    );
  }

  const defaultLabel = agentList.default_agent
    ? agentList.default_agent.agent_name || agentList.default_agent.name
    : '节点配置';

  const agentOptions = [
    { value: '', label: `默认：${defaultLabel}` },
    ...agentList.agents
      .filter((a) => agentList.default_agent == null || a.id !== agentList.default_agent.id)
      .map((a) => ({ value: String(a.id), label: a.agent_name || a.name })),
  ];
  // 当前已选但不在列表中的 agent（如被停用后）也保留可回选
  if (value != null && !agentList.agents.some((a) => a.id === value)) {
    agentOptions.push({ value: String(value), label: `Agent #${value}` });
  }

  return (
    <Select
      size="sm"
      value={String(value ?? '')}
      disabled={disabled}
      options={agentOptions}
      onChange={(val) => onChange(val ? Number(val) : undefined)}
    />
  );
};

export const AgentOverrideField = memo(AgentOverrideFieldInner);
AgentOverrideField.displayName = 'AgentOverrideField';
export default AgentOverrideField;

import React, { memo, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Select } from '../../../platform/components/ui/Select';
import { fetchLLMModelList, type LLMModelList } from '../llmModels';

/**
 * 「模型」下拉字段：候选 = admin llm-configs 已配置的模型名，留空 = 节点配置默认模型。
 * AI 对话 / 图片分析 / 提示词生成 / 图像生成节点的设置弹层共用，避免重复实现拉取/加载/失败回退逻辑。
 */
export interface ModelOverrideFieldProps {
  /** 当前选中的模型名（undefined = 跟随节点配置） */
  value?: string;
  onChange: (value?: string) => void;
  /** 节点配置 id（拉取服务商模型列表用） */
  configId: number;
  /** 生成中 / 有下级节点等场景禁用 */
  disabled?: boolean;
}

const ModelOverrideFieldInner: React.FC<ModelOverrideFieldProps> = ({
  value,
  onChange,
  configId,
  disabled = false,
}) => {
  const [modelList, setModelList] = useState<LLMModelList | null>(null);
  const [modelListFailed, setModelListFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setModelList(null);
    setModelListFailed(false);
    fetchLLMModelList(configId)
      .then((data) => {
        if (!cancelled) setModelList(data);
      })
      .catch(() => {
        if (!cancelled) setModelListFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [configId]);

  const controlClass =
    'w-full min-h-[28px] rounded-md border border-dashed border-paper-grid px-2 py-1 text-[11px] font-sans text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors disabled:opacity-50';

  // 上游未实现 /models（或不可达）：回退手动输入
  if (modelListFailed) {
    return (
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        disabled={disabled}
        placeholder="自定义模型名（留空 = 默认）"
        className={`${controlClass} bg-transparent placeholder:text-ink-faint`}
      />
    );
  }

  if (!modelList) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-ink-faint font-sans py-1">
        <Loader2 size={10} className="animate-spin" />
        正在加载模型列表…
      </div>
    );
  }

  const modelOptions = [
    { value: '', label: `默认：${modelList.default_model || '节点配置模型'}` },
    ...modelList.models
      .filter((m) => m && m !== modelList.default_model)
      .map((m) => ({ value: m, label: m })),
  ];
  // 当前已选但不在列表中的模型（如服务商列表变化后）也保留可回选
  if (value && value !== modelList.default_model && !modelList.models.includes(value)) {
    modelOptions.push({ value, label: value });
  }

  return (
    <Select
      size="sm"
      value={value ?? ''}
      disabled={disabled}
      options={modelOptions}
      onChange={(val) => onChange(val || undefined)}
    />
  );
};

export const ModelOverrideField = memo(ModelOverrideFieldInner);
ModelOverrideField.displayName = 'ModelOverrideField';
export default ModelOverrideField;

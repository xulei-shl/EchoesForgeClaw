import React, { memo, useEffect, useState } from 'react';
import { CloudSun, Loader2, Search, AlertTriangle, Link2 } from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { NODE_COLORS } from '../nodeTypes';

export interface WeatherNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 手动输入的城市（写入 data.city） */
  city?: string;
  /** 连线上级文本节点提供的城市（连线即输入，优先于手动输入；为空则不提示） */
  upstreamCity?: string;
  /** 查询结果（天气文本，写入 data.output 作为对外输出） */
  output?: string;
  isGenerating?: boolean;
  error?: string | null;
  /** 提交查询（city 可为空 = 自动定位；具体城市由页面合并上游/手动输入） */
  onFetch?: (id: string, city: string) => void;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  /** 卡片底部「+」插槽 */
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const WeatherNodeInner: React.FC<WeatherNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  city = '',
  upstreamCity = '',
  output = '',
  isGenerating = false,
  error = null,
  onFetch,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
}) => {
  const [cityInput, setCityInput] = useState(city);

  // 外部内容变化（撤销/重做/历史恢复）时同步草稿城市
  useEffect(() => {
    setCityInput(city);
  }, [city]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isGenerating) return;
    onFetch?.(id, cityInput.trim());
  };

  const hasUpstream = upstreamCity.trim().length > 0;

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '天气查询'}
      dotColor={NODE_COLORS.weather}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 460 }}
      className={isGenerating && !error ? 'transition-[box-shadow,border-color,opacity] duration-200 border-transparent' : ''}
      glowOverlay={isGenerating && !error ? <BeamGlow /> : undefined}
      showLeftAnchor
      showRightAnchor
      footer={footer}
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-3">
        {/* 查询表单：始终可见，便于重复查询 */}
        <form onSubmit={handleSubmit} className="shrink-0 space-y-1.5">
          <div className="flex gap-2">
            <input
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              placeholder="城市（如 beijing / 上海，留空自动定位）"
              disabled={isGenerating}
              className="flex-1 h-10 min-w-0 rounded-md border border-dashed border-paper-grid bg-transparent px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isGenerating}
              className="flex items-center justify-center w-10 h-10 shrink-0 rounded-md bg-accent text-paper hover:bg-accent-hover active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title="查询"
            >
              <Search size={15} strokeWidth={2} />
            </button>
          </div>
          {hasUpstream && (
            <p
              className="flex items-center gap-1 text-[11px] text-ink-faint font-sans"
              title="连线即输入：连线的文本节点内容将作为城市，优先于手动输入"
            >
              <Link2 size={11} strokeWidth={1.5} className="shrink-0" />
              已连线上级文本作为城市：{upstreamCity}
            </p>
          )}
        </form>

        {/* 结果 / 加载 / 错误区 */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          {isGenerating ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
              <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />
              <p className="text-xs font-serif text-accent">正在查询天气...</p>
            </div>
          ) : error ? (
            <div className="p-3 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
              <AlertTriangle size={14} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
              <p className="flex-1 min-w-0 text-[12px] text-error/90 leading-relaxed break-words font-sans">{error}</p>
            </div>
          ) : output.trim() ? (
            <div className="w-full min-w-0 font-sans text-sm leading-relaxed">
              <Streamdown
                plugins={{ cjk, code }}
                isAnimating={false}
                caret="block"
                linkSafety={{ enabled: false }}
              >
                {normalizeMarkdown(output)}
              </Streamdown>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[140px]">
              <div className="w-14 h-14 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
                <CloudSun size={24} strokeWidth={1.5} />
              </div>
              <p className="text-sm font-serif text-ink-light">输入城市查询当前天气</p>
              <p className="text-xs text-ink-faint font-sans">可连线文本节点传入城市；留空按 IP 自动定位</p>
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const WeatherNode = memo(WeatherNodeInner);
WeatherNode.displayName = 'WeatherNode';
export default WeatherNode;

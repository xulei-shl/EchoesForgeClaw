import React, { memo, useEffect, useState, useCallback } from 'react';
import { CloudSun, Loader2, Search, AlertTriangle, Link2, MapPin, X } from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
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

/** 常用城市快捷预设 */
const POPULAR_CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都'];

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

  const hasUpstream = upstreamCity.trim().length > 0;
  // 实际生效的查询目标城市：优先上级连线，其次手动输入
  const effectiveCity = hasUpstream ? upstreamCity.trim() : cityInput.trim();

  const handleQuery = useCallback(
    (targetCity?: string) => {
      if (isGenerating) return;
      const c = targetCity !== undefined ? targetCity.trim() : effectiveCity;
      onFetch?.(id, c);
    },
    [effectiveCity, id, isGenerating, onFetch]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleQuery();
  };

  const handleSelectPopularCity = (c: string) => {
    setCityInput(c);
    handleQuery(c);
  };

  const renderActionBar = () => {
    if (isGenerating) return undefined;
    return (
      <NodeActionBar>
        {(output.trim() || error) && (
          <NodeActionBar.Retry
            onClick={() => handleQuery()}
            error={!!error}
            tooltip={error ? '重试查询' : '重新获取天气'}
          />
        )}
        {output.trim() && (
          <NodeActionBar.Copy
            text={output}
            tooltip="复制天气内容"
            toastMessage="天气信息已复制到剪贴板"
          />
        )}
      </NodeActionBar>
    );
  };

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
      actionBar={renderActionBar()}
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-3">
        {/* 查询控制区：根据是否有上游连线自适应 */}
        <div className="shrink-0 space-y-2">
          {hasUpstream ? (
            /* 连线即输入模式：高光提示卡片 */
            <div className="flex items-center justify-between p-2.5 rounded-md border border-accent/40 bg-accent/5">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center shrink-0 text-accent">
                  <Link2 size={13} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-serif text-accent uppercase tracking-wider">上级连线输入城市</div>
                  <div className="text-sm font-medium text-ink truncate font-mono">{upstreamCity}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQuery(upstreamCity)}
                disabled={isGenerating}
                title="重新查询此城市天气"
                className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Search size={12} strokeWidth={2} />
                查询
              </button>
            </div>
          ) : (
            /* 手动输入模式：输入框 + 快捷城市胶囊 */
            <>
              <form onSubmit={handleSubmit} className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <input
                    value={cityInput}
                    onChange={(e) => setCityInput(e.target.value)}
                    placeholder="输入城市（留空按网络 IP 自动定位）"
                    disabled={isGenerating}
                    className="w-full h-10 rounded-md border border-dashed border-paper-grid bg-transparent pl-3 pr-8 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
                  />
                  {cityInput && !isGenerating && (
                    <button
                      type="button"
                      onClick={() => setCityInput('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                      title="清除"
                    >
                      <X size={13} strokeWidth={2} />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={isGenerating}
                  title="查询天气"
                  className="flex items-center justify-center w-10 h-10 shrink-0 rounded-md bg-accent text-paper hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Search size={15} strokeWidth={2} />
                </button>
              </form>

              {/* 常用城市胶囊 */}
              <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5 select-none">
                <span className="text-[11px] font-serif text-ink-faint shrink-0 mr-0.5">热门：</span>
                {POPULAR_CITIES.map((c) => {
                  const isSelected = cityInput.trim() === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={isGenerating}
                      onClick={() => handleSelectPopularCity(c)}
                      className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-sans border transition-all active:scale-[0.96] ${
                        isSelected
                          ? 'border-accent/60 bg-accent/10 text-accent font-medium'
                          : 'border-dashed border-paper-grid text-ink-light hover:border-paper-grid hover:text-ink hover:bg-paper-grid/20'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* 结果 / 加载 / 错误区 */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          {isGenerating ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[160px]">
              <div className="w-12 h-12 rounded-full border border-dashed border-accent/40 bg-accent/5 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-serif text-accent font-medium">正在观测气象与云图...</p>
                <p className="text-[11px] font-mono text-ink-faint">
                  {effectiveCity ? `目标：${effectiveCity}` : '正在根据 IP 自动定位'}
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="p-3.5 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
              <AlertTriangle size={15} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-1.5 font-sans">
                <p className="text-[12px] text-error/90 leading-relaxed break-words">{error}</p>
                <button
                  type="button"
                  onClick={() => handleQuery()}
                  className="inline-flex items-center text-[11px] text-error font-medium hover:underline active:scale-[0.96] transition-transform"
                >
                  重试查询
                </button>
              </div>
            </div>
          ) : output.trim() ? (
            <div className="w-full min-w-0 font-mono text-sm leading-relaxed p-3 rounded-md bg-paper/60 border border-dashed border-paper-grid">
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
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[180px]">
              <div className="w-14 h-14 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
                <CloudSun size={24} strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-serif text-ink-light">输入城市查询实时天气与天气预报</p>
                <p className="text-xs text-ink-faint font-sans">可连线上级文本节点传入城市；留空按网络 IP 自动定位</p>
              </div>
              <button
                type="button"
                onClick={() => handleQuery('')}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-serif text-accent border border-dashed border-accent/40 bg-accent/5 hover:bg-accent/10 active:scale-[0.96] transition-all"
              >
                <MapPin size={13} strokeWidth={1.75} />
                自动定位查询天气
              </button>
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


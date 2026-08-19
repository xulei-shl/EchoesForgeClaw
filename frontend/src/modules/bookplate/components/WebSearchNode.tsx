import React, { memo, useEffect, useState, useCallback, useMemo } from 'react';
import { Search, Loader2, AlertTriangle, Link2, Shuffle, Globe, Trash2 } from 'lucide-react';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { NODE_COLORS } from '../nodeTypes';

export type WebSearchSource = 'random' | 'zhihu_global' | 'tavily' | 'exa' | 'anysearch' | 'doubao';

export interface WebSearchRequest {
  query: string;
  count: number;
  source: WebSearchSource;
}

export interface WebSearchTabData {
  output: string;
  usedSource: string;
  error: string | null;
  isGenerating: boolean;
  count?: number;
}

export const SOURCE_OPTIONS: { value: WebSearchSource; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { value: 'random', label: '随机', icon: Shuffle },
  { value: 'zhihu_global', label: '知乎全网', icon: Globe },
  { value: 'tavily', label: 'Tavily', icon: Globe },
  { value: 'exa', label: 'Exa', icon: Globe },
  { value: 'anysearch', label: 'AnySearch', icon: Globe },
  { value: 'doubao', label: '豆包', icon: Globe },
];

export const SOURCE_LABEL: Record<string, string> = {
  zhihu_global: '知乎全网搜索',
  tavily: 'Tavily 搜索',
  exa: 'Exa 搜索',
  anysearch: 'AnySearch 搜索',
  doubao: '豆包搜索',
};

const COUNT_OPTIONS: SelectOption[] = [5, 10, 15, 20].map((v) => ({ label: `${v} 条`, value: String(v) }));

const TAB_INITIAL: WebSearchTabData = { output: '', usedSource: '', error: null, isGenerating: false, count: 5 };

export interface WebSearchNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  upstreamQuery?: string;
  source?: WebSearchSource;
  tabData?: Partial<Record<WebSearchSource, WebSearchTabData>>;
  output?: string;
  isGenerating?: boolean;
  error?: string | null;
  onFetch?: (id: string, payload: WebSearchRequest) => void;
  onUpdateEditor?: (id: string, patch: Record<string, any>) => void;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
}

const WebSearchNodeInner: React.FC<WebSearchNodeProps> = ({
  id, initialX, initialY, title,
  upstreamQuery = '', source = 'random',
  tabData = {},
  onFetch, onUpdateEditor, onRemove, onPositionChange, onSizeChange, onDrag,
  footer, onContextMenu, hasDownstream,
}) => {
  const [queryInput, setQueryInput] = useState('');
  const [activeSource, setActiveSource] = useState<WebSearchSource>(source);

  useEffect(() => { setActiveSource(source); }, [source]);

  const currentTab = useMemo<WebSearchTabData>(
    () => ({ ...TAB_INITIAL, ...tabData[activeSource] }),
    [tabData, activeSource],
  );

  const hasUpstream = upstreamQuery.trim().length > 0;
  const effectiveQuery = hasUpstream ? upstreamQuery.trim() : queryInput.trim();
  const canSubmit = effectiveQuery.length > 0 && !currentTab.isGenerating && !hasDownstream;

  const handleSourceChange = (src: WebSearchSource) => {
    setActiveSource(src);
    onUpdateEditor?.(id, { source: src });
  };

  const handleSearch = useCallback(() => {
    if (currentTab.isGenerating || hasDownstream || !effectiveQuery) return;
    onFetch?.(id, { query: effectiveQuery, count: currentTab.count ?? 5, source: activeSource });
  }, [activeSource, currentTab.count, currentTab.isGenerating, effectiveQuery, hasDownstream, id, onFetch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch();
  };

  const handleClearCurrent = () => {
    if (hasDownstream || currentTab.isGenerating) return;
    const nextTab = { ...TAB_INITIAL };
    const nextTabData = { ...tabData, [activeSource]: nextTab };
    onUpdateEditor?.(id, {
      tabData: nextTabData,
      output: '',
      error: null,
    });
  };

  const renderActionBar = () => {
    if (currentTab.isGenerating) return undefined;
    return (
      <NodeActionBar>
        {(currentTab.output.trim() || currentTab.error) && (
          <NodeActionBar.Retry
            onClick={handleSearch}
            error={!!currentTab.error}
            hasDownstream={hasDownstream}
            tooltip={currentTab.error ? '重试检索' : '重新检索'}
          />
        )}
        {currentTab.output.trim() && (
          <NodeActionBar.Copy
            text={currentTab.output}
            tooltip="复制检索结果"
            toastMessage="检索结果已复制到剪贴板"
          />
        )}
      </NodeActionBar>
    );
  };

  const sourceIcon = (src: WebSearchSource) => {
    if (src === 'random') return <Shuffle size={12} strokeWidth={2} />;
    return <Globe size={12} strokeWidth={2} />;
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '网络搜索'}
      dotColor={NODE_COLORS.web_search}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 460, height: 560 }}
      className={currentTab.isGenerating && !currentTab.error ? 'transition-[box-shadow,border-color,opacity] duration-200 border-transparent' : ''}
      glowOverlay={currentTab.isGenerating && !currentTab.error ? <BeamGlow /> : undefined}
      showLeftAnchor
      showRightAnchor
      footer={footer}
      actionBar={renderActionBar()}
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-3">
        {hasUpstream ? (
          <div className="space-y-2 shrink-0">
            <div className="flex items-center justify-between p-2.5 rounded-md border border-accent/40 bg-accent/5">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center shrink-0 text-accent">
                  <Link2 size={13} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-serif text-accent uppercase tracking-wider">上级连线传入关键词</div>
                  <div className="text-sm font-medium text-ink truncate font-mono max-w-[200px]">{upstreamQuery}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSearch}
                disabled={!canSubmit}
                title={hasDownstream ? '有下级节点，不可修改输出' : '以连线内容检索'}
                className="flex items-center justify-center gap-1 px-2.5 h-7 shrink-0 rounded-md bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-transform disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
              >
                <Search size={11} strokeWidth={2} />
                <span>检索</span>
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-sans text-ink-faint shrink-0">返回数量</span>
              <Select
                value={String(currentTab.count ?? 5)}
                onChange={(v) => onUpdateEditor?.(id, { tabData: { ...tabData, [activeSource]: { ...currentTab, count: Number(v) } } })}
                options={COUNT_OPTIONS}
                disabled={currentTab.isGenerating}
                size="sm"
                className="w-28"
              />
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex gap-1.5 shrink-0">
            <div className="relative flex-1 min-w-0">
              <input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="输入关键词，多源网络检索…"
                disabled={currentTab.isGenerating}
                className="w-full h-8 rounded-lg border border-dashed border-paper-grid bg-transparent pl-2.5 pr-8 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
              />
              {queryInput && !currentTab.isGenerating && (
                <button
                  type="button"
                  onClick={() => setQueryInput('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                  title="清空输入"
                  aria-label="清空输入"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="3" y1="3" x2="9" y2="9" /><line x1="9" y1="3" x2="3" y2="9" />
                  </svg>
                </button>
              )}
            </div>
            <Select
              value={String(currentTab.count ?? 5)}
              onChange={(v) => onUpdateEditor?.(id, { tabData: { ...tabData, [activeSource]: { ...currentTab, count: Number(v) } } })}
              options={COUNT_OPTIONS}
              disabled={currentTab.isGenerating}
              size="sm"
              className="w-[76px] shrink-0"
            />
            <button
              type="submit"
              disabled={!canSubmit}
              title="回车直接检索"
              className="flex items-center justify-center w-8 h-8 shrink-0 rounded-lg bg-accent text-paper hover:bg-accent-hover active:scale-[0.96] transition-transform disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
            >
              <Search size={13} strokeWidth={2} />
            </button>
          </form>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex-1 flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5">
            {SOURCE_OPTIONS.map((opt) => {
              const isActive = activeSource === opt.value;
              const tab = tabData[opt.value];
              const hasResult = tab && (tab.output.trim() || tab.error);
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSourceChange(opt.value)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-sans border transition-all active:scale-[0.96] shrink-0 ${
                    isActive
                      ? 'border-accent/60 bg-accent/10 text-accent font-medium'
                      : 'border-dashed border-paper-grid text-ink-light hover:border-paper-grid hover:text-ink hover:bg-paper-grid/20'
                  }`}
                >
                  <Icon size={12} strokeWidth={2} />
                  {opt.label}
                  {hasResult && !isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent/40" />
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={currentTab.isGenerating || !effectiveQuery || hasDownstream}
            title={hasDownstream ? '有下级节点，不可修改输出' : '检索'}
            className="flex items-center justify-center gap-1.5 px-3 h-7 shrink-0 rounded-md bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
          >
            {currentTab.isGenerating ? (
              <Loader2 size={12} className="animate-spin" strokeWidth={2} />
            ) : (
              <Search size={12} strokeWidth={2} />
            )}
            {currentTab.isGenerating ? '检索中...' : '检索'}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          {currentTab.isGenerating ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[120px]">
              <div className="w-12 h-12 rounded-full border border-dashed border-accent/40 bg-accent/5 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-serif text-accent font-medium">正在检索...</p>
                <p className="text-[11px] font-mono text-ink-faint">
                  {activeSource === 'random' ? '随机选择检索源' : SOURCE_LABEL[activeSource] ?? activeSource}
                </p>
              </div>
            </div>
          ) : currentTab.error ? (
            <div className="p-3.5 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
              <AlertTriangle size={15} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-1.5 font-sans">
                <p className="text-[12px] text-error/90 leading-relaxed break-words">{currentTab.error}</p>
                <button type="button" onClick={handleSearch}
                  className="inline-flex items-center text-[11px] text-error font-medium hover:underline active:scale-[0.96] transition-transform">
                  重试检索
                </button>
              </div>
            </div>
          ) : currentTab.output.trim() ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-ink-faint font-sans">
                <span>检索源：{SOURCE_LABEL[currentTab.usedSource] ?? currentTab.usedSource}</span>
                {!hasDownstream && (
                  <button type="button" onClick={handleClearCurrent}
                    className="inline-flex items-center gap-1 text-ink-faint hover:text-error transition-colors">
                    <Trash2 size={11} strokeWidth={1.5} />
                    清空
                  </button>
                )}
              </div>
              <div className="w-full min-w-0 font-mono text-sm leading-relaxed p-3 rounded-md bg-paper/60 border border-dashed border-paper-grid">
                <Streamdown plugins={{ cjk, code }} isAnimating={false} caret="block" linkSafety={{ enabled: false }}>
                  {normalizeMarkdown(currentTab.output)}
                </Streamdown>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[120px]">
              <div className="w-14 h-14 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
                <Globe size={24} strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-serif text-ink-light">输入关键词开始检索</p>
                <p className="text-xs text-ink-faint font-sans">可选随机源或指定检索源，各源结果独立保存</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const WebSearchNode = memo(WebSearchNodeInner);
WebSearchNode.displayName = 'WebSearchNode';
export default WebSearchNode;
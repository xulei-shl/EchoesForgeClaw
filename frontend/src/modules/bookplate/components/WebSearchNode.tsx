import React, { memo, useEffect, useState, useCallback, useMemo } from 'react';
import { Search, Loader2, Shuffle, Globe } from 'lucide-react';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { NODE_COLORS } from '../nodeTypes';
import {
  UpstreamLinkCard,
  SearchNodeLoadingView,
  SearchNodeErrorView,
  SearchNodeEmptyView,
} from './common/SearchNodeScaffold';

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

export const SOURCE_OPTIONS: {
  value: WebSearchSource;
  label: string;
  fullName: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}[] = [
  { value: 'random', label: '随机', fullName: '随机检索源', icon: Shuffle },
  { value: 'zhihu_global', label: '知乎', fullName: '知乎全网搜索', icon: Globe },
  { value: 'tavily', label: 'Tavily', fullName: 'Tavily 搜索', icon: Globe },
  { value: 'exa', label: 'Exa', fullName: 'Exa 搜索', icon: Globe },
  { value: 'anysearch', label: 'Any', fullName: 'AnySearch 搜索', icon: Globe },
  { value: 'doubao', label: '豆包', fullName: '豆包搜索', icon: Globe },
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
}

const WebSearchNodeInner: React.FC<WebSearchNodeProps> = ({
  id, initialX, initialY, title,
  upstreamQuery = '', source = 'random',
  tabData = {},
  onFetch, onUpdateEditor, onRemove, onPositionChange, onSizeChange, onDrag,
  footer, onContextMenu,
}) => {
  const { showToast } = useFeedback();
  const [queryInput, setQueryInput] = useState('');
  const [activeSource, setActiveSource] = useState<WebSearchSource>(source);

  useEffect(() => { setActiveSource(source); }, [source]);

  const currentTab = useMemo<WebSearchTabData>(
    () => ({ ...TAB_INITIAL, ...tabData[activeSource] }),
    [tabData, activeSource],
  );

  const hasUpstream = upstreamQuery.trim().length > 0;
  const effectiveQuery = hasUpstream ? upstreamQuery.trim() : queryInput.trim();
  const canSubmit = effectiveQuery.length > 0 && !currentTab.isGenerating;

  /** 切换检索源：同步将目标 Tab 缓存的数据推送至 node.data，使下游节点实时联动 */
  const handleSourceChange = (src: WebSearchSource) => {
    if (src === activeSource) return;
    setActiveSource(src);
    const targetTab = tabData[src] || TAB_INITIAL;
    onUpdateEditor?.(id, {
      source: src,
      output: targetTab.output || '',
      error: targetTab.error || null,
      isGenerating: !!targetTab.isGenerating,
    });
  };

  const handleSearch = useCallback(() => {
    if (currentTab.isGenerating || !effectiveQuery) return;
    onFetch?.(id, { query: effectiveQuery, count: currentTab.count ?? 5, source: activeSource });
  }, [activeSource, currentTab.count, currentTab.isGenerating, effectiveQuery, id, onFetch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch();
  };

  /** 清空当前 Tab 结果，并同步清空对外输出 */
  const handleClearCurrent = () => {
    if (currentTab.isGenerating) return;
    const nextTab = { ...TAB_INITIAL, count: currentTab.count ?? 5 };
    const nextTabData = { ...tabData, [activeSource]: nextTab };
    onUpdateEditor?.(id, {
      tabData: nextTabData,
      output: '',
      error: null,
    });
    showToast('已清空当前检索结果', { type: 'info' });
  };

  const renderActionBar = () => {
    if (currentTab.isGenerating) return undefined;
    const hasOutput = !!currentTab.output.trim();
    const hasError = !!currentTab.error;
    return (
      <NodeActionBar>
        {(hasOutput || hasError) && (
          <NodeActionBar.Retry
            onClick={handleSearch}
            error={hasError}
            tooltip={hasError ? '重试检索' : '重新检索'}
          />
        )}
        {hasOutput && (
          <NodeActionBar.Copy
            text={currentTab.output}
            tooltip="复制检索结果"
            toastMessage="检索结果已复制到剪贴板"
          />
        )}
        {(hasOutput || hasError) && (
          <NodeActionBar.Eraser
            onClick={handleClearCurrent}
            disabled={currentTab.isGenerating}
            tooltip="清空当前结果"
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
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2.5">
        {/* 顶部检索触发与参数栏 */}
        {hasUpstream ? (
          <UpstreamLinkCard
            label="上级传入关键词"
            content={upstreamQuery}
            onTrigger={handleSearch}
            disabled={!canSubmit}
            isLoading={currentTab.isGenerating}
            buttonText="检索"
            extraControls={
              <Select
                value={String(currentTab.count ?? 5)}
                onChange={(v) => onUpdateEditor?.(id, { tabData: { ...tabData, [activeSource]: { ...currentTab, count: Number(v) } } })}
                options={COUNT_OPTIONS}
                disabled={currentTab.isGenerating}
                size="sm"
                className="w-[72px]"
              />
            }
          />
        ) : (
          <form onSubmit={handleSubmit} className="flex items-center gap-1.5 shrink-0">
            <div className="relative flex-1 min-w-0">
              <input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="输入关键词，多源网络检索…"
                disabled={currentTab.isGenerating}
                className="w-full h-8 rounded-lg border border-dashed border-paper-grid bg-transparent pl-2.5 pr-7 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
              />
              {queryInput && !currentTab.isGenerating && (
                <button
                  type="button"
                  onClick={() => setQueryInput('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                  title="清空输入"
                  aria-label="清空输入"
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
              className="w-[74px] shrink-0"
            />
            <button
              type="submit"
              disabled={!canSubmit}
              title="点击或按 Enter 检索"
              className="flex items-center justify-center gap-1 px-2.5 h-8 shrink-0 rounded-lg bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-transform disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
            >
              {currentTab.isGenerating ? (
                <Loader2 size={12} className="animate-spin" strokeWidth={2} />
              ) : (
                <Search size={12} strokeWidth={2} />
              )}
              <span>{currentTab.isGenerating ? '检索中' : '检索'}</span>
            </button>
          </form>
        )}

        {/* 6 选项紧凑自适应分段控制器（无横向滚动条，各源平铺并显示缓存指示点） */}
        <div className="grid grid-cols-6 gap-1 p-1 rounded-lg border border-dashed border-paper-grid bg-paper-grid/10 shrink-0">
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
                title={opt.fullName}
                className={`relative flex items-center justify-center gap-1 py-1 px-1 rounded-md text-[11px] font-sans transition-all active:scale-[0.96] truncate ${
                  isActive
                    ? 'bg-paper text-accent font-medium border border-accent/40 shadow-xs'
                    : 'text-ink-light hover:text-ink hover:bg-paper/50 border border-transparent'
                }`}
              >
                <Icon size={11} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
                <span className="truncate">{opt.label}</span>
                {hasResult && !isActive && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent/60" />
                )}
              </button>
            );
          })}
        </div>

        {/* 内容/结果展示区域 */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          {currentTab.isGenerating ? (
            <SearchNodeLoadingView
              text="正在网络检索..."
              subtext={activeSource === 'random' ? '随机选择检索源' : SOURCE_LABEL[activeSource] ?? activeSource}
            />
          ) : currentTab.error ? (
            <SearchNodeErrorView
              error={currentTab.error}
              onRetry={handleSearch}
              retryText="重试检索"
            />
          ) : currentTab.output.trim() ? (
            <div className="space-y-1.5">
              <div className="flex items-center text-[11px] text-ink-faint font-sans pb-0.5">
                <span className="truncate">检索源：{SOURCE_LABEL[currentTab.usedSource] ?? currentTab.usedSource}</span>
              </div>
              <div className="w-full min-w-0 font-mono text-sm leading-relaxed p-3 rounded-md bg-paper/60 border border-dashed border-paper-grid">
                <Streamdown plugins={{ cjk, code }} isAnimating={false} caret="block" linkSafety={{ enabled: false }}>
                  {normalizeMarkdown(currentTab.output)}
                </Streamdown>
              </div>
            </div>
          ) : (
            <SearchNodeEmptyView
              icon={<Globe size={24} strokeWidth={1.5} />}
              title="输入关键词开始多源检索"
              description="支持随机源或指定各平台源，各源独立缓存"
            />
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const WebSearchNode = memo(WebSearchNodeInner);
WebSearchNode.displayName = 'WebSearchNode';
export default WebSearchNode;
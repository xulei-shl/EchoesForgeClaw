import React, { memo, useEffect, useState, useCallback } from 'react';
import {
  Search,
  Globe,
  Sparkles,
  Loader2,
  AlertTriangle,
  Link2,
  Copy,
  Check,
  X,
  MessagesSquare,
  SlidersHorizontal,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { NODE_COLORS } from '../nodeTypes';

/** 知乎检索的 3 类模式：站内搜索 / 全网搜索 / 直答 */
export type ZhihuSearchMode = 'zhihu' | 'global' | 'zhida';

/** 提交给页面的检索请求（页面合并上级连线文本后转发后端） */
export interface ZhihuSearchRequest {
  mode: ZhihuSearchMode;
  /** 检索关键词 / 直答问题（页面以连线上级文本优先覆盖） */
  query: string;
  /** 请求数量（zhihu 1-10 / global 1-20） */
  count: number;
  /** 全网搜索高级筛选表达式（仅 global） */
  filter: string;
  /** 全网搜索索引库：all / realtime / static（仅 global） */
  search_db: string;
  /** 直答模型档位（仅 zhida） */
  model: string;
}

export interface ZhihuSearchNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 当前检索模式（写入 data.mode） */
  mode?: ZhihuSearchMode;
  /** 手动输入的关键词 / 问题（写入 data.query） */
  query?: string;
  /** 请求数量（写入 data.count） */
  count?: number;
  /** 全网搜索高级筛选表达式（写入 data.filter） */
  filter?: string;
  /** 全网搜索索引库（写入 data.search_db） */
  search_db?: string;
  /** 直答模型档位（写入 data.model） */
  model?: string;
  /** 连线上级文本节点提供的关键词 / 问题（连线即输入，优先于手动输入） */
  upstreamQuery?: string;
  /** 检索结果（文本，写入 data.output 作为对外输出） */
  output?: string;
  isGenerating?: boolean;
  error?: string | null;
  /** 提交检索（具体关键词由页面合并上游/手动输入） */
  onFetch?: (id: string, payload: ZhihuSearchRequest) => void;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  /** 卡片底部「+」插槽 */
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 是否有下级节点关联（有下级时禁用影响输出的动作） */
  hasDownstream?: boolean;
}

/** 模式页签（交互入口：3 类检索一键切换） */
const MODE_TABS: { value: ZhihuSearchMode; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }[] = [
  { value: 'zhihu', label: '知乎搜索', icon: Search },
  { value: 'global', label: '全网搜索', icon: Globe },
  { value: 'zhida', label: '直答', icon: Sparkles },
];

/** 各模式请求数量上限（zhihu 10 / global 20，与后端一致） */
const MAX_COUNT: Record<ZhihuSearchMode, number> = { zhihu: 10, global: 20, zhida: 10 };

/** 数量下拉选项（按模式上限提供常用档位） */
const COUNT_OPTIONS: Record<Exclude<ZhihuSearchMode, 'zhida'>, SelectOption[]> = {
  zhihu: [3, 5, 10].map((v) => ({ label: `${v} 条`, value: String(v) })),
  global: [5, 10, 20].map((v) => ({ label: `${v} 条`, value: String(v) })),
};

/** 全网搜索索引库选项 */
const SEARCH_DB_OPTIONS: SelectOption[] = [
  { label: '全部索引库', value: 'all', title: '搜索全部内容（默认）' },
  { label: '实时库', value: 'realtime', title: '仅搜索实时索引' },
  { label: '静态库', value: 'static', title: '仅搜索静态索引' },
];

/** 直答模型档位选项 */
const ZHIDA_MODEL_OPTIONS: SelectOption[] = [
  { label: '快速回答', value: 'zhida-fast-1p5', title: '响应快，适合日常问答' },
  { label: '深度思考', value: 'zhida-thinking-1p5', title: '推理过程更充分，回答更严谨' },
  { label: '智能思考', value: 'zhida-agent', title: 'Agent 模式，可执行多步任务' },
];

const ZhihuSearchNodeInner: React.FC<ZhihuSearchNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  mode = 'zhihu',
  query = '',
  count = 5,
  filter = '',
  search_db = 'all',
  model = 'zhida-fast-1p5',
  upstreamQuery = '',
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
  hasDownstream,
}) => {
  // 编辑器草稿态（本地输入）；外部内容变化（撤销/重做/历史恢复）时同步
  const [modeInput, setModeInput] = useState<ZhihuSearchMode>(mode);
  const [queryInput, setQueryInput] = useState(query);
  const [countInput, setCountInput] = useState(count);
  const [filterInput, setFilterInput] = useState(filter);
  const [searchDbInput, setSearchDbInput] = useState(search_db);
  const [modelInput, setModelInput] = useState(model);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { showToast } = useFeedback();

  useEffect(() => setModeInput(mode), [mode]);
  useEffect(() => setQueryInput(query), [query]);
  useEffect(() => setCountInput(count), [count]);
  useEffect(() => setFilterInput(filter), [filter]);
  useEffect(() => setSearchDbInput(search_db), [search_db]);
  useEffect(() => setModelInput(model), [model]);

  const isZhida = modeInput === 'zhida';
  const hasUpstream = upstreamQuery.trim().length > 0;
  // 实际生效的关键词/问题：优先上级连线，其次手动输入
  const effectiveQuery = hasUpstream ? upstreamQuery.trim() : queryInput.trim();
  const canSubmit = effectiveQuery.length > 0 && !isGenerating && !hasDownstream;

  /** 切换模式：数量档位收敛到该模式上限（如 全网 20 → 知乎 10） */
  const switchMode = (m: ZhihuSearchMode) => {
    if (m === modeInput) return;
    setModeInput(m);
    setCountInput((c) => Math.min(c, MAX_COUNT[m]));
  };

  const handleQuery = useCallback(
    (targetQuery?: string) => {
      if (isGenerating || hasDownstream) return;
      const q = targetQuery !== undefined ? targetQuery.trim() : effectiveQuery;
      if (!q) return;
      onFetch?.(id, {
        mode: modeInput,
        query: q,
        count: Math.min(countInput, MAX_COUNT[modeInput]),
        filter: filterInput,
        search_db: searchDbInput,
        model: modelInput,
      });
    },
    [effectiveQuery, id, isGenerating, hasDownstream, modeInput, countInput, filterInput, searchDbInput, modelInput, onFetch]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleQuery();
  };

  const handleCopy = async () => {
    if (!output.trim()) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      showToast('检索结果已复制到剪贴板', { type: 'success' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('复制失败，请重试', { type: 'error' });
    }
  };

  const renderActionBar = () => {
    if (isGenerating) return undefined;
    return (
      <NodeActionBar>
        {(output.trim() || error) && (
          <NodeActionBar.Retry
            onClick={() => handleQuery()}
            error={!!error}
            hasDownstream={hasDownstream}
            tooltip={error ? '重试检索' : '重新检索'}
          />
        )}
        {output.trim() && (
          <NodeActionBar.Custom
            icon={copied ? <Check size={16} strokeWidth={2} className="text-accent" /> : <Copy size={16} strokeWidth={1.5} />}
            tooltip={copied ? '已复制' : '复制检索结果'}
            onClick={handleCopy}
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
      title={title || '知乎检索'}
      dotColor={NODE_COLORS.zhihu_search}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 560 }}
      className={isGenerating && !error ? 'transition-[box-shadow,border-color,opacity] duration-200 border-transparent' : ''}
      glowOverlay={isGenerating && !error ? <BeamGlow /> : undefined}
      showLeftAnchor
      showRightAnchor
      footer={footer}
      actionBar={renderActionBar()}
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-3">
        {/* 模式页签：知乎搜索 / 全网搜索 / 直答 */}
        <div className="shrink-0 flex gap-1 p-1 rounded-lg bg-paper-grid/20 border border-paper-grid select-none">
          {MODE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = modeInput === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => switchMode(tab.value)}
                disabled={isGenerating}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-sans transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
                  active ? 'bg-accent text-paper shadow-sm font-medium' : 'text-ink-light hover:bg-paper-grid/40 hover:text-ink'
                }`}
              >
                <Icon size={13} strokeWidth={2} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 查询控制区：根据模式与是否连线自适应 */}
        <div className="shrink-0 space-y-2">
          {hasUpstream ? (
            /* 连线即输入模式：高光提示卡片 */
            <div className="flex items-center justify-between p-2.5 rounded-md border border-accent/40 bg-accent/5">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center shrink-0 text-accent">
                  <Link2 size={13} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-serif text-accent uppercase tracking-wider">
                    上级连线输入{isZhida ? '问题' : '关键词'}
                  </div>
                  <div className="text-sm font-medium text-ink truncate font-mono">{upstreamQuery}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQuery(upstreamQuery)}
                disabled={!canSubmit}
                title={hasDownstream ? '有下级节点，不可修改输出' : `以该${isZhida ? '问题' : '关键词'}检索`}
                className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isZhida ? <Sparkles size={12} strokeWidth={2} /> : <Search size={12} strokeWidth={2} />}
                {isZhida ? '提问' : '查询'}
              </button>
            </div>
          ) : isZhida ? (
            /* 直答模式：模型档位 + 问题输入 */
            <div className="space-y-2">
              <Select
                value={modelInput}
                onChange={(v) => setModelInput(v)}
                options={ZHIDA_MODEL_OPTIONS}
                disabled={isGenerating}
                size="sm"
                className="w-full"
              />
              <div className="relative">
                <textarea
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="输入问题，直答将给出回答…"
                  rows={2}
                  disabled={isGenerating}
                  className="w-full rounded-md border border-dashed border-paper-grid bg-transparent p-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50 resize-none leading-relaxed"
                />
                {queryInput && !isGenerating && (
                  <button
                    type="button"
                    onClick={() => setQueryInput('')}
                    className="absolute right-2 top-2 p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                    title="清除"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleQuery()}
                disabled={!canSubmit}
                title={hasDownstream ? '有下级节点，不可修改输出' : '提问'}
                className="w-full flex items-center justify-center gap-1.5 h-9 rounded-md bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.97] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles size={13} strokeWidth={2} />
                提问
              </button>
            </div>
          ) : (
            /* 搜索模式：关键词 + 数量 + 查询按钮（全网搜索附高级筛选） */
            <>
              <form onSubmit={handleSubmit} className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <input
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    placeholder={modeInput === 'global' ? '输入关键词，检索全网内容' : '输入关键词，检索知乎站内内容'}
                    disabled={isGenerating}
                    className="w-full h-10 rounded-md border border-dashed border-paper-grid bg-transparent pl-3 pr-8 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
                  />
                  {queryInput && !isGenerating && (
                    <button
                      type="button"
                      onClick={() => setQueryInput('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                      title="清除"
                    >
                      <X size={13} strokeWidth={2} />
                    </button>
                  )}
                </div>
                <Select
                  value={String(countInput)}
                  onChange={(v) => setCountInput(Number(v))}
                  options={COUNT_OPTIONS[modeInput as Exclude<ZhihuSearchMode, 'zhida'>]}
                  disabled={isGenerating}
                  size="sm"
                  className="w-[84px] shrink-0"
                />
                <button
                  type="submit"
                  disabled={!canSubmit}
                  title={hasDownstream ? '有下级节点，不可修改输出' : '检索'}
                  className="flex items-center justify-center w-10 h-10 shrink-0 rounded-md bg-accent text-paper hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Search size={15} strokeWidth={2} />
                </button>
              </form>

              {/* 全网搜索：高级筛选（索引库 + Filter 语法） */}
              {modeInput === 'global' && (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((o) => !o)}
                    disabled={isGenerating}
                    className="inline-flex items-center gap-1 text-[11px] font-sans text-ink-faint hover:text-accent transition-colors disabled:opacity-40"
                  >
                    <SlidersHorizontal size={11} strokeWidth={2} />
                    高级筛选{advancedOpen ? '（收起）' : ''}
                  </button>
                  {advancedOpen && (
                    <div className="space-y-1.5 p-2 rounded-md border border-dashed border-paper-grid bg-paper/40">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-sans text-ink-faint shrink-0 w-14">索引库</span>
                        <Select
                          value={searchDbInput}
                          onChange={(v) => setSearchDbInput(v)}
                          options={SEARCH_DB_OPTIONS}
                          disabled={isGenerating}
                          size="sm"
                          className="flex-1"
                        />
                      </div>
                      <input
                        value={filterInput}
                        onChange={(e) => setFilterInput(e.target.value)}
                        placeholder='筛选语法，如 host=="example.com" AND publish_time>=1778494631'
                        disabled={isGenerating}
                        className="w-full h-8 rounded-md border border-dashed border-paper-grid bg-transparent px-2.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
                      />
                    </div>
                  )}
                </div>
              )}
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
                <p className="text-xs font-serif text-accent font-medium">
                  {isZhida ? '直答思考中…' : modeInput === 'global' ? '正在全网检索…' : '正在知乎站内检索…'}
                </p>
                <p className="text-[11px] font-mono text-ink-faint">{effectiveQuery}</p>
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
                  重试检索
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
                <MessagesSquare size={24} strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-serif text-ink-light">检索知乎内容，结果以文本输出</p>
                <p className="text-xs text-ink-faint font-sans">
                  站内搜索 / 全网搜索 / 直答问答；可连线上级文本节点传入关键词或问题
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const ZhihuSearchNode = memo(ZhihuSearchNodeInner);
ZhihuSearchNode.displayName = 'ZhihuSearchNode';
export default ZhihuSearchNode;

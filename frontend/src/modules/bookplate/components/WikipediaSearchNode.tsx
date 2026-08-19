import React, { memo, useEffect, useState, useCallback } from 'react';
import {
  BookOpen,
  Loader2,
  Search,
  AlertTriangle,
  Link2,
  Copy,
  Check,
  X,
  ChevronLeft,
  Globe,
  FileText,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { NODE_COLORS } from '../nodeTypes';

/** Wikipedia 检索结果项（与后端 wikipedia-service 一致） */
export interface WikipediaSearchItem {
  title: string;
  pageid: number;
  snippet: string;
  wordcount: number;
}

/** 提交给页面的检索请求（页面合并上级连线文本后转发后端） */
export interface WikipediaSearchRequest {
  /** 检索关键词（页面以连线上级文本优先覆盖） */
  query: string;
  /** 语言子域（zh / en / ja …） */
  language: string;
  /** 请求数量（1-50） */
  limit: number;
}

export interface WikipediaSearchNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 语言子域（写入 data.language） */
  language?: string;
  /** 手动输入的关键词（写入 data.query） */
  query?: string;
  /** 请求数量（写入 data.limit） */
  limit?: number;
  /** 检索结果列表（写入 data.results，点击条目拉全文） */
  results?: WikipediaSearchItem[];
  /** 当前打开的文章标题（写入 data.articleTitle；非空 = 处于全文视图） */
  articleTitle?: string;
  /** 文章全文（文本，写入 data.output 作为对外输出） */
  output?: string;
  /** 摘要模式开关（写入 data.summaryMode；true = 拉简介，false = 拉全文） */
  summaryMode?: boolean;
  isGenerating?: boolean;
  error?: string | null;
  /** 连线上级文本节点提供的关键词（连线即输入，优先于手动输入） */
  upstreamKeyword?: string;
  /** 提交检索（具体关键词由页面合并上游/手动输入） */
  onSearch?: (id: string, payload: WikipediaSearchRequest) => void;
  /** 打开一篇检索结果的文章（写入 data.output）；summary=true 走简介，false 走全文 */
  onOpenArticle?: (id: string, title: string, summary?: boolean) => void;
  /** 从全文视图返回检索结果列表（仅切视图，不清空输出） */
  onBackToResults?: (id: string) => void;
  /** 编辑器状态写入 node.data（如 summaryMode 切换） */
  onUpdateEditor?: (id: string, patch: Record<string, any>) => void;
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

/** 常用 Wikipedia 语言版本 */
const LANGUAGE_OPTIONS: SelectOption[] = [
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
  { label: '日本語', value: 'ja' },
  { label: 'Français', value: 'fr' },
  { label: 'Deutsch', value: 'de' },
  { label: 'Español', value: 'es' },
  { label: 'Русский', value: 'ru' },
];

/** 语言代码 → 展示名（加载态 / 结果页展示用） */
const LANGUAGE_LABEL: Record<string, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ru: 'Русский',
};

/** 数量下拉选项 */
const LIMIT_OPTIONS: SelectOption[] = [5, 10, 20].map((v) => ({ label: `${v} 条`, value: String(v) }));

const WikipediaSearchNodeInner: React.FC<WikipediaSearchNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  language = 'zh',
  query = '',
  limit = 10,
  results = [],
  articleTitle = '',
  output = '',
  summaryMode = false,
  isGenerating = false,
  error = null,
  upstreamKeyword = '',
  onSearch,
  onOpenArticle,
  onBackToResults,
  onUpdateEditor,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  hasDownstream,
}) => {
  // 编辑器草稿态（本地输入）；外部内容变化（撤销/重做/历史恢复）时同步
  const [languageInput, setLanguageInput] = useState(language);
  const [queryInput, setQueryInput] = useState(query);
  const [limitInput, setLimitInput] = useState(limit);
  const [copied, setCopied] = useState(false);
  const { showToast } = useFeedback();

  useEffect(() => setLanguageInput(language), [language]);
  useEffect(() => setQueryInput(query), [query]);
  useEffect(() => setLimitInput(limit), [limit]);

  const hasUpstream = upstreamKeyword.trim().length > 0;
  // 实际生效的关键词：优先上级连线，其次手动输入
  const effectiveQuery = hasUpstream ? upstreamKeyword.trim() : queryInput.trim();
  // 全文视图：已打开（或正在打开）某篇文章
  const articleOpen = articleTitle.trim().length > 0;
  const canSubmit = effectiveQuery.length > 0 && !isGenerating && !hasDownstream;

  const handleSearch = useCallback(
    (targetQuery?: string) => {
      if (isGenerating || hasDownstream) return;
      const q = targetQuery !== undefined ? targetQuery.trim() : effectiveQuery;
      if (!q) return;
      onSearch?.(id, { query: q, language: languageInput, limit: Math.min(limitInput, 50) });
    },
    [effectiveQuery, id, isGenerating, hasDownstream, languageInput, limitInput, onSearch]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch();
  };

  const handleOpenArticle = useCallback(
    (t: string) => {
      if (isGenerating || hasDownstream) return;
      onOpenArticle?.(id, t, summaryMode);
    },
    [id, isGenerating, hasDownstream, onOpenArticle, summaryMode]
  );

  /** 重试：全文视图失败 → 重拉该文章；否则重新检索当前关键词 */
  const handleRetry = useCallback(() => {
    if (articleOpen) {
      onOpenArticle?.(id, articleTitle);
    } else {
      handleSearch();
    }
  }, [articleOpen, articleTitle, id, onOpenArticle, handleSearch]);

  const handleCopy = async () => {
    if (!output.trim()) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      showToast('文章内容已复制到剪贴板', { type: 'success' });
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
            onClick={handleRetry}
            error={!!error}
            hasDownstream={hasDownstream}
            tooltip={error ? '重试' : '重新检索'}
          />
        )}
        {output.trim() && (
          <NodeActionBar.Custom
            icon={copied ? <Check size={16} strokeWidth={2} className="text-accent" /> : <Copy size={16} strokeWidth={1.5} />}
            tooltip={copied ? '已复制' : '复制文章内容'}
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
      title={title || 'Wikipedia 检索'}
      dotColor={NODE_COLORS.wikipedia_search}
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
        {/* 查询控制区：根据是否连线自适应 */}
        <div className="shrink-0 space-y-2">
          {hasUpstream ? (
            /* 连线即输入模式：高光提示卡片 */
            <div className="flex items-center justify-between p-2.5 rounded-md border border-accent/40 bg-accent/5">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center shrink-0 text-accent">
                  <Link2 size={13} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-serif text-accent uppercase tracking-wider">上级连线输入关键词</div>
                  <div className="text-sm font-medium text-ink truncate font-mono">{upstreamKeyword}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Select
                  value={languageInput}
                  onChange={(v) => setLanguageInput(v)}
                  options={LANGUAGE_OPTIONS}
                  disabled={isGenerating}
                  size="sm"
                  className="w-[92px]"
                />
                <button
                  type="button"
                  onClick={() => handleSearch(upstreamKeyword)}
                  disabled={!canSubmit}
                  title={hasDownstream ? '有下级节点，不可修改输出' : '以该关键词检索'}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Search size={12} strokeWidth={2} />
                  检索
                </button>
              </div>
            </div>
          ) : (
            /* 手动输入模式：语言 + 关键词 + 数量 + 检索按钮 */
            <>
              <div className="flex gap-2">
                <Select
                  value={languageInput}
                  onChange={(v) => setLanguageInput(v)}
                  options={LANGUAGE_OPTIONS}
                  disabled={isGenerating}
                  size="sm"
                  className="w-[96px] shrink-0"
                />
                <Select
                  value={String(limitInput)}
                  onChange={(v) => setLimitInput(Number(v))}
                  options={LIMIT_OPTIONS}
                  disabled={isGenerating}
                  size="sm"
                  className="w-[84px] shrink-0"
                />
              </div>
              <form onSubmit={handleSubmit} className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <input
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    placeholder="输入关键词，检索 Wikipedia 词条…"
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
                <button
                  type="submit"
                  disabled={!canSubmit}
                  title={hasDownstream ? '有下级节点，不可修改输出' : '检索'}
                  className="flex items-center justify-center w-10 h-10 shrink-0 rounded-md bg-accent text-paper hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Search size={15} strokeWidth={2} />
                </button>
              </form>
            </>
          )}
        </div>

        {/* 结果 / 全文 / 加载 / 错误区 */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          {isGenerating ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[160px]">
              <div className="w-12 h-12 rounded-full border border-dashed border-accent/40 bg-accent/5 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-serif text-accent font-medium">
                  {articleOpen ? '正在获取文章全文…' : `正在检索 ${LANGUAGE_LABEL[languageInput] ?? languageInput} Wikipedia…`}
                </p>
                <p className="text-[11px] font-mono text-ink-faint">{articleOpen ? articleTitle : effectiveQuery}</p>
              </div>
            </div>
          ) : error ? (
            <div className="p-3.5 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
              <AlertTriangle size={15} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-1.5 font-sans">
                <p className="text-[12px] text-error/90 leading-relaxed break-words">{error}</p>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="inline-flex items-center text-[11px] text-error font-medium hover:underline active:scale-[0.96] transition-transform"
                >
                  重试
                </button>
              </div>
            </div>
          ) : articleOpen ? (
            /* 全文视图：文章正文 + 返回结果入口 */
            <div className="w-full min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onBackToResults?.(id)}
                  className="inline-flex items-center gap-0.5 text-[11px] font-sans text-ink-faint hover:text-accent transition-colors shrink-0"
                  title="返回检索结果"
                >
                  <ChevronLeft size={12} strokeWidth={2} />
                  返回结果（{results.length} 条）
                </button>
                <span className="text-[11px] font-mono text-ink-faint truncate">{articleTitle}</span>
              </div>
              <div className="font-mono text-sm leading-relaxed p-3 rounded-md bg-paper/60 border border-dashed border-paper-grid">
                <Streamdown
                  plugins={{ cjk, code }}
                  isAnimating={false}
                  caret="block"
                  linkSafety={{ enabled: false }}
                >
                  {normalizeMarkdown(output)}
                </Streamdown>
              </div>
            </div>
          ) : results.length > 0 ? (
            /* 检索结果列表：点击条目拉取全文 */
            <div className="w-full min-w-0 space-y-1.5">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[11px] font-serif text-ink-faint">
                  共 {results.length} 条结果 · 点击词条查看{summaryMode ? '简介' : '全文'}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-sans text-ink-faint">
                    <Globe size={11} strokeWidth={2} />
                    {LANGUAGE_LABEL[languageInput] ?? languageInput}
                  </span>
                  <button
                    type="button"
                    disabled={isGenerating || hasDownstream}
                    onClick={() => onUpdateEditor?.(id, { summaryMode: !summaryMode })}
                    className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors ${
                      summaryMode
                        ? 'border-accent bg-accent/20'
                        : 'border-paper-grid bg-paper-grid/60'
                    } ${isGenerating || hasDownstream ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    title={summaryMode ? '简介模式：点击词条仅获取简介' : '全文模式：点击词条获取完整正文'}
                  >
                    <span
                      className={`inline-block h-3 w-3 rounded-full transition-transform ${
                        summaryMode ? 'translate-x-3.5 bg-accent' : 'translate-x-0.5 bg-ink-faint/60'
                      }`}
                    />
                  </button>
                  <span className="text-[10px] font-sans text-ink-faint whitespace-nowrap">
                    {summaryMode ? '简介' : '全文'}
                  </span>
                </div>
              </div>
              {results.map((r) => (
                <button
                  key={r.pageid}
                  type="button"
                  disabled={isGenerating || hasDownstream}
                  onClick={() => handleOpenArticle(r.title)}
                  title={hasDownstream ? '有下级节点，不可修改输出' : `查看「${r.title}」全文`}
                  className="w-full text-left p-2.5 rounded-md border border-dashed border-paper-grid bg-paper/40 hover:border-accent/50 hover:bg-accent/5 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileText size={12} strokeWidth={2} className="text-accent shrink-0" />
                    <span className="text-[13px] font-medium text-ink truncate">{r.title}</span>
                    <span className="text-[10px] font-sans text-ink-faint shrink-0">约 {r.wordcount} 词</span>
                  </div>
                  {r.snippet && (
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-light font-sans line-clamp-2">
                      {r.snippet}
                    </p>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[180px]">
              <div className="w-14 h-14 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
                <BookOpen size={24} strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-serif text-ink-light">检索 Wikipedia 词条并获取文章全文</p>
                <p className="text-xs text-ink-faint font-sans">多语言支持 · 匿名无需密钥 · 可连线上级文本节点传入关键词</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const WikipediaSearchNode = memo(WikipediaSearchNodeInner);
WikipediaSearchNode.displayName = 'WikipediaSearchNode';
export default WikipediaSearchNode;

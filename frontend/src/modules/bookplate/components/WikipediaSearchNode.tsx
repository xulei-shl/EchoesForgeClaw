import React, { memo, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Loader2,
  Search,
  AlertTriangle,
  X,
  ChevronLeft,
  FileText,
  RotateCw,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { NODE_COLORS } from '../nodeTypes';
import { UpstreamLinkCard } from './common/SearchNodeScaffold';

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
}) => {
  // 编辑器草稿态（本地输入）；外部内容变化（撤销/重做/历史恢复）时同步
  const [languageInput, setLanguageInput] = useState(language);
  const [queryInput, setQueryInput] = useState(query);
  const [limitInput, setLimitInput] = useState(limit);

  useEffect(() => setLanguageInput(language), [language]);
  useEffect(() => setQueryInput(query), [query]);
  useEffect(() => setLimitInput(limit), [limit]);

  const hasUpstream = upstreamKeyword.trim().length > 0;
  // 实际生效的关键词：优先上级连线，其次手动输入
  const effectiveQuery = hasUpstream ? upstreamKeyword.trim() : queryInput.trim();
  // 全文视图：已打开（或正在打开）某篇文章
  const articleOpen = articleTitle.trim().length > 0;
  const canSubmit = effectiveQuery.length > 0 && !isGenerating;

  const handleSearch = useCallback(
    (targetQuery?: string) => {
      if (isGenerating) return;
      const q = targetQuery !== undefined ? targetQuery.trim() : effectiveQuery;
      if (!q) return;
      onSearch?.(id, { query: q, language: languageInput, limit: Math.min(limitInput, 50) });
    },
    [effectiveQuery, id, isGenerating, languageInput, limitInput, onSearch]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch();
  };

  const handleOpenArticle = useCallback(
    (t: string) => {
      if (isGenerating) return;
      onOpenArticle?.(id, t, summaryMode);
    },
    [id, isGenerating, onOpenArticle, summaryMode]
  );

  /** 重试：全文视图失败 → 重拉该文章；否则重新检索当前关键词 */
  const handleRetry = useCallback(() => {
    if (articleOpen) {
      onOpenArticle?.(id, articleTitle, summaryMode);
    } else {
      handleSearch();
    }
  }, [articleOpen, articleTitle, id, onOpenArticle, summaryMode, handleSearch]);

  const renderActionBar = () => {
    if (isGenerating) return undefined;
    return (
      <NodeActionBar>
        {(output.trim() || error) && (
          <NodeActionBar.Retry
            onClick={handleRetry}
            error={!!error}
            tooltip={error ? '重试' : '重新检索'}
          />
        )}
        {output.trim() && (
          <NodeActionBar.Copy
            text={output}
            tooltip="复制文章内容"
            toastMessage="文章内容已复制到剪贴板"
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
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2.5">
        {/* 查询控制区：根据是否连线自适应 */}
        <div className="shrink-0 space-y-2">
          {hasUpstream ? (
            /* 连线即输入模式：高光提示卡片 */
            <UpstreamLinkCard
              label="上级连线输入关键词"
              content={upstreamKeyword}
              onTrigger={() => handleSearch(upstreamKeyword)}
              disabled={!canSubmit}
              buttonText="检索"
            />
          ) : (
            /* 手动输入模式：第 1 行 语言 + 关键词输入框 + 检索按钮 复合行 */
            <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
              <Select
                value={languageInput}
                onChange={(v) => {
                  setLanguageInput(v);
                  onUpdateEditor?.(id, { language: v });
                }}
                options={LANGUAGE_OPTIONS}
                disabled={isGenerating}
                size="sm"
                className="w-[86px] shrink-0"
              />
              <div className="relative flex-1 min-w-0">
                <input
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  onBlur={() => onUpdateEditor?.(id, { query: queryInput })}
                  placeholder="输入关键词，检索词条…"
                  disabled={isGenerating}
                  className="w-full h-8 rounded-lg border border-dashed border-paper-grid bg-transparent pl-2.5 pr-8 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
                />
                {queryInput && !isGenerating && (
                  <button
                    type="button"
                    onClick={() => {
                      setQueryInput('');
                      onUpdateEditor?.(id, { query: '' });
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                    title="清除"
                    aria-label="清空输入"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={!canSubmit}
                title="回车直接检索"
                className="flex items-center justify-center h-8 px-2.5 shrink-0 rounded-lg bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-transform disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent gap-1 shadow-xs"
              >
                <Search size={13} strokeWidth={2} />
              </button>
            </form>
          )}

          {/* 第 2 行：参数与模式工具栏（条数选择 + 结果统计 + 全文/简介分段胶囊） */}
          <div className="flex items-center justify-between gap-2 px-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              {hasUpstream && (
                <Select
                  value={languageInput}
                  onChange={(v) => {
                    setLanguageInput(v);
                    onUpdateEditor?.(id, { language: v });
                  }}
                  options={LANGUAGE_OPTIONS}
                  disabled={isGenerating}
                  size="sm"
                  className="w-[86px] shrink-0"
                />
              )}
              <Select
                value={String(limitInput)}
                onChange={(v) => {
                  const num = Number(v);
                  setLimitInput(num);
                  onUpdateEditor?.(id, { limit: num });
                }}
                options={LIMIT_OPTIONS}
                disabled={isGenerating}
                size="sm"
                className="w-[78px] shrink-0"
              />
              {results.length > 0 && !articleOpen && (
                <span className="text-[11px] font-sans text-ink-faint truncate tabular-nums">
                  共 {results.length} 条结果
                </span>
              )}
            </div>

            {/* 全文 / 简介 分段胶囊切换器（带滑动指示器） */}
            <div className="relative flex items-center rounded-lg border border-dashed border-paper-grid p-0.5 bg-paper/40 shrink-0">
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => onUpdateEditor?.(id, { summaryMode: false })}
                className="relative px-2.5 py-0.5 rounded-md text-[11px] font-sans transition-colors active:scale-[0.96] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                title="全文模式：点击词条拉取完整正文"
              >
                {!summaryMode && (
                  <motion.div
                    layoutId="wikipedia-mode-pill"
                    className="absolute inset-0 rounded-md bg-accent shadow-xs"
                    transition={{ type: 'spring', duration: 0.28, bounce: 0 }}
                  />
                )}
                <span className={`relative z-10 ${!summaryMode ? 'text-paper font-medium' : 'text-ink-faint hover:text-ink'}`}>
                  全文
                </span>
              </button>

              <button
                type="button"
                disabled={isGenerating}
                onClick={() => onUpdateEditor?.(id, { summaryMode: true })}
                className="relative px-2.5 py-0.5 rounded-md text-[11px] font-sans transition-colors active:scale-[0.96] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                title="简介模式：点击词条仅拉取摘要简介"
              >
                {summaryMode && (
                  <motion.div
                    layoutId="wikipedia-mode-pill"
                    className="absolute inset-0 rounded-md bg-accent shadow-xs"
                    transition={{ type: 'spring', duration: 0.28, bounce: 0 }}
                  />
                )}
                <span className={`relative z-10 ${summaryMode ? 'text-paper font-medium' : 'text-ink-faint hover:text-ink'}`}>
                  简介
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* 结果 / 全文 / 加载 / 错误 / 空状态区（微位移平滑切换） */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          <AnimatePresence mode="wait">
            {isGenerating ? (
              <motion.div
                key="generating"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[160px]"
              >
                <div className="w-12 h-12 rounded-full border border-dashed border-accent/40 bg-accent/5 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />
                </div>
                <div className="space-y-1 max-w-[80%]">
                  <p className="text-xs font-serif text-accent font-medium">
                    {articleOpen ? '正在获取文章正文…' : `正在检索 ${LANGUAGE_LABEL[languageInput] ?? languageInput} Wikipedia…`}
                  </p>
                  <p className="text-[11px] font-mono text-ink-faint truncate">{articleOpen ? articleTitle : effectiveQuery}</p>
                </div>
              </motion.div>
            ) : error ? (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="p-3.5 rounded-lg border border-error/20 bg-error/5 flex items-start gap-2.5"
              >
                <AlertTriangle size={15} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-1.5 font-sans">
                  <p className="text-[12px] text-error/90 leading-relaxed break-words">{error}</p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="inline-flex items-center gap-1 text-[11px] text-error font-medium hover:underline active:scale-[0.96] transition-transform"
                  >
                    <RotateCw size={11} />
                    <span>重试检索</span>
                  </button>
                </div>
              </motion.div>
            ) : articleOpen ? (
              /* 全文视图：文章正文 + 返回结果入口 */
              <motion.div
                key={`article-${articleTitle}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="w-full min-w-0 space-y-2"
              >
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <button
                    type="button"
                    onClick={() => onBackToResults?.(id)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-paper-grid/20 hover:bg-paper-grid/40 text-[11px] font-sans text-ink-light hover:text-ink active:scale-[0.96] transition-transform transition-colors shrink-0"
                    title="返回检索结果列表"
                  >
                    <ChevronLeft size={12} strokeWidth={2} />
                    <span>返回列表 ({results.length})</span>
                  </button>
                  <span className="text-[11px] font-mono text-ink-faint truncate" title={articleTitle}>
                    {articleTitle}
                  </span>
                </div>
                <div className="font-mono text-xs leading-relaxed p-3 rounded-lg bg-paper/60 border border-dashed border-paper-grid">
                  <Streamdown
                    plugins={{ cjk, code }}
                    isAnimating={false}
                    caret="block"
                    linkSafety={{ enabled: false }}
                  >
                    {normalizeMarkdown(output)}
                  </Streamdown>
                </div>
              </motion.div>
            ) : results.length > 0 ? (
              /* 检索结果列表：点击条目拉取全文 */
              <motion.div
                key="results-list"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="w-full min-w-0 space-y-1.5"
              >
                {results.map((r) => (
                  <button
                    key={r.pageid}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => handleOpenArticle(r.title)}
                    title={`查看「${r.title}」${summaryMode ? '简介' : '全文'}`}
                    className="w-full text-left p-2.5 rounded-lg border border-dashed border-paper-grid bg-paper/40 hover:border-accent/50 hover:bg-accent/5 active:scale-[0.96] transition-transform duration-100 ease-out disabled:opacity-40 disabled:cursor-not-allowed group"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText size={12} strokeWidth={2} className="text-accent shrink-0" />
                      <span className="text-[13px] font-medium text-ink group-hover:text-accent transition-colors truncate">
                        {r.title}
                      </span>
                      <span className="text-[10px] font-mono text-ink-faint shrink-0 tabular-nums">
                        约 {r.wordcount.toLocaleString()} 词
                      </span>
                    </div>
                    {r.snippet && (
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-light font-sans line-clamp-2">
                        {r.snippet}
                      </p>
                    )}
                  </button>
                ))}
              </motion.div>
            ) : (
              /* 空状态 */
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="h-full flex flex-col items-center justify-center gap-2.5 text-center min-h-[180px] p-4 select-none"
              >
                <div className="w-14 h-14 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
                  <BookOpen size={24} strokeWidth={1.5} />
                </div>
                <div className="space-y-1 max-w-[280px]">
                  <p className="text-xs font-serif text-ink-light font-medium">检索 Wikipedia 词条并获取文章全文</p>
                  <p className="text-[11px] text-ink-faint font-sans leading-normal">
                    多语言支持 · 匿名无需密钥 · 支持上级连线传入
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </CanvasNode>
  );
};

export const WikipediaSearchNode = memo(WikipediaSearchNodeInner);
WikipediaSearchNode.displayName = 'WikipediaSearchNode';
export default WikipediaSearchNode;


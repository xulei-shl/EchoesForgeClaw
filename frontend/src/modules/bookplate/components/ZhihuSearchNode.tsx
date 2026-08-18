import React, { memo, useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
  SlidersHorizontal,
  RotateCw,
  Trash2,
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

/** 各模式独立的执行状态与配置 */
export interface ZhihuSearchTabData {
  /** 检索/问答结果 Markdown 文本 */
  output: string;
  /** 错误信息 */
  error: string | null;
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 搜索条数（zhihu 1-10 / global 1-20） */
  count?: number;
  /** 全网搜索高级筛选语法（仅 global） */
  filter?: string;
  /** 全网搜索索引库（仅 global） */
  search_db?: string;
  /** 直答模型档位（仅 zhida） */
  model?: string;
}

export interface ZhihuSearchNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 当前选中的检索模式（写入 data.mode） */
  mode?: ZhihuSearchMode;
  /** 全局共享的检索关键词 / 问题（写入 data.query） */
  query?: string;
  /** 3 个模式各自独立的数据缓存（写入 data.tabData） */
  tabData?: Partial<Record<ZhihuSearchMode, ZhihuSearchTabData>>;
  /** 兼容旧字段：请求数量（写入 data.count） */
  count?: number;
  /** 兼容旧字段：全网搜索高级筛选表达式（写入 data.filter） */
  filter?: string;
  /** 兼容旧字段：全网搜索索引库（写入 data.search_db） */
  search_db?: string;
  /** 兼容旧字段：直答模型档位（写入 data.model） */
  model?: string;
  /** 连线上级文本节点提供的关键词 / 问题（连线即输入，优先于手动输入） */
  upstreamQuery?: string;
  /** 兼容旧字段：当前活跃结果（写入 data.output 作为对外输出） */
  output?: string;
  /** 兼容旧字段：是否生成中 */
  isGenerating?: boolean;
  /** 兼容旧字段：错误信息 */
  error?: string | null;
  /** 提交检索请求 */
  onFetch?: (id: string, payload: ZhihuSearchRequest) => void;
  /** 编辑器状态回写（模式切换、参数更新、Tab 结果清空等） */
  onUpdateEditor?: (id: string, patch: Record<string, any>, undoable: boolean) => void;
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

/** 模式页签配置（交互入口：3 类检索一键切换） */
const MODE_TABS: {
  value: ZhihuSearchMode;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  tagline: string;
  emptyDesc: string;
}[] = [
  {
    value: 'zhihu',
    label: '知乎搜索',
    icon: Search,
    tagline: '知乎站内精选',
    emptyDesc: '检索知乎站内高赞回答、专栏与专业讨论',
  },
  {
    value: 'global',
    label: '全网搜索',
    icon: Globe,
    tagline: '全网多源检索',
    emptyDesc: '全网综合信息检索，支持实时索引与条件筛选',
  },
  {
    value: 'zhida',
    label: '直答',
    icon: Sparkles,
    tagline: 'AI 深度问答',
    emptyDesc: '基于知乎与全网知识的 AI 智能直答与深度思考',
  },
];

/** 各模式请求数量上限（zhihu 10 / global 20，与后端一致） */
const MAX_COUNT: Record<ZhihuSearchMode, number> = { zhihu: 10, global: 20, zhida: 10 };

/** 数量下拉选项 */
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

/** 默认 Tab 初始数据模板 */
const DEFAULT_TAB_DATA: Record<ZhihuSearchMode, ZhihuSearchTabData> = {
  zhihu: { output: '', error: null, isGenerating: false, count: 5 },
  global: { output: '', error: null, isGenerating: false, count: 5, filter: '', search_db: 'all' },
  zhida: { output: '', error: null, isGenerating: false, model: 'zhida-fast-1p5' },
};

const ZhihuSearchNodeInner: React.FC<ZhihuSearchNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  mode = 'zhihu',
  query = '',
  tabData,
  count = 5,
  filter = '',
  search_db = 'all',
  model = 'zhida-fast-1p5',
  upstreamQuery = '',
  output = '',
  isGenerating = false,
  error = null,
  onFetch,
  onUpdateEditor,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  hasDownstream,
}) => {
  const { showToast } = useFeedback();

  // 当前激活模式
  const [activeMode, setActiveMode] = useState<ZhihuSearchMode>(mode);
  // 全局共享检索词
  const [queryInput, setQueryInput] = useState<string>(query);

  // 初始化合并 3 个模式各自独立的数据状态
  const initialMergedTabData = useMemo<Record<ZhihuSearchMode, ZhihuSearchTabData>>(() => {
    return {
      zhihu: {
        ...DEFAULT_TAB_DATA.zhihu,
        count: count ?? 5,
        ...(tabData?.zhihu || {}),
        // 若旧数据未隔离 tabData 且当前 mode 吻合，回退兼容
        output: tabData?.zhihu?.output ?? (mode === 'zhihu' ? output : ''),
        error: tabData?.zhihu?.error ?? (mode === 'zhihu' ? error : null),
        isGenerating: tabData?.zhihu?.isGenerating ?? (mode === 'zhihu' ? isGenerating : false),
      },
      global: {
        ...DEFAULT_TAB_DATA.global,
        count: count ?? 5,
        filter: filter ?? '',
        search_db: search_db ?? 'all',
        ...(tabData?.global || {}),
        output: tabData?.global?.output ?? (mode === 'global' ? output : ''),
        error: tabData?.global?.error ?? (mode === 'global' ? error : null),
        isGenerating: tabData?.global?.isGenerating ?? (mode === 'global' ? isGenerating : false),
      },
      zhida: {
        ...DEFAULT_TAB_DATA.zhida,
        model: model ?? 'zhida-fast-1p5',
        ...(tabData?.zhida || {}),
        output: tabData?.zhida?.output ?? (mode === 'zhida' ? output : ''),
        error: tabData?.zhida?.error ?? (mode === 'zhida' ? error : null),
        isGenerating: tabData?.zhida?.isGenerating ?? (mode === 'zhida' ? isGenerating : false),
      },
    };
  }, [tabData, mode, count, filter, search_db, model, output, error, isGenerating]);

  const [localTabData, setLocalTabData] = useState<Record<ZhihuSearchMode, ZhihuSearchTabData>>(initialMergedTabData);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 外部 Props 变化时同步更新
  useEffect(() => {
    setActiveMode(mode);
  }, [mode]);

  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  useEffect(() => {
    setLocalTabData(initialMergedTabData);
  }, [initialMergedTabData]);

  // 当前 Tab 的独立状态与配置
  const currentTab = localTabData[activeMode] || DEFAULT_TAB_DATA[activeMode];
  const isZhida = activeMode === 'zhida';
  const hasUpstream = upstreamQuery.trim().length > 0;
  // 生效关键词：连线文本优先，其次手动输入
  const effectiveQuery = hasUpstream ? upstreamQuery.trim() : queryInput.trim();
  const canSubmit = effectiveQuery.length > 0 && !currentTab.isGenerating && !hasDownstream;

  // 任意 Tab 是否正在生成中（用于光晕/动画展示）
  const anyGenerating = Object.values(localTabData).some((t) => t.isGenerating);

  /** 切换模式 Tab：更新当前 activeMode，检索词保持全局共享，同步将该 Tab 的 output 输出到外界 */
  const switchMode = (targetMode: ZhihuSearchMode) => {
    if (targetMode === activeMode) return;
    setActiveMode(targetMode);
    const targetOutput = localTabData[targetMode]?.output ?? '';
    const targetGenerating = !!localTabData[targetMode]?.isGenerating;
    const targetError = localTabData[targetMode]?.error ?? null;
    onUpdateEditor?.(
      id,
      {
        mode: targetMode,
        output: targetOutput,
        isGenerating: targetGenerating,
        error: targetError,
      },
      false
    );
  };

  /** 更新当前 Tab 专属配置参数并持久化 */
  const updateCurrentTabConfig = (patch: Partial<ZhihuSearchTabData>) => {
    setLocalTabData((prev) => {
      const nextTab = { ...prev[activeMode], ...patch };
      const nextMap = { ...prev, [activeMode]: nextTab };
      onUpdateEditor?.(
        id,
        {
          tabData: nextMap,
          ...(activeMode === 'zhida' && patch.model ? { model: patch.model } : {}),
          ...(activeMode !== 'zhida' && patch.count ? { count: patch.count } : {}),
          ...(activeMode === 'global' && patch.filter !== undefined ? { filter: patch.filter } : {}),
          ...(activeMode === 'global' && patch.search_db !== undefined ? { search_db: patch.search_db } : {}),
        },
        false
      );
      return nextMap;
    });
  };

  /** 触发检索：提交当前激活 Tab 的请求 */
  const handleQuery = useCallback(
    (targetQuery?: string) => {
      if (currentTab.isGenerating || hasDownstream) return;
      const q = targetQuery !== undefined ? targetQuery.trim() : effectiveQuery;
      if (!q) return;

      const requestCount = Math.min(currentTab.count ?? 5, MAX_COUNT[activeMode]);
      const requestFilter = currentTab.filter ?? '';
      const requestSearchDb = currentTab.search_db ?? 'all';
      const requestModel = currentTab.model ?? 'zhida-fast-1p5';

      // 乐观更新当前 Tab 为生成态
      setLocalTabData((prev) => ({
        ...prev,
        [activeMode]: {
          ...prev[activeMode],
          isGenerating: true,
          error: null,
        },
      }));

      onFetch?.(id, {
        mode: activeMode,
        query: q,
        count: requestCount,
        filter: requestFilter,
        search_db: requestSearchDb,
        model: requestModel,
      });
    },
    [activeMode, currentTab, effectiveQuery, hasDownstream, id, onFetch]
  );

  /** 搜索表单提交 */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleQuery();
  };

  /** 直答模式快捷键支持（Ctrl+Enter / Cmd+Enter 提问） */
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canSubmit) handleQuery();
    }
  };

  /** 复制当前 Tab 的 Markdown 结果 */
  const handleCopy = async () => {
    const textToCopy = currentTab.output?.trim();
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      showToast('检索结果已复制到剪贴板', { type: 'success' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('复制失败，请重试', { type: 'error' });
    }
  };

  /** 清空当前 Tab 结果 */
  const handleClearCurrentOutput = () => {
    if (hasDownstream || currentTab.isGenerating) return;
    setLocalTabData((prev) => {
      const nextTab = { ...prev[activeMode], output: '', error: null };
      const nextMap = { ...prev, [activeMode]: nextTab };
      onUpdateEditor?.(
        id,
        {
          tabData: nextMap,
          output: '',
          error: null,
        },
        true
      );
      return nextMap;
    });
    showToast('已清空当前结果', { type: 'info' });
  };

  /** 悬浮操作栏 */
  const renderActionBar = () => {
    if (currentTab.isGenerating) return undefined;
    const hasCurrentOutput = !!currentTab.output?.trim();
    const hasCurrentError = !!currentTab.error;

    return (
      <NodeActionBar>
        {(hasCurrentOutput || hasCurrentError) && (
          <NodeActionBar.Retry
            onClick={() => handleQuery()}
            error={hasCurrentError}
            hasDownstream={hasDownstream}
            tooltip={hasCurrentError ? '重试当前检索' : '重新检索当前 Tab'}
          />
        )}
        {hasCurrentOutput && (
          <NodeActionBar.Custom
            icon={copied ? <Check size={16} strokeWidth={2} className="text-accent" /> : <Copy size={16} strokeWidth={1.5} />}
            tooltip={copied ? '已复制' : '复制当前结果'}
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
      className={anyGenerating ? 'transition-[box-shadow,border-color,opacity] duration-200 border-transparent' : ''}
      glowOverlay={anyGenerating ? <BeamGlow /> : undefined}
      showLeftAnchor
      showRightAnchor
      footer={footer}
      actionBar={renderActionBar()}
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2.5">
        {/* 模式页签 Segmented Control：知乎搜索 / 全网搜索 / 直答（带状态指示徽标） */}
        <div className="shrink-0 flex gap-1 p-1 rounded-lg bg-paper-grid/20 border border-paper-grid select-none">
          {MODE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeMode === tab.value;
            const tabState = localTabData[tab.value] || DEFAULT_TAB_DATA[tab.value];
            const hasResult = !!tabState.output?.trim();
            const hasErr = !!tabState.error;
            const isGen = !!tabState.isGenerating;

            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => switchMode(tab.value)}
                className={`relative flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-sans transition-all active:scale-[0.97] ${
                  active
                    ? 'bg-accent text-paper shadow-sm font-medium'
                    : 'text-ink-light hover:bg-paper-grid/40 hover:text-ink'
                }`}
              >
                {isGen ? (
                  <Loader2 size={12} strokeWidth={2.5} className="animate-spin text-current" />
                ) : (
                  <Icon size={13} strokeWidth={2} className="shrink-0" />
                )}
                <span>{tab.label}</span>

                {/* 状态指示点：已出结果 (小圆点) / 报错 (红点) */}
                {!isGen && (hasResult || hasErr) && (
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full transition-transform ${
                      hasErr
                        ? active ? 'bg-paper ring-1 ring-error' : 'bg-error'
                        : active ? 'bg-paper' : 'bg-accent'
                    }`}
                    title={hasErr ? '检索出错' : '已有检索结果'}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* 上级连线提示卡片（当有上游连线时常驻置顶，与参数配置解耦） */}
        {hasUpstream && (
          <div className="shrink-0 flex items-center justify-between p-2 rounded-md border border-accent/40 bg-accent/5">
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <div className="w-5 h-5 rounded-full bg-accent/15 flex items-center justify-center shrink-0 text-accent">
                <Link2 size={12} strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-serif text-accent uppercase tracking-wider">
                  上级连线传入{isZhida ? '问题' : '关键词'}
                </div>
                <div className="text-xs font-medium text-ink truncate font-mono">{upstreamQuery}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleQuery(upstreamQuery)}
              disabled={!canSubmit}
              title={hasDownstream ? '有下级节点，不可修改输出' : `以连线内容${isZhida ? '提问' : '检索'}`}
              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isZhida ? <Sparkles size={11} strokeWidth={2} /> : <Search size={11} strokeWidth={2} />}
              {isZhida ? '提问' : '检索'}
            </button>
          </div>
        )}

        {/* 查询控制区：根据当前模式自适应（无连线时展示输入框，有连线时展示参数调节） */}
        <div className="shrink-0 space-y-2">
          {isZhida ? (
            /* 直答模式控制区：输入框在上，模型选择与提问按钮在下方同一行 */
            hasUpstream ? (
              /* 有连线时：单独展示模型档位选择 */
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-sans text-ink-faint shrink-0">模型档位</span>
                <Select
                  value={currentTab.model ?? 'zhida-fast-1p5'}
                  onChange={(v) => updateCurrentTabConfig({ model: v })}
                  options={ZHIDA_MODEL_OPTIONS}
                  disabled={currentTab.isGenerating}
                  size="sm"
                  className="flex-1"
                />
              </div>
            ) : (
              /* 无连线时：上部问题 Textarea，下部同一行展示模型下拉与提问按钮 */
              <div className="space-y-1.5">
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    onKeyDown={handleTextareaKeyDown}
                    placeholder="输入问题，直答将给出回答… (Ctrl+Enter 快捷提问)"
                    rows={2}
                    disabled={currentTab.isGenerating}
                    className="w-full rounded-md border border-dashed border-paper-grid bg-transparent p-2 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50 resize-none leading-relaxed"
                  />
                  {queryInput && !currentTab.isGenerating && (
                    <button
                      type="button"
                      onClick={() => setQueryInput('')}
                      className="absolute right-2 top-2 p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                      title="清空输入"
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={currentTab.model ?? 'zhida-fast-1p5'}
                    onChange={(v) => updateCurrentTabConfig({ model: v })}
                    options={ZHIDA_MODEL_OPTIONS}
                    disabled={currentTab.isGenerating}
                    size="sm"
                    className="flex-1 min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => handleQuery()}
                    disabled={!canSubmit}
                    title={hasDownstream ? '有下级节点，不可修改输出' : '提问直答 (Ctrl+Enter)'}
                    className="shrink-0 flex items-center justify-center gap-1 px-3 h-8 rounded-md bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Sparkles size={12} strokeWidth={2} />
                    <span>提问</span>
                  </button>
                </div>
              </div>
            )
          ) : (
            /* 搜索模式控制区（知乎搜索 / 全网搜索） */
            <>
              {!hasUpstream ? (
                <form onSubmit={handleSubmit} className="flex gap-1.5">
                  <div className="relative flex-1 min-w-0">
                    <input
                      value={queryInput}
                      onChange={(e) => setQueryInput(e.target.value)}
                      placeholder={activeMode === 'global' ? '输入关键词，全网检索…' : '输入关键词，知乎站内检索…'}
                      disabled={currentTab.isGenerating}
                      className="w-full h-8 rounded-md border border-dashed border-paper-grid bg-transparent pl-2.5 pr-7 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
                    />
                    {queryInput && !currentTab.isGenerating && (
                      <button
                        type="button"
                        onClick={() => setQueryInput('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                        title="清空输入"
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                  <Select
                    value={String(currentTab.count ?? 5)}
                    onChange={(v) => updateCurrentTabConfig({ count: Number(v) })}
                    options={COUNT_OPTIONS[activeMode as Exclude<ZhihuSearchMode, 'zhida'>]}
                    disabled={currentTab.isGenerating}
                    size="sm"
                    className="w-[76px] shrink-0"
                  />
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    title={hasDownstream ? '有下级节点，不可修改输出' : '回车直接检索'}
                    className="flex items-center justify-center w-8 h-8 shrink-0 rounded-md bg-accent text-paper hover:bg-accent-hover active:scale-[0.96] transition-transform disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Search size={13} strokeWidth={2} />
                  </button>
                </form>
              ) : (
                /* 有上级连线时的条数选择栏 */
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-sans text-ink-faint shrink-0">检索数量</span>
                  <Select
                    value={String(currentTab.count ?? 5)}
                    onChange={(v) => updateCurrentTabConfig({ count: Number(v) })}
                    options={COUNT_OPTIONS[activeMode as Exclude<ZhihuSearchMode, 'zhida'>]}
                    disabled={currentTab.isGenerating}
                    size="sm"
                    className="w-28"
                  />
                </div>
              )}

              {/* 全网搜索专属：高级筛选折叠面板（索引库 + Filter 语法） */}
              {activeMode === 'global' && (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((o) => !o)}
                    disabled={currentTab.isGenerating}
                    className="inline-flex items-center gap-1 text-[11px] font-sans text-ink-faint hover:text-accent transition-colors disabled:opacity-40"
                  >
                    <SlidersHorizontal size={11} strokeWidth={2} />
                    <span>高级筛选</span>
                    <span className="text-[10px] text-ink-faint/80">
                      {advancedOpen ? '（收起）' : currentTab.filter ? '（已设置筛选）' : '（展开）'}
                    </span>
                  </button>
                  {advancedOpen && (
                    <div className="space-y-1.5 p-2 rounded-md border border-dashed border-paper-grid bg-paper-grid/10 animate-in fade-in duration-150">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-sans text-ink-faint shrink-0 w-12">索引库</span>
                        <Select
                          value={currentTab.search_db ?? 'all'}
                          onChange={(v) => updateCurrentTabConfig({ search_db: v })}
                          options={SEARCH_DB_OPTIONS}
                          disabled={currentTab.isGenerating}
                          size="sm"
                          className="flex-1"
                        />
                      </div>
                      <input
                        value={currentTab.filter ?? ''}
                        onChange={(e) => updateCurrentTabConfig({ filter: e.target.value })}
                        placeholder='Filter 语法，如 host=="zhihu.com" AND publish_time>=1778494631'
                        disabled={currentTab.isGenerating}
                        className="w-full h-7 rounded-md border border-dashed border-paper-grid bg-transparent px-2 text-[11px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 结果区顶部工具栏（有结果时展示模式标识、重新检索与清空按钮） */}
        {currentTab.output?.trim() && !currentTab.isGenerating && (
          <div className="shrink-0 flex items-center justify-between px-1 text-[11px] text-ink-faint select-none">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              <span className="font-sans font-medium text-ink-light">
                {MODE_TABS.find((t) => t.value === activeMode)?.label}结果
              </span>
              <span className="text-[10px] text-ink-faint font-mono">
                ({currentTab.output.length} 字)
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopy}
                className="p-1 rounded text-ink-faint hover:text-ink hover:bg-paper-grid/40 transition-colors"
                title={copied ? '已复制' : '复制 Markdown'}
              >
                {copied ? <Check size={12} className="text-accent" /> : <Copy size={12} />}
              </button>
              <button
                type="button"
                onClick={() => handleQuery()}
                disabled={!canSubmit}
                className="p-1 rounded text-ink-faint hover:text-ink hover:bg-paper-grid/40 transition-colors disabled:opacity-30"
                title="重新检索当前 Tab"
              >
                <RotateCw size={12} />
              </button>
              <button
                type="button"
                onClick={handleClearCurrentOutput}
                disabled={hasDownstream}
                className="p-1 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors disabled:opacity-30"
                title="清空当前结果"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        )}

        {/* 结果展示 / 加载中 / 错误区 */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          {currentTab.isGenerating ? (
            /* 加载状态 */
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[160px] animate-in fade-in duration-150">
              <div className="w-11 h-11 rounded-full border border-dashed border-accent/40 bg-accent/5 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />
              </div>
              <div className="space-y-1 max-w-[80%]">
                <p className="text-xs font-serif text-accent font-medium">
                  {isZhida ? '直答思考中…' : activeMode === 'global' ? '正在全网检索…' : '正在知乎站内检索…'}
                </p>
                <p className="text-[11px] font-mono text-ink-faint truncate">{effectiveQuery}</p>
              </div>
            </div>
          ) : currentTab.error ? (
            /* 错误状态 */
            <div className="p-3.5 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5 animate-in fade-in duration-150">
              <AlertTriangle size={15} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-1.5 font-sans">
                <p className="text-[12px] text-error/90 leading-relaxed break-words">{currentTab.error}</p>
                <button
                  type="button"
                  onClick={() => handleQuery()}
                  className="inline-flex items-center gap-1 text-[11px] text-error font-medium hover:underline active:scale-[0.96] transition-transform"
                >
                  <RotateCw size={11} />
                  <span>重试检索</span>
                </button>
              </div>
            </div>
          ) : currentTab.output?.trim() ? (
            /* Markdown 结果渲染 */
            <div className="w-full min-w-0 font-mono text-xs leading-relaxed p-3 rounded-md bg-paper/60 border border-dashed border-paper-grid animate-in fade-in duration-150">
              <Streamdown
                plugins={{ cjk, code }}
                isAnimating={false}
                caret="block"
                linkSafety={{ enabled: false }}
              >
                {normalizeMarkdown(currentTab.output)}
              </Streamdown>
            </div>
          ) : (
            /* 针对当前 Tab 定制的空状态 */
            <div className="h-full flex flex-col items-center justify-center gap-2.5 text-center min-h-[180px] p-4 select-none animate-in fade-in duration-150">
              <div className="w-12 h-12 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
                {isZhida ? (
                  <Sparkles size={20} strokeWidth={1.5} />
                ) : activeMode === 'global' ? (
                  <Globe size={20} strokeWidth={1.5} />
                ) : (
                  <Search size={20} strokeWidth={1.5} />
                )}
              </div>
              <div className="space-y-1 max-w-[280px]">
                <p className="text-xs font-serif text-ink-light font-medium">
                  {MODE_TABS.find((t) => t.value === activeMode)?.tagline}
                </p>
                <p className="text-[11px] text-ink-faint font-sans leading-normal">
                  {MODE_TABS.find((t) => t.value === activeMode)?.emptyDesc}
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


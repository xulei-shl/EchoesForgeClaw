import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Eraser, ImagePlus, MessageSquare, Send, Copy, Check, Loader2, Square, RefreshCw, ChevronUp, ChevronDown, Lock, X, FileText, Download, Brain, FolderOpen, Clock, Sparkles, Bot, Wrench, TerminalSquare } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar, copyTextToClipboard } from '../../../platform/components/node/NodeActionBar';
import { AgentActivity } from '../../../platform/components/agent/AgentActivity';
import { Toggle } from '../../../platform/components/ui/Toggle';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import type { AgentFile, AgentStep, ChatMessage, ChatNodeSettings, InjectedContextBlock } from '../../../platform/types';
import { ContextInjectionBlock } from './ContextInjectionBlock';
import { AgentOverrideField } from './AgentOverrideField';
import { ModelOverrideField } from './ModelOverrideField';
import { ExtensionWidgets } from './ExtensionWidgets';
import { QuestionAnswerBlock } from './QuestionAnswerBlock';
import { parseQuestionnaireInteractions } from '../utils/piQuestionnaireParser';
import type { ExtensionWidgetItem, PendingUiRequest } from '../piStream';
import { NODE_COLORS } from '../nodeTypes';
import { authHeaders } from '../authUtils';
import {
  RASTER_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  fileToDataUrl,
  optimizeDataUrl,
} from '../imageUpload';
import {
  extractWorkspaceFiles,
  mergeAgentFiles,
  stripUnrenderableImages,
} from '../workspaceFiles';
import { stripInjectedContext } from '../chatSendHelpers';

// 单轮最多附带的图片数（与后端透传上限保持一致）
const MAX_ATTACHMENTS = 4;

/** 带鉴权获取 skill 执行产生的文件字节。
 *  skill-files 接口要求登录鉴权，<img> / <a href> 无法携带 Authorization 头，
 *  因此图片预览与文件下载统一走 fetch + token → blob → objectURL 路线。 */
async function fetchSkillFile(file: AgentFile): Promise<Blob> {
  const resp = await fetch(file.url, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.blob();
}

/** 文件大小人类可读格式（B / KB / MB） */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 单个工作区产物文件卡片（图片缩略预览 / 文档下载）。 */
const SkillFileCard = memo(({ file }: { file: AgentFile }) => {
  const { showToast } = useFeedback();
  const [downloading, setDownloading] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);

  useEffect(() => {
    if (!isImage) return;
    let active = true;
    let createdUrl: string | null = null;
    fetchSkillFile(file)
      .then((blob) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [file.url, isImage]);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await fetchSkillFile(file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      showToast('文件下载失败，请重试', { type: 'error' });
    } finally {
      setDownloading(false);
    }
  };

  if (isImage) {
    return (
      <div className="group/file relative inline-block rounded-lg overflow-hidden border border-paper-grid shadow-sm bg-paper-grid/20">
        {blobUrl ? (
          <PhotoView src={blobUrl}>
            <img
              src={blobUrl}
              alt={file.name}
              className="max-h-36 max-w-[240px] object-cover cursor-zoom-in hover:opacity-90 transition"
              loading="lazy"
            />
          </PhotoView>
        ) : (
          <div className="w-24 h-24 flex items-center justify-center text-ink-faint">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        <button
          onClick={handleDownload}
          title={`下载 ${file.name}`}
          className="absolute right-1 bottom-1 p-1 rounded-md bg-paper/90 text-ink-light hover:text-accent opacity-0 group-hover/file:opacity-100 transition shadow-sm"
        >
          {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-paper-grid bg-paper-grid/20 text-xs font-sans max-w-[260px]">
      <FileText size={14} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-ink font-medium leading-tight" title={file.name}>
          {file.name}
        </p>
        <p className="text-[10px] text-ink-faint mt-0.5">{formatFileSize(file.size)}</p>
      </div>
      <button
        onClick={handleDownload}
        title={`下载 ${file.name}`}
        className="p-1 rounded text-ink-faint hover:text-accent transition"
      >
        {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      </button>
    </div>
  );
});
SkillFileCard.displayName = 'SkillFileCard';

/** 工作区文件列表侧滑抽屉面板（skill_agent 模式下展示所有服务端生成的文件）。 */
const WorkspaceFilesDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  files: AgentFile[] | null;
  loading: boolean;
  onRefresh: () => void;
}> = memo(({ open, onClose, files, loading, onRefresh }) => {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-30 bg-paper/95 backdrop-blur-sm flex flex-col rounded-xl overflow-hidden animate-in fade-in-0 duration-150">
      <div className="flex items-center justify-between px-3 py-2 border-b border-paper-grid bg-paper-grid/20 shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-serif text-ink">
          <FolderOpen size={13} className="text-accent" />
          <span>工作区产物文件</span>
          {files && <span className="text-[10px] text-ink-faint font-sans">({files.length})</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            title="刷新文件列表"
            className="p-1 rounded text-ink-faint hover:text-ink hover:bg-paper-grid/40 transition"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onClose}
            title="关闭面板"
            className="p-1 rounded text-ink-faint hover:text-ink hover:bg-paper-grid/40 transition"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {loading && !files ? (
          <div className="h-full flex items-center justify-center text-ink-faint gap-1.5 text-xs">
            <Loader2 size={14} className="animate-spin" />
            <span>加载文件中…</span>
          </div>
        ) : !files || files.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-ink-faint gap-1 text-xs py-8">
            <FolderOpen size={20} strokeWidth={1.25} />
            <p>暂无工作区产物</p>
            <p className="text-[10px] text-ink-faint/70">Skill Agent 执行产生的文件将显示在此处</p>
          </div>
        ) : (
          <PhotoProvider maskOpacity={0.85} bannerVisible={false}>
            <div className="flex flex-col gap-2">
              {files.map((file) => (
                <SkillFileCard key={file.url} file={file} />
              ))}
            </div>
          </PhotoProvider>
        )}
      </div>
    </div>
  );
});
WorkspaceFilesDrawer.displayName = 'WorkspaceFilesDrawer';

/** 自动重试横幅：倒计时自走（delaySec 递减），可展开查看原因；借鉴 Proma RetryingNotice。 */
const RetryNoticeBanner: React.FC<{ notice: ChatRetryNotice }> = ({ notice }) => {
  const [remaining, setRemaining] = useState(notice.delaySec);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setRemaining(notice.delaySec);
    const timer = setInterval(() => {
      setRemaining((v: number) => (v > 0 ? v - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [notice.attempt, notice.delaySec]);
  return (
    <div className="mb-2 p-2 rounded-md border border-accent/25 bg-accent/5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
        title="点击查看详情"
      >
        <RefreshCw size={12} strokeWidth={2} className="text-accent animate-spin shrink-0" />
        <span className="flex-1 min-w-0 text-[11px] font-sans text-accent/90 leading-snug">
          {notice.reason}，{remaining}s 后自动重试（第 {notice.attempt}/{notice.maxAttempts || '?'} 次）
        </span>
        <ChevronDown
          size={11}
          strokeWidth={2}
          className={`shrink-0 text-accent/70 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <p className="mt-1.5 pl-[22px] text-[10px] font-sans text-ink-light leading-relaxed break-all select-text">
          上游错误：{notice.reason}。pi 正以指数退避自动重试，期间无需操作；多次失败将以错误横幅提示。
        </p>
      )}
    </div>
  );
};

/** 排队消息行：撤回 / 立即发送（流式中发送的消息先进队列，借鉴 Proma AgentMessageQueue）。 */
const QueuedMessageRow: React.FC<{
  item: { id: number; text: string; images?: string[] };
  onRecall: (id: number) => void;
  onSendNow: (id: number) => void;
}> = ({ item, onRecall, onSendNow }) => (
  <div className="flex items-center gap-1.5 max-w-full rounded-lg border border-paper-grid bg-paper-grid/20 px-2 py-1 group/queue">
    <Clock size={11} strokeWidth={2} className="text-ink-faint shrink-0" />
    <p className="flex-1 min-w-0 truncate text-[11px] font-sans text-ink-light" title={item.text}>
      {item.text || `图片 ×${item.images?.length ?? 0}`}
    </p>
    {!!item.images?.length && item.text && (
      <span className="shrink-0 text-[9px] font-sans text-ink-faint">+{item.images.length}图</span>
    )}
    <button
      onClick={() => onSendNow(item.id)}
      title="立即发送"
      className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 active:scale-95 transition opacity-60 group-hover/queue:opacity-100"
    >
      <Send size={10} strokeWidth={2} />
    </button>
    <button
      onClick={() => onRecall(item.id)}
      title="撤回"
      className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md text-ink-faint hover:text-error hover:bg-error/10 active:scale-95 transition opacity-60 group-hover/queue:opacity-100"
    >
      <X size={10} strokeWidth={2.5} />
    </button>
  </div>
);

const TRUNCATE_STEP_TEXT = 300;
const truncateStepText = (s: string) => (s.length > TRUNCATE_STEP_TEXT ? s.slice(0, TRUNCATE_STEP_TEXT) + '…' : s);

/**
 * 助手消息一体化步骤卡片（思考过程 + 工具执行步骤）：
 * - 将同一步骤内的思考过程与 Agent 工具执行日志深度融合成单个步骤折叠卡片；
 * - 顶部显示清晰的步骤序号（如「步骤 1 · Agent 思考与执行」）与工具步数；
 * - 思考阶段实时展开，正文出现或执行完毕后平滑收起；
 * - 支持点击一键展开/收起，内部清晰分栏展示思考推理与工具明细。
 */
const StepActivityCard: React.FC<{
  stepNumber?: number;
  reasoning?: string;
  agentSteps?: AgentStep[];
  agentName?: string;
  streaming?: boolean;
  hasContent?: boolean;
}> = memo(({ stepNumber, reasoning, agentSteps = [], agentName, streaming = false, hasContent = false }) => {
  const hasReasoning = Boolean(reasoning && reasoning.trim().length > 0);
  const hasSteps = agentSteps.length > 0;

  if (!hasReasoning && !hasSteps && !streaming) return null;

  // 展开状态逻辑：若用户手动开合则尊重用户选择；若未手动操作，流式且无正文时自动展开，有正文后自动收起
  const [userToggledOpen, setUserToggledOpen] = useState<boolean | null>(null);
  const sawContentRef = useRef(hasContent);

  // 正文首次出现时自动平滑收起（仅一次）
  useEffect(() => {
    if (hasContent && !sawContentRef.current) {
      sawContentRef.current = true;
      setUserToggledOpen(false);
    }
  }, [hasContent]);

  const open = userToggledOpen ?? (streaming && !hasContent);

  const toggleOpen = () => setUserToggledOpen((v) => (v === null ? !open : !v));

  // 摘要预览文本
  const tailReasoning = hasReasoning ? reasoning!.slice(-40).replace(/\n/g, ' ') : '';
  const lastStepName = hasSteps ? agentSteps[agentSteps.length - 1]?.name : '';
  const previewText = tailReasoning || (lastStepName ? `调用工具 ${lastStepName}` : '');

  // 步骤标题生成
  const stepPrefix = stepNumber ? `步骤 ${stepNumber}` : 'Agent 思考与执行';
  const mainTitle = agentName
    ? `${stepPrefix} · ${agentName}`
    : `${stepPrefix} · ${hasReasoning && hasSteps ? '思考与执行' : hasReasoning ? '思考过程' : '运行过程'}`;

  const renderAgentStep = (step: AgentStep, idx: number) => {
    switch (step.type) {
      case 'agent_tool_call':
        return (
          <div key={idx} className="px-2.5 py-1.5 border-b border-dashed border-paper-grid/40 last:border-0">
            <p className="flex items-center gap-1.5 text-[10.5px] font-mono text-accent">
              <Wrench size={10.5} strokeWidth={1.75} className="shrink-0" />
              <span>调用工具</span>
              <span className="font-semibold text-ink-light bg-accent/10 px-1 py-0.5 rounded text-[10px]">
                {step.name || '未知工具'}
              </span>
            </p>
            {step.arguments ? (
              <pre className="mt-1 text-[9.5px] leading-snug text-ink-light font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar bg-paper-grid/20 p-1.5 rounded select-text">
                {truncateStepText(step.arguments)}
              </pre>
            ) : null}
          </div>
        );
      case 'agent_tool_result':
        return (
          <div key={idx} className="px-2.5 py-1.5 border-b border-dashed border-paper-grid/40 last:border-0">
            <p className="flex items-center gap-1.5 text-[10.5px] font-mono text-ink-light">
              <TerminalSquare size={10.5} strokeWidth={1.75} className="shrink-0 text-ink-faint" />
              <span>{step.name || '工具'} 返回结果</span>
            </p>
            {step.result ? (
              <pre className="mt-1 text-[9.5px] leading-snug text-ink-faint font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar bg-paper-grid/20 p-1.5 rounded select-text">
                {truncateStepText(step.result)}
              </pre>
            ) : null}
          </div>
        );
      case 'agent_status':
      default:
        return (
          <div key={idx} className="px-2.5 py-1.5 border-b border-dashed border-paper-grid/40 last:border-0">
            <p className="text-[10px] leading-snug text-ink-light font-sans select-text">
              {step.message || '状态更新'}
            </p>
          </div>
        );
    }
  };

  return (
    <div className="w-full mb-1 rounded-lg border border-dashed border-paper-grid/80 bg-paper-grid/15 overflow-hidden transition-all duration-200">
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-[10px] text-ink-faint hover:text-ink-light font-sans transition-colors overflow-hidden select-none active:scale-[0.99]"
        title={open ? '收起步骤详情' : '展开步骤详情'}
      >
        <Bot size={11} strokeWidth={1.75} className={open ? 'text-accent shrink-0' : 'shrink-0'} />
        <span className={`shrink-0 ${open ? 'text-ink-light font-medium' : ''}`}>
          {mainTitle}
        </span>

        {!open && previewText && (
          <span className="flex-1 min-w-0 mx-1 overflow-hidden whitespace-nowrap text-right text-ink-faint/70 select-none truncate text-[9.5px]">
            {previewText}
          </span>
        )}

        <span className={`flex items-center gap-1 shrink-0 ${open || !previewText ? 'ml-auto' : ''}`}>
          {streaming && <Loader2 size={10} className="animate-spin text-accent shrink-0" />}
          {hasSteps && (
            <span className="text-[9.5px] font-mono tabular-nums text-ink-faint bg-paper-grid/30 px-1 py-0.2 rounded">
              {agentSteps.length} 步
            </span>
          )}
          {open ? (
            <ChevronUp size={11} strokeWidth={2} />
          ) : (
            <ChevronDown size={11} strokeWidth={2} />
          )}
        </span>
      </button>

      {/* grid-rows 0fr/1fr 过渡：折叠/展开平滑动画 */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-dashed border-paper-grid/50">
            {/* 思考推理板块 */}
            {hasReasoning && (
              <div className="px-2.5 pt-2 pb-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-sans font-medium text-ink-faint mb-1">
                  <Brain size={10.5} strokeWidth={1.75} className="text-accent shrink-0" />
                  <span>思考推理</span>
                  {streaming && !hasContent && (
                    <span className="text-[9px] text-accent/80 font-normal animate-pulse">（正在思考…）</span>
                  )}
                </div>
                <pre className="text-[10.5px] text-ink-light font-sans whitespace-pre-wrap leading-relaxed max-h-44 overflow-y-auto custom-scrollbar select-text bg-paper-grid/10 p-2 rounded border border-paper-grid/30">
                  {reasoning}
                </pre>
              </div>
            )}

            {/* 分隔线 */}
            {hasReasoning && hasSteps && (
              <div className="border-t border-dashed border-paper-grid/30 mx-2.5 my-1" />
            )}

            {/* 工具执行步骤板块 */}
            {hasSteps && (
              <div className="px-2.5 pt-1.5 pb-2">
                <div className="flex items-center gap-1.5 text-[10px] font-sans font-medium text-ink-faint mb-1">
                  <Wrench size={10.5} strokeWidth={1.75} className="text-accent shrink-0" />
                  <span>工具执行明细</span>
                  <span className="text-[9.5px] font-mono tabular-nums text-ink-faint">({agentSteps.length} 步)</span>
                </div>
                <div className="max-h-48 overflow-y-auto custom-scrollbar rounded border border-paper-grid/30 bg-paper-grid/10">
                  {agentSteps.map(renderAgentStep)}
                  {streaming && (
                    <div className="px-2.5 py-1.5 flex items-center gap-1.5 text-[10px] text-accent bg-accent/5 font-sans">
                      <Loader2 size={10} strokeWidth={2} className="animate-spin shrink-0" />
                      <span>Agent 执行中…</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
StepActivityCard.displayName = 'StepActivityCard';

const SettingsToggleRow = memo(({ label, description, checked, onChange, disabled }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) => (
  <div className="flex items-start justify-between gap-2.5">
    <div className="min-w-0">
      <p className="text-xs font-sans text-ink">{label}</p>
      <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">{description}</p>
    </div>
    <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
  </div>
));
SettingsToggleRow.displayName = 'SettingsToggleRow';

const ScrollButton = memo(({ direction, onClick, title }: {
  direction: 'up' | 'down'; onClick: () => void; title: string;
}) => (
  <button
    onClick={onClick}
    className="pointer-events-auto flex items-center justify-center w-7 h-7 rounded-full bg-paper/90 border border-paper-grid/60 shadow-sm text-ink-faint hover:text-ink hover:bg-paper-grid hover:shadow backdrop-blur-md transition-all active:scale-[0.96]"
    title={title}
  >
    {direction === 'up' ? <ChevronUp size={16} strokeWidth={2} /> : <ChevronDown size={16} strokeWidth={2} />}
  </button>
));
ScrollButton.displayName = 'ScrollButton';

const STYLE_INJECTIONS = `
@keyframes msg-enter {
  0% { opacity: 0; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
}
.msg-enter-anim { animation: msg-enter 0.2s cubic-bezier(0.2, 0, 0, 1) forwards; }
@keyframes pop-enter {
  0% { opacity: 0; transform: scale(0.96); transform-origin: bottom right; }
  100% { opacity: 1; transform: scale(1); transform-origin: bottom right; }
}
.pop-enter-anim { animation: pop-enter 0.2s cubic-bezier(0.2, 0, 0, 1) forwards; }
@keyframes thinking-wave {
  0%, 100% { transform: translateY(0); opacity: 0.35; }
  50% { transform: translateY(-2px); opacity: 1; }
}
@keyframes thinking-glow {
  0%, 100% { opacity: 0.65; }
  50% { opacity: 1; }
}
.animate-thinking-wave { 
  animation: thinking-wave 1.2s cubic-bezier(0.2, 0, 0, 1) infinite; 
  will-change: transform, opacity;
}
.animate-thinking-glow { 
  animation: thinking-glow 1.8s ease-in-out infinite; 
  will-change: opacity;
}
.chat-scroll-container {
  contain: content;
}
@media (prefers-reduced-motion: reduce) {
  .animate-thinking-wave {
    animation: thinking-glow 1.3s ease-in-out infinite;
    transform: none !important;
  }
  .msg-enter-anim, .pop-enter-anim {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
`;

interface ChatMessageItemProps {
  msg: ChatMessage;
  idx: number;
  stepNumber?: number;
  isLast: boolean;
  agentName?: string;
  /** 当前节点工作区 id（从正文提取工作区产物文件时用于换算接口 URL） */
  workspaceId?: string | null;
  /** 上下文注入块（首条 user 消息渲染时用于精准剥离上下文前缀） */
  contextBlocks?: InjectedContextBlock[];
  onCopy: (content: string, idx: number) => void;
  isCopied: boolean;
  onRetry?: () => void;
  /** 扩展交互提问（仅最后一条活动消息消费） */
  extensionDialog?: {
    request: PendingUiRequest | null;
    onAnswer: (
      id: string,
      response: { value?: string; confirmed?: boolean; cancelled?: boolean }
    ) => void;
  } | null;
}

/** 单条对话消息气泡：memo 隔离，流式更新时非活动历史消息跳过 re-render */
const ChatMessageItem: React.FC<ChatMessageItemProps> = memo(({
  msg,
  idx,
  stepNumber,
  isLast,
  agentName,
  workspaceId,
  contextBlocks,
  onCopy,
  isCopied,
  onRetry,
  extensionDialog,
}) => {
  // 正文直接透传：SSE text-delta 增量到达即随消息内容增长，Streamdown 以 streaming 模式
  // （parseIncompleteMarkdown / block 级 memo / caret）负责流式渲染，无需再叠加打字机节流。
  if (msg.role === 'user') {
    const userContent = idx === 0 ? stripInjectedContext(msg.content, contextBlocks) : msg.content;
    return (
      <div className="flex flex-col items-end gap-0.5 msg-enter-anim">
        {msg.images && msg.images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5 max-w-[85%]">
            {msg.images.map((img, i) => (
              <PhotoView key={i} src={img}>
                <img
                  src={img}
                  alt={`附带图片 ${i + 1}`}
                  className="w-16 h-16 rounded-lg object-cover cursor-zoom-in border border-white/20 shadow-sm hover:opacity-90 active:scale-[0.96] transition-transform duration-100"
                  loading="lazy"
                />
              </PhotoView>
            ))}
          </div>
        )}
        {userContent && (
          <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-accent text-white text-sm leading-relaxed whitespace-pre-wrap break-words font-sans shadow-sm select-text">
            {userContent}
          </div>
        )}
      </div>
    );
  }

  // 判定正文是否有实际内容
  const hasContent = Boolean(msg.content && msg.content.trim().length > 0);
  // 是否处于初次等待首字阶段（处于流式生成中，尚无正文，且尚无思考推理和工具步骤）
  const isWaitingInitialToken = Boolean(
    msg.streaming &&
      !hasContent &&
      !msg.reasoning &&
      (!msg.agentSteps || msg.agentSteps.length === 0)
  );
  // 是否应该渲染正文气泡：有正文、处于初次等待首字阶段、或已被用户中断
  const shouldRenderBubble = hasContent || isWaitingInitialToken || Boolean(msg.interrupted);
  // 正文引用的工作区产物（渲染时提取，与事件上报的 msg.files 合并去重）→ 文件卡片
  const cardFiles = mergeAgentFiles(
    Array.isArray(msg.files) ? msg.files : [],
    extractWorkspaceFiles(msg.content, workspaceId)
  );

  // 流式代码块降级：流式期间仅启用 cjk 插件，暂缓昂贵的 Shiki 语法高亮；待本轮流式结束后一次性高亮渲染
  const streamPlugins = useMemo(
    () => (msg.streaming ? { cjk } : { cjk, code }),
    [msg.streaming]
  );

  // 提取 ask_user_question 问答交互卡片数据（提问与用户选择）
  const questionnaireInteractions = useMemo(
    () => parseQuestionnaireInteractions(msg.agentSteps),
    [msg.agentSteps]
  );

  return (
    <div className={`flex flex-col items-start gap-1 relative group ${!msg.streaming ? 'msg-enter-anim' : ''}`}>
      {/* 1. 一体化步骤卡片（思考推理 + 工具执行） */}
      <StepActivityCard
        stepNumber={stepNumber}
        reasoning={msg.reasoning}
        agentSteps={msg.agentSteps}
        agentName={agentName}
        streaming={!!msg.streaming}
        hasContent={hasContent}
      />
      {/* 2. AI 回答正文气泡（仅在有正文、初次等待或被中断时渲染，彻底杜绝中间步骤出现空白矩形气泡） */}
      {shouldRenderBubble && (
        <div className="flex items-end w-full min-w-0">
          <div className={`max-w-[92%] px-3 py-2 rounded-2xl rounded-bl-sm bg-paper-grid/25 border border-paper-grid/60 text-sm leading-relaxed font-sans min-w-0 select-text ${isWaitingInitialToken ? 'flex items-center text-ink-light' : ''}`}>
            {isWaitingInitialToken ? (
              <div className="flex items-center gap-2 py-0.5 text-ink-light select-none">
                <div className="flex items-center gap-1.5 text-accent">
                  <Sparkles size={13} strokeWidth={2} className="animate-thinking-glow shrink-0" />
                  <span className="text-[12px] font-sans font-medium text-ink-light">思考中…</span>
                </div>
                <div className="flex items-center gap-1 h-3 pl-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/70 animate-thinking-wave" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/70 animate-thinking-wave" style={{ animationDelay: '160ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/70 animate-thinking-wave" style={{ animationDelay: '320ms' }} />
                </div>
              </div>
            ) : (
              <Streamdown
                plugins={streamPlugins}
                isAnimating={!!msg.streaming}
                caret="block"
                linkSafety={{ enabled: false }}
              >
                {/* 流式渲染：正文随 text-delta 增量增长，Streamdown streaming 模式逐块渲染 */}
                {normalizeMarkdown(stripUnrenderableImages(msg.content, workspaceId)) ||
                  (msg.interrupted ? '已中断' : '')}
              </Streamdown>
            )}
          </div>
          {!msg.streaming && hasContent && (
            <div className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={() => onCopy(msg.content, idx)}
                className="p-1.5 text-ink-faint hover:text-ink hover:bg-paper-grid/40 rounded-md transition-colors active:scale-[0.96]"
                title="复制回复"
              >
                {isCopied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          )}
        </div>
      )}
      {/* 4. 交互型扩展问答（ask_user_question / dialog）：紧随 AI 引导语下方展开，最符合自然心理阅读与交互动线 */}
      {(questionnaireInteractions.length > 0 || (isLast && extensionDialog?.request)) && (
        <div className="w-full mt-1.5">
          <QuestionAnswerBlock
            interactions={questionnaireInteractions}
            pendingUi={isLast ? extensionDialog?.request : null}
            onAnswer={extensionDialog?.onAnswer}
          />
        </div>
      )}
      {/* 5. Skill Agent 执行产生的文件：图片缩略预览 + 下载卡片（事件上报 + 正文提取合并） */}
      {cardFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1 w-full pl-0.5">
          {cardFiles.map((f) => (
            <SkillFileCard key={f.url} file={f} />
          ))}
        </div>
      )}
      {/* 被用户停止的回复：展示「重试」入口（仅当该消息是最后一条时，重试目标 = 本轮） */}
      {msg.interrupted && !msg.streaming && isLast && (
        <div className="flex items-center gap-1.5 text-[10px] font-sans text-ink-faint pl-1">
          <span className="flex items-center gap-1">
            <Square size={8} strokeWidth={2} fill="currentColor" />
            已中断
          </span>
          <button
            onClick={onRetry}
            title="重新发送该轮对话"
            className="flex items-center gap-1 rounded-md border border-paper-grid px-1.5 py-0.5 text-ink-light hover:text-accent hover:border-accent/40 hover:bg-accent/5 active:scale-[0.96] transition"
          >
            <RefreshCw size={9} strokeWidth={2} />
            重试
          </button>
        </div>
      )}
    </div>
  );
});
ChatMessageItem.displayName = 'ChatMessageItem';

/** 自动重试横幅数据（Skill Agent 结构化 agent_retry 事件驱动；倒计时在横幅内自走） */
export interface ChatRetryNotice {
  attempt: number;
  maxAttempts: number;
  delaySec: number;
  reason: string;
}

/** 排队消息（流式中发送进入队列，当前轮结束后自动依次发出） */
export interface ChatMessageQueue {
  items: { id: number; text: string; images?: string[] }[];
  onRecall: (id: number) => void;
  onSendNow: (id: number) => void;
}

/** 工作区产物面板（skill_agent 模式专用；数据由宿主从服务端拉取，其他模式不传即不渲染） */
export interface ChatWorkspaceFilesPanel {
  open: boolean;
  loading: boolean;
  files: AgentFile[];
  onToggle: () => void;
  onRefresh: () => void;
}

export interface ChatNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 对话消息列表（含正在流式的最后一条 assistant 消息） */
  messages?: ChatMessage[];
  /** 注入的结构化上下文块（按各上级节点分别展示） */
  contextBlocks?: InjectedContextBlock[];
  /** 当前节点工作区 id（Skill Agent 产物文件提取/下载归属） */
  workspaceId?: string | null;
  /** Agent 名称（该节点配置为 agent 模式时展示） */
  agentName?: string;
  /**
   * 当前轮节点级 agent 步骤：正文开始流式前（工具执行阶段）实时展示；
   * 正文开始后镜像会挂到消息级 agentSteps，此块的展示条件随即失效，避免重复。
   */
  agentSteps?: AgentStep[];
  isGenerating: boolean;
  error?: string | null;
  /** 上下文加载设置 */
  settings: ChatNodeSettings;
  /** 封面开关当前生效状态（显式设置或按 book_info 连通性的默认值），驱动设置弹层开关展示 */
  bookCoverEnabled?: boolean;
  onRemove?: (id: string) => void;
  /** 发送一条用户消息（多轮对话），images 为本轮附带图片（data URL） */
  onSend?: (id: string, text: string, images?: string[]) => void;
  /** 停止当前生成（点击后中止本次调用） */
  onStop?: (id: string) => void;
  /** 重试最后一轮（失败 / 中断后重新发送调用） */
  onRetry?: (id: string) => void;
  /** 更新上下文加载设置 */
  onUpdateSettings?: (id: string, settings: ChatNodeSettings) => void;
  /** 清空当前对话 */
  onClearChat?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  /** 卡片底部「+」插槽 */
  footer?: React.ReactNode;
  /** 根节点右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 所属自定义分组（配置了分组时在标题旁展示小标签） */
  group?: string;
  /** 标题旁的类型不匹配提示 */
  mismatchBadge?: string | null;
  /** 节点执行模式：LLM 模式下展示「模型」下拉（Agent 模式由 Agent 侧决定模型，不展示） */
  mode?: 'llm' | 'agent' | 'skill_agent';
  /** 绑定的节点配置 id（拉取服务商模型列表用） */
  configId?: number | null;
  /** 工作区产物面板（skill_agent 模式：服务端 outputs/ ∪ manifest 历史） */
  workspaceFiles?: ChatWorkspaceFilesPanel | null;
  /** 自动重试横幅（skill_agent 模式；null = 无） */
  retryNotice?: ChatRetryNotice | null;
  /** 排队消息（skill_agent 模式；不传 = 不启用排队） */
  messageQueue?: ChatMessageQueue | null;
  /** 扩展 widget（skill_agent 模式；服务端快照 + SSE 归约，跨轮保留） */
  widgets?: ExtensionWidgetItem[];
  /** 扩展交互弹层（skill_agent 模式；模型提问 select/input/confirm，作答回写服务端） */
  extensionDialog?: {
    request: PendingUiRequest | null;
    onAnswer: (
      id: string,
      response: { value?: string; confirmed?: boolean; cancelled?: boolean }
    ) => void;
  } | null;
}

const ChatNodeInner: React.FC<ChatNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  messages = [],
  contextBlocks = [],
  workspaceId,
  agentName,
  agentSteps = [],
  isGenerating,
  error,
  settings,
  bookCoverEnabled = true,
  onRemove,
  onSend,
  onStop,
  onRetry,
  onUpdateSettings,
  onClearChat,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  group,
  mismatchBadge,
  mode,
  configId,
  workspaceFiles,
  retryNotice,
  messageQueue,
  widgets = [],
  extensionDialog = null,
}) => {
  const [draft, setDraft] = useState('');
  // 本轮待发送的图片附件（data URL），随消息发送后在气泡内展示
  const [attachments, setAttachments] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { showToast } = useFeedback();
  // 是否「贴底」：贴底时新消息自动滚动到底部，向上翻阅历史时不打扰
  const stickBottomRef = useRef(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const scrollRafRef = useRef<number | null>(null);

  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  const handleCopy = useCallback(async (content: string, idx: number) => {
    try {
      await copyTextToClipboard(content);
      setCopiedId(idx);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      showToast('复制失败，请手动选择文本复制', { type: 'error' });
    }
  }, []);

  const handleDownload = () => {
    if (messages.length === 0) return;

    let md = `# ${title || 'AI 对话记录'}\n\n`;
    messages.forEach((msg) => {
      if (msg.role === 'user') {
        md += `**You**:\n${msg.content}\n`;
        // 用户附带图片以 data URL 内嵌进 Markdown（base64 不含括号/换行，可直接进图片语法），
        // 随对话一并导出：本地 Markdown 查看器（VS Code / Typora / Obsidian 等）可直接渲染
        if (msg.images && msg.images.length > 0) {
          md += `${msg.images
            .map((img, j) => `![附带图片 ${j + 1}](${img})`)
            .join('\n')}\n`;
        }
        md += '\n';
      } else {
        md += `**AI**:\n${msg.content}\n\n`;
      }
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'chat'}_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '36px';
      if (draft) {
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }
  }, [draft]);

  const handleScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = listRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      stickBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
      const needTop = scrollTop > 200;
      const needBottom = scrollHeight - scrollTop - clientHeight > 100;
      setShowScrollTop((prev) => (prev !== needTop ? needTop : prev));
      setShowScrollBottom((prev) => (prev !== needBottom ? needBottom : prev));
    });
  }, []);

  // 用户主动向上滚动时（鼠标滚轮或触摸往下滑），立即解除贴底吸附，防止被流式高频拉底干扰阅读
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      stickBottomRef.current = false;
    }
  }, []);

  const touchStartYRef = useRef<number | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartYRef.current != null) {
      const currentY = e.touches[0]?.clientY ?? touchStartYRef.current;
      if (currentY > touchStartYRef.current + 8) {
        stickBottomRef.current = false;
      }
    }
  }, []);

  // 新消息 / 流式增量 / agent 步骤到达时自动滚到底（贴底状态下使用 rAF 异步滚动，消除 Forced Reflow）
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, agentSteps]);

  // 设置弹层：点击外部 / Esc 关闭
  useEffect(() => {
    if (!settingsOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (
        settingsBtnRef.current?.contains(e.target as Node) ||
        popupRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setSettingsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

  const toggleSettings = () => {
    if (!settingsOpen && settingsBtnRef.current) {
      const rect = settingsBtnRef.current.getBoundingClientRect();
      setCoords({
        x: window.innerWidth - rect.right,
        y: window.innerHeight - rect.top + 8,
      });
    }
    setSettingsOpen((v) => !v);
  };

  /** 选择并处理附件图片（格式 / 体积校验 + 压缩），追加到附件列表 */
  const handleAttachFile = async (file: File) => {
    if (!RASTER_IMAGE_TYPES.includes(file.type)) {
      showToast('请选择 PNG / JPG / WebP / GIF 格式的图片', { type: 'error' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast('图片大小不能超过 8MB', { type: 'error' });
      return;
    }
    try {
      const raw = await fileToDataUrl(file);
      const stored = await optimizeDataUrl(raw, file.size);
      setAttachments((prev) => (prev.length < MAX_ATTACHMENTS ? [...prev, stored] : prev));
    } catch (e: any) {
      showToast(e?.message || '图片处理失败，请重试', { type: 'error' });
    }
  };

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 允许重复选择同一文件
    if (files.length === 0) return;
    files.slice(0, MAX_ATTACHMENTS - attachments.length).forEach((f) => void handleAttachFile(f));
  };

  const handleSend = () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || isGenerating) return;
    stickBottomRef.current = true;
    onSend?.(id, text, attachments.length ? attachments : undefined);
    setDraft('');
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderActionBar = () => {
    return (
      <NodeActionBar>
        {messages.length > 0 && (
          <NodeActionBar.Download onClick={handleDownload} disabled={isGenerating} />
        )}
        <NodeActionBar.SettingsTrigger
          ref={settingsBtnRef}
          onClick={toggleSettings}
          disabled={isGenerating}
          active={messages.length > 0}
          tooltip={messages.length > 0 ? "运行设置 (已锁定)" : "运行设置"}
        />
        {messages.length > 0 && (
          <NodeActionBar.Eraser
            onClick={() => onClearChat?.(id)}
            disabled={isGenerating}
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
      title={title || 'AI 对话'}
      dotColor={NODE_COLORS.chat}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 560 }}
      className={`transition-[box-shadow,border-color,opacity] duration-200 ${isGenerating && messages.length === 0 ? 'border-transparent' : ''}`}
      showLeftAnchor={true}
      showRightAnchor={true}
      footer={footer}
      groupBadge={group}
      mismatchBadge={mismatchBadge}
      actionBar={renderActionBar()}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLE_INJECTIONS }} />
      <div className="relative h-full flex flex-col flex-1 min-h-0">
        {/* 自动重试横幅（Skill Agent 结构化事件；优先级高于错误横幅——重试期间不显示错误态） */}
        {retryNotice && isGenerating && <RetryNoticeBanner notice={retryNotice} />}
        {error && !isGenerating && (
          <div className="mb-2 p-2.5 rounded-md border border-error/20 bg-error/5 flex items-start gap-2">
            <AlertTriangle size={13} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
            <p className="flex-1 min-w-0 text-[11px] text-error/90 leading-relaxed break-words font-sans">
              {error}
            </p>
            {/* 无用户消息时没有可重试的轮次（如异常初始状态），隐藏重试避免空转 */}
            {messages.some((m) => m.role === 'user') && (
              <button
                onClick={() => {
                  stickBottomRef.current = true;
                  onRetry?.(id);
                }}
                title="重新发送最后一轮对话"
                className="shrink-0 flex items-center gap-1 rounded-md border border-error/25 px-2 py-1 text-[10px] font-sans text-error hover:bg-error/10 active:scale-[0.96] transition"
              >
                <RefreshCw size={11} strokeWidth={2} />
                重试
              </button>
            )}
          </div>
        )}

        {/* 消息列表 */}
        <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
          <div
            ref={listRef}
            onScroll={handleScroll}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-2.5 pr-0.5 pb-8 chat-scroll-container"
          >
            {/* 顶部展示各个上级节点的上下文注入折叠块 */}
            {contextBlocks.length > 0 && (
              <div className="space-y-1 mb-1">
                {contextBlocks.map((block) => (
                  <ContextInjectionBlock key={block.id} block={block} />
                ))}
              </div>
            )}

            {messages.length === 0 ? (
              <div className={`${contextBlocks.length > 0 ? 'py-8' : 'h-full'} min-h-[120px] flex flex-col items-center justify-center gap-2 text-center px-4`}>
                <MessageSquare size={22} strokeWidth={1.25} className="text-ink-faint/70" />
                <p className="text-xs text-ink-faint font-sans leading-relaxed">
                  输入消息（可附带图片）开始多轮对话
                  <br />
                  支持绑定大模型、FastClaw Agent 或 Skill Agent（Pi Agent）
                </p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                // 计算当前 assistant 消息在其所属交互轮次中的步骤序号（以 user 消息为轮次分界）
                let stepNumber: number | undefined = undefined;
                if (msg.role === 'assistant') {
                  let count = 0;
                  for (let i = 0; i <= idx; i++) {
                    if (messages[i].role === 'user') {
                      count = 0;
                    } else if (messages[i].role === 'assistant') {
                      count++;
                    }
                  }
                  stepNumber = count;
                }
                return (
                  <ChatMessageItem
                    key={`${msg.role}-${idx}`}
                    msg={msg}
                    idx={idx}
                    stepNumber={stepNumber}
                    isLast={idx === messages.length - 1}
                    agentName={agentName}
                    workspaceId={workspaceId}
                    contextBlocks={contextBlocks}
                    onCopy={handleCopy}
                    isCopied={copiedId === idx}
                    onRetry={() => onRetry?.(id)}
                    extensionDialog={extensionDialog}
                  />
                );
              })
            )}
            {/* 工具执行阶段（正文尚未开始流式）的实时 Agent 日志与问答卡片：步骤先落在节点级 agentSteps，
                正文开始后由镜像挂到最后一条 assistant 消息，此块随即让位给消息级展示，避免重复 */}
            {isGenerating &&
              agentSteps.length > 0 &&
              !messages[messages.length - 1]?.agentSteps?.length && (
                <div className="w-full space-y-1">
                  <AgentActivity
                    steps={agentSteps}
                    agentName={agentName}
                    running
                    defaultOpen={false}
                  />
                  <QuestionAnswerBlock
                    interactions={parseQuestionnaireInteractions(agentSteps)}
                    pendingUi={extensionDialog?.request}
                    onAnswer={extensionDialog?.onAnswer}
                  />
                </div>
              )}
            {/* 独立交互提问（无助手消息步骤时自适应在消息区渲染） */}
            {extensionDialog?.request &&
              !messages.some((m) => m.role === 'assistant') &&
              agentSteps.length === 0 && (
                <QuestionAnswerBlock
                  pendingUi={extensionDialog.request}
                  onAnswer={extensionDialog.onAnswer}
                />
              )}
          </div>
        </PhotoProvider>

        {/* 悬浮滚动按钮 */}
        <div className="absolute right-4 bottom-14 flex flex-col gap-2 z-20 pointer-events-none">
          <div className={`transition-all duration-200 ${showScrollTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
            <ScrollButton direction="up" onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} title="回到顶部" />
          </div>
          <div className={`transition-all duration-200 ${showScrollBottom ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
            <ScrollButton
              direction="down"
              onClick={() => {
                stickBottomRef.current = true;
                listRef.current?.scrollTo({ top: listRef.current?.scrollHeight, behavior: 'smooth' });
              }}
              title="回到底部"
            />
          </div>
        </div>

        {/* 工作区产物面板（skill_agent）：服务端 outputs/ 快照 ∪ manifest 历史 */}
        {workspaceFiles && (
          <div className="shrink-0 mt-1.5">
            <div className="flex items-center gap-1.5">
              <button
                onClick={workspaceFiles.onToggle}
                className="flex items-center gap-1.5 text-[11px] font-sans text-ink-faint hover:text-accent transition-colors"
              >
                <FolderOpen size={12} strokeWidth={2} />
                <span>
                  工作区文件
                  {workspaceFiles.files.length > 0 && ` (${workspaceFiles.files.length})`}
                </span>
                {workspaceFiles.open ? (
                  <ChevronDown size={11} strokeWidth={2} className="rotate-180" />
                ) : (
                  <ChevronDown size={11} strokeWidth={2} />
                )}
              </button>
              {workspaceFiles.open && (
                <button
                  onClick={() => workspaceFiles.onRefresh()}
                  disabled={workspaceFiles.loading}
                  title="刷新产物列表"
                  className="flex items-center justify-center w-5 h-5 rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 active:scale-95 transition disabled:opacity-40"
                >
                  <RefreshCw size={10} strokeWidth={2} className={workspaceFiles.loading ? 'animate-spin' : ''} />
                </button>
              )}
            </div>
            {workspaceFiles.open && (
              <div className="mt-1.5 max-h-40 overflow-y-auto flex flex-wrap gap-2 pr-0.5">
                {workspaceFiles.loading && !workspaceFiles.files.length ? (
                  <div className="flex items-center gap-1.5 text-[10px] font-sans text-ink-faint py-1">
                    <Loader2 size={11} className="animate-spin" /> 加载中…
                  </div>
                ) : workspaceFiles.files.length === 0 ? (
                  <p className="text-[10px] font-sans text-ink-faint py-1">暂无产物文件</p>
                ) : (
                  <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
                    {workspaceFiles.files.map((f) => (
                      <SkillFileCard key={f.url || f.path} file={f} />
                    ))}
                  </PhotoProvider>
                )}
              </div>
            )}
          </div>
        )}

        {/* 排队消息（skill_agent）：流式中发送的消息先入队，当前轮结束后自动依次发出 */}
        {messageQueue && messageQueue.items.length > 0 && (
          <div className="shrink-0 mt-1.5 space-y-1">
            <p className="text-[10px] font-sans text-ink-faint">
              排队中 ({messageQueue.items.length})，当前轮结束后自动发送
            </p>
            {messageQueue.items.map((item) => (
              <QueuedMessageRow
                key={item.id}
                item={item}
                onRecall={messageQueue.onRecall}
                onSendNow={messageQueue.onSendNow}
              />
            ))}
          </div>
        )}

        {/* 扩展 widget（单实例渲染，组件内部按 placement 分组；输入框上方展示） */}
        {widgets.length > 0 && (
          <div className="shrink-0 my-2 max-h-[40%] overflow-y-auto pr-0.5 custom-scrollbar">
            <ExtensionWidgets widgets={widgets} />
          </div>
        )}

        {/* 输入区：文本 + 图片附件 */}
        <div className="shrink-0 mt-2 pt-2 border-t border-solid border-black/5 dark:border-white/5">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {attachments.map((img, i) => (
                <div
                  key={i}
                  className="relative group w-11 h-11 rounded-md overflow-hidden border border-paper-grid bg-paper"
                >
                  <img
                    src={img}
                    alt={`附件 ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    disabled={isGenerating}
                    title="移除图片"
                    className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-paper border border-paper-grid shadow-sm text-ink-faint hover:text-error hover:border-error/40 transition disabled:opacity-40"
                  >
                    <X size={9} strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={handlePick}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating || attachments.length >= MAX_ATTACHMENTS}
              title={
                attachments.length >= MAX_ATTACHMENTS
                  ? `最多附带 ${MAX_ATTACHMENTS} 张图片`
                  : '附带图片'
              }
              className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg border border-dashed border-paper-grid text-ink-faint hover:text-accent hover:border-accent/40 hover:bg-accent/5 active:scale-[0.96] transition disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ImagePlus size={15} strokeWidth={2} />
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isGenerating}
              rows={1}
              placeholder={isGenerating ? '回复生成中…' : '输入消息，Enter 发送，Shift+Enter 换行'}
              className="flex-1 min-w-0 min-h-[36px] max-h-32 overflow-y-auto resize-none rounded-lg border border-dashed border-paper-grid bg-node-bg px-3 py-1.5 text-sm font-sans text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors disabled:opacity-60"
            />
            {isGenerating ? (
              <button
                onClick={() => onStop?.(id)}
                title="停止生成"
                className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg border border-error/30 bg-error/5 text-error hover:bg-error/10 active:scale-[0.96] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
              >
                <Square size={15} strokeWidth={2} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!draft.trim() && attachments.length === 0}
                title="发送 (Enter)"
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent text-white shadow-sm hover:bg-accent/90 active:scale-[0.96] transition disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Send size={15} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 设置弹层（portal 定位，避免被节点滚动容器裁剪） */}
      {settingsOpen && typeof document !== 'undefined' && createPortal(
        <div ref={popupRef} className="fixed z-[9999]" style={{ right: coords.x, bottom: coords.y }}>
          <div className="w-64 pop-enter-anim">
            <div className="bg-paper border border-paper-grid rounded-xl shadow-xl overflow-hidden">
              <div className="px-3 py-2.5 border-b border-dashed border-paper-grid bg-paper-grid/10">
                <p className="text-xs font-sans font-medium text-ink-light">运行设置</p>
              </div>
              <div className="p-3 space-y-3">
                <SettingsToggleRow
                  label="继承图书元数据"
                  description="上游穿透的图书节点或兜底的图书节点"
                  checked={settings.includeBook}
                  onChange={(v) => onUpdateSettings?.(id, { ...settings, includeBook: v })}
                  disabled={messages.length > 0}
                />
                <SettingsToggleRow
                  label="加载图书封面图片"
                  description="上游穿透的图书节点或兜底的图书节点的封面图"
                  checked={bookCoverEnabled}
                  onChange={(v) => onUpdateSettings?.(id, { ...settings, includeBookCover: v })}
                  disabled={messages.length > 0}
                />
                <SettingsToggleRow
                  label="加载直接上级文本"
                  description="仅提取紧邻相连的父节点输出的文字内容"
                  checked={settings.includeUpstream}
                  onChange={(v) => onUpdateSettings?.(id, { ...settings, includeUpstream: v })}
                  disabled={messages.length > 0}
                />
                <SettingsToggleRow
                  label="加载直接上级图片"
                  description="仅提取紧邻相连的父节点输出的图像"
                  checked={settings.includeUpstreamImages !== false}
                  onChange={(v) => onUpdateSettings?.(id, { ...settings, includeUpstreamImages: v })}
                  disabled={messages.length > 0}
                />
                {/* 模型选择：仅 LLM 模式（Agent 模式模型由 Agent 侧决定）；候选 = admin 已配置模型，留空 = 配置默认模型 */}
                {mode === 'llm' && configId != null && (
                  <div className="space-y-1.5">
                    <div>
                      <p className="text-xs font-sans text-ink">模型</p>
                      <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                        切换为后台已配置的其他模型
                      </p>
                    </div>
                    <ModelOverrideField
                      value={settings.modelOverride}
                      onChange={(v) =>
                        onUpdateSettings?.(id, { ...settings, modelOverride: v })
                      }
                      configId={configId}
                      disabled={messages.length > 0}
                    />
                  </div>
                )}
                {/* Agent 选择：仅 Agent 模式（全部启用 FastClaw Agent，留空 = 节点绑定 Agent；
                    对话开始后锁定，需先清空对话才能切换，避免 FastClaw 服务端会话串台） */}
                {mode === 'agent' && configId != null && (
                  <div className="space-y-1.5">
                    <div>
                      <p className="text-xs font-sans text-ink">Agent</p>
                      <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                        切换为后台已配置的其他 FastClaw Agent
                      </p>
                    </div>
                    <AgentOverrideField
                      value={settings.agentOverride}
                      onChange={(v) =>
                        onUpdateSettings?.(id, { ...settings, agentOverride: v })
                      }
                      configId={configId}
                      disabled={messages.length > 0}
                    />
                  </div>
                )}
                {/* Thinking：仅 Skill Agent 模式（pi --thinking 透传；对话开始后锁定） */}
                {mode === 'skill_agent' && (
                  <div className="space-y-1.5">
                    <div>
                      <p className="text-xs font-sans text-ink">思考模式</p>
                      <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                        启用 = 高推理档；关闭 = 视模型/服务商是否支持；默认 = 跟随模型默认
                      </p>
                    </div>
                    <select
                      value={
                        settings.piThinking === 'off' ? 'off' : settings.piThinking ? 'on' : ''
                      }
                      onChange={(e) =>
                        onUpdateSettings?.(id, { ...settings, piThinking: e.target.value || undefined })
                      }
                      disabled={messages.length > 0}
                      className="w-full rounded-md border border-paper-grid bg-paper px-2 py-1.5 text-xs font-sans text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <option value="">默认（跟随模型）</option>
                      <option value="on">启用思考</option>
                      <option value="off">关闭思考</option>
                    </select>
                  </div>
                )}
                {messages.length > 0 ? (
                  <div className="flex items-start gap-1.5 p-2 rounded-md bg-paper-grid/40 border border-paper-grid text-ink-light">
                    <Lock size={12} strokeWidth={1.5} className="shrink-0 mt-0.5" />
                    <p className="text-[10px] font-sans leading-snug flex-1">
                      对话已开始，上下文配置已锁定。
                    </p>
                  </div>
                ) : (
                  <p className="text-[10px] text-ink-faint font-sans leading-snug">
                    上下文在首轮自动注入并随消息历史保持；清空对话后可重新注入。
                  </p>
                )}
                {messages.length > 0 && (
                  <div>
                    <button
                      onClick={() => {
                        setSettingsOpen(false);
                        onClearChat?.(id);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed py-1.5 text-[11px] font-sans transition border-error/30 text-error/90 hover:bg-error/5 active:scale-[0.98]"
                    >
                      <Eraser size={11} strokeWidth={2} />
                      清空对话（清空后重新注入上下文）
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </CanvasNode>
  );
};

export const ChatNode = memo(ChatNodeInner);
ChatNode.displayName = 'ChatNode';
export default ChatNode;

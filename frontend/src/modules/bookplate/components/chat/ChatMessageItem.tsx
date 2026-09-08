import React, { memo, useMemo, useState } from 'react';
import { PhotoView } from 'react-photo-view';
import { Check, Copy, Pencil, RefreshCw, Square, Trash2 } from 'lucide-react';
import { Streamdown, cjk, code } from '../../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../../platform/utils/normalizeMarkdown';
import { SkillFileCard } from './SkillFileCard';
import { StepActivityCard } from './StepActivityCard';
import { SubagentRunBlock } from '../SubagentRunBlock';
import { QuestionAnswerBlock } from '../QuestionAnswerBlock';
import { parseQuestionnaireInteractions } from '../../utils/piQuestionnaireParser';
import { parseSubagentRuns } from '../../utils/subagentParser';
import { getRandomKaomoji } from '../../utils/kaomoji';
import {
  extractUserUploadRefs,
  extractWorkspaceFiles,
  mergeAgentFiles,
  stripUnrenderableImages,
} from '../../workspaceFiles';
import { stripInjectedContext } from '../../chatSendHelpers';
import type { ChatMessage, InjectedContextBlock } from '../../../../platform/types';
import type { PendingUiRequest } from '../../piStream';

/** 格式化 token 数量展示（≥1M 带 M，≥1k 带 k，其余原样展示） */
function formatTokenCount(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return String(num);
}

interface ChatMessageItemProps {
  msg: ChatMessage;
  idx: number;
  stepNumber?: number;
  isLast: boolean;
  agentName?: string;
  /** 当前节点工作区 id（从正文提取AI 产物文件时用于换算接口 URL） */
  workspaceId?: string | null;
  /** 上下文注入块（首条 user 消息渲染时用于精准剥离上下文前缀） */
  contextBlocks?: InjectedContextBlock[];
  onCopy: (content: string, idx: number) => void;
  isCopied: boolean;
  onRetry?: () => void;
  /** 删除消息回调（仅 LLM 模式启用） */
  onDelete?: (idx: number) => void;
  /** 编辑用户消息并重新发送回调（仅 LLM 模式启用） */
  onEditResend?: (idx: number, newText: string) => void;
  /** 重试 AI 消息回调（截断当前 AI 及后续，重新发送上一条 user，仅 LLM 模式启用） */
  onRetryAssistant?: (idx: number) => void;
  /** 是否允许删除该 AI 消息 */
  canDelete?: boolean;
  /** 是否允许编辑该用户消息 */
  canEdit?: boolean;
  /** 节点是否正在流式生成中 */
  isGenerating?: boolean;
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
export const ChatMessageItem: React.FC<ChatMessageItemProps> = memo(({
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
  onDelete,
  onEditResend,
  onRetryAssistant,
  canDelete,
  canEdit,
  isGenerating,
  extensionDialog,
}) => {
  // 单条消息生成时随机确定一个专属俏皮颜文字，在当前消息流式生命周期内保持稳定
  const [kaomoji] = useState(() => getRandomKaomoji());
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');

  // 流式代码块降级：流式期间仅启用 cjk 插件，暂缓昂贵的 Shiki 语法高亮；待本轮流式结束后一次性高亮渲染
  const streamPlugins = useMemo(
    () => (msg.streaming ? { cjk } : { cjk, code }),
    [msg.streaming]
  );

  // 提取 ask_user_question 问答交互卡片数据（提问与用户选择）
  const questionnaireInteractions = useMemo(
    () => (msg.role === 'assistant' ? parseQuestionnaireInteractions(msg.agentSteps) : []),
    [msg.role, msg.agentSteps]
  );
  // 提取 subagent 运行卡片数据（对话流内独立折叠组件）
  const subagentRuns = useMemo(
    () => (msg.role === 'assistant' ? parseSubagentRuns(msg.agentSteps) : []),
    [msg.role, msg.agentSteps]
  );

  // 正文直接透传：SSE text-delta 增量到达即随消息内容增长，Streamdown 以 streaming 模式
  // （parseIncompleteMarkdown / block 级 memo / caret）负责流式渲染，无需再叠加打字机节流。
  if (msg.role === 'user') {
    const rawContent = idx === 0 ? stripInjectedContext(msg.content, contextBlocks) : msg.content;
    // 展示层把正文中的 inputs/ 上传路径提取为可预览/下载卡片（发送给模型的原文不变）
    const { files: userFiles, display: userContent } = extractUserUploadRefs(rawContent, workspaceId);

    const handleStartEdit = () => {
      setEditText(rawContent);
      setIsEditing(true);
    };

    const handleCancelEdit = () => {
      setIsEditing(false);
      setEditText('');
    };

    const handleConfirmResend = () => {
      const trimmed = editText.trim();
      if (!trimmed || isGenerating) return;
      setIsEditing(false);
      onEditResend?.(idx, trimmed);
    };

    return (
      <div className={`flex flex-col items-end gap-0.5 w-full ${isLast ? 'msg-enter-anim' : ''}`}>
        {msg.images && msg.images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5 max-w-[85%]">
            {msg.images.map((img, i) => (
              <PhotoView key={i} src={img}>
                <img
                  src={img}
                  alt={`附带图片 ${i + 1}`}
                  className="w-16 h-16 rounded-lg object-cover cursor-zoom-in border border-white/20 shadow-sm hover:opacity-90 active:scale-[0.96] transition-transform duration-100 ease-out"
                  loading="lazy"
                />
              </PhotoView>
            ))}
          </div>
        )}
        {userFiles.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5 max-w-[85%]">
            {userFiles.map((f) => (
              <SkillFileCard key={f.url} file={f} />
            ))}
          </div>
        )}
        {isEditing ? (
          <div className="w-full max-w-[90%] flex flex-col items-end gap-1.5 bg-paper-grid/20 border border-accent/40 rounded-2xl rounded-br-sm p-2.5 shadow-sm">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleConfirmResend();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelEdit();
                }
              }}
              className="w-full min-h-[64px] max-h-[220px] p-2 text-sm leading-relaxed text-ink bg-transparent focus:outline-none resize-y font-sans placeholder:text-ink-faint/50"
              placeholder="编辑此条消息..."
              autoFocus
            />
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[10px] text-ink-faint/60 font-sans mr-1 select-none">
                Ctrl+Enter 发送 · Esc 取消
              </span>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-2 py-1 text-ink-faint hover:text-ink rounded-md border border-paper-grid/60 hover:bg-paper-grid/30 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmResend}
                disabled={!editText.trim() || isGenerating}
                className="px-2.5 py-1 text-white bg-accent hover:bg-accent-hover disabled:opacity-50 rounded-md shadow-xs transition-colors font-medium"
              >
                重新发送
              </button>
            </div>
          </div>
        ) : (
          userContent && (
            <div className="relative group/user flex items-start justify-end gap-1 max-w-[85%]">
              {canEdit && !isGenerating && (
                <div className="opacity-0 group-hover/user:opacity-100 flex items-center gap-0.5 shrink-0 mt-1 transition-opacity duration-150">
                  <button
                    type="button"
                    onClick={() => onEditResend?.(idx, rawContent)}
                    aria-label="重新发送此轮对话"
                    title="重新发送此轮对话（删除后续消息）"
                    className="p-1 text-ink-faint hover:text-ink hover:bg-paper-grid/40 rounded-md transition-colors duration-150 active:scale-[0.96]"
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    aria-label="编辑并重新发送"
                    title="编辑并重新发送"
                    className="p-1 text-ink-faint hover:text-ink hover:bg-paper-grid/40 rounded-md transition-colors duration-150 active:scale-[0.96]"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              )}
              <div className="px-3 py-2 rounded-2xl rounded-br-sm bg-accent text-white text-sm leading-relaxed whitespace-pre-wrap break-words font-sans shadow-sm select-text [text-wrap:pretty]">
                {userContent}
              </div>
            </div>
          )
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
  // 正文引用的AI 产物（渲染时提取，与事件上报的 msg.files 合并去重）→ 文件卡片
  const cardFiles = mergeAgentFiles(
    Array.isArray(msg.files) ? msg.files : [],
    extractWorkspaceFiles(msg.content, workspaceId)
  );

  return (
    <div className={`flex flex-col items-start gap-1 relative group ${isLast && !msg.streaming ? 'msg-enter-anim' : ''}`}>
      {/* 1. 一体化步骤卡片（思考过程 + 工具执行步骤） */}
      <StepActivityCard
        stepNumber={stepNumber}
        reasoning={msg.reasoning}
        agentSteps={msg.agentSteps}
        agentName={agentName}
        streaming={!!msg.streaming}
        hasContent={hasContent}
        kaomoji={kaomoji}
      />
      {/* 2. AI 回答正文气泡（仅在有正文、初次等待或被中断时渲染，彻底杜绝中间步骤出现空白矩形气泡） */}
      {shouldRenderBubble && (
        <div className="flex items-end w-full min-w-0">
          <div
            className={`max-w-[92%] px-3 py-2 rounded-2xl rounded-bl-sm bg-paper-grid/25 border border-paper-grid/60 text-sm leading-relaxed font-sans min-w-0 select-text [text-wrap:pretty] ${isWaitingInitialToken ? 'flex items-center text-ink-light' : ''}`}
            style={{ '--kaomoji-caret': `"${kaomoji}"` } as React.CSSProperties}
          >
            {isWaitingInitialToken ? (
              <div className="flex items-center gap-2 py-0.5 select-none">
                <span className="text-[11px] font-sans font-medium text-accent inline-flex items-center px-1.5 py-0.5 rounded-full bg-accent/15 border border-accent/25 shadow-[0_0_8px_rgba(var(--color-accent),0.25)] animate-pulse">
                  {kaomoji}
                </span>
                <div className="flex items-center gap-1.5 h-3 pl-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/75 animate-thinking-wave" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/75 animate-thinking-wave" style={{ animationDelay: '180ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/75 animate-thinking-wave" style={{ animationDelay: '360ms' }} />
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
        </div>
      )}
      {/* 3.5 子代理运行卡片（subagent）：按对话顺序独立折叠展示；多条同现时仅最后一条默认展开 */}
      {subagentRuns.length > 0 && (
        <div className="w-full mt-1.5 space-y-1.5">
          {subagentRuns.map((run, idx) => (
            <SubagentRunBlock
              key={run.toolCallId}
              run={run}
              defaultExpanded={idx === subagentRuns.length - 1}
            />
          ))}
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
      {/* 6. Token 用量与操作栏（复制 / 删除，与 token 用量同一行） */}
      {!msg.streaming && (msg.tokenUsage || hasContent || canDelete) && (
        <div className="flex items-center justify-between w-full max-w-[92%] text-[10px] pl-1 mt-0.5 select-none min-h-[22px]">
          {/* 左侧：Token 用量与上下文窗口占比 */}
          <div className="flex items-center gap-1.5 font-mono text-ink-faint/60">
            {msg.tokenUsage ? (
              <>
                <span>
                  {formatTokenCount(msg.tokenUsage.totalTokens)} tokens
                  {msg.tokenUsage.input != null && msg.tokenUsage.output != null && (
                    <span className="opacity-75 font-sans ml-1">
                      (↑{formatTokenCount(msg.tokenUsage.input)} ↓{formatTokenCount(msg.tokenUsage.output)})
                    </span>
                  )}
                </span>
                {msg.tokenUsage.percent != null && (
                  <>
                    <span>·</span>
                    <span
                      title={
                        msg.tokenUsage.contextWindow
                          ? `模型上下文窗口：${formatTokenCount(msg.tokenUsage.contextWindow)} tokens`
                          : undefined
                      }
                    >
                      {msg.tokenUsage.percent}% 窗口
                    </span>
                  </>
                )}
              </>
            ) : <span />}
          </div>

          {/* 右侧：复制 & 重试 & 删除 操作按钮 */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {hasContent && (
              <button
                type="button"
                onClick={() => onCopy(msg.content, idx)}
                aria-label="复制回复"
                className="p-1 text-ink-faint hover:text-ink hover:bg-paper-grid/40 rounded transition-[color,background-color,transform] duration-150 active:scale-[0.96] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                title="复制回复"
              >
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
            {Boolean(onRetryAssistant) && !isGenerating && (
              <button
                type="button"
                onClick={() => onRetryAssistant?.(idx)}
                aria-label="重新生成此回复"
                className="p-1 text-ink-faint hover:text-accent hover:bg-paper-grid/40 rounded transition-[color,background-color,transform] duration-150 active:scale-[0.96] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                title="重新生成此回复（删除当前回复及后续消息）"
              >
                <RefreshCw size={12} />
              </button>
            )}
            {canDelete && !isGenerating && (
              <button
                type="button"
                onClick={() => onDelete?.(idx)}
                aria-label="删除此回复"
                className="p-1 text-ink-faint hover:text-error hover:bg-error/10 rounded transition-[color,background-color,transform] duration-150 active:scale-[0.96] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error"
                title="删除此回复"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
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
            type="button"
            onClick={onRetry}
            aria-label="重新发送该轮对话"
            title="重新发送该轮对话"
            className="flex items-center gap-1 rounded-md border border-paper-grid px-1.5 py-0.5 text-ink-light hover:text-accent hover:border-accent/40 hover:bg-accent/5 active:scale-[0.96] transition-[color,background-color,border-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
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
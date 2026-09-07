import React, { memo, useMemo, useState } from 'react';
import { PhotoView } from 'react-photo-view';
import { Check, Copy, RefreshCw, Square } from 'lucide-react';
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
  extensionDialog,
}) => {
  // 单条消息生成时随机确定一个专属俏皮颜文字，在当前消息流式生命周期内保持稳定
  const [kaomoji] = useState(() => getRandomKaomoji());

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
    return (
      <div className={`flex flex-col items-end gap-0.5 ${isLast ? 'msg-enter-anim' : ''}`}>
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
        {userContent && (
          <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-accent text-white text-sm leading-relaxed whitespace-pre-wrap break-words font-sans shadow-sm select-text [text-wrap:pretty]">
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
          {!msg.streaming && hasContent && (
            <div className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                type="button"
                onClick={() => onCopy(msg.content, idx)}
                aria-label="复制回复"
                className="p-1.5 text-ink-faint hover:text-ink hover:bg-paper-grid/40 rounded-md transition-[color,background-color,transform] duration-150 active:scale-[0.96] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                title="复制回复"
              >
                {isCopied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          )}
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
      {/* 6. Token 用量与上下文窗口占比（非流式且有 tokenUsage 时展示） */}
      {!msg.streaming && msg.tokenUsage && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-ink-faint/60 pl-1 mt-0.5 select-none">
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
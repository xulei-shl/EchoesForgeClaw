import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, MessageSquare, RefreshCw } from 'lucide-react';
import { PhotoProvider } from 'react-photo-view';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar, copyTextToClipboard } from '../../../platform/components/node/NodeActionBar';
import { AgentActivity } from '../../../platform/components/agent/AgentActivity';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import type { AgentStep, ChatMessage, ChatNodeSettings, InjectedContextBlock } from '../../../platform/types';
import { ContextInjectionBlock } from './ContextInjectionBlock';
import { ExtensionWidgets } from './ExtensionWidgets';
import { QuestionAnswerBlock } from './QuestionAnswerBlock';
import { parseQuestionnaireInteractions } from '../utils/piQuestionnaireParser';
import { buildChatMarkdown } from '../utils/chatExport';
import type { ExtensionWidgetItem, PendingUiRequest } from '../piStream';
import { NODE_COLORS } from '../nodeTypes';
import { ChatMessageItem } from './chat/ChatMessageItem';
import {
  QueuedMessageRow,
  RetryNoticeBanner,
  type ChatMessageQueue,
  type ChatRetryNotice,
} from './chat/ChatStatusBanners';
import { ChatNodeComposer } from './chat/ChatNodeComposer';
import { ChatNodeSettingsPopover } from './chat/ChatNodeSettingsPopover';
import { ScrollButtons } from './chat/ScrollButtons';
import {
  ChatSidePanelDrawer,
  type ChatSidePanel,
} from './chat/ChatSidePanel';
import { CHAT_STYLE_INJECTIONS } from './chatStyles';

export type { ChatRetryNotice, ChatMessageQueue } from './chat/ChatStatusBanners';
export type { ChatSidePanel } from './chat/ChatSidePanel';

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
  /**
   * Skill Agent 模式：任意格式文件上传到工作区 inputs/ 的回调（返回工作区相对路径）。
   * 缺省 = 不启用文件附件（图片-only base64 行为）。
   */
  onUploadFile?: (file: File) => Promise<{ name: string; path: string; mime: string; size: number }>;
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
  /** 调整尺寸中（每帧）实时回调，供父级命令式更新连线，不触发 React 渲染 */
  onResizeLive?: (id: string, width: number, height: number) => void;
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
  /**
   * 侧边面板（单一右侧吸附抽屉，Tab 切换）：AI 产物 / 我的上传（skill_agent +
   * FastClaw agent）+ 对话历史（skill_agent 模式：该节点 pi 会话列表，点击载入 / 置顶 / 删除）
   */
  sidePanel?: ChatSidePanel | null;
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
  onUploadFile,
  onStop,
  onRetry,
  onUpdateSettings,
  onClearChat,
  onPositionChange,
  onSizeChange,
  onDrag,
  onResizeLive,
  footer,
  onContextMenu,
  group,
  mismatchBadge,
  mode,
  configId,
  sidePanel,
  retryNotice,
  messageQueue,
  widgets = [],
  extensionDialog = null,
}) => {
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const { showToast } = useFeedback();
  // 是否「贴底」：贴底时新消息自动滚动到底部，向上翻阅历史时不打扰
  const stickBottomRef = useRef(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  // 窗口级拦截：拖拽文件到节点/画布任意位置时不触发浏览器默认行为（打开/导航到文件）
  useEffect(() => {
    const preventFileNav = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', preventFileNav);
    window.addEventListener('drop', preventFileNav);
    return () => {
      window.removeEventListener('dragover', preventFileNav);
      window.removeEventListener('drop', preventFileNav);
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
    const md = buildChatMarkdown(title, messages);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'chat'}_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = listRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      const distFromBottom = scrollHeight - scrollTop - clientHeight;
      // 迟滞区间保护：离底 <= 24px 自动恢复吸附，离底 > 48px 稳定保持自由阅览
      if (distFromBottom <= 24) {
        stickBottomRef.current = true;
      } else if (distFromBottom > 48) {
        stickBottomRef.current = false;
      }
      const needTop = scrollTop > 160;
      const needBottom = distFromBottom > 80;
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

  const renderActionBar = () => {
    return (
      <NodeActionBar>
        {sidePanel && (
          <NodeActionBar.SidePanel
            open={sidePanel.open}
            loading={sidePanel.filesLoading || !!sidePanel.sessionsLoading}
            onClick={sidePanel.onToggle}
            tooltip={sidePanel.open ? '收起侧边面板 (Esc)' : '侧边面板（产物 / 文件 / 历史）'}
          />
        )}
        {messages.length > 0 && (
          <NodeActionBar.Download onClick={handleDownload} disabled={isGenerating} />
        )}
        <NodeActionBar.SettingsTrigger
          ref={settingsBtnRef}
          onClick={toggleSettings}
          disabled={isGenerating}
          active={messages.length > 0}
          tooltip={messages.length > 0 ? "运行设置 (模型可切换；上下文与 Agent 已锁定)" : "运行设置"}
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
      onResizeLive={onResizeLive}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 560 }}
      className={`transition-[border-color,opacity] duration-150 ${isGenerating && messages.length === 0 ? 'border-transparent' : ''}`}
      showLeftAnchor={true}
      showRightAnchor={true}
      footer={footer}
      groupBadge={group}
      mismatchBadge={mismatchBadge}
      // 抽屉必须挂在 sideDrawer 根级插槽（渲染在内容区 overflow 之外，见
      // docs/节点侧边吸附抽屉使用指南.md 2.1：写进 children 会被 overflow-x-hidden 裁切）。
      // 单一右侧吸附抽屉，工作区文件与对话历史经 Tab 切换（见 ChatSidePanel）。
      sideDrawer={sidePanel ? <ChatSidePanelDrawer panel={sidePanel} /> : undefined}
      actionBar={renderActionBar()}
    >
      <style dangerouslySetInnerHTML={{ __html: CHAT_STYLE_INJECTIONS }} />
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
                type="button"
                onClick={() => {
                  stickBottomRef.current = true;
                  onRetry?.(id);
                }}
                aria-label="重新发送最后一轮对话"
                title="重新发送最后一轮对话"
                className="shrink-0 flex items-center gap-1 rounded-md border border-error/25 px-2 py-1 text-[10px] font-sans text-error hover:bg-error/10 active:scale-[0.96] transition-[color,background-color,border-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error"
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
        <ScrollButtons
          showTop={showScrollTop}
          showBottom={showScrollBottom}
          onScrollTop={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          onScrollBottom={() => {
            stickBottomRef.current = true;
            listRef.current?.scrollTo({ top: listRef.current?.scrollHeight, behavior: 'smooth' });
          }}
        />


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

        {/* 输入区：文本 + 附件 + 拖拽上传 + @ 工作区文件引用（见 ChatNodeComposer） */}
        <ChatNodeComposer
          mode={mode}
          onUploadFile={onUploadFile}
          isGenerating={isGenerating}
          workspaceId={workspaceId}
          onSend={(text, images) => {
            stickBottomRef.current = true;
            onSend?.(id, text, images);
          }}
          onStop={() => onStop?.(id)}
        />
      </div>

      {/* 设置弹层（portal 定位，避免被节点滚动容器裁剪） */}
      <ChatNodeSettingsPopover
        open={settingsOpen}
        coords={coords}
        popupRef={popupRef}
        settings={settings}
        bookCoverEnabled={bookCoverEnabled}
        mode={mode}
        configId={configId}
        hasMessages={messages.length > 0}
        onUpdateSettings={(next) => onUpdateSettings?.(id, next)}
        onClearChat={() => onClearChat?.(id)}
        onClose={() => setSettingsOpen(false)}
      />
    </CanvasNode>
  );
};

export const ChatNode = memo(ChatNodeInner);
ChatNode.displayName = 'ChatNode';
export default ChatNode;
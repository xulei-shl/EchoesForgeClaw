import React, { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Eraser, ImagePlus, Link2, MessageSquare, Send, Copy, Check, Loader2, Square, RefreshCw, ChevronUp, ChevronDown, Lock, X, FileText, Download, Brain } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { AgentActivity } from '../../../platform/components/agent/AgentActivity';
import { Toggle } from '../../../platform/components/ui/Toggle';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import type { AgentFile, AgentStep, ChatMessage, ChatNodeSettings } from '../../../platform/types';
import { NODE_COLORS } from '../nodeTypes';
import {
  RASTER_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  fileToDataUrl,
  optimizeDataUrl,
} from '../imageUpload';

// 单轮最多附带的图片数（与后端透传上限保持一致）
const MAX_ATTACHMENTS = 4;

/** 带鉴权获取 skill 执行产生的文件字节。
 *  skill-files 接口要求登录鉴权，<img> / <a href> 无法携带 Authorization 头，
 *  因此图片预览与文件下载统一走 fetch + token → blob → objectURL 路线。 */
async function fetchSkillFile(file: AgentFile): Promise<Blob> {
  const token = localStorage.getItem('token');
  const resp = await fetch(file.url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.blob();
}

/** 文件大小人类可读格式（B / KB / MB） */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Skill Agent 执行产生的文件卡片：图片内联缩略预览（鉴权 fetch → blob → objectURL），其他类型展示下载按钮。 */
const SkillFileCard: React.FC<{ file: AgentFile }> = memo(({ file }) => {
  const { showToast } = useFeedback();
  const isImage = file.mime?.startsWith('image/') ?? false;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // 图片：加载为 blob → objectURL 后展示缩略图（组件卸载时释放）
  useEffect(() => {
    if (!isImage) return;
    let url: string | null = null;
    let cancelled = false;
    fetchSkillFile(file)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, isImage]);

  const handleDownload = async () => {
    try {
      const blob = await fetchSkillFile(file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('文件下载失败，请重试', { type: 'error' });
    }
  };

  if (isImage) {
    const thumb = (
      <div className="relative group w-20 h-20 rounded-lg overflow-hidden border border-paper-grid bg-paper cursor-zoom-in shrink-0">
        {objectUrl ? (
          <img src={objectUrl} alt={file.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {failed ? (
              <span className="text-[10px] text-ink-faint font-sans">加载失败</span>
            ) : (
              <Loader2 size={14} className="animate-spin text-ink-faint" />
            )}
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            void handleDownload();
          }}
          title="下载文件"
          className="absolute bottom-1 right-1 flex items-center justify-center w-6 h-6 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-black/70 transition"
        >
          <Download size={12} strokeWidth={2} />
        </button>
      </div>
    );
    // 图片加载完成（objectURL 可用）后才挂 PhotoView，避免 src 为空时点击出错
    return objectUrl ? <PhotoView src={objectUrl}>{thumb}</PhotoView> : thumb;
  }

  return (
    <div className="flex items-center gap-2 max-w-full rounded-lg border border-paper-grid bg-paper-grid/20 px-2.5 py-1.5 hover:bg-paper-grid/40 transition-colors msg-enter-anim">
      <FileText size={15} strokeWidth={1.75} className="text-ink-faint shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-sans text-ink truncate" title={file.name}>
          {file.name}
        </p>
        {typeof file.size === 'number' && file.size > 0 && (
          <p className="text-[10px] text-ink-faint font-sans">{formatFileSize(file.size)}</p>
        )}
      </div>
      <button
        onClick={() => void handleDownload()}
        title="下载文件"
        className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 active:scale-95 transition"
      >
        <Download size={13} strokeWidth={2} />
      </button>
    </div>
  );
});
SkillFileCard.displayName = 'SkillFileCard';

/** 模型思考过程（reasoning）折叠块：弱化样式、默认收起，点击展开。
 *
 * 交互时序：
 * - 思考阶段（仅 reasoning、尚无正文）自动展开，实时可见思考过程；
 * - 正文开始输出（hasContent 由 false -> true）时自动平滑收起——思考已完成，
 *   让注意力回到回答上；此自动收起只触发一次，之后用户的手动展开/收起不受影响。
 * - 挂载时已有正文（非流式历史消息）默认收起。
 */
const ReasoningBlock: React.FC<{
  text: string;
  streaming: boolean;
  hasContent: boolean;
}> = memo(({ text, streaming, hasContent }) => {
  const [open, setOpen] = useState(false);
  // 记录是否已见过正文：正文首次出现时自动收起（仅一次）
  const sawContentRef = useRef(hasContent);
  useEffect(() => {
    if (hasContent && !sawContentRef.current) {
      sawContentRef.current = true;
      setOpen(false);
    }
  }, [hasContent]);

  const tailText = text.slice(-50).replace(/\n/g, ' ');

  return (
    <div className="w-full mb-1 rounded-lg border border-dashed border-paper-grid/80 bg-paper-grid/15 overflow-hidden msg-enter-anim">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-ink-faint hover:text-ink-light font-sans transition-colors overflow-hidden"
        title={open ? '收起思考过程' : '展开思考过程'}
      >
        <Brain size={11} strokeWidth={1.75} className={open ? 'text-accent shrink-0' : 'shrink-0'} />
        <span className={open ? 'text-ink-light shrink-0' : 'shrink-0'}>思考过程</span>
        
        {!open && tailText && (
          <span className="flex-1 min-w-0 mx-1 overflow-hidden whitespace-nowrap text-right mask-gradient-left text-ink-faint/70 select-none">
            {tailText}
          </span>
        )}

        <span className={`flex items-center gap-1 shrink-0 ${open || !tailText ? 'ml-auto' : ''}`}>
          {streaming && <Loader2 size={10} className="animate-spin text-ink-faint" />}
          {open ? (
            <ChevronUp size={11} strokeWidth={2} />
          ) : (
            <ChevronDown size={11} strokeWidth={2} />
          )}
        </span>
      </button>
      {/* grid-rows 0fr/1fr 过渡：折叠/展开平滑动画（无需固定高度） */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <pre className="text-[11px] text-ink-light font-sans whitespace-pre-wrap leading-relaxed px-2.5 pb-2 max-h-44 overflow-y-auto custom-scrollbar border-t border-dashed border-paper-grid/50">
            {text}
          </pre>
        </div>
      </div>
    </div>
  );
});
ReasoningBlock.displayName = 'ReasoningBlock';

const STYLE_INJECTIONS = `
@keyframes msg-enter {
  0% { opacity: 0; transform: translateY(8px); }
  100% { opacity: 1; transform: translateY(0); }
}
.msg-enter-anim { animation: msg-enter 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
@keyframes pop-enter {
  0% { opacity: 0; transform: scale(0.96); transform-origin: bottom right; }
  100% { opacity: 1; transform: scale(1); transform-origin: bottom right; }
}
.pop-enter-anim { animation: pop-enter 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
.mask-gradient-left {
  mask-image: linear-gradient(to right, transparent, black 16px);
  -webkit-mask-image: linear-gradient(to right, transparent, black 16px);
}
`;

export interface ChatNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 对话消息列表（含正在流式的最后一条 assistant 消息） */
  messages?: ChatMessage[];
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
  /** 是否有下级节点关联 */
  hasDownstream?: boolean;
  /** 标题旁的类型不匹配提示 */
  mismatchBadge?: string | null;
}

const ChatNodeInner: React.FC<ChatNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  messages = [],
  agentName,
  agentSteps = [],
  isGenerating,
  error,
  settings,
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
  hasDownstream,
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

  const handleCopy = (content: string, idx: number) => {
    navigator.clipboard.writeText(content);
    setCopiedId(idx);
    setTimeout(() => setCopiedId(null), 2000);
  };

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

  const handleScroll = () => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) {
        const { scrollTop, scrollHeight, clientHeight } = el;
        stickBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
        setShowScrollTop(scrollTop > 200);
        setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 100);
      }
      scrollRafRef.current = null;
    });
  };

  // 新消息 / 流式增量 / agent 步骤到达时自动滚到底（贴底状态下）
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      if (stickBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      handleScroll();
    }
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
          tooltip={messages.length > 0 ? "上下文设置 (已锁定)" : "上下文设置"}
        />
        {messages.length > 0 && (
          <NodeActionBar.Eraser
            onClick={() => onClearChat?.(id)}
            disabled={isGenerating}
            hasDownstream={hasDownstream}
          />
        )}
      </NodeActionBar>
    );
  };

  const renderMessage = (msg: ChatMessage, idx: number) => {
    if (msg.role === 'user') {
      const hasHiddenContext = !!(msg.context || msg.contextImages?.length);
      return (
        <div key={idx} className="flex flex-col items-end gap-0.5 msg-enter-anim">
          {hasHiddenContext && (
            <span className="text-[10px] text-ink-faint font-sans flex items-center gap-1">
              <Link2 size={9} strokeWidth={2} />
              已附带上下文
            </span>
          )}
          {msg.images && msg.images.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5 max-w-[85%]">
              {msg.images.map((img, i) => (
                <PhotoView key={i} src={img}>
                  <img
                    src={img}
                    alt={`附带图片 ${i + 1}`}
                    className="w-16 h-16 rounded-lg object-cover cursor-zoom-in border border-white/20 shadow-sm hover:opacity-90 active:scale-95 transition"
                    loading="lazy"
                  />
                </PhotoView>
              ))}
            </div>
          )}
          {msg.content && (
            <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-accent text-white text-[13px] leading-relaxed whitespace-pre-wrap break-words font-sans shadow-sm">
              {msg.content}
            </div>
          )}
        </div>
      );
    }
    // 思考占位：仅当流式且正文/思考都还没有内容时显示「思考中...」；
    // 思考一旦开始产出（reasoning 独立字段），改由 ReasoningBlock 折叠块展示
    const isThinking = msg.streaming && !msg.content && !msg.reasoning;

    return (
      <div key={idx} className="flex flex-col items-start gap-1 relative group msg-enter-anim">
        {msg.agentSteps && msg.agentSteps.length > 0 && (
          <div className="w-full mb-1">
            <AgentActivity
              steps={msg.agentSteps}
              agentName={agentName}
              running={!!msg.streaming}
            />
          </div>
        )}
        {/* 模型思考过程（reasoning）：与回答正文分离的折叠块；正文开始输出后自动收起 */}
        {msg.reasoning && (
          <ReasoningBlock
            text={msg.reasoning}
            streaming={!!msg.streaming}
            hasContent={!!msg.content}
          />
        )}
        <div className="flex items-end w-full min-w-0">
          <div className={`max-w-[92%] px-3 py-2 rounded-2xl rounded-bl-sm bg-paper-grid/25 border border-paper-grid/60 text-[13px] leading-relaxed font-sans min-w-0 ${isThinking ? 'flex items-center gap-1.5 text-ink-faint' : ''}`}>
            {isThinking ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>思考中...</span>
              </>
            ) : (
              <Streamdown
                plugins={{ cjk, code }}
                isAnimating={!!msg.streaming}
                caret="block"
                linkSafety={{ enabled: false }}
              >
                {normalizeMarkdown(msg.content) || (msg.interrupted ? '已中断' : '…')}
              </Streamdown>
            )}
          </div>
          {!msg.streaming && (
            <div className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={() => handleCopy(msg.content, idx)}
                className="p-1.5 text-ink-faint hover:text-ink hover:bg-paper-grid/40 rounded-md transition-colors"
                title="复制回复"
              >
                {copiedId === idx ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          )}
        </div>
        {/* Skill Agent 执行产生的文件：图片缩略预览 + 下载卡片 */}
        {msg.files && msg.files.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1 w-full pl-0.5">
            {msg.files.map((f) => (
              <SkillFileCard key={f.url} file={f} />
            ))}
          </div>
        )}
        {/* 被用户停止的回复：展示「重试」入口（仅当该消息是最后一条时，重试目标 = 本轮） */}
        {msg.interrupted && !msg.streaming && idx === messages.length - 1 && (
          <div className="flex items-center gap-1.5 text-[10px] font-sans text-ink-faint pl-1">
            <span className="flex items-center gap-1">
              <Square size={8} strokeWidth={2} fill="currentColor" />
              已中断
            </span>
            <button
              onClick={() => onRetry?.(id)}
              title="重新发送该轮对话"
              className="flex items-center gap-1 rounded-md border border-paper-grid px-1.5 py-0.5 text-ink-light hover:text-accent hover:border-accent/40 hover:bg-accent/5 active:scale-95 transition"
            >
              <RefreshCw size={9} strokeWidth={2} />
              重试
            </button>
          </div>
        )}
      </div>
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
        {error && !isGenerating && (
          <div className="mb-2 p-2.5 rounded-md border border-error/20 bg-error/5 flex items-start gap-2">
            <AlertTriangle size={13} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
            <p className="flex-1 min-w-0 text-[11px] text-error/90 leading-relaxed break-words font-sans">
              {error}
            </p>
            {/* 无用户消息时没有可重试的轮次（如异常初始状态），隐藏重试避免空转 */}
            {messages.some((m) => m.role === 'user') && (
              <button
                onClick={() => onRetry?.(id)}
                title="重新发送最后一轮对话"
                className="shrink-0 flex items-center gap-1 rounded-md border border-error/25 px-2 py-1 text-[10px] font-sans text-error hover:bg-error/10 active:scale-95 transition"
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
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-2.5 pr-0.5"
          >
            {messages.length === 0 ? (
              <div className="h-full min-h-[120px] flex flex-col items-center justify-center gap-2 text-center px-4">
                <MessageSquare size={22} strokeWidth={1.25} className="text-ink-faint/70" />
                <p className="text-xs text-ink-faint font-sans leading-relaxed">
                  输入消息（可附带图片）开始多轮对话
                  <br />
                  支持绑定大模型、FastClaw Agent 或 Skill Agent（加载 skill 执行）
                </p>
              </div>
            ) : (
              messages.map(renderMessage)
            )}
            {/* 工具执行阶段（正文尚未开始流式）的实时 Agent 日志：步骤先落在节点级 agentSteps，
                正文开始后由镜像挂到最后一条 assistant 消息，此块随即让位给消息级展示，避免重复 */}
            {isGenerating &&
              agentSteps.length > 0 &&
              !messages[messages.length - 1]?.agentSteps?.length && (
                <div className="w-full">
                  <AgentActivity steps={agentSteps} agentName={agentName} running />
                </div>
              )}
          </div>
        </PhotoProvider>

        {/* 悬浮滚动按钮 */}
        <div className="absolute right-4 bottom-14 flex flex-col gap-2 z-20 pointer-events-none">
          <div className={`transition-all duration-300 ${showScrollTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
            <button
              onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              className="pointer-events-auto flex items-center justify-center w-7 h-7 rounded-full bg-paper/90 border border-paper-grid/60 shadow-sm text-ink-faint hover:text-ink hover:bg-paper-grid hover:shadow backdrop-blur-md transition-all active:scale-95"
              title="回到顶部"
            >
              <ChevronUp size={16} strokeWidth={2} />
            </button>
          </div>
          <div className={`transition-all duration-300 ${showScrollBottom ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
            <button
              onClick={() => listRef.current?.scrollTo({ top: listRef.current?.scrollHeight, behavior: 'smooth' })}
              className="pointer-events-auto flex items-center justify-center w-7 h-7 rounded-full bg-paper/90 border border-paper-grid/60 shadow-sm text-ink-faint hover:text-ink hover:bg-paper-grid hover:shadow backdrop-blur-md transition-all active:scale-95"
              title="回到底部"
            >
              <ChevronDown size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

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
              className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg border border-dashed border-paper-grid text-ink-faint hover:text-accent hover:border-accent/40 hover:bg-accent/5 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
              className="flex-1 min-w-0 min-h-[36px] max-h-32 overflow-y-auto resize-none rounded-lg border border-dashed border-paper-grid bg-node-bg px-3 py-1.5 text-[13px] font-sans text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors disabled:opacity-60"
            />
            {isGenerating ? (
              <button
                onClick={() => onStop?.(id)}
                title="停止生成"
                className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg border border-error/30 bg-error/5 text-error hover:bg-error/10 active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
              >
                <Square size={15} strokeWidth={2} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!draft.trim() && attachments.length === 0}
                title="发送 (Enter)"
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent text-white shadow-sm hover:bg-accent/90 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
                <p className="text-xs font-sans font-medium text-ink-light">上下文设置</p>
              </div>
              <div className="p-3 space-y-3">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-sans text-ink">包含图书元数据</p>
                    <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                      连线上游的图书元数据（无连线时取画布根节点）
                    </p>
                  </div>
                  <Toggle
                    checked={settings.includeBook}
                    onChange={(v) => onUpdateSettings?.(id, { ...settings, includeBook: v })}
                    label="包含图书元数据"
                    disabled={messages.length > 0}
                  />
                </div>
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-sans text-ink">加载上一级节点内容</p>
                    <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                      紧随的上级节点输出（支持对话节点串联）
                    </p>
                  </div>
                  <Toggle
                    checked={settings.includeUpstream}
                    onChange={(v) => onUpdateSettings?.(id, { ...settings, includeUpstream: v })}
                    label="加载上一级节点内容"
                    disabled={messages.length > 0}
                  />
                </div>
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-sans text-ink">加载上级图片</p>
                    <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                      紧随的上级节点图片（图片上传 / 图像生成节点），随对话一并交给模型 / Agent
                    </p>
                  </div>
                  <Toggle
                    checked={settings.includeUpstreamImages !== false}
                    onChange={(v) =>
                      onUpdateSettings?.(id, { ...settings, includeUpstreamImages: v })
                    }
                    label="加载上级图片"
                    disabled={messages.length > 0}
                  />
                </div>
                {messages.length > 0 ? (
                  <div className="flex items-start gap-1.5 p-2 rounded-md bg-paper-grid/40 border border-paper-grid text-ink-light">
                    <Lock size={12} strokeWidth={1.5} className="shrink-0 mt-0.5" />
                    <p className="text-[10px] font-sans leading-snug flex-1">
                      对话已开始，上下文配置已锁定。如需修改，请先清空对话。
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

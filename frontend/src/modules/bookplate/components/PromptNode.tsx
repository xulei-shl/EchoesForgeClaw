import React, { memo, useState, useRef, useEffect } from 'react';
import { Sparkles, Pencil, Check, X, RefreshCw, ChevronDown, ChevronRight, ImageIcon, Upload, AlertTriangle } from 'lucide-react';
import { Streamdown, cjk } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { Textarea } from '../../../platform/components/ui/Textarea';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { AgentActivity } from '../../../platform/components/agent/AgentActivity';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import type { AgentStep } from '../../../platform/types';

// 上传参考图体积上限（与后端 MAX_UPLOAD_IMAGE_BYTES 保持一致）
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
// 允许上传的位图格式（与后端魔数校验一致；SVG 等矢量格式无文件头魔数，会被后端拒绝）
const RASTER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export interface PromptNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  content: string;
  coverAnalysis?: string;
  /** Agent 模式中间步骤（工具调用 / 思考状态） */
  agentSteps?: AgentStep[];
  /** Agent 名称（stage2 生效模式为 agent 时展示） */
  agentName?: string;
  isGenerating: boolean;
  error?: string | null;
  onRemove?: (id: string) => void;
  /** 生成失败/超时后重试生成提示词；image 为最近一次「重新生成」上传的参考图（base64 data URL） */
  onRetry?: (id: string, image?: string) => void;
  onGenerateImage?: (id: string) => void;
  onEditContent?: (id: string, content: string) => void;
  /** 编辑模式：上传参考图后重新生成提示词（image 为 base64 data URL，空则不携带） */
  onRegenerate?: (id: string, image?: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
}

const PromptNodeInner: React.FC<PromptNodeProps> = ({
  id,
  initialX,
  initialY,
  content,
  coverAnalysis,
  agentSteps,
  agentName,
  isGenerating,
  error,
  onRemove,
  onRetry,
  onGenerateImage,
  onEditContent,
  onRegenerate,
  onPositionChange,
  onSizeChange,
  onDrag,
}) => {
  const { dialog, showToast } = useFeedback();
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 编辑模式上传的参考图（base64 data URL，仅存内存，不写入节点数据/持久化）
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 最近一次「重新生成」携带的参考图：生成失败后点「重试」时复用，避免用户重新上传
  const lastRegenImageRef = useRef<string | null>(null);

  useEffect(() => {
    setEditContent(content);
  }, [content]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  /** 退出编辑模式前检查：上传了图片但未点击「重新生成」时给出确认提示（需求 3） */
  const confirmDiscardUpload = async (): Promise<boolean> => {
    if (!uploadedImage) return true;
    const ok = await dialog.confirm({
      title: '上传的图片尚未使用',
      message: '已上传参考图但未点击「重新生成」。继续操作后该图片将被丢弃，提示词不会基于它生成。是否继续？',
      confirmText: '继续',
      cancelText: '返回编辑',
    });
    return ok;
  };

  const handleSave = async () => {
    if (!(await confirmDiscardUpload())) return;
    onEditContent?.(id, editContent);
    setIsEditing(false);
    setUploadedImage(null);
    setUploadedName('');
  };

  const handleCancel = async () => {
    if (!(await confirmDiscardUpload())) return;
    setEditContent(content);
    setIsEditing(false);
    setUploadedImage(null);
    setUploadedName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSave();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      void handleCancel();
    }
  };

  const handlePickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file) return;
    if (!RASTER_IMAGE_TYPES.includes(file.type)) {
      showToast('请选择 PNG / JPG / WebP / GIF 格式的图片', { type: 'error' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast('图片大小不能超过 8MB', { type: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedImage(reader.result as string);
      setUploadedName(file.name);
    };
    reader.onerror = () => {
      showToast('图片读取失败，请重试', { type: 'error' });
    };
    reader.readAsDataURL(file);
  };

  /** 点击「重新生成」：把上传图片交给父级，沿 Stage 2 封面分析 + 元数据合并流式生成 */
  const handleRegenerate = () => {
    if (!uploadedImage || isGenerating || !onRegenerate) return;
    lastRegenImageRef.current = uploadedImage;
    onRegenerate?.(id, uploadedImage);
    // 退出编辑模式，由父级接管生成态（清空内容 → 加载动画 → 流式输出）
    setUploadedImage(null);
    setUploadedName('');
    setIsEditing(false);
  };

  const actionBtn =
    'flex items-center justify-center w-7 h-7 rounded-full ' +
    'text-ink-light hover:text-ink hover:bg-paper-grid/40 ' +
    'active:scale-[0.97] transition ' +
    'disabled:opacity-40 disabled:cursor-not-allowed ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  const renderActionBar = () => {
    if (isGenerating) return undefined;

    if (isEditing) {
      return (
        <>
          {uploadedImage && onRegenerate && (
            <Tooltip content="重新生成 (合并参考图与图书元数据)">
              <button
                onClick={handleRegenerate}
                disabled={isGenerating}
                className={actionBtn + (!isGenerating ? ' hover:text-accent hover:bg-accent/10' : '')}
              >
                <RefreshCw size={16} strokeWidth={1.5} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="保存 (Ctrl+Enter)">
            <button
              onClick={() => void handleSave()}
              className={actionBtn}
            >
              <Check size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
          <Tooltip content="取消 (Esc)">
            <button
              onClick={() => void handleCancel()}
              className={actionBtn}
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </>
      );
    }

    if (!content && !error) return undefined;

    return (
      <>
        {(error || content) && onRetry && (
          <Tooltip content={error ? '重试' : '重新生成'}>
            <button
              onClick={() => onRetry?.(id, lastRegenImageRef.current ?? undefined)}
              className={actionBtn + (error ? ' text-error hover:text-error hover:bg-error/10' : '')}
            >
              <RefreshCw size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
        {content && onEditContent && (
          <Tooltip content="编辑">
            <button
              onClick={() => setIsEditing(true)}
              className={actionBtn}
            >
              <Pencil size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
        {content && onGenerateImage && (
          <Tooltip content="生成藏书票">
            <button
              onClick={() => onGenerateImage?.(id)}
              className={actionBtn}
            >
              <Sparkles size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
      </>
    );
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title="图像提示词"
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      resizable
      defaultSize={{ width: 420, height: 500 }}
      className={`transition-[box-shadow,border-color,opacity] duration-200 ${isGenerating && !content ? 'border-transparent' : ''}`}
      glowOverlay={isGenerating && !content ? <BeamGlow /> : undefined}
      showLeftAnchor={true}
      showRightAnchor={true}
      actionBar={renderActionBar()}
    >
      <div className="relative h-full flex flex-col flex-1 min-h-0">
        {/* Agent 模式中间步骤（可折叠） */}
        <AgentActivity
          steps={agentSteps}
          agentName={agentName}
          running={isGenerating && !!agentName}
        />
        {/* 第一步：封面图像分析（可折叠） */}
        {coverAnalysis && (
          <div className="shrink-0 min-h-0 border-b border-dashed border-paper-grid pb-2 mb-2">
            <button
              onClick={() => setAnalysisOpen((v) => !v)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs text-ink-light hover:text-ink hover:bg-paper-grid/30 transition-colors"
            >
              {analysisOpen ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
              <ImageIcon size={13} strokeWidth={1.5} className="text-accent" />
              <span className="font-serif">封面分析</span>
            </button>
            {analysisOpen && (
              <pre className="max-h-40 overflow-y-auto px-3 pb-2 text-[11px] leading-relaxed text-ink-light font-mono whitespace-pre-wrap">
                {coverAnalysis}
              </pre>
            )}
          </div>
        )}
        <div className="relative z-10 flex flex-col h-full flex-1 min-h-0">
          {isEditing ? (
            <div className="flex flex-col flex-1 min-h-0 gap-2">
              <Textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 min-h-0 w-full resize-none"
              />
              {/* 上传参考图 → 重新生成（需求 2） */}
              <div className="shrink-0 mt-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={handlePickImage}
                />
                {uploadedImage ? (
                  <div className="flex items-center gap-3 p-2.5 rounded-md border border-paper-grid bg-paper-grid/10 group/upload-box transition-colors hover:border-paper-grid/60">
                    <div className="relative shrink-0">
                      <img
                        src={uploadedImage}
                        alt="上传的参考图"
                        className="w-12 h-16 object-cover rounded shadow-[0_0_0_1px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1)]"
                      />
                      <button
                        onClick={() => {
                          setUploadedImage(null);
                          setUploadedName('');
                        }}
                        className="absolute -top-2 -right-2 flex items-center justify-center w-6 h-6 rounded-full bg-paper border border-paper-grid text-ink-light hover:text-error hover:border-error/30 shadow-sm active:scale-[0.96] transition-all opacity-0 group-hover/upload-box:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error z-10"
                        title="移除图片"
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    </div>
                    
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <p className="text-[11px] text-ink font-medium font-sans truncate mb-0.5" title={uploadedName}>{uploadedName}</p>
                      <p className="text-[10px] text-ink-faint font-sans leading-snug line-clamp-2">图片已就绪，请点击节点右下角「<RefreshCw size={10} className="inline mb-[2px]" /> 重新生成」按钮</p>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="group w-full flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-md border border-dashed border-paper-grid bg-paper-grid/5 text-ink-faint hover:text-accent hover:border-accent/40 hover:bg-accent/5 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Upload size={16} strokeWidth={1.5} className="group-hover:-translate-y-0.5 transition-transform duration-300" />
                    <span className="text-[11px] font-sans">上传参考图 · 分析艺术风格与主题色</span>
                  </button>
                )}
              </div>
            </div>
          ) : (!content && isGenerating) ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 h-full min-h-[120px]">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-sm font-serif text-accent">构思提示词中...</span>
            </div>
          ) : (
            /* 流式 Markdown：Streamdown（内置 GFM + CJK 插件 + 流式光标） */
            <div className="w-full min-w-0 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              <div className="w-full min-w-0 font-sans text-sm leading-relaxed">
                {error && !isGenerating && (
                  <div className="mb-3 p-3 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
                    <AlertTriangle size={14} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 font-sans">
                      <p className="text-[12px] text-error/90 leading-relaxed break-words">{error}</p>
                    </div>
                  </div>
                )}
                <Streamdown
                  plugins={{ cjk }}
                  isAnimating={isGenerating}
                  caret="block"
                  controls={false}
                  linkSafety={{ enabled: false }}
                >
                  {normalizeMarkdown(content) || (!error ? '等待生成...' : '')}
                </Streamdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const PromptNode = memo(PromptNodeInner);
PromptNode.displayName = 'PromptNode';
export default PromptNode;

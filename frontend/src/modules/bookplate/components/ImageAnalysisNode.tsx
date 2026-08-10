import React, { memo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ImageIcon,
  Play,
  RefreshCw,
  ScanSearch,
  Upload,
  X,
  AlertTriangle,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { AgentActivity } from '../../../platform/components/agent/AgentActivity';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import type { AgentStep } from '../../../platform/types';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';

// 上传参考图体积上限（与后端 MAX_UPLOAD_IMAGE_BYTES 保持一致）
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
// 允许上传的位图格式（与后端魔数校验一致）
const RASTER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export interface ImageAnalysisNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  analysis?: string;
  /** Agent 模式中间步骤（工具调用 / 思考状态） */
  agentSteps?: AgentStep[];
  /** Agent 名称（该节点配置为 agent 模式时展示） */
  agentName?: string;
  isGenerating: boolean;
  error?: string | null;
  onRemove?: (id: string) => void;
  /** 执行/重试：image 为本次上传的参考图（base64 data URL）；不传则回退上游封面 */
  onRun?: (id: string, image?: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  /** 卡片底部「+」插槽 */
  footer?: React.ReactNode;
  /** 根节点右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 所属自定义分组（配置了分组时在标题旁展示小标签） */
  group?: string;
}

const ImageAnalysisNodeInner: React.FC<ImageAnalysisNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  analysis,
  agentSteps,
  agentName,
  isGenerating,
  error,
  onRemove,
  onRun,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  group,
}) => {
  const { showToast } = useFeedback();
  // 本次会话上传的参考图（base64 data URL，仅存内存）
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  /** 上传后立即执行分析（把参考图交给父级，父级持久化到内存供重试复用） */
  const handleAnalyzeUploaded = () => {
    if (!uploadedImage || isGenerating || !onRun) return;
    onRun(id, uploadedImage);
    setUploadedImage(null);
    setUploadedName('');
  };

  const actionBtn =
    'flex items-center justify-center w-7 h-7 rounded-full ' +
    'text-ink-light hover:text-ink hover:bg-paper-grid/40 ' +
    'active:scale-[0.96] transition-colors transition-transform ' +
    'disabled:opacity-40 disabled:cursor-not-allowed ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  const renderActionBar = () => {
    if (isGenerating) return undefined;
    return (
      <>
        {(error || analysis || (!error && !analysis)) && onRun && (
          <Tooltip content={error ? '重试' : analysis ? '重新生成' : '运行分析'}>
            <button
              onClick={() => onRun?.(id)}
              disabled={isGenerating}
              className={actionBtn + (error ? ' text-error hover:text-error hover:bg-error/10' : '')}
            >
              {error || analysis ? <RefreshCw size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
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
      title={title || "图片分析"}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 460 }}
      className={`transition-[box-shadow,border-color,opacity] duration-200 ${isGenerating && !analysis ? 'border-transparent' : ''}`}
      glowOverlay={isGenerating && !analysis ? <BeamGlow /> : undefined}
      showLeftAnchor={true}
      showRightAnchor={true}
      footer={footer}
      groupBadge={group}
      actionBar={renderActionBar()}
    >
      <div className="relative h-full flex flex-col flex-1 min-h-0">
        <AgentActivity
          steps={agentSteps}
          agentName={agentName}
          running={isGenerating && !!agentName}
        />
        <div className="relative z-10 flex flex-col gap-3 flex-1 min-h-0">
          {isGenerating && !analysis ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-[140px]">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-sm font-serif text-accent">正在分析图片...</span>
            </div>
          ) : error && !analysis ? (
            <div className="flex-1 flex flex-col gap-3 min-h-[140px]">
              <div className="p-3 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
                <AlertTriangle size={14} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 font-sans">
                  <p className="text-[12px] text-error/90 leading-relaxed break-words">{error}</p>
                </div>
              </div>
            </div>
          ) : analysis ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="w-full min-w-0 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                <div className="w-full min-w-0 font-sans text-[12px] leading-relaxed">
                  <Streamdown
                    plugins={{ cjk, code }}
                    isAnimating={isGenerating}
                    caret="block"
                    linkSafety={{ enabled: false }}
                  >
                    {normalizeMarkdown(analysis)}
                  </Streamdown>
                </div>
              </div>
            </div>
          ) : (
            /* 待运行态：提示 + 上传参考图 */
            <div className="flex-1 flex flex-col gap-3 min-h-[160px]">
              <div className="flex items-start gap-2 px-2 py-2.5 rounded-md border border-dashed border-paper-grid bg-paper-grid/10">
                <ScanSearch size={14} strokeWidth={1.5} className="text-accent shrink-0 mt-0.5" />
                <p className="text-[12px] text-ink-light font-sans leading-relaxed">
                  可分析上游图书节点的封面，或上传参考图手动分析艺术风格与主题色
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handlePickImage}
              />
              {uploadedImage ? (
                <div className="flex items-center gap-3 p-2.5 rounded-md border border-paper-grid bg-paper-grid/10 transition-colors">
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
                      className="absolute -top-2 -right-2 flex items-center justify-center w-6 h-6 rounded-full bg-paper border border-paper-grid text-ink-light hover:text-error hover:border-error/30 shadow-sm active:scale-[0.96] transition-all opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error z-10"
                      title="移除图片"
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
                    <p className="text-[11px] text-ink font-medium font-sans truncate" title={uploadedName}>{uploadedName}</p>
                    <button
                      onClick={handleAnalyzeUploaded}
                      disabled={isGenerating}
                      className="self-start inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-sans text-accent border border-dashed border-accent/40 hover:bg-accent/10 active:scale-95 transition"
                    >
                      <Play size={11} strokeWidth={2} />
                      开始分析
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isGenerating}
                  className="group w-full flex flex-col items-center justify-center gap-1.5 py-4 rounded-md border border-dashed border-paper-grid bg-paper-grid/5 text-ink-faint hover:text-accent hover:border-accent/40 hover:bg-accent/5 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                >
                  <Upload size={16} strokeWidth={1.5} className="group-hover:-translate-y-0.5 transition-transform duration-300" />
                  <span className="text-[11px] font-sans">上传参考图 · 分析艺术风格与主题色</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const ImageAnalysisNode = memo(ImageAnalysisNodeInner);
ImageAnalysisNode.displayName = 'ImageAnalysisNode';
export default ImageAnalysisNode;

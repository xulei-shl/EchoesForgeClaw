import React, { memo, useEffect, useRef, useState } from 'react';
import { Globe, Heart, RefreshCw, Trash2, AlertTriangle, Maximize2 } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { AgentActivity } from '../../../platform/components/agent/AgentActivity';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import type { AgentStep } from '../../../platform/types';
import { NODE_COLORS } from '../nodeTypes';

export interface ImageNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  imageUrl?: string | null;
  /** Agent 模式中间步骤（工具调用 / 思考状态） */
  agentSteps?: AgentStep[];
  /** Agent 名称（stage3 生效模式为 agent 时展示） */
  agentName?: string;
  isGenerating: boolean;
  error?: string | null;
  isFavorited?: boolean;
  isPublic?: boolean;
  isMock?: boolean;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  /** 收藏切换，resolve 为新的收藏状态；失败时 reject */
  onToggleFavorite?: (id: string) => Promise<boolean>;
  /** 公开切换，resolve 为新的公开状态；失败时 reject */
  onTogglePublic?: (id: string) => Promise<boolean>;
  /** 是否为全局操作栏当前作用目标（选中态高亮） */
  isSelected?: boolean;
  /** 上游「图片上传」节点参考图（data URL，展示缩略图用） */
  referenceImageUrl?: string | null;
  /** 参考图状态提示文案（如「已使用参考图 · 图生图」「参考图已传入 Agent」「等待上传参考图」） */
  referenceNote?: string | null;
  /** 是否处于「等待上传参考图」状态（待运行态，样式区分） */
  referenceWaiting?: boolean;
  /** 历史记录已被删除（收藏/公开会重新生成记录）时的弱提示 */
  recordDeleted?: boolean;
  /** 点击节点选中（作为全局操作栏的作用目标） */
  onSelect?: (id: string) => void;
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

const ImageNodeInner: React.FC<ImageNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  imageUrl,
  agentSteps,
  agentName,
  isGenerating,
  error,
  isFavorited = false,
  isPublic = false,
  isMock = false,
  isSelected = false,
  referenceImageUrl,
  referenceNote,
  referenceWaiting = false,
  recordDeleted = false,
  onSelect,
  onRemove,
  onRetry,
  onToggleFavorite,
  onTogglePublic,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  group,
}) => {
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2600);
  };

  const runToggle = async (
    fn: ((id: string) => Promise<boolean>) | undefined,
    okMsg: (active: boolean) => string
  ) => {
    if (!fn) return;
    try {
      const active = await fn(id);
      showNotice(okMsg(active));
    } catch {
      showNotice('操作失败，请重试');
    }
  };

  const isLoading = isGenerating && !imageUrl;
  // 兼容已存在的节点：检查 error 或 imageUrl 是否包含 mock_bookplate
  const isMockImage = !!error || (typeof imageUrl === 'string' && imageUrl.includes('mock_bookplate'));
  const displayError = error || (isMockImage ? 'API 配置缺失，当前为演示占位图' : null);

  const actionBtn =
    'relative flex items-center justify-center w-7 h-7 rounded-full ' +
    'text-ink-light hover:text-ink hover:bg-paper-grid/40 ' +
    'active:scale-[0.96] transition-colors transition-transform duration-150 ease-out ' +
    'disabled:opacity-40 disabled:cursor-not-allowed ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
    'after:content-[\'\'] after:absolute after:-inset-1.5';

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || "藏书票图像"}
      dotColor={NODE_COLORS.image_generation}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 540 }}
      className={`transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out ${isLoading ? 'border-transparent' : ''} ${isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''}`}
      glowOverlay={isLoading ? <BeamGlow /> : undefined}
      showLeftAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      groupBadge={group}
      actionBar={
        <>
          <Tooltip content="重试">
            <button
              onClick={() => onRetry?.(id)}
              disabled={isGenerating}
              className={actionBtn + (displayError ? ' text-error hover:text-error hover:bg-error/10' : '')}
            >
              <RefreshCw size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
          <Tooltip content={isFavorited ? '取消收藏' : '收藏'}>
            <button
              onClick={() => runToggle(onToggleFavorite, (active) => (active ? '已收藏' : '已取消收藏'))}
              disabled={!imageUrl || isGenerating || !onToggleFavorite || isMock}
              className={actionBtn}
            >
              <Heart
                size={16}
                strokeWidth={1.5}
                className={isFavorited ? 'fill-accent text-accent' : ''}
              />
            </button>
          </Tooltip>
          <Tooltip content={isPublic ? '从画廊撤下' : '公开到画廊'}>
            <button
              onClick={() => runToggle(onTogglePublic, (active) => (active ? '已公开' : '已撤下'))}
              disabled={!imageUrl || isGenerating || !onTogglePublic || isMock}
              className={actionBtn}
            >
              <Globe size={16} strokeWidth={1.5} className={isPublic ? 'text-accent' : ''} />
            </button>
          </Tooltip>
          <Tooltip content="删除">
            <button
              onClick={() => onRemove?.(id)}
              className={`${actionBtn} text-ink-faint hover:text-error`}
            >
              <Trash2 size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </>
      }
    >
      <div className="relative h-full flex flex-col flex-1 min-h-0">
        <AgentActivity
          steps={agentSteps}
          agentName={agentName}
          running={isGenerating && !!agentName}
        />
        <div className="relative z-10 flex flex-col gap-3 flex-1 min-h-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-4 min-h-[220px]">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-sm font-serif text-accent">正在绘制藏书票...</span>
            </div>
          ) : imageUrl ? (
            <div className={`relative group border border-dashed rounded-lg p-1 shadow-sm ${displayError ? 'border-error/30 bg-error/5' : 'border-paper-grid bg-paper'}`}>
              {!displayError ? (
                <PhotoProvider
                  maskOpacity={0.8}
                  bannerVisible={false}
                >
                  <PhotoView src={imageUrl}>
                    <Tooltip content="点击全屏查看">
                      <img
                        src={imageUrl}
                        alt="生成的藏书票"
                        className="w-full rounded-sm cursor-pointer group-hover:opacity-95 active:scale-[0.99] transition-transform transition-opacity outline outline-1 outline-[oklch(0_0_0/0.1)] outline-offset-[-1px]"
                        loading="lazy"
                      />
                    </Tooltip>
                  </PhotoView>
                </PhotoProvider>
              ) : (
                <>
                  <img
                    src={imageUrl}
                    alt="生成失败：占位图"
                    aria-describedby={`error-desc-${id}`}
                    className="w-full rounded-sm outline outline-1 outline-error/20 outline-offset-[-1px] opacity-80"
                    loading="lazy"
                  />
                  {/* 悬浮错误提示 */}
                  <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center px-4 pointer-events-none">
                    <div className="bg-paper/95 backdrop-blur-sm shadow-md border border-error/20 rounded-lg p-3 flex items-start gap-2.5 max-w-[95%] pointer-events-auto">
                      <AlertTriangle size={14} strokeWidth={1.5} className="text-error shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0 font-sans" id={`error-desc-${id}`}>
                        <p className="text-[12px] text-error/90 leading-relaxed break-words">{displayError}</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
              
              {/* 全屏提示图标 */}
              {!displayError && (
                <div className="absolute right-3 bottom-3 p-1.5 rounded bg-black/40 backdrop-blur-sm text-white/90 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-sm flex items-center justify-center">
                  <Maximize2 size={16} strokeWidth={1.5} />
                </div>
              )}
            </div>
          ) : displayError ? (
            /* 错误态：与 PromptNode 错误横幅同款视觉 */
            <div className="flex-1 flex flex-col gap-3 min-h-[160px]">
              <div className="p-3 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
                <AlertTriangle size={14} strokeWidth={1.5} className="text-error shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 font-sans">
                  <p className="text-[12px] text-error/90 leading-relaxed break-words">{displayError}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 min-h-[160px] text-center">
              <span className="text-sm text-ink-faint font-sans">等待生成藏书票图片</span>
            </div>
          )}



          {referenceNote && (
            <div className="flex items-center justify-end gap-1.5 text-xs font-sans">
              {referenceImageUrl && (
                <img
                  src={referenceImageUrl}
                  alt="参考图"
                  className="w-4 h-4 rounded-sm object-cover border border-paper-grid shrink-0"
                  loading="lazy"
                />
              )}
              <span
                className={`inline-flex items-center gap-1.5 ${
                  referenceWaiting ? 'text-ink-faint' : 'text-ink-light'
                }`}
              >
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    referenceWaiting ? 'bg-amber-500/70' : 'bg-accent/70'
                  }`}
                />
                {referenceNote}
              </span>
            </div>
          )}

          {recordDeleted && imageUrl && !isGenerating && (
            <div className="flex items-center gap-1.5 text-right text-xs text-ink-faint font-sans">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/60" />
              记录已删除 · 收藏将重新生成记录
            </div>
          )}

          {notice && (
            <div className="text-right text-xs text-ink-faint font-sans">
              {notice}
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const ImageNode = memo(ImageNodeInner);
ImageNode.displayName = 'ImageNode';
export default ImageNode;

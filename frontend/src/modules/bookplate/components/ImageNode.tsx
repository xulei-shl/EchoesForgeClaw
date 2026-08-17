import React, { memo, useEffect, useRef, useState } from 'react';
import { Globe, Heart, RefreshCw, Trash2, AlertTriangle, Maximize2 } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { AgentActivity } from '../../../platform/components/agent/AgentActivity';
import { NodeRunPlaceholder } from '../../../platform/components/node/NodeRunPlaceholder';
import type { AgentStep, InjectedContextBlock, NodeRunSettings } from '../../../platform/types';
import { NODE_COLORS } from '../nodeTypes';
import { NodeSettingsPopover } from './NodeSettingsPopover';
import { ContextInjectionBlock } from './ContextInjectionBlock';

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
  /** 手动运行（待运行态点击「运行」触发） */
  onRun?: (id: string) => void;
  /** 运行设置（包含图书元数据 / 图像尺寸与宽高比） */
  settings?: NodeRunSettings;
  /** 注入的上下文块（提示词 / 文本上级 / 图书元数据 / 参考图，折叠卡片展示） */
  contextBlocks?: InjectedContextBlock[];
  onUpdateSettings?: (id: string, settings: NodeRunSettings) => void;
  /** 运行设置中展示图像参数（尺寸/宽高比）区块（仅图像生成节点开启） */
  showImageParams?: boolean;
  /** 运行设置中展示「加载图书封面图片」开关（图像生成节点开启） */
  showBookCoverOption?: boolean;
  /** 画布是否已有图书元数据节点 */
  hasBookInfo?: boolean;
  /** 标题旁的类型不匹配提示 */
  mismatchBadge?: string | null;
  /** 是否有下级节点关联（有下级时禁用输出影响按钮） */
  hasDownstream?: boolean;
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
  onRun,
  settings,
  contextBlocks,
  onUpdateSettings,
  showImageParams = false,
  showBookCoverOption = false,
  hasBookInfo,
  mismatchBadge,
  hasDownstream,
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
  // 待运行态：无图片、无错误、未生成 → 提供「运行」按钮
  const isIdle = !imageUrl && !displayError && !isGenerating;

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
      mismatchBadge={mismatchBadge}
      actionBar={
        <NodeActionBar>
          {isIdle && onRun ? (
            <NodeActionBar.Run
              onClick={() => onRun?.(id)}
              disabled={isGenerating}
              hasDownstream={hasDownstream}
            />
          ) : (
            <NodeActionBar.Retry
              onClick={() => onRetry?.(id)}
              disabled={isGenerating}
              hasDownstream={hasDownstream}
              error={!!displayError}
            />
          )}
          {onUpdateSettings && settings && (
            <NodeSettingsPopover
              settings={settings}
              onChange={(s) => onUpdateSettings?.(id, s)}
              disabled={isGenerating}
              hasDownstream={hasDownstream}
              hasBookInfo={hasBookInfo}
              showImageParams={showImageParams}
              showBookCoverOption={showBookCoverOption}
            />
          )}
          <NodeActionBar.Custom
            icon={<Heart size={16} strokeWidth={1.5} className={isFavorited ? 'fill-accent text-accent' : ''} />}
            tooltip={isFavorited ? '取消收藏' : '收藏'}
            onClick={() => runToggle(onToggleFavorite, (active) => (active ? '已收藏' : '已取消收藏'))}
            disabled={!imageUrl || isGenerating || !onToggleFavorite || isMock}
          />
          <NodeActionBar.Custom
            icon={<Globe size={16} strokeWidth={1.5} className={isPublic ? 'text-accent' : ''} />}
            tooltip={isPublic ? '从画廊撤下' : '公开到画廊'}
            onClick={() => runToggle(onTogglePublic, (active) => (active ? '已公开' : '已撤下'))}
            disabled={!imageUrl || isGenerating || !onTogglePublic || isMock}
          />
          <NodeActionBar.Custom
            icon={<Trash2 size={16} strokeWidth={1.5} />}
            tooltip="删除"
            onClick={() => onRemove?.(id)}
            className="text-ink-faint hover:text-error"
          />
        </NodeActionBar>
      }
    >
      <div className="relative h-full flex flex-col flex-1 min-h-0">
        <AgentActivity
          steps={agentSteps}
          agentName={agentName}
          running={isGenerating && !!agentName}
        />
        <div className="relative z-10 flex flex-col gap-3 flex-1 min-h-0">
          <style>{`
            @keyframes scan-vertical {
              0% { top: 0; opacity: 0; }
              10% { opacity: 1; }
              90% { opacity: 1; }
              100% { top: calc(100% - 2px); opacity: 0; }
            }
          `}</style>
          {isLoading ? (
            <div className="relative flex flex-col items-center justify-center gap-4 flex-1 min-h-[220px] rounded-lg border border-accent/20 bg-accent/5 overflow-hidden shadow-inner">
              {referenceImageUrl && (
                <>
                  <div className="absolute inset-0 bg-cover bg-center opacity-20 scale-110 blur-xl transition-all duration-500" style={{ backgroundImage: `url(${referenceImageUrl})` }} />
                  <div className="absolute inset-0 bg-paper/40 backdrop-blur-[2px]" />
                </>
              )}
              <div className="relative z-10 flex flex-col items-center gap-4 w-full p-4">
                {referenceImageUrl ? (
                   <div className="relative w-16 h-16 rounded-lg shadow-md border border-accent/30 overflow-hidden bg-paper/80 backdrop-blur-sm shrink-0">
                     <img src={referenceImageUrl} className="w-full h-full object-cover opacity-90" alt="参考图" />
                     <div className="absolute inset-0 bg-accent/10 animate-pulse" />
                     <div className="absolute left-0 right-0 h-[2px] bg-accent/60 shadow-[0_0_8px_rgba(var(--color-accent),0.8)]" style={{ animation: 'scan-vertical 2s ease-in-out infinite' }} />
                   </div>
                ) : (
                   <div className="relative w-16 h-16 rounded-lg shadow-sm border border-accent/20 overflow-hidden bg-accent/10 shrink-0 flex items-center justify-center">
                     <div className="absolute inset-0 bg-gradient-to-tr from-accent/0 via-accent/10 to-accent/0 animate-[pulse_2s_ease-in-out_infinite]" />
                     <div className="absolute left-0 right-0 h-[2px] bg-accent/40 shadow-[0_0_8px_rgba(var(--color-accent),0.5)]" style={{ animation: 'scan-vertical 2s ease-in-out infinite' }} />
                     <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent/60 relative z-10">
                       <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                       <circle cx="8.5" cy="8.5" r="1.5"></circle>
                       <polyline points="21 15 16 10 5 21"></polyline>
                     </svg>
                   </div>
                )}
                <div className="flex flex-col items-center gap-2.5">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2.5 h-2.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2.5 h-2.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-sm font-serif text-accent tracking-wide drop-shadow-sm text-center">
                    {referenceImageUrl ? '正在基于参考图生成...' : '正在绘制藏书票...'}
                  </span>
                </div>
              </div>
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
            <NodeRunPlaceholder
              bgOverlay={
                referenceImageUrl ? (
                  <>
                    <div className="absolute inset-0 bg-cover bg-center opacity-10 scale-110 blur-xl grayscale" style={{ backgroundImage: `url(${referenceImageUrl})` }} />
                    <div className="absolute inset-0 bg-paper/60 backdrop-blur-sm" />
                  </>
                ) : undefined
              }
              icon={
                referenceImageUrl ? (
                   <div className="relative w-12 h-12 rounded-md shadow-sm border border-paper-grid overflow-hidden bg-paper opacity-90">
                     <img src={referenceImageUrl} className="w-full h-full object-cover grayscale opacity-70" alt="参考图" />
                     {/* 增加待机微脉冲，表示节点处于活跃排队状态 */}
                     <div className="absolute inset-0 bg-ink-faint/10 animate-pulse" />
                     {referenceWaiting && (
                        <div className="absolute inset-0 bg-paper/50 backdrop-blur-[1px] flex items-center justify-center">
                          <div className="w-4 h-4 border-2 border-ink-faint/70 border-t-transparent rounded-full animate-spin" />
                        </div>
                     )}
                   </div>
                ) : (
                   <div className="relative w-10 h-10 rounded-full bg-paper shadow-sm border border-paper-grid flex items-center justify-center text-ink-faint/60 overflow-hidden">
                     <div className="absolute inset-0 bg-ink-faint/5 animate-pulse" />
                     <RefreshCw size={16} strokeWidth={1.5} className="opacity-50 animate-[spin_4s_linear_infinite]" />
                   </div>
                )
              }
              text="点击 ▶ 运行生成图像"
              subtext={referenceNote}
            />
          )}

          {/* 顶部展示各个上级节点的上下文注入折叠块（与 AI 对话节点同一组件） */}
          {contextBlocks && contextBlocks.length > 0 && (
            <div className="space-y-1.5 shrink-0">
              {contextBlocks.map((block) => (
                <ContextInjectionBlock key={block.id} block={block} />
              ))}
            </div>
          )}

          {referenceNote && imageUrl && !isLoading && !displayError && (
            <div className="flex items-center justify-end gap-1.5 text-[11px] font-sans pt-1 shrink-0">
              <span className="text-ink-faint">
                {referenceNote}
              </span>
              {referenceImageUrl && (
                <div className="w-4 h-4 rounded-[3px] border border-paper-grid overflow-hidden shrink-0 shadow-sm">
                  <img
                    src={referenceImageUrl}
                    alt="参考图"
                    className="w-full h-full object-cover grayscale-[0.3]"
                    loading="lazy"
                  />
                </div>
              )}
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

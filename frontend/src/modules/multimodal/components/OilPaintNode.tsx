import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Palette,
  Heart,
  Globe,
  Upload,
  Trash2,
  Loader2,
  Pencil,
  Check,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { SliderRow } from '../../../platform/components/ui/Slider';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import type { OilPaintState, OilPaintStyle } from '../oilpaint';
import type { WetPaintSession } from '../oilpaint/engine';

export interface OilPaintNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<OilPaintState>;
  /** 上游图书元数据封面图或直接上级图片输出 */
  upstreamImageUrl?: string | null;
  isFavorited?: boolean;
  isPublic?: boolean;
  isSelected?: boolean;
  recordDeleted?: boolean;
  onSelect?: (id: string) => void;
  onRemove?: (id: string) => void;
  onToggleFavorite?: (id: string) => Promise<boolean>;
  onTogglePublic?: (id: string) => Promise<boolean>;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  mismatchBadge?: string | null;
  /** 状态更新写入 node.data */
  onUpdateState?: (id: string, patch: Partial<OilPaintState>) => void;
  /** 导出油画：PNG Data URL 落盘保存 + 写入历史数据库 */
  onExport?: (id: string, dataUrl: string, state: OilPaintState) => Promise<void>;
}

const OilPaintNodeInner: React.FC<OilPaintNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  data = {},
  upstreamImageUrl,
  isFavorited = false,
  isPublic = false,
  isSelected = false,
  recordDeleted = false,
  onSelect,
  onRemove,
  onToggleFavorite,
  onTogglePublic,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  mismatchBadge,
  onUpdateState,
  onExport,
}) => {
  const { showToast } = useFeedback();

  // 1. 输入图片四级优先级：本地上传 > 直连图片/穿透封面/根节点封面兜底
  const activeImageSrc = useMemo(() => {
    return data?.uploadedImage || upstreamImageUrl || null;
  }, [data?.uploadedImage, upstreamImageUrl]);

  // 核心参数（持久化在 node.data，滑杆直接读写）
  const strokeSize = data.strokeSize ?? 1;
  const strokeCountK = data.strokeCountK ?? 14;
  const dryness = data.dryness ?? 0.69;
  const style: OilPaintStyle = data.style ?? 'brush';

  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<WetPaintSession | null>(null);
  const countTimerRef = useRef<number | null>(null);
  const lastAppliedRef = useRef<{ size: number; k: number; dry: number; style: OilPaintStyle } | null>(null);

  // 当外部 data.imageUrl 变更时同步编辑态
  useEffect(() => {
    setIsEditing(!data?.imageUrl);
  }, [data?.imageUrl]);

  // 会话建立：编辑态且有输入图时打开（绑定图片，加载三 + 首次分析/播种/渲染）；
  // 离开编辑态 / 更换输入图 / 卸载时释放，避免 WebGL 上下文累积
  useEffect(() => {
    if (!activeImageSrc || !isEditing) return;
    let cancelled = false;
    setSessionStatus('loading');
    (async () => {
      try {
        const { WetPaintSession } = await import('../oilpaint');
        if (cancelled) return;
        const session = await WetPaintSession.create(activeImageSrc, {
          params: { strokeSize, strokeCountK, dryness },
          style,
          maxEdge: 1024,
        });
        if (cancelled) {
          session.dispose();
          return;
        }
        sessionRef.current?.dispose();
        sessionRef.current = session;
        const container = previewContainerRef.current;
        if (container) {
          container.replaceChildren();
          const canvas = session.canvas;
          canvas.className = 'max-w-full max-h-full object-contain';
          container.appendChild(canvas);
        }
        setSessionStatus('ready');
      } catch (err: any) {
        console.error('初始化湿油彩会话失败:', err);
        setSessionStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      sessionRef.current?.dispose();
      sessionRef.current = null;
      previewContainerRef.current?.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImageSrc, isEditing]);

  // 参数实时预览：uniform 级（大小/干燥度/风格）增量重绘毫秒级即时生效；
  // 数量级重播种防抖 350ms 后应用完整参数
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || sessionStatus !== 'ready') return;
    const last = lastAppliedRef.current;
    const countChanged = !last || last.k !== strokeCountK;
    if (countTimerRef.current !== null) window.clearTimeout(countTimerRef.current);
    const apply = (full: boolean) => {
      lastAppliedRef.current = { size: strokeSize, k: strokeCountK, dry: dryness, style };
      try {
        session.update(full ? { strokeSize, strokeCountK, dryness } : { strokeSize, dryness }, style);
      } catch (err) {
        console.error('实时更新湿油彩失败:', err);
      }
    };
    if (!countChanged) {
      apply(false);
    } else {
      countTimerRef.current = window.setTimeout(() => {
        countTimerRef.current = null;
        apply(true);
      }, 350);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokeSize, strokeCountK, dryness, style, sessionStatus]);

  // 卸载清理计时器
  useEffect(() => {
    return () => {
      if (countTimerRef.current !== null) window.clearTimeout(countTimerRef.current);
    };
  }, []);

  const patchParam = useCallback(
    (patch: Partial<OilPaintState>) => {
      onUpdateState?.(id, patch);
    },
    [id, onUpdateState],
  );

  // 生成：会话就绪时直接导出当前画布（预览即结果）；未就绪时回退一次性渲染
  const handleGenerate = useCallback(async () => {
    if (!activeImageSrc || isGenerating) return;
    setIsGenerating(true);
    try {
      let dataUrl: string;
      const session = sessionRef.current;
      if (session && sessionStatus === 'ready') {
        dataUrl = session.toDataUrl();
      } else {
        const { renderWetPaintFromImage } = await import('../oilpaint');
        const result = await renderWetPaintFromImage(activeImageSrc, {
          params: { strokeSize, strokeCountK, dryness },
          style,
          variant: Date.now() % 1000,
        });
        dataUrl = result.dataUrl;
      }

      onUpdateState?.(id, {
        imageUrl: dataUrl,
        isSaved: false,
        strokeSize,
        strokeCountK,
        dryness,
        style,
      });
      showToast('湿油彩生成完成（可点击保存按钮写入数据库）', { type: 'success' });
    } catch (err: any) {
      console.error('生成湿油彩失败:', err);
      showToast(err?.message || '生成湿油彩失败，请重试', { type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }, [activeImageSrc, isGenerating, strokeSize, strokeCountK, dryness, style, sessionStatus, id, onUpdateState, showToast]);

  // 独立保存到数据库
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);
    try {
      await onExport(id, imgUrl, {
        imageUrl: imgUrl,
        uploadedImage: data.uploadedImage || null,
        isSaved: true,
        strokeSize,
        strokeCountK,
        dryness,
        style,
      });
      onUpdateState?.(id, { isSaved: true });
      onSelect?.(id);
      showToast('湿油彩已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      console.error('保存到数据库失败:', err);
      showToast(err?.detail || err?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [data?.imageUrl, data.uploadedImage, isExporting, onExport, id, strokeSize, strokeCountK, dryness, style, onUpdateState, onSelect, showToast]);

  // 本地直接下载 PNG（随时可用）
  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `oil-paint-${Date.now()}.png`;
    link.click();
    showToast('湿油彩图片已下载', { type: 'success' });
  }, [data?.imageUrl, showToast]);

  // 本地上传图片
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', { type: 'warning' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const result = evt.target?.result as string;
      if (result) {
        onUpdateState?.(id, { uploadedImage: result, imageUrl: null });
        setIsEditing(true);
        showToast('已加载本地图片', { type: 'success' });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 清空本地上传图片，恢复上游继承
  const handleClearUpload = () => {
    onUpdateState?.(id, { uploadedImage: null, imageUrl: null });
    setIsEditing(true);
    showToast('已恢复上级输入图片', { type: 'success' });
  };

  // 收藏与公开
  const runToggle = async (
    fn: ((id: string) => Promise<boolean>) | undefined,
    okMsg: (active: boolean) => string
  ) => {
    if (!fn) return;
    try {
      const active = await fn(id);
      showToast(okMsg(active), { type: 'success' });
    } catch {
      showToast('操作失败，请重试', { type: 'error' });
    }
  };

  const hasGenerated = Boolean(data?.imageUrl && !isEditing);
  const isSaved = Boolean(data?.isSaved);

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '湿油彩效果'}
      dotColor={NODE_COLORS.oil_paint || 'oklch(0.66 0.16 60)'}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 560 }}
      className={`transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out ${
        isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''
      }`}
      showLeftAnchor={true}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      mismatchBadge={mismatchBadge}
      actionBar={
        <NodeActionBar>
          {hasGenerated ? (
            <>
              <NodeActionBar.Retry
                onClick={() => setIsEditing(true)}
                disabled={isExporting}
                tooltip="重新调整参数"
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExporting}
              />
              {data?.uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  onClick={handleClearUpload}
                  disabled={isExporting}
                />
              )}
              {/* 独立保存到数据库按钮 */}
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={isExporting || isSaved}
                tooltip={isSaved ? '已保存到数据库' : '保存到数据库（保存后可公开/收藏）'}
                className={isSaved ? 'text-accent opacity-70' : 'text-ink-light hover:text-accent'}
              />
              {/* 收藏按钮（未保存时禁用并提示） */}
              <NodeActionBar.Custom
                icon={
                  <Heart
                    size={16}
                    strokeWidth={1.5}
                    className={isSaved && isFavorited ? 'fill-accent text-accent' : ''}
                  />
                }
                tooltip={
                  !isSaved
                    ? '请先保存到数据库后再收藏'
                    : isFavorited
                      ? '取消收藏'
                      : '收藏'
                }
                onClick={() =>
                  isSaved && runToggle(onToggleFavorite, (act) => (act ? '已收藏' : '已取消收藏'))
                }
                disabled={!isSaved || isExporting || !onToggleFavorite}
              />
              {/* 公开按钮（未保存时禁用并提示） */}
              <NodeActionBar.Custom
                icon={
                  <Globe
                    size={16}
                    strokeWidth={1.5}
                    className={isSaved && isPublic ? 'text-accent' : ''}
                  />
                }
                tooltip={
                  !isSaved
                    ? '请先保存到数据库后再公开'
                    : isPublic
                      ? '从画廊撤下'
                      : '公开到画廊'
                }
                onClick={() =>
                  isSaved && runToggle(onTogglePublic, (act) => (act ? '已公开' : '已撤下'))
                }
                disabled={!isSaved || isExporting || !onTogglePublic}
              />
              {/* 下载按钮（随时可用） */}
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isExporting}
                tooltip="直接下载油画 PNG"
              />
              <NodeActionBar.Reset
                onClick={() => patchParam({ imageUrl: null, isSaved: false })}
                disabled={isExporting}
                tooltip="清空结果回到参数编辑态"
              />
            </>
          ) : (
            <>
              <NodeActionBar.Custom
                icon={
                  isGenerating ? (
                    <Loader2 size={16} className="animate-spin text-accent" />
                  ) : (
                    <Palette size={16} strokeWidth={1.5} />
                  )
                }
                tooltip="生成湿油彩效果"
                onClick={handleGenerate}
                disabled={!activeImageSrc || isGenerating}
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={isGenerating}
              />
              {data?.uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  onClick={handleClearUpload}
                  disabled={isGenerating}
                />
              )}
            </>
          )}
          <NodeActionBar.ExternalLink
            href="https://github.com/simonxxooxxoo/wet-paint-flow"
            tooltip="点击使用完整功能"
          />
        </NodeActionBar>
      }
    >
      {/* 隐藏的真实文件上传 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 参数工具栏（编辑态展示核心参数滑杆与风格切换） */}
        {!hasGenerated && (
          <div className="flex flex-col gap-1.5 px-1.5 py-1.5 rounded-md bg-paper-grid/20 border border-paper-grid/40 text-xs font-sans text-ink-light select-none">
            <div className="flex items-center justify-between gap-2">
              <SliderRow
                label="笔触大小"
                value={strokeSize}
                min={0.4}
                max={2.5}
                step={0.1}
                display={`${strokeSize.toFixed(1)}x`}
                disabled={isGenerating}
                onChange={(v) => patchParam({ strokeSize: v })}
              />
              <SliderRow
                label="数量(千)"
                value={strokeCountK}
                min={6}
                max={24}
                step={1}
                display={`${strokeCountK}k`}
                disabled={isGenerating}
                onChange={(v) => patchParam({ strokeCountK: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <SliderRow
                label="干燥度"
                value={dryness}
                min={0}
                max={1}
                step={0.05}
                display={`${Math.round(dryness * 100)}%`}
                disabled={isGenerating}
                onChange={(v) => patchParam({ dryness: v })}
              />
              <div className="flex items-center gap-1 shrink-0" role="radiogroup" aria-label="湿油彩风格">
                <span className="text-ink-faint text-[11px] px-0.5">风格:</span>
                {(['brush', 'blend'] as OilPaintStyle[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={style === s}
                    onClick={() => patchParam({ style: s })}
                    disabled={isGenerating}
                    className={`px-2 py-0.5 rounded text-xs transition-colors duration-150 active:scale-[0.96] ${
                      style === s
                        ? 'bg-accent/15 text-accent font-medium'
                        : 'hover:bg-paper-grid/40 text-ink-light'
                    }`}
                  >
                    {s === 'brush' ? '纯笔触' : '融合'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 预览画布 */}
        <div className="relative flex-1 min-h-0 w-full overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none">
          <AnimatePresence mode="wait" initial={false}>
            {!hasGenerated ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="relative w-full h-full flex items-center justify-center overflow-hidden p-2"
              >
                {activeImageSrc ? (
                  <div className="relative w-full h-full flex items-center justify-center p-2">
                    {/* 会话 canvas 挂载点：仅承载命令式 appendChild 的画布，不含 React 子节点
                        （避免 replaceChildren 清除 React 节点导致 removeChild 崩溃） */}
                    <div ref={previewContainerRef} className="w-full h-full flex items-center justify-center" />
                    {sessionStatus === 'loading' && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-paper/60 backdrop-blur-sm text-ink-light">
                        <Loader2 size={24} className="animate-spin text-accent" />
                        <span className="text-xs">正在建立实时会话…</span>
                      </div>
                    )}
                    {sessionStatus === 'error' && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-paper/70 backdrop-blur-sm text-ink-faint p-4 text-center">
                        <span className="text-xs">无法建立实时预览（可能不支持 WebGL）</span>
                        <button
                          type="button"
                          onClick={() => {
                            setSessionStatus('idle');
                            window.setTimeout(() => patchParam({}), 0);
                          }}
                          className="px-2.5 py-1 rounded text-xs bg-paper-grid/40 hover:bg-paper-grid/70 active:scale-[0.96] transition-colors duration-150"
                        >
                          重试
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-ink-faint gap-2 p-6 text-center">
                    <Upload size={32} strokeWidth={1.5} />
                    <p className="text-xs">请连线上级图片或点击上方按钮上传本地图片</p>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="preview"
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ type: 'spring', damping: 24, stiffness: 260 }}
                className="relative w-full h-full flex items-center justify-center p-3"
              >
                {data.imageUrl ? (
                  <div className="relative group max-w-full max-h-full flex items-center justify-center">
                    <img
                      src={data.imageUrl}
                      alt="湿油彩效果预览"
                      className="max-w-full max-h-[440px] object-contain drop-shadow-md select-none pointer-events-none rounded"
                    />
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="absolute bottom-3 right-3 px-2.5 py-1.5 rounded-full bg-paper/90 backdrop-blur text-ink text-xs shadow-md border border-paper-grid/40 hover:bg-white hover:text-accent active:scale-[0.96] transition-[opacity,transform,background-color,color] flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent duration-150"
                    >
                      <Pencil size={12} strokeWidth={1.5} />
                      <span>调整参数</span>
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无湿油彩生成结果</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {isGenerating && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/35 backdrop-blur-sm text-paper">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-xs">正在绘制笔触…</span>
            </div>
          )}
        </div>

        {/* 状态与弱提示 */}
        {recordDeleted && hasGenerated && !isExporting && (
          <div className="flex items-center justify-end gap-1.5 text-right text-xs text-ink-faint font-sans">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/60" />
            记录已删除 · 收藏将重新生成记录
          </div>
        )}
      </div>
    </CanvasNode>
  );
};

export const OilPaintNode = memo(OilPaintNodeInner);
OilPaintNode.displayName = 'OilPaintNode';
export default OilPaintNode;

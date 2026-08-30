import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Palette,
  Heart,
  Globe,
  Loader2,
  Pencil,
  Check,
  Dices,
} from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { SliderRow } from '../../../platform/components/ui/Slider';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type WatercolorBrushState,
  type WatercolorCompositionMode,
  WATERCOLOR_PRESET_PALETTES,
  WATERCOLOR_DEFAULT_PARAMS,
} from '../watercolor/types';
import type { WatercolorSession } from '../watercolor/engine';

export interface WatercolorBrushNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<WatercolorBrushState>;
  /** 上游提取的配色列表（如中国传统配色节点直接连线注入） */
  upstreamColors?: string[] | null;
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
  onUpdateState?: (id: string, patch: Partial<WatercolorBrushState>) => void;
  /** 导出水彩：PNG Data URL 落盘保存 + 写入历史数据库 */
  onExport?: (id: string, dataUrl: string, state: WatercolorBrushState) => Promise<void>;
}

const MODE_OPTIONS: SelectOption[] = [
  { value: 'wave_strips', label: '〰️ 流动色带' },
  { value: 'watercolor_clouds', label: '💧 云阶水彩' },
  { value: 'grid_hatch', label: '▦ 格律排线' },
  { value: 'vector_vortex', label: '🌀 流场涡旋' },
  { value: 'abstract_sketch', label: '✏️ 表现手绘' },
];

const PALETTE_OPTIONS: SelectOption[] = WATERCOLOR_PRESET_PALETTES.map((p) => ({
  value: p.id,
  label: p.name,
}));

const WatercolorBrushNodeInner: React.FC<WatercolorBrushNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  data = {},
  upstreamColors,
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

  // 合并上游注入的配色或预设配色
  const activeColors = useMemo(() => {
    if (upstreamColors && upstreamColors.length > 0) return upstreamColors;
    const preset = WATERCOLOR_PRESET_PALETTES.find((p) => p.id === data?.paletteId);
    return preset?.colors || WATERCOLOR_PRESET_PALETTES[0].colors;
  }, [upstreamColors, data?.paletteId]);

  // 核心参数（持久化在 node.data）
  const mode: WatercolorCompositionMode =
    data.mode && ['wave_strips', 'watercolor_clouds', 'grid_hatch', 'vector_vortex', 'abstract_sketch'].includes(data.mode)
      ? data.mode
      : WATERCOLOR_DEFAULT_PARAMS.mode;
  const paletteId = data.paletteId ?? WATERCOLOR_DEFAULT_PARAMS.paletteId;
  const wiggle = data.wiggle ?? WATERCOLOR_DEFAULT_PARAMS.wiggle;
  const bleedStrength = data.bleedStrength ?? WATERCOLOR_DEFAULT_PARAMS.bleedStrength;
  const textureStrength = data.textureStrength ?? WATERCOLOR_DEFAULT_PARAMS.textureStrength;
  const borderStrength = data.borderStrength ?? WATERCOLOR_DEFAULT_PARAMS.borderStrength;
  const hatchDist = data.hatchDist ?? WATERCOLOR_DEFAULT_PARAMS.hatchDist;
  const fieldMode = data.fieldMode ?? WATERCOLOR_DEFAULT_PARAMS.fieldMode;
  const grain = data.grain ?? WATERCOLOR_DEFAULT_PARAMS.grain;
  const brushType = data.brushType ?? WATERCOLOR_DEFAULT_PARAMS.brushType;
  const seed = data.seed ?? WATERCOLOR_DEFAULT_PARAMS.seed;

  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const sessionRef = useRef<WatercolorSession | null>(null);
  const updateTimerRef = useRef<number | null>(null);

  // 当外部 data.imageUrl 变更时同步编辑态
  useEffect(() => {
    setIsEditing(!data?.imageUrl);
  }, [data?.imageUrl]);

  const currentState: WatercolorBrushState = useMemo(
    () => ({
      mode,
      paletteId,
      customColors: activeColors,
      brushType,
      wiggle,
      bleedStrength,
      textureStrength,
      borderStrength,
      hatchDist,
      fieldMode,
      grain,
      seed,
      imageUrl: data.imageUrl || null,
      isSaved: data.isSaved,
      error: null,
    }),
    [
      mode,
      paletteId,
      activeColors,
      brushType,
      wiggle,
      bleedStrength,
      textureStrength,
      borderStrength,
      hatchDist,
      fieldMode,
      grain,
      seed,
      data.imageUrl,
      data.isSaved,
    ]
  );

  // 保证 Canvas 始终挂载在当前有效的 DOM 容器上
  useEffect(() => {
    if (!containerEl || !sessionRef.current || sessionStatus !== 'ready') return;
    containerEl.replaceChildren();
    const canvas = sessionRef.current.canvas;
    canvas.className = 'max-w-full max-h-full object-contain';
    containerEl.appendChild(canvas);
  }, [containerEl, sessionStatus]);

  // 会话建立：编辑态时打开离屏 Canvas，离开编辑态 / 卸载时释放
  useEffect(() => {
    if (!isEditing) {
      sessionRef.current?.dispose();
      sessionRef.current = null;
      setSessionStatus('idle');
      return;
    }
    let cancelled = false;
    setSessionStatus('loading');

    (async () => {
      try {
        const { WatercolorSession } = await import('../watercolor');
        if (cancelled) return;
        const session = await WatercolorSession.create({
          params: currentState,
          width: 512,
          height: 512,
        });
        if (cancelled) {
          session.dispose();
          return;
        }
        sessionRef.current?.dispose();
        sessionRef.current = session;
        setSessionStatus('ready');
      } catch (err: any) {
        console.error('初始化物理水彩会话失败:', err);
        setSessionStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, mode]);

  // 参数更新实时响应（防抖 200ms）
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || sessionStatus !== 'ready') return;

    if (updateTimerRef.current !== null) {
      window.clearTimeout(updateTimerRef.current);
    }

    updateTimerRef.current = window.setTimeout(() => {
      updateTimerRef.current = null;
      try {
        session.update(currentState);
      } catch (err) {
        console.error('更新物理水彩预览失败:', err);
      }
    }, 200);

    return () => {
      if (updateTimerRef.current !== null) {
        window.clearTimeout(updateTimerRef.current);
      }
    };
  }, [currentState, sessionStatus]);

  const patchParam = useCallback(
    (patch: Partial<WatercolorBrushState>) => {
      onUpdateState?.(id, patch);
    },
    [id, onUpdateState]
  );

  // 重新播种（换个随机感）
  const handleReseed = useCallback(() => {
    patchParam({ seed: Math.floor(Math.random() * 999999) });
    showToast('已重新播种随机形态', { type: 'success' });
  }, [patchParam, showToast]);

  // 生成：会话就绪时直接导出当前画布；未就绪时回退一次性高清渲染
  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      let dataUrl: string;
      const session = sessionRef.current;
      if (session && sessionStatus === 'ready') {
        dataUrl = session.toDataUrl();
      } else {
        const { renderWatercolorArt } = await import('../watercolor');
        const result = await renderWatercolorArt(currentState, 1080, 1080);
        dataUrl = result.dataUrl;
      }

      // 立即显式退出编辑态，切入结果展示态，避免时序中间态导致的布局错位
      setIsEditing(false);

      onUpdateState?.(id, {
        ...currentState,
        imageUrl: dataUrl,
        isSaved: false,
      });
      showToast('水彩手绘生成完成（可点击保存按钮写入数据库）', { type: 'success' });
    } catch (err: any) {
      console.error('生成水彩画作失败:', err);
      showToast(err?.message || '生成失败，请重试', { type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, sessionStatus, currentState, id, onUpdateState, showToast]);

  // 独立保存到数据库
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);
    try {
      await onExport(id, imgUrl, {
        ...currentState,
        imageUrl: imgUrl,
        isSaved: true,
      });
      onUpdateState?.(id, { isSaved: true });
      onSelect?.(id);
      showToast('水彩画作已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      console.error('保存到数据库失败:', err);
      showToast(err?.detail || err?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [data?.imageUrl, isExporting, onExport, id, currentState, onUpdateState, onSelect, showToast]);

  // 本地直接下载 PNG
  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `watercolor-brush-${Date.now()}.png`;
    link.click();
    showToast('水彩图片已下载', { type: 'success' });
  }, [data?.imageUrl, showToast]);

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
      title={title || '物理水彩手绘'}
      dotColor={NODE_COLORS.watercolor_brush || 'oklch(0.68 0.18 190)'}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 580 }}
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
              {/* 独立保存到数据库按钮 */}
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={isExporting || isSaved}
                tooltip={isSaved ? '已保存到数据库' : '保存到数据库（保存后可公开/收藏）'}
                className={isSaved ? 'text-accent opacity-70' : 'text-ink-light hover:text-accent'}
              />
              {/* 收藏按钮 */}
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
              {/* 公开按钮 */}
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
              {/* 下载按钮 */}
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isExporting}
                tooltip="直接下载水彩 PNG"
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
                tooltip="生成物理水彩"
                onClick={handleGenerate}
                disabled={isGenerating}
              />
              <NodeActionBar.Custom
                icon={<Dices size={16} strokeWidth={1.5} />}
                tooltip="随机重掷形态"
                onClick={handleReseed}
                disabled={isGenerating}
              />
            </>
          )}
          <NodeActionBar.ExternalLink
            href="https://p5-brush.cargo.site/"
            tooltip="点击浏览 p5.brush 官方艺术展"
          />
        </NodeActionBar>
      }
    >

      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 参数工具栏 */}
        {!hasGenerated && (
          <div className="relative z-20 flex flex-col gap-2 p-2 rounded-xl bg-paper/95 border border-paper-grid/80 text-xs font-sans text-ink-light select-none shadow-2xs shrink-0">
            {/* 构图模式与调色板选择 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[10px] text-ink-faint">构图范式</span>
                <Select
                  value={mode}
                  onChange={(val) => patchParam({ mode: val as WatercolorCompositionMode })}
                  options={MODE_OPTIONS}
                  disabled={isGenerating}
                  size="sm"
                  className="w-full"
                />
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[10px] text-ink-faint">配色方案</span>
                <Select
                  value={paletteId}
                  onChange={(val) => patchParam({ paletteId: val })}
                  options={PALETTE_OPTIONS}
                  disabled={isGenerating || !!upstreamColors}
                  size="sm"
                  className="w-full"
                />
              </div>
            </div>

            {/* 核心滑杆参数 2x2 等宽网格 */}
            <div className="grid gap-x-4 gap-y-1.5 grid-cols-2 pt-1 border-t border-paper-grid/40">
              <SliderRow
                label="手颤"
                value={wiggle}
                min={0.2}
                max={2.5}
                step={0.1}
                display={`${wiggle.toFixed(1)}x`}
                labelWidth="w-6"
                valueWidth="min-w-[26px]"
                disabled={isGenerating}
                onChange={(v) => patchParam({ wiggle: v })}
              />
              <SliderRow
                label="出血"
                value={bleedStrength}
                min={0.0}
                max={0.8}
                step={0.05}
                display={`${Math.round(bleedStrength * 100)}%`}
                labelWidth="w-6"
                valueWidth="min-w-[26px]"
                disabled={isGenerating}
                onChange={(v) => patchParam({ bleedStrength: v })}
              />
              <SliderRow
                label="纸纹"
                value={textureStrength}
                min={0.0}
                max={1.0}
                step={0.05}
                display={`${Math.round(textureStrength * 100)}%`}
                labelWidth="w-6"
                valueWidth="min-w-[26px]"
                disabled={isGenerating}
                onChange={(v) => patchParam({ textureStrength: v })}
              />
              <SliderRow
                label="排线"
                value={hatchDist}
                min={4}
                max={20}
                step={1}
                display={`${hatchDist}px`}
                labelWidth="w-6"
                valueWidth="min-w-[26px]"
                disabled={isGenerating}
                onChange={(v) => patchParam({ hatchDist: v })}
              />
            </div>
          </div>
        )}

        {/* 预览视口 */}
        <div className="relative flex-1 min-h-0 w-full overflow-hidden rounded bg-[#FCFAF2] border border-paper-grid/40 flex flex-col items-center justify-center select-none shadow-inner p-2">
          {!hasGenerated ? (
            <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
              {/* Canvas 挂载容器 */}
              <div ref={setContainerEl} className="w-full h-full flex items-center justify-center" />

              {/* 加载动效遮罩：严格居中覆盖整个视口 */}
              {sessionStatus === 'loading' && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 bg-[#FCFAF2]/80 backdrop-blur-[2px] text-ink-light pointer-events-none">
                  <Loader2 size={26} className="animate-spin text-accent" />
                  <span className="text-xs font-sans text-ink-light font-medium">正在渲染物理水彩…</span>
                </div>
              )}

              {/* 错误提示遮罩 */}
              {sessionStatus === 'error' && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#FCFAF2]/90 backdrop-blur-sm text-ink-faint p-4 text-center">
                  <span className="text-xs">无法建立 WebGL 渲染会话</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSessionStatus('idle');
                      patchParam({ seed: Date.now() % 100000 });
                    }}
                    className="px-2.5 py-1 rounded text-xs bg-paper-grid/40 hover:bg-paper-grid/70 active:scale-[0.96] transition-colors duration-150"
                  >
                    重试
                  </button>
                </div>
              )}
            </div>
          ) : (
            <PhotoProvider maskOpacity={0.85} bannerVisible={false}>
              <div className="relative w-full h-full flex items-center justify-center p-2">
                {data.imageUrl ? (
                  <div className="relative group max-w-full max-h-full flex items-center justify-center">
                    <PhotoView src={data.imageUrl}>
                      <img
                        src={data.imageUrl}
                        alt="水彩手绘预览"
                        className="max-w-full max-h-[440px] object-contain drop-shadow-md select-none rounded cursor-zoom-in hover:opacity-95 transition-opacity"
                      />
                    </PhotoView>
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="absolute bottom-3 right-3 px-2.5 py-1.5 rounded-full bg-paper/90 backdrop-blur text-ink text-xs shadow-md border border-paper-grid/40 hover:bg-white hover:text-accent active:scale-[0.96] transition-[opacity,transform,background-color,color] flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent duration-150 z-10"
                    >
                      <Pencil size={12} strokeWidth={1.5} />
                      <span>调整参数</span>
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无水彩生成结果</div>
                )}
              </div>
            </PhotoProvider>
          )}

          {isGenerating && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/35 backdrop-blur-sm text-paper">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-xs">正在渲染物理水彩…</span>
            </div>
          )}
        </div>

        {/* 状态弱提示 */}
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

export const WatercolorBrushNode = memo(WatercolorBrushNodeInner);
WatercolorBrushNode.displayName = 'WatercolorBrushNode';
export default WatercolorBrushNode;

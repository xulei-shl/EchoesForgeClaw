import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Palette,
  Heart,
  Globe,
  Loader2,
  Pencil,
  Check,
  Dices,
  ChevronUp,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { SliderRow } from '../../../platform/components/ui/Slider';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type WatercolorBrushState,
  type WatercolorCompositionMode,
  type WatercolorLayoutMode,
  type WatercolorBrushType,
  type WatercolorFieldMode,
  type WatercolorTechnique,
  type WatercolorAspectRatio,
  type WatercolorResolution,
  WATERCOLOR_PRESET_PALETTES,
  WATERCOLOR_DEFAULT_PARAMS,
  WATERCOLOR_PRESET_RECIPES,
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

const PRESET_SELECT_OPTIONS: SelectOption[] = [
  { value: 'custom', label: '自由创想', title: '空白画板·自由拼装所有积木参数' },
  { value: 'spiral_vortex', label: '螺线律动', title: '连续曲线笔触、流光彩带与漩涡星云' },
  { value: 'woven_grid', label: '浮水织锦', title: '海床流场波动经纬、水彩光斑与交错排线' },
  { value: 'watercolor_clouds', label: '云阶水彩', title: '纯净多层水彩晕染，无杂乱直线' },
  { value: 'topographic_strata', label: '山川层峦', title: '东方青绿等高线山川地貌' },
  { value: 'matisse_cutouts', label: '剪纸留白', title: '马蒂斯现代几何剪纸造型与负空间' },
  { value: 'botanical_bloom', label: '绽放花轮', title: '纯植物花瓣多层展开与色彩渗透' },
  { value: 'bauhaus_grid', label: '包豪斯', title: '现代主义几何色块与贯穿一体排线' },
  { value: 'zen_splash', label: '破墨飞白', title: '东方水墨书法粗重圆相与写意渗透' },
  { value: 'abstract_sketch', label: '表现手绘', title: '纯粹向量流场速写与飞线动势' },
  { value: 'ukiyo_wave', label: '浮世浪涌', title: '卷曲翻滚的浮世绘巨浪浪峰' },
  { value: 'aerosol_spray', label: '气溶胶', title: '喷枪微粒、街头艺术与气溶胶晕染' },
  { value: 'mineral_rubbing', label: '拓印岩彩', title: '干画粉彩涂抹与粗粝矿物岩石' },
];

const LAYOUT_MODE_OPTIONS: SelectOption[] = [
  { value: 'blobs', label: '有机块面' },
  { value: 'strata', label: '层叠流线' },
  { value: 'flow_lines', label: '流场线描' },
  { value: 'radial', label: '极坐标放射' },
  { value: 'grid', label: '几何方阵' },
  { value: 'woven_grid', label: '浮水织锦' },
  { value: 'spirals', label: '螺线律动' },
  { value: 'rings', label: '同心环系' },
  { value: 'cutouts', label: '负空间镂空' },
  { value: 'waves', label: '浮世浪峰' },
  { value: 'spray', label: '气溶胶喷绘' },
  { value: 'mineral', label: '拓印岩彩' },
];

const PALETTE_OPTIONS: SelectOption[] = WATERCOLOR_PRESET_PALETTES.map((p) => ({
  value: p.id,
  label: p.name,
}));

const ASPECT_RATIO_OPTIONS: SelectOption[] = [
  { value: '1:1', label: '1:1 方形' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '4:3', label: '4:3 横版' },
  { value: '9:16', label: '9:16 手机' },
  { value: '16:9', label: '16:9 宽屏' },
];

const RESOLUTION_OPTIONS: SelectOption[] = [
  { value: '1024', label: '1K 标准' },
  { value: '2048', label: '2K 超清' },
];

const BACKGROUND_OPTIONS: SelectOption[] = [
  { value: 'paper', label: '象牙白纸' },
  { value: 'transparent', label: '透明底' },
];

const BRUSH_TYPE_OPTIONS: SelectOption[] = [
  { value: 'watercolor', label: '水彩笔' },
  { value: 'pastel', label: '粉彩笔' },
  { value: 'charcoal', label: '炭笔' },
  { value: 'rotring', label: '针管笔' },
  { value: 'pen', label: '钢笔' },
  { value: '2B', label: '2B 软铅笔' },
  { value: 'HB', label: 'HB 铅笔' },
  { value: '2H', label: '2H 硬铅笔' },
  { value: 'cpencil', label: '彩色铅笔' },
  { value: 'spray', label: '喷枪微粒' },
  { value: 'marker', label: '马克笔' },
];

const FIELD_MODE_OPTIONS: SelectOption[] = [
  { value: 'curved', label: '弧形流场' },
  { value: 'seabed', label: '海床柔流' },
  { value: 'waves', label: '潮汐波浪' },
  { value: 'spiral', label: '同心旋涡' },
  { value: 'zigzag', label: '之字折线' },
  { value: 'hand', label: '手绘微颤' },
  { value: 'columns', label: '纵向列流' },
  { value: 'none', label: '无流场·纯直笔' },
];

const TECHNIQUE_OPTIONS: SelectOption[] = [
  { value: 'watercolor', label: '物理水彩晕染' },
  { value: 'massing', label: '干画粉彩手绘' },
  { value: 'hatching', label: '密集单向排线' },
  { value: 'hatch_array', label: '贯穿一体排线' },
  { value: 'wash', label: '清透平涂水洗' },
  { value: 'contour', label: '纯手绘轮廓' },
];

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
  const mode: WatercolorCompositionMode = data.mode ?? WATERCOLOR_DEFAULT_PARAMS.mode;
  const layoutMode: WatercolorLayoutMode = data.layoutMode ?? WATERCOLOR_DEFAULT_PARAMS.layoutMode;
  const paletteId = data.paletteId ?? WATERCOLOR_DEFAULT_PARAMS.paletteId;
  const brushType: WatercolorBrushType = data.brushType ?? WATERCOLOR_DEFAULT_PARAMS.brushType;
  const fieldMode: WatercolorFieldMode = data.fieldMode ?? WATERCOLOR_DEFAULT_PARAMS.fieldMode;
  const technique: WatercolorTechnique = data.technique ?? WATERCOLOR_DEFAULT_PARAMS.technique;
  const curvature = data.curvature ?? WATERCOLOR_DEFAULT_PARAMS.curvature;
  const density = data.density ?? WATERCOLOR_DEFAULT_PARAMS.density;
  const wiggle = data.wiggle ?? WATERCOLOR_DEFAULT_PARAMS.wiggle;
  const bleedStrength = data.bleedStrength ?? WATERCOLOR_DEFAULT_PARAMS.bleedStrength;
  const textureStrength = data.textureStrength ?? WATERCOLOR_DEFAULT_PARAMS.textureStrength;
  const borderStrength = data.borderStrength ?? WATERCOLOR_DEFAULT_PARAMS.borderStrength;
  const hatchDist = data.hatchDist ?? WATERCOLOR_DEFAULT_PARAMS.hatchDist;
  const grain = data.grain ?? WATERCOLOR_DEFAULT_PARAMS.grain;
  const seed = data.seed ?? WATERCOLOR_DEFAULT_PARAMS.seed;
  const transparentBackground = data.transparentBackground ?? WATERCOLOR_DEFAULT_PARAMS.transparentBackground ?? false;
  const aspectRatio: WatercolorAspectRatio = data.aspectRatio ?? WATERCOLOR_DEFAULT_PARAMS.aspectRatio ?? '1:1';
  const resolution: WatercolorResolution = data.resolution ?? WATERCOLOR_DEFAULT_PARAMS.resolution ?? 1024;

  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

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
      layoutMode,
      paletteId,
      customColors: activeColors,
      brushType,
      fieldMode,
      technique,
      curvature,
      density,
      wiggle,
      bleedStrength,
      textureStrength,
      borderStrength,
      hatchDist,
      grain,
      seed,
      transparentBackground,
      aspectRatio,
      resolution,
      imageUrl: data.imageUrl || null,
      isSaved: data.isSaved,
      error: null,
    }),
    [
      mode,
      layoutMode,
      paletteId,
      activeColors,
      brushType,
      fieldMode,
      technique,
      curvature,
      density,
      wiggle,
      bleedStrength,
      textureStrength,
      borderStrength,
      hatchDist,
      grain,
      seed,
      transparentBackground,
      aspectRatio,
      resolution,
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
        const { WatercolorSession, getWatercolorDimensions } = await import('../watercolor');
        if (cancelled) return;
        const dims = getWatercolorDimensions(aspectRatio, 512);
        const session = await WatercolorSession.create({
          params: currentState,
          width: dims.width,
          height: dims.height,
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
  }, [isEditing, aspectRatio]);

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

  /** 一键装载美学配方（同步装载所有参数） */
  const handleApplyPresetRecipe = useCallback(
    (presetValue: WatercolorCompositionMode) => {
      if (presetValue === 'custom') {
        patchParam({ mode: 'custom' });
        return;
      }
      const recipe = WATERCOLOR_PRESET_RECIPES[presetValue];
      if (recipe) {
        patchParam({
          mode: presetValue,
          ...recipe,
        });
      }
    },
    [patchParam]
  );

  /** 全参数灵感洗牌（全维度随机生成独特的创作组合） */
  const handleRandomizeAll = useCallback(() => {
    const layoutModes: WatercolorLayoutMode[] = [
      'blobs',
      'strata',
      'flow_lines',
      'radial',
      'grid',
      'woven_grid',
      'spirals',
      'rings',
      'cutouts',
      'waves',
      'spray',
      'mineral',
    ];
    const brushTypes: WatercolorBrushType[] = ['watercolor', 'pastel', 'charcoal', 'rotring', 'pen', '2B', 'HB', 'cpencil', 'spray', 'marker'];
    const fieldModes: WatercolorFieldMode[] = ['curved', 'seabed', 'waves', 'spiral', 'zigzag', 'hand', 'columns', 'none'];
    const techniques: WatercolorTechnique[] = ['watercolor', 'massing', 'hatching', 'hatch_array', 'wash', 'contour'];

    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

    const randomState: Partial<WatercolorBrushState> = {
      mode: 'custom',
      layoutMode: pick(layoutModes),
      brushType: pick(brushTypes),
      fieldMode: pick(fieldModes),
      technique: pick(techniques),
      paletteId: pick(WATERCOLOR_PRESET_PALETTES).id,
      curvature: Number((Math.random() * 0.9 + 0.1).toFixed(2)),
      density: Number((Math.random() * 0.9 + 0.6).toFixed(1)),
      wiggle: Number((Math.random() * 1.6 + 0.4).toFixed(1)),
      bleedStrength: Number((Math.random() * 0.5 + 0.1).toFixed(2)),
      textureStrength: Number((Math.random() * 0.5 + 0.35).toFixed(2)),
      borderStrength: Number((Math.random() * 0.5 + 0.3).toFixed(2)),
      hatchDist: Math.floor(Math.random() * 10 + 5),
      seed: Math.floor(Math.random() * 999999),
    };

    patchParam(randomState);
    showToast('已随机生成全新灵感参数组合', { type: 'success' });
  }, [patchParam, showToast]);

  // 生成：执行高清物理水彩渲染导出
  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const { renderWatercolorArt } = await import('../watercolor');
      const result = await renderWatercolorArt(currentState);
      const dataUrl = result.dataUrl;

      // 立即显式退出编辑态，切入结果展示态，避免时序中间态导致的布局错位
      setIsEditing(false);

      onUpdateState?.(id, {
        ...currentState,
        imageUrl: dataUrl,
        isSaved: false,
      });
      showToast(
        `水彩手绘生成完成 (${result.width}×${result.height}${currentState.transparentBackground ? '·透明底' : ''})`,
        { type: 'success' }
      );
    } catch (err: any) {
      console.error('生成水彩画作失败:', err);
      showToast(err?.message || '生成失败，请重试', { type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, currentState, id, onUpdateState, showToast]);

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

  const checkerboardStyle: React.CSSProperties = transparentBackground
    ? {
        backgroundImage: `
          linear-gradient(45deg, rgba(0, 0, 0, 0.06) 25%, transparent 25%),
          linear-gradient(-45deg, rgba(0, 0, 0, 0.06) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, rgba(0, 0, 0, 0.06) 75%),
          linear-gradient(-45deg, transparent 75%, rgba(0, 0, 0, 0.06) 75%)
        `,
        backgroundSize: '16px 16px',
        backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
        backgroundColor: '#f8f8fa',
      }
    : {
        backgroundColor: '#FCFAF2',
      };

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
      defaultSize={{ width: 450, height: 640 }}
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
                icon={<Check size={16} strokeWidth={1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={isExporting || isSaved}
                tooltip={isSaved ? '已保存到数据库' : '保存到数据库（保存后可公开/收藏）'}
                className={isSaved ? 'text-accent opacity-70' : 'text-ink-light hover:text-accent'}
              />
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
                tooltip="全参数灵感洗牌（一键随机生成全新组合）"
                onClick={handleRandomizeAll}
                disabled={isGenerating}
              />
            </>
          )}
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 参数工具栏 */}
        {!hasGenerated && (
          <div className="relative z-20 flex flex-col gap-1.5 p-2 rounded-xl bg-paper/95 border border-paper-grid/80 text-xs font-sans text-ink-light select-none shadow-2xs shrink-0">
            {/* 预设美学配方选择器 + 右侧展开/收起参数工坊按钮 */}
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="flex-1 min-w-0">
                <Select
                  value={mode}
                  onChange={(val) => handleApplyPresetRecipe(val as WatercolorCompositionMode)}
                  options={PRESET_SELECT_OPTIONS}
                  disabled={isGenerating}
                  size="sm"
                  className="w-full"
                />
              </div>

              <Tooltip content={isPanelCollapsed ? '展开画室参数工坊' : '收起参数工坊，最大化预览水彩'}>
                <button
                  type="button"
                  onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
                  className={`h-8 px-2.5 flex items-center gap-1 rounded-md border border-dashed border-paper-grid text-xs font-medium transition-[color,border-color,background-color,transform] active:scale-[0.96] shrink-0 ${
                    !isPanelCollapsed
                      ? 'bg-accent/10 border-accent/40 text-accent font-semibold'
                      : 'text-ink-light hover:text-accent hover:border-accent/40 bg-transparent'
                  }`}
                  aria-label={isPanelCollapsed ? '展开画室参数工坊' : '收起画室参数工坊'}
                >
                  <SlidersHorizontal size={13} />
                  <span className="text-[11px]">{isPanelCollapsed ? '参数' : '收起'}</span>
                  {isPanelCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                </button>
              </Tooltip>
            </div>

            {/* 可平滑收起的详细参数工坊（正交积木参数组合） */}
            <AnimatePresence initial={false}>
              {!isPanelCollapsed && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-col gap-2 pt-1 max-h-[220px] overflow-y-auto pr-1">
                    {/* 1. 构图几何母题 & 主笔刷材质 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-[10px] text-ink-faint">构图母题</span>
                        <Select
                          value={layoutMode}
                          onChange={(val) => patchParam({ layoutMode: val as WatercolorLayoutMode, mode: 'custom' })}
                          options={LAYOUT_MODE_OPTIONS}
                          disabled={isGenerating}
                          size="sm"
                          className="w-full"
                        />
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-[10px] text-ink-faint">主笔刷材质</span>
                        <Select
                          value={brushType}
                          onChange={(val) => patchParam({ brushType: val as WatercolorBrushType, mode: 'custom' })}
                          options={BRUSH_TYPE_OPTIONS}
                          disabled={isGenerating}
                          size="sm"
                          className="w-full"
                        />
                      </div>
                    </div>

                    {/* 2. 向量流场引导 & 填色技法 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-[10px] text-ink-faint">向量流场</span>
                        <Select
                          value={fieldMode}
                          onChange={(val) => patchParam({ fieldMode: val as WatercolorFieldMode, mode: 'custom' })}
                          options={FIELD_MODE_OPTIONS}
                          disabled={isGenerating}
                          size="sm"
                          className="w-full"
                        />
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-[10px] text-ink-faint">填色技法</span>
                        <Select
                          value={technique}
                          onChange={(val) => patchParam({ technique: val as WatercolorTechnique, mode: 'custom' })}
                          options={TECHNIQUE_OPTIONS}
                          disabled={isGenerating}
                          size="sm"
                          className="w-full"
                        />
                      </div>
                    </div>

                    {/* 3. 物理特性微调滑杆（紧凑双列网格，减少视觉割裂） */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1 border-t border-paper-grid/40">
                      <SliderRow
                        label="曲率"
                        value={curvature}
                        min={0.0}
                        max={1.0}
                        step={0.05}
                        display={`${Math.round(curvature * 100)}%`}
                        labelWidth="w-6"
                        valueWidth="min-w-[26px]"
                        disabled={isGenerating}
                        onChange={(v) => patchParam({ curvature: v, mode: 'custom' })}
                      />
                      <SliderRow
                        label="密度"
                        value={density}
                        min={0.3}
                        max={2.0}
                        step={0.1}
                        display={`${density.toFixed(1)}x`}
                        labelWidth="w-6"
                        valueWidth="min-w-[26px]"
                        disabled={isGenerating}
                        onChange={(v) => patchParam({ density: v, mode: 'custom' })}
                      />
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
                        onChange={(v) => patchParam({ wiggle: v, mode: 'custom' })}
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
                        onChange={(v) => patchParam({ bleedStrength: v, mode: 'custom' })}
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
                        onChange={(v) => patchParam({ textureStrength: v, mode: 'custom' })}
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
                        onChange={(v) => patchParam({ hatchDist: v, mode: 'custom' })}
                      />
                    </div>

                    {/* 4. 配色与规格 */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-paper-grid/40">
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-[10px] text-ink-faint">配色方案</span>
                        <Select
                          value={paletteId}
                          onChange={(val) => patchParam({ paletteId: val, mode: 'custom' })}
                          options={PALETTE_OPTIONS}
                          disabled={isGenerating || !!upstreamColors}
                          size="sm"
                          className="w-full"
                        />
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-[10px] text-ink-faint">画底质感</span>
                        <Select
                          value={transparentBackground ? 'transparent' : 'paper'}
                          onChange={(val) => patchParam({ transparentBackground: val === 'transparent', mode: 'custom' })}
                          options={BACKGROUND_OPTIONS}
                          disabled={isGenerating}
                          size="sm"
                          className="w-full"
                        />
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-[10px] text-ink-faint">画幅比例</span>
                        <Select
                          value={aspectRatio}
                          onChange={(val) => patchParam({ aspectRatio: val as WatercolorAspectRatio })}
                          options={ASPECT_RATIO_OPTIONS}
                          disabled={isGenerating}
                          size="sm"
                          className="w-full"
                        />
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-[10px] text-ink-faint">导出画质</span>
                        <Select
                          value={String(resolution)}
                          onChange={(val) => patchParam({ resolution: Number(val) as WatercolorResolution })}
                          options={RESOLUTION_OPTIONS}
                          disabled={isGenerating}
                          size="sm"
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 预览视口 */}
        <div
          className="relative flex-1 min-h-0 w-full overflow-hidden rounded border border-paper-grid/40 flex flex-col items-center justify-center select-none shadow-inner p-2"
          style={checkerboardStyle}
        >
          {!hasGenerated ? (
            <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
              {/* Canvas 挂载容器 */}
              <div ref={setContainerEl} className="w-full h-full flex items-center justify-center" />

              {/* 加载动效遮罩：严格居中覆盖整个视口 */}
              {sessionStatus === 'loading' && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 bg-paper/80 backdrop-blur-[2px] text-ink-light pointer-events-none">
                  <Loader2 size={26} className="animate-spin text-accent" />
                  <span className="text-xs font-sans text-ink-light font-medium">正在渲染物理水彩…</span>
                </div>
              )}

              {/* 错误提示遮罩 */}
              {sessionStatus === 'error' && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-paper/90 backdrop-blur-sm text-ink-faint p-4 text-center">
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
                        className="max-w-full max-h-[460px] object-contain drop-shadow-md select-none rounded cursor-zoom-in hover:opacity-95 transition-opacity"
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

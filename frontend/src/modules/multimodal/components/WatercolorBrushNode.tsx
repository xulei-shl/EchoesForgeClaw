import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Palette,
  Heart,
  Globe,
  Loader2,
  Pencil,
  Check,
  Dices,
  SlidersHorizontal,
} from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
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
  WatercolorStudioPanel,
} from '../watercolor';
import type { WatercolorSession } from '../watercolor/engine';

const PRESET_SELECT_OPTIONS: SelectOption[] = [
  { value: 'custom', label: '自由创想', title: '空白画板·自由拼装所有积木参数' },
  { value: 'spiral_vortex', label: '螺线律动', title: '连续曲线笔触、流光彩带与漩涡星云' },
  { value: 'woven_grid', label: '浮水织锦', title: '海床流场波动经纬、水彩光斑与交错排线' },
  { value: 'watercolor_clouds', label: '云阶水彩', title: '纯净多层水彩有机云团，无杂乱直线' },
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
export interface WatercolorBrushNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  data?: Partial<WatercolorBrushState> & {
    imageUrl?: string | null;
    isSaved?: boolean;
    error?: string | null;
  };
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
  onUpdateState?: (id: string, patch: Partial<WatercolorBrushState>) => void;
  onExport?: (id: string, dataUrl: string, state: WatercolorBrushState) => Promise<void>;
}

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
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isRollingDice, setIsRollingDice] = useState(false);
  // 用户是否已开始创作（选择模板/调整参数等）：未开始时保持空白，不建立渲染会话
  const [hasStarted, setHasStarted] = useState<boolean>(() => Boolean(data?.previewStarted));

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

  // 会话建立：编辑态时打开离屏 Canvas，离开编辑态 / 卸载时释放。
  // 新节点未选择模板前（hasStarted = false）不建立会话，保持空白，避免创建即渲染卡顿
  useEffect(() => {
    if (!isEditing) {
      sessionRef.current?.dispose();
      sessionRef.current = null;
      setSessionStatus('idle');
      return;
    }
    if (!hasStarted) {
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
  }, [isEditing, aspectRatio, hasStarted]);

  // 参数更新实时响应（极速防抖 60ms，兼顾帧率与物理模拟性能）
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
    }, 60);

    return () => {
      if (updateTimerRef.current !== null) {
        window.clearTimeout(updateTimerRef.current);
      }
    };
  }, [currentState, sessionStatus]);

  const patchParam = useCallback(
    (patch: Partial<WatercolorBrushState>) => {
      // 用户第一次交互（选模板 / 改参数 / 洗牌 / 重置）即视为开始创作：
      // 置位并持久化 previewStarted，此后编辑态建立实时预览会话
      setHasStarted(true);
      onUpdateState?.(id, { ...patch, previewStarted: true });
    },
    [id, onUpdateState]
  );

  /** 一键装载美学配方（同步装载所有参数、刷新随机种子并同步调色板） */
  const handleApplyPresetRecipe = useCallback(
    (presetValue: WatercolorCompositionMode) => {
      if (presetValue === 'custom') {
        patchParam({ mode: 'custom' });
        return;
      }
      const recipe = WATERCOLOR_PRESET_RECIPES[presetValue];
      if (recipe) {
        const nextPalette = WATERCOLOR_PRESET_PALETTES.find((p) => p.id === recipe.paletteId);
        const nextColors = upstreamColors && upstreamColors.length > 0 ? upstreamColors : nextPalette?.colors || [];
        patchParam({
          mode: presetValue,
          seed: Math.floor(Math.random() * 999999),
          customColors: nextColors,
          ...recipe,
        });
      }
    },
    [patchParam, upstreamColors]
  );

  /** 全参数灵感洗牌（全维度随机生成独特的创作组合，附带触觉反馈与微动效） */
  const handleRandomizeAll = useCallback(() => {
    setIsRollingDice(true);
    window.setTimeout(() => setIsRollingDice(false), 350);

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

  /** 统一重置参数为初始默认值（编辑态与预览态通用） */
  const handleResetParams = useCallback(() => {
    const defaultSettings = { ...WATERCOLOR_DEFAULT_PARAMS };
    const patch: Partial<WatercolorBrushState> = {
      ...defaultSettings,
      customColors: activeColors,
    };

    if (data?.imageUrl && !isEditing) {
      setIsEditing(true);
      patch.imageUrl = null;
      patch.isSaved = false;
    }

    patchParam(patch);
    showToast('已重置为初始默认参数', { type: 'success' });
  }, [activeColors, data?.imageUrl, isEditing, patchParam, showToast]);


  // 生成：执行高清物理水彩渲染导出
  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    // 已进入创作流程：之后重新进入编辑态时恢复实时预览
    setHasStarted(true);
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
        previewStarted: true,
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
      className={`transition-[opacity,transform] duration-150 ease-out ${
        isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''
      }`}
      showLeftAnchor={true}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      sideDrawer={
        isEditing ? (
          <WatercolorStudioPanel
            isOpen={isDrawerOpen}
            mode={mode}
            layoutMode={layoutMode}
            brushType={brushType}
            fieldMode={fieldMode}
            technique={technique}
            curvature={curvature}
            density={density}
            wiggle={wiggle}
            bleedStrength={bleedStrength}
            textureStrength={textureStrength}
            hatchDist={hatchDist}
            paletteId={paletteId}
            transparentBackground={transparentBackground}
            aspectRatio={aspectRatio}
            resolution={resolution}
            upstreamColors={upstreamColors}
            disabled={isGenerating}
            onUpdate={patchParam}
            onClose={() => setIsDrawerOpen(false)}
          />
        ) : undefined
      }
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
                onClick={handleResetParams}
                disabled={isExporting}
                tooltip="重置为初始默认参数"
              />
            </>
          ) : (
            <>
              <NodeActionBar.Custom
                icon={
                  isGenerating ? (
                    <Loader2 size={16} className="animate-spin motion-reduce:animate-none text-accent" />
                  ) : (
                    <Palette size={16} strokeWidth={1.5} />
                  )
                }
                tooltip="生成物理水彩"
                onClick={handleGenerate}
                disabled={isGenerating}
              />
              <NodeActionBar.Custom
                icon={
                  <SlidersHorizontal
                    size={16}
                    strokeWidth={1.5}
                    className={isDrawerOpen ? 'text-accent' : ''}
                  />
                }
                tooltip={isDrawerOpen ? '收起配置抽屉' : '展开参数配置抽屉'}
                onClick={() => setIsDrawerOpen((prev) => !prev)}
                className={isDrawerOpen ? 'text-accent' : ''}
              />
              <NodeActionBar.Custom
                icon={
                  <Dices
                    size={16}
                    strokeWidth={1.5}
                    className={`transition-transform duration-300 ease-out ${
                      isRollingDice ? 'rotate-180 scale-110 text-accent' : ''
                    }`}
                  />
                }
                tooltip="全参数灵感洗牌（一键随机生成全新组合）"
                onClick={handleRandomizeAll}
                disabled={isGenerating}
              />
              <NodeActionBar.Reset
                onClick={handleResetParams}
                disabled={isGenerating}
                tooltip="重置为初始默认参数"
              />
            </>
          )}
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 顶部单行常驻配方工具栏（无内部折叠表单，仅占用约 34px） */}
        {!hasGenerated && (
          <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-paper/95 border border-paper-grid/80 text-xs font-sans text-ink-light select-none shadow-2xs shrink-0">
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

            <Tooltip content={isDrawerOpen ? '收起画室参数抽屉' : '展开参数抽屉，精调笔法与物理特性'}>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(!isDrawerOpen)}
                className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md border border-dashed text-xs font-medium transition-[color,border-color,background-color,transform] active:scale-[0.96] shrink-0 cursor-pointer ${
                  isDrawerOpen
                    ? 'bg-accent/10 border-accent/40 text-accent font-semibold'
                    : 'border-paper-grid text-ink-light hover:text-accent hover:border-accent/40 bg-transparent'
                }`}
                aria-label={isDrawerOpen ? '收起画室参数抽屉' : '展开画室参数抽屉'}
              >
                <SlidersHorizontal size={13} />
                <span className="text-[11px]">{isDrawerOpen ? '收起' : '参数'}</span>
              </button>
            </Tooltip>
          </div>
        )}

        {/* 预览视口 */}
        <div

          className="relative flex-1 min-h-0 w-full overflow-hidden rounded border border-paper-grid/40 flex flex-col items-center justify-center select-none shadow-inner p-2"
          style={checkerboardStyle}
        >
          {!hasGenerated ? (
            <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
              {!hasStarted ? (
                /* 空白起始态：未选择模板前不建立渲染会话 */
                <div className="flex flex-col items-center justify-center gap-2 text-ink-faint select-none">
                  <Palette size={22} strokeWidth={1.5} className="opacity-60" />
                  <span className="text-xs font-sans">选择上方模板开始创作</span>
                </div>
              ) : (
                <>
                  {/* Canvas 挂载容器 */}
                  <div ref={setContainerEl} className="w-full h-full flex items-center justify-center" />

                  {/* 加载动效遮罩：严格居中覆盖整个视口 */}
                  {sessionStatus === 'loading' && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 bg-paper/80 backdrop-blur-[2px] text-ink-light pointer-events-none">
                      <Loader2 size={26} className="animate-spin motion-reduce:animate-none text-accent" />
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
                </>
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
              <Loader2 size={28} className="animate-spin motion-reduce:animate-none" />
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

import React, { useState, useMemo } from 'react';
import {
  Palette,
  Brush,
  Gauge,
  Sliders,
  Link,
  Image as ImageIcon,
  AlertCircle,
} from 'lucide-react';
import { NodeSideDrawer } from '../../../platform/components/node/NodeSideDrawer';
import { NumberStepperRow } from '../../../platform/components/ui/NumberStepper';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import {
  type WatercolorBackgroundType,
  type WatercolorBrushState,
  type WatercolorCompositionMode,
  type WatercolorLayoutMode,
  type WatercolorBrushType,
  type WatercolorFieldMode,
  type WatercolorTechnique,
  type WatercolorAspectRatio,
  type WatercolorResolution,
  WATERCOLOR_PRESET_PALETTES,
} from './types';

export interface WatercolorStudioPanelProps {
  isOpen: boolean;
  mode: WatercolorCompositionMode;
  layoutMode: WatercolorLayoutMode;
  brushType: WatercolorBrushType;
  fieldMode: WatercolorFieldMode;
  technique: WatercolorTechnique;
  curvature: number;
  density: number;
  wiggle: number;
  bleedStrength: number;
  textureStrength: number;
  hatchDist: number;
  paletteId: string;
  transparentBackground?: boolean;
  backgroundType?: WatercolorBackgroundType;
  bgImageOpacity?: number;
  upstreamImageUrl?: string | null;
  aspectRatio: WatercolorAspectRatio;
  resolution: WatercolorResolution;
  upstreamColors?: string[] | null;
  disabled?: boolean;
  onUpdate: (patch: Partial<WatercolorBrushState>) => void;
  onClose: () => void;
}

type PanelTab = 'brush' | 'physics' | 'canvas';

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
  { value: 'image', label: '背景图 (上游/封面)' },
];

const PRESET_NAME_MAP: Record<string, string> = {
  custom: '自由创想',
  spiral_vortex: '螺线律动',
  woven_grid: '浮水织锦',
  watercolor_clouds: '云阶水彩',
  topographic_strata: '山川层峦',
  matisse_cutouts: '剪纸留白',
  botanical_bloom: '绽放花轮',
  bauhaus_grid: '包豪斯',
  zen_splash: '破墨飞白',
  abstract_sketch: '表现手绘',
  ukiyo_wave: '浮世浪涌',
  aerosol_spray: '气溶胶',
  mineral_rubbing: '拓印岩彩',
};

/**
 * 物理水彩参数配置抽屉面板
 * 遵循 NodeSideDrawer 范式与 better-layout 结构，提供笔法、物理、规格 3 组负空间 Tab
 */
export const WatercolorStudioPanel: React.FC<WatercolorStudioPanelProps> = ({
  isOpen,
  mode,
  layoutMode,
  brushType,
  fieldMode,
  technique,
  curvature,
  density,
  wiggle,
  bleedStrength,
  textureStrength,
  hatchDist,
  paletteId,
  transparentBackground,
  backgroundType,
  bgImageOpacity = 0.35,
  upstreamImageUrl,
  aspectRatio,
  resolution,
  upstreamColors,
  disabled = false,
  onUpdate,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('brush');

  const effectiveBgType: WatercolorBackgroundType =
    backgroundType ?? (transparentBackground ? 'transparent' : 'paper');

  // 当前调色板颜色预览
  const currentPalette = useMemo(() => {
    return WATERCOLOR_PRESET_PALETTES.find((p) => p.id === paletteId) || WATERCOLOR_PRESET_PALETTES[0];
  }, [paletteId]);

  return (
    <NodeSideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="物理水彩工坊"
      subtitle={`配方: ${PRESET_NAME_MAP[mode] || '自定义'}`}
      icon={<Palette size={14} />}
      width={310}
    >
      <div className="flex flex-col gap-3 font-sans">
        {/* 顶部 Tab 分段按钮（负空间胶囊分组，同心圆角） */}
        <div className="grid grid-cols-3 gap-0.5 p-0.5 rounded-lg bg-paper-grid/30 border border-paper-grid/50 select-none shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('brush')}
            className={`flex items-center justify-center gap-1 py-1 px-1 rounded-md text-[11px] transition-[transform,background-color,color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
              activeTab === 'brush'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Brush size={11} className="shrink-0" />
            <span>笔触</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('physics')}
            className={`flex items-center justify-center gap-1 py-1 px-1 rounded-md text-[11px] transition-[transform,background-color,color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
              activeTab === 'physics'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Gauge size={11} className="shrink-0" />
            <span>物理</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('canvas')}
            className={`flex items-center justify-center gap-1 py-1 px-1 rounded-md text-[11px] transition-[transform,background-color,color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
              activeTab === 'canvas'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Sliders size={11} className="shrink-0" />
            <span>纸张</span>
          </button>
        </div>


        {/* Tab 2: 构图与笔法 */}
        {activeTab === 'brush' && (
          <div className="flex flex-col gap-3">
            {/* 构图母题 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-light">构图几何母题</label>
              <Select
                value={layoutMode}
                onChange={(val) => onUpdate({ layoutMode: val as WatercolorLayoutMode, mode: 'custom' })}
                options={LAYOUT_MODE_OPTIONS}
                disabled={disabled}
                size="sm"
                className="w-full"
              />
              <span className="text-[10px] text-ink-faint">骨架分布：决定画面几何元素的排布形态</span>
            </div>

            {/* 主笔刷材质 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-light">主笔刷材质</label>
              <Select
                value={brushType}
                onChange={(val) => onUpdate({ brushType: val as WatercolorBrushType, mode: 'custom' })}
                options={BRUSH_TYPE_OPTIONS}
                disabled={disabled}
                size="sm"
                className="w-full"
              />
              <span className="text-[10px] text-ink-faint">笔触质感：水彩笔、软铅、炭笔或喷枪</span>
            </div>

            {/* 向量流场引导 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-light">向量流场引导</label>
              <Select
                value={fieldMode}
                onChange={(val) => onUpdate({ fieldMode: val as WatercolorFieldMode, mode: 'custom' })}
                options={FIELD_MODE_OPTIONS}
                disabled={disabled}
                size="sm"
                className="w-full"
              />
              <span className="text-[10px] text-ink-faint">流向动势：引导线条随数学向量力场流动</span>
            </div>

            {/* 填色与排线技法 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-light">填色与排线技法</label>
              <Select
                value={technique}
                onChange={(val) => onUpdate({ technique: val as WatercolorTechnique, mode: 'custom' })}
                options={TECHNIQUE_OPTIONS}
                disabled={disabled}
                size="sm"
                className="w-full"
              />
              <span className="text-[10px] text-ink-faint">工艺形态：水彩物理晕染、干画粉彩或贯穿排线</span>
            </div>
          </div>
        )}

        {/* Tab 3: 物理特性微调 */}
        {activeTab === 'physics' && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-[11px] text-ink-light font-medium px-0.5">
              <span>物理流体与手绘微调</span>
              <span className="text-[10px] text-ink-faint">60fps 实时模拟</span>
            </div>

            <div className="flex flex-col gap-2 p-2 rounded-lg bg-paper/70 border border-paper-grid/50">
              <NumberStepperRow
                label="几何曲率"
                value={Math.round(curvature * 100)}
                min={0}
                max={100}
                step={1}
                unit="%"
                labelWidth="w-16"
                disabled={disabled}
                onChange={(v) => onUpdate({ curvature: Number((v / 100).toFixed(2)), mode: 'custom' })}
              />
              <NumberStepperRow
                label="元素密度"
                value={Number(density.toFixed(1))}
                min={0.3}
                max={2.0}
                step={0.1}
                unit="x"
                formatDisplay={(v) => `${v.toFixed(1)}x`}
                labelWidth="w-16"
                disabled={disabled}
                onChange={(v) => onUpdate({ density: Number(v.toFixed(1)), mode: 'custom' })}
              />
              <NumberStepperRow
                label="手绘微颤"
                value={Number(wiggle.toFixed(1))}
                min={0.2}
                max={2.5}
                step={0.1}
                unit="x"
                formatDisplay={(v) => `${v.toFixed(1)}x`}
                labelWidth="w-16"
                disabled={disabled}
                onChange={(v) => onUpdate({ wiggle: Number(v.toFixed(1)), mode: 'custom' })}
              />
            </div>

            <div className="flex flex-col gap-2 p-2 rounded-lg bg-paper/70 border border-paper-grid/50">
              <NumberStepperRow
                label="水晕出血"
                value={Math.round(bleedStrength * 100)}
                min={0}
                max={80}
                step={1}
                unit="%"
                labelWidth="w-16"
                disabled={disabled}
                onChange={(v) => onUpdate({ bleedStrength: Number((v / 100).toFixed(2)), mode: 'custom' })}
              />
              <NumberStepperRow
                label="纸纹留白"
                value={Math.round(textureStrength * 100)}
                min={0}
                max={100}
                step={1}
                unit="%"
                labelWidth="w-16"
                disabled={disabled}
                onChange={(v) => onUpdate({ textureStrength: Number((v / 100).toFixed(2)), mode: 'custom' })}
              />
              <NumberStepperRow
                label="排线间距"
                value={Math.round(hatchDist)}
                min={4}
                max={20}
                step={1}
                unit="px"
                labelWidth="w-16"
                disabled={disabled}
                onChange={(v) => onUpdate({ hatchDist: Math.round(v), mode: 'custom' })}
              />
            </div>
          </div>
        )}

        {/* Tab 4: 画底与画幅规格 */}
        {activeTab === 'canvas' && (
          <div className="flex flex-col gap-3">
            {/* 配色方案 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-light flex items-center justify-between">
                <span>配色方案</span>
                {upstreamColors && upstreamColors.length > 0 && (
                  <span className="text-[10px] text-accent flex items-center gap-1">
                    <Link size={10} /> 上游连线注入
                  </span>
                )}
              </label>

              {upstreamColors && upstreamColors.length > 0 ? (
                <div className="p-2 rounded-lg bg-accent/5 border border-accent/30 flex flex-col gap-1.5">
                  <span className="text-[10px] text-ink-light">使用连线注入的专属配色：</span>
                  <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                    {upstreamColors.map((c, i) => (
                      <span
                        key={i}
                        className="w-5 h-5 rounded-full border border-black/10 shadow-2xs shrink-0"
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <Select
                    value={paletteId}
                    onChange={(val) => onUpdate({ paletteId: val, mode: 'custom' })}
                    options={PALETTE_OPTIONS}
                    disabled={disabled}
                    size="sm"
                    className="w-full"
                  />
                  <div className="flex items-center gap-1 px-1 py-0.5">
                    {currentPalette.colors.map((c, i) => (
                      <span
                        key={i}
                        className="w-4 h-4 rounded-full border border-black/10 shadow-2xs shrink-0"
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 画底质感 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-light">画底质感</label>
              <Select
                value={effectiveBgType}
                onChange={(val) => {
                  const newType = val as WatercolorBackgroundType;
                  onUpdate({
                    backgroundType: newType,
                    transparentBackground: newType === 'transparent',
                    mode: 'custom',
                  });
                }}
                options={BACKGROUND_OPTIONS}
                disabled={disabled}
                size="sm"
                className="w-full"
              />

              {effectiveBgType === 'transparent' && (
                <span className="text-[10px] text-ink-faint">透明底方便作为免抠贴纸叠加至其他手账</span>
              )}

              {effectiveBgType === 'image' && (
                <div className="flex flex-col gap-2 p-2 rounded-lg bg-paper-grid/20 border border-paper-grid text-xs mt-0.5">
                  {upstreamImageUrl ? (
                    <div className="flex items-center gap-1.5 text-accent text-[11px] font-medium">
                      <ImageIcon size={13} className="shrink-0" />
                      <span>已继承上游图片 / 图书封面</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-[11px]">
                      <AlertCircle size={13} className="shrink-0" />
                      <span>未检测到上游图片，暂以白纸显示</span>
                    </div>
                  )}

                  <NumberStepperRow
                    label="底图浓度"
                    value={Math.round((bgImageOpacity ?? 0.35) * 100)}
                    min={10}
                    max={100}
                    step={5}
                    unit="%"
                    labelWidth="w-16"
                    disabled={disabled}
                    onChange={(v) =>
                      onUpdate({
                        bgImageOpacity: Number((v / 100).toFixed(2)),
                        mode: 'custom',
                      })
                    }
                  />
                  <span className="text-[10px] text-ink-faint leading-tight">
                    象牙白衬底蒙版，降低原图反差以衬托水彩物理流体细节
                  </span>
                </div>
              )}
            </div>

            {/* 画幅比例 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-light">画幅比例</label>
              <Select
                value={aspectRatio}
                onChange={(val) => onUpdate({ aspectRatio: val as WatercolorAspectRatio })}
                options={ASPECT_RATIO_OPTIONS}
                disabled={disabled}
                size="sm"
                className="w-full"
              />
            </div>

            {/* 导出画质 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-light">导出画质</label>
              <Select
                value={String(resolution)}
                onChange={(val) => onUpdate({ resolution: Number(val) as WatercolorResolution })}
                options={RESOLUTION_OPTIONS}
                disabled={disabled}
                size="sm"
                className="w-full"
              />
            </div>
          </div>
        )}
      </div>
    </NodeSideDrawer>
  );
};

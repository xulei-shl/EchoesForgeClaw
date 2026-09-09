import React, { useState } from 'react';
import {
  Sparkles,
  Layers,
  Stamp,
  Check,
  RotateCcw,
  Crosshair,
} from 'lucide-react';
import type {
  EmbossFoilState,
  EmbossReliefStyle,
  FoilShimmerType,
  LightPoint,
} from './types';
import {
  EMBOSS_FOIL_PRESETS,
  getEmbossFoilPreset,
} from './presets';
import { NodeSideDrawer } from '../../../_shared/NodeSideDrawer';
import { SliderRow } from '../../../../../shared/components/ui/Slider';
import { Toggle } from '../../../../../shared/components/ui/Toggle';

export interface EmbossFoilStudioPanelProps {
  /** 抽屉是否展开 */
  isOpen: boolean;
  /** 当前预设 ID */
  presetId: string;
  /** 浮雕表面肌理风格 */
  reliefStyle: EmbossReliefStyle;
  /** 光泽高光类型 */
  shimmerType: FoilShimmerType;
  /** 浮雕深度 (0 ~ 100) */
  depth: number;
  /** 高光亮度 (0 ~ 100) */
  brightness: number;
  /** 光斑扩散半径 (10 ~ 80) */
  radius: number;
  /** 自然光入射角度 (0 ~ 360) */
  lightAngle: number;
  /** 高光自定义落点 */
  lightPoints: LightPoint[];
  /** 是否开启邮票齿孔 */
  withPerforation: boolean;
  /** 是否开启白边留白 */
  withMargin: boolean;
  /** 是否处于禁用状态（如渲染中） */
  disabled?: boolean;
  /** 参数更新回调 */
  onUpdate: (patch: Partial<EmbossFoilState>) => void;
  /** 切换预设回调 */
  onSelectPreset: (presetId: string) => void;
  /** 清空高光落点回调 */
  onResetPoints: () => void;
  /** 关闭抽屉 */
  onClose: () => void;
}

type PanelTab = 'presets' | 'relief' | 'shimmer';

/** 肌理风格定义与说明 */
const RELIEF_STYLES: { id: EmbossReliefStyle; label: string; desc: string }[] = [
  { id: 'topography', label: '等高线', desc: '等高指纹流线' },
  { id: 'paper_emboss', label: '纸质浮雕', desc: '微观纸浆凹凸' },
  { id: 'fine_grain', label: '细腻磨砂', desc: '微颗粒细致散射' },
  { id: 'contour_mesh', label: '网格几何', desc: '空间透视切面' },
];

/** 高光色系定义与渐变预览样式 */
const SHIMMER_TYPES: {
  id: FoilShimmerType;
  label: string;
  gradient: string;
  sub: string;
}[] = [
  {
    id: 'prismatic_opal',
    label: '欧泊幻彩',
    gradient: 'linear-gradient(135deg, #ffffff 0%, #ffb9d2 25%, #82f5d7 55%, #78d2ff 80%, #cda0ff 100%)',
    sub: '翡翠天青色散',
  },
  {
    id: 'rainbow_foil',
    label: '彩虹镭射',
    gradient: 'linear-gradient(135deg, #ffd064 0%, #ff78b4 30%, #a064ff 65%, #50dcff 100%)',
    sub: '全息光栅光谱',
  },
  {
    id: 'neon_cyber',
    label: '赛博霓虹',
    gradient: 'linear-gradient(135deg, #ff2d96 0%, #963cff 50%, #00f0ff 100%)',
    sub: '电光洋红天青',
  },
  {
    id: 'rose_champagne',
    label: '玫瑰香槟',
    gradient: 'linear-gradient(135deg, #fff3e6 0%, #ffc396 35%, #f582af 70%, #c378c3 100%)',
    sub: '奢雅暖粉微光',
  },
  {
    id: 'nebula_violet',
    label: '星云幽紫',
    gradient: 'linear-gradient(135deg, #d74bff 0%, #4b6eff 55%, #00d2ff 100%)',
    sub: '深邃夜空幻彩',
  },
  {
    id: 'warm_gold',
    label: '奢雅暖金',
    gradient: 'linear-gradient(135deg, #fff8dc 0%, #ffdc82 35%, #e6af3c 70%, #b4781e 100%)',
    sub: '古典香槟烫金',
  },
  {
    id: 'pearl_platinum',
    label: '珠光铂金',
    gradient: 'linear-gradient(135deg, #e1f0ff 0%, #ebdcfa 45%, #becde6 100%)',
    sub: '纯净冰蓝冷光',
  },
  {
    id: 'obsidian_gold',
    label: '黑曜暗金',
    gradient: 'linear-gradient(135deg, #ebc36e 0%, #a0732d 45%, #232630 100%)',
    sub: '黑金钛金属暗光',
  },
];

/**
 * 微浮雕高光配置抽屉面板
 * 遵循 NodeSideDrawer 范式，以 3 个负空间 Tab 承载预设、肌理与高光调优
 */
export const EmbossFoilStudioPanel: React.FC<EmbossFoilStudioPanelProps> = ({
  isOpen,
  presetId,
  reliefStyle,
  shimmerType,
  depth,
  brightness,
  radius,
  lightAngle,
  lightPoints,
  withPerforation,
  withMargin,
  disabled = false,
  onUpdate,
  onSelectPreset,
  onResetPoints,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('presets');

  const currentPreset = getEmbossFoilPreset(presetId);

  return (
    <NodeSideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="微浮雕高光"
      subtitle={`预设: ${currentPreset.name}`}
      icon={<Sparkles size={14} />}
      width={310}
    >
      <div className="flex flex-col gap-3 font-sans">
        {/* 顶部 Tab 分段按钮（负空间胶囊分组，外 8px 内 6px + 2px 间距实现同心圆角） */}
        <div className="grid grid-cols-3 gap-0.5 p-0.5 rounded-lg bg-paper-grid/30 border border-paper-grid/50 select-none shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            className={`flex items-center justify-center gap-1 py-1 px-1.5 rounded-md text-[11px] transition-[transform,background-color,color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
              activeTab === 'presets'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Layers size={11} className="shrink-0" />
            <span>预设方案</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('relief')}
            className={`flex items-center justify-center gap-1 py-1 px-1.5 rounded-md text-[11px] transition-[transform,background-color,color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
              activeTab === 'relief'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Stamp size={11} className="shrink-0" />
            <span>浮雕肌理</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('shimmer')}
            className={`flex items-center justify-center gap-1 py-1 px-1.5 rounded-md text-[11px] transition-[transform,background-color,color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
              activeTab === 'shimmer'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Sparkles size={11} className="shrink-0" />
            <span>全息高光</span>
          </button>
        </div>

        {/* 1. 预设选项卡 */}
        {activeTab === 'presets' && (
          <div className="space-y-2">
            <div className="text-[11px] text-ink-faint">
              经典工艺模板 (点击即时生效)
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {EMBOSS_FOIL_PRESETS.map((p) => {
                const isSelected = presetId === p.id;
                // 查找该预设对应的代表色
                const shimmerInfo = SHIMMER_TYPES.find(
                  (s) => s.id === p.params.shimmerType
                );
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectPreset(p.id)}
                    disabled={disabled}
                    className={`flex flex-col text-left p-2 rounded-lg border transition-[transform,background-color,border-color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
                      isSelected
                        ? 'border-accent bg-accent/10 shadow-2xs'
                        : 'border-paper-grid/60 bg-paper/80 hover:border-paper-grid hover:bg-paper'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <div className="flex items-center justify-between w-full mb-0.5">
                      <div className="flex items-center gap-1.5 font-medium text-xs text-ink">
                        <span
                          className="w-3 h-3 rounded-full shrink-0 shadow-2xs border border-white/60"
                          style={{
                            background:
                              shimmerInfo?.gradient ||
                              'linear-gradient(135deg, #fff, #999)',
                          }}
                        />
                        <span>{p.name}</span>
                      </div>
                      {isSelected && <Check size={13} className="text-accent" />}
                    </div>
                    <span className="text-[10px] text-ink-faint leading-relaxed line-clamp-2">
                      {p.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. 浮雕肌理选项卡 */}
        {activeTab === 'relief' && (
          <div className="space-y-3.5">
            {/* 表面肌理风格 */}
            <div className="space-y-1.5">
              <label className="text-ink-light font-medium text-xs">
                表面肌理风格 (Relief Style)
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {RELIEF_STYLES.map((r) => {
                  const isChecked = reliefStyle === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onUpdate({ reliefStyle: r.id })}
                      disabled={disabled}
                      className={`flex flex-col p-2 rounded-lg border text-left transition-[transform,background-color,border-color,color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
                        isChecked
                          ? 'border-accent bg-accent/10 text-accent font-medium shadow-2xs'
                          : 'border-paper-grid/60 bg-paper/60 hover:bg-paper-grid/30 text-ink-light'
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs font-medium text-ink">
                          {r.label}
                        </span>
                        {isChecked && <Check size={11} className="text-accent" />}
                      </div>
                      <span className="text-[10px] text-ink-faint mt-0.5">
                        {r.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 浮雕深度滑块 */}
            <div className="pt-1">
              <SliderRow
                label="浮雕深度"
                value={depth}
                min={0}
                max={100}
                step={1}
                display={`${depth}%`}
                labelWidth="w-16"
                disabled={disabled}
                onChange={(v) => onUpdate({ depth: v })}
              />
            </div>

            {/* 边缘工艺与白边留白 */}
            <div className="space-y-2 pt-1 border-t border-paper-grid/30">
              <label className="text-ink-light font-medium text-xs">
                边缘工艺与版式
              </label>

              {/* 齿孔边缘 */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-paper-grid/20 border border-paper-grid/40">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <Stamp size={14} className="text-accent shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-xs text-ink">邮票齿孔</div>
                    <div className="text-[10px] text-ink-faint mt-0.5">
                      模拟经典邮票打孔穿孔边缘
                    </div>
                  </div>
                </div>
                <Toggle
                  checked={withPerforation}
                  onChange={(checked) => onUpdate({ withPerforation: checked })}
                  disabled={disabled}
                  label="邮票齿孔打孔"
                />
              </div>

              {/* 纸面留白 */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-paper-grid/20 border border-paper-grid/40">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <Sparkles size={14} className="text-accent shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-xs text-ink">纸面留白</div>
                    <div className="text-[10px] text-ink-faint mt-0.5">
                      四周经典白色纸质边衬装裱
                    </div>
                  </div>
                </div>
                <Toggle
                  checked={withMargin}
                  onChange={(checked) => onUpdate({ withMargin: checked })}
                  disabled={disabled}
                  label="纸面白色留白"
                />
              </div>
            </div>
          </div>
        )}

        {/* 3. 全息高光选项卡 */}
        {activeTab === 'shimmer' && (
          <div className="space-y-3.5">
            {/* 高光色相色谱 */}
            <div className="space-y-1.5">
              <label className="text-ink-light font-medium text-xs">
                高光色系 (Foil Shimmer)
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {SHIMMER_TYPES.map((s) => {
                  const isChecked = shimmerType === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onUpdate({ shimmerType: s.id })}
                      disabled={disabled}
                      className={`flex items-center gap-2 p-1.5 rounded-lg border text-left transition-[transform,background-color,border-color,color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
                        isChecked
                          ? 'border-accent bg-accent/10 text-accent font-medium shadow-2xs'
                          : 'border-paper-grid/60 bg-paper/60 hover:bg-paper-grid/30 text-ink-light'
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <span
                        className="w-5 h-5 rounded-full shrink-0 shadow-2xs border border-white/70"
                        style={{ background: s.gradient }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-ink truncate leading-tight">
                          {s.label}
                        </div>
                        <div className="text-[9px] text-ink-faint truncate leading-tight mt-0.5">
                          {s.sub}
                        </div>
                      </div>
                      {isChecked && <Check size={11} className="text-accent shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 光影调节滑杆 */}
            <div className="space-y-2 pt-1 border-t border-paper-grid/30">
              <SliderRow
                label="高光亮度"
                value={brightness}
                min={0}
                max={100}
                step={1}
                display={`${brightness}%`}
                labelWidth="w-16"
                disabled={disabled}
                onChange={(v) => onUpdate({ brightness: v })}
              />

              <SliderRow
                label="散焦半径"
                value={radius}
                min={10}
                max={80}
                step={1}
                display={`${radius}px`}
                labelWidth="w-16"
                disabled={disabled}
                onChange={(v) => onUpdate({ radius: v })}
              />

              <SliderRow
                label="入射角度"
                value={lightAngle}
                min={0}
                max={360}
                step={5}
                display={`${lightAngle}°`}
                labelWidth="w-16"
                disabled={disabled}
                onChange={(v) => onUpdate({ lightAngle: v })}
              />
            </div>

            {/* 高光落点定光状态 */}
            <div className="p-2 rounded-lg bg-paper-grid/20 border border-paper-grid/40 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Crosshair size={12} className="text-accent" />
                  <span className="text-xs font-semibold text-ink">
                    定点高光落点
                  </span>
                </div>
                <span className="text-[10px] text-ink-faint font-mono tabular-nums">
                  {lightPoints.length} / 6
                </span>
              </div>

              <div className="text-[10px] text-ink-faint leading-relaxed">
                {lightPoints.length > 0
                  ? '已启用自定义多点落点，点击卡片各点可直接移除或新增。'
                  : '当前跟随默认自然光位。点击左侧画面任意位置可直接落点。'}
              </div>

              {lightPoints.length > 0 && (
                <button
                  type="button"
                  onClick={onResetPoints}
                  disabled={disabled}
                  className="w-full flex items-center justify-center gap-1 py-1 rounded-md border border-paper-grid/60 bg-paper/80 hover:border-accent hover:text-accent text-[11px] text-ink-light transition-[transform,background-color,border-color,color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <RotateCcw size={11} />
                  <span>清除落点，恢复自然光位</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </NodeSideDrawer>
  );
};

export default EmbossFoilStudioPanel;

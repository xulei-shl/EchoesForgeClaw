import React from 'react';
import {
  SlidersHorizontal,
  Columns3,
  Grid,
  Boxes,
  Disc,
  CloudRain,
  Waves,
  Hexagon,
  Wind,
  Dot,
  Dices,
} from 'lucide-react';
import type { GlassPattern, GlassRefractParams } from './types';
import {
  getGlassPresetByPattern,
  PATTERN_DESCRIPTIONS,
} from './presets';
import { NodeSideDrawer } from '../../../platform/components/node/NodeSideDrawer';
import { SliderRow } from '../../../platform/components/ui/Slider';

export interface GlassRefractStudioPanelProps {
  /** 抽屉是否展开 */
  isOpen: boolean;
  /** 当前玻璃图案风格 */
  pattern: GlassPattern;
  /** 周期/滴粒尺寸 (6 ~ 220) */
  scale: number;
  /** 浮雕起伏强度 (0 ~ 3.0) */
  relief: number;
  /** 折射景深厚度 (0 ~ 200) */
  thickness: number;
  /** 旋转角度 (0 ~ 180) */
  angle: number;
  /** 物理色散 (0 ~ 0.1) */
  dispersion: number;
  /** 菲涅尔光泽 (0 ~ 1.0) */
  specular: number;
  /** 砖缝宽度 (0 ~ 0.5) */
  gap?: number;
  /** 雨滴分布种子 */
  seed?: number;
  /** 禁用状态（如生成中） */
  disabled?: boolean;
  /** 参数更新回调 */
  onUpdate: (patch: Partial<GlassRefractParams>) => void;
  /** 换一批随机雨滴分布回调 */
  onRandomizeRain?: () => void;
  /** 关闭抽屉回调 */
  onClose: () => void;
}

/** 9 种玻璃图案定义与其专属图标（供主节点与全站复用） */
export const PATTERN_OPTIONS: {
  label: string;
  value: GlassPattern;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  { label: '长虹', value: 'fluted', icon: Columns3 },
  { label: '十字', value: 'cross', icon: Grid },
  { label: '砖块', value: 'block', icon: Boxes },
  { label: '水波', value: 'ripple', icon: Disc },
  { label: '雨滴', value: 'rain', icon: CloudRain },
  { label: '波浪', value: 'wave', icon: Waves },
  { label: '锤纹', value: 'hammer', icon: Hexagon },
  { label: '流动', value: 'flemish', icon: Wind },
  { label: '磨砂', value: 'frosted', icon: Dot },
];

/**
 * 玻璃折射外挂式参数微调抽屉面板
 * 纯粹聚焦于细致物理与光学参数调节，图案风格直接在宿主节点顶部切换
 */
export const GlassRefractStudioPanel: React.FC<GlassRefractStudioPanelProps> = ({
  isOpen,
  pattern,
  scale,
  relief,
  thickness,
  angle,
  dispersion,
  specular,
  gap,
  seed,
  disabled = false,
  onUpdate,
  onRandomizeRain,
  onClose,
}) => {
  const currentPreset = getGlassPresetByPattern(pattern);
  const patternDef = PATTERN_OPTIONS.find((opt) => opt.value === pattern);

  return (
    <NodeSideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="玻璃折射工坊"
      subtitle={`当前: ${currentPreset?.name || pattern}${patternDef ? ` · ${patternDef.label}` : ''}`}
      icon={<SlidersHorizontal size={14} />}
      width={310}
    >
      <div className="flex flex-col gap-3 font-sans">
        {/* 当前图案风格特性简报卡片 */}
        <div className="text-[10px] text-ink-faint leading-relaxed p-2 bg-paper-grid/20 rounded-lg border border-paper-grid/30 select-none">
          <div className="flex items-center gap-1.5 font-medium text-ink-light mb-0.5">
            {patternDef && (
              <span className="p-0.5 rounded bg-accent/15 text-accent flex items-center justify-center">
                <patternDef.icon size={12} />
              </span>
            )}
            <span>{currentPreset?.name}</span>
            <span className="text-[10px] text-ink-faint font-normal">特性说明</span>
          </div>
          <p className="mt-0.5 leading-normal">
            {PATTERN_DESCRIPTIONS[pattern]}
          </p>
        </div>

        {/* 分组一：基础形态与起伏 */}
        <div className="space-y-2">
          <label className="text-ink-light font-medium text-xs flex items-center justify-between">
            <span>形态与起伏</span>
            <span className="text-[10px] text-ink-faint font-normal">Geometry</span>
          </label>
          <div className="space-y-2 bg-paper/60 p-2 rounded-lg border border-paper-grid/40">
            <SliderRow
              label={pattern === 'rain' ? '滴粒' : '周期'}
              value={scale}
              min={6}
              max={220}
              step={1}
              display={`${scale}px`}
              labelWidth="w-7"
              valueWidth="min-w-[36px]"
              disabled={disabled}
              onChange={(v) => onUpdate({ scale: v })}
            />
            <SliderRow
              label="浮雕"
              value={Math.round(relief * 100)}
              min={0}
              max={300}
              step={1}
              display={relief === 0 ? '平切' : `${Math.round(relief * 100)}%`}
              labelWidth="w-7"
              valueWidth="min-w-[36px]"
              disabled={disabled}
              onChange={(v) => onUpdate({ relief: v / 100 })}
            />
            <SliderRow
              label="景深"
              value={Math.round(thickness)}
              min={0}
              max={200}
              step={1}
              display={thickness === 0 ? '贴合' : `${Math.round(thickness)}px`}
              labelWidth="w-7"
              valueWidth="min-w-[36px]"
              disabled={disabled}
              onChange={(v) => onUpdate({ thickness: v })}
            />
            <SliderRow
              label="角度"
              value={angle}
              min={0}
              max={180}
              step={1}
              display={pattern === 'ripple' ? '同心' : `${angle}°`}
              labelWidth="w-7"
              valueWidth="min-w-[36px]"
              disabled={disabled || pattern === 'ripple'}
              onChange={(v) => onUpdate({ angle: v })}
            />
          </div>
        </div>

        {/* 分组二：光学色散与表面光泽 */}
        <div className="space-y-2">
          <label className="text-ink-light font-medium text-xs flex items-center justify-between">
            <span>光学与质感</span>
            <span className="text-[10px] text-ink-faint font-normal">Optics</span>
          </label>
          <div className="space-y-2 bg-paper/60 p-2 rounded-lg border border-paper-grid/40">
            <SliderRow
              label="色散"
              value={Math.round(dispersion * 1000)}
              min={0}
              max={100}
              step={1}
              display={dispersion === 0 ? '无' : `${(dispersion * 100).toFixed(1)}%`}
              labelWidth="w-7"
              valueWidth="min-w-[36px]"
              disabled={disabled}
              onChange={(v) => onUpdate({ dispersion: v / 1000 })}
            />
            <SliderRow
              label="光泽"
              value={Math.round(specular * 100)}
              min={0}
              max={100}
              step={1}
              display={specular === 0 ? '无' : `${Math.round(specular * 100)}%`}
              labelWidth="w-7"
              valueWidth="min-w-[36px]"
              disabled={disabled}
              onChange={(v) => onUpdate({ specular: v / 100 })}
            />
          </div>
        </div>

        {/* 分组三：模式专属控制 */}
        {pattern === 'block' && (
          <div className="space-y-2">
            <label className="text-ink-light font-medium text-xs flex items-center justify-between">
              <span>砖块结构</span>
              <span className="text-[10px] text-ink-faint font-normal">Block Gap</span>
            </label>
            <div className="bg-paper/60 p-2 rounded-lg border border-paper-grid/40">
              <SliderRow
                label="砖缝"
                value={Math.round((gap ?? 0.06) * 100)}
                min={0}
                max={50}
                step={1}
                display={gap === 0 ? '无缝' : `${Math.round((gap ?? 0.06) * 100)}%`}
                labelWidth="w-7"
                valueWidth="min-w-[36px]"
                disabled={disabled}
                onChange={(v) => onUpdate({ gap: v / 100 })}
              />
            </div>
          </div>
        )}

        {pattern === 'rain' && (
          <div className="space-y-2">
            <label className="text-ink-light font-medium text-xs flex items-center justify-between">
              <span>水滴随机分布</span>
              <span className="text-[10px] text-ink-faint font-normal">Seed</span>
            </label>
            <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-paper/60 border border-paper-grid/40">
              <span className="text-ink-faint text-[11px]">
                分布种子: <span className="font-mono text-ink font-medium">{seed ?? 7}</span>
              </span>
              <button
                type="button"
                onClick={onRandomizeRain}
                disabled={disabled}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-paper-grid/60 bg-paper hover:bg-accent/15 hover:border-accent/40 text-ink hover:text-accent transition duration-150 cursor-pointer active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Dices size={13} />
                <span>换一批雨滴</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </NodeSideDrawer>
  );
};

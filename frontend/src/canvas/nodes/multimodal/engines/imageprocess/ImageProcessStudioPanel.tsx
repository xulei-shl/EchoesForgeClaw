import React, { useMemo } from 'react';
import {
  SlidersHorizontal,
  Tv,
  Layers,
  Sparkles,
  CircleDot,
  Grid3X3,
  Terminal,
} from 'lucide-react';
import { NodeSideDrawer } from '../../../_shared/NodeSideDrawer';
import { Select } from '../../../../../shared/components/ui/Select';
import { SliderRow } from '../../../../../shared/components/ui/Slider';
import { CustomPaletteEditor } from '../../CustomPaletteEditor';
import type {
  ImageFxEffectDef,
  ImageFxId,
  ImageFxParamValue,
  ImageFxSliderParamDef,
  ImageFxSelectParamDef,
} from './types';

export interface ImageProcessStudioPanelProps {
  /** 是否展开抽屉 */
  isOpen: boolean;
  /** 当前激活的效果定义 */
  effect: ImageFxEffectDef;
  /** 当前效果下的参数键值对 */
  params: Record<string, ImageFxParamValue>;
  /** 当前输入图片源（供吸管工具使用） */
  activeImageSrc: string | null;
  /** 是否处于生成/计算处理中 */
  disabled?: boolean;
  /** 参数更新回调 */
  onParamChange: (key: string, value: ImageFxParamValue) => void;
  /** 关闭抽屉回调 */
  onClose: () => void;
}

/** 效果图标映射表 */
const EFFECT_ICONS: Record<
  ImageFxId,
  React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>
> = {
  crt: Tv,
  texture: Layers,
  grain: Sparkles,
  halftone: CircleDot,
  dither: Grid3X3,
  ascii: Terminal,
};

/** 根据选项数量计算等宽网格列数，确保严格对齐边缘（Align to shared edges）并消除拉伸变形 */
function getSegmentGridColsClass(count: number): string {
  switch (count) {
    case 2:
      return 'grid-cols-2';
    case 3:
      return 'grid-cols-3';
    case 4:
      return 'grid-cols-4';
    case 5:
    case 6:
      return 'grid-cols-3';
    case 7:
    case 8:
    default:
      return 'grid-cols-4';
  }
}

/**
 * 图片处理侧边吸附抽屉（ImageProcessStudioPanel）
 *
 * 遵循「docs/节点侧边吸附抽屉使用指南.md」与 better-layout 空间分组规范：
 * 1. 采用声明式驱动架构统一承载 6 个效果模板的全部参数；
 * 2. 抽屉拥有 310px 舒适视口与原生纵向平滑滚动；
 * 3. 头部降噪，仅展示图标、标题、副标题与关闭按钮；参数重置全站统一收敛至节点右下角 NodeActionBar.Reset。
 */
export const ImageProcessStudioPanel: React.FC<ImageProcessStudioPanelProps> = ({
  isOpen,
  effect,
  params,
  activeImageSrc,
  disabled = false,
  onParamChange,
  onClose,
}) => {
  // 参数类型分类提取
  const sliderDefs = useMemo(
    () => effect.params.filter((p): p is ImageFxSliderParamDef => p.kind === 'slider'),
    [effect.params]
  );
  const segmentDefs = useMemo(
    () => effect.params.filter((p) => p.kind === 'segment'),
    [effect.params]
  );
  const selectDefs = useMemo(
    () => effect.params.filter((p): p is ImageFxSelectParamDef => p.kind === 'select'),
    [effect.params]
  );

  // 是否展示自定义色板编辑器
  const showCustomPalette =
    (effect.id === 'dither' && params.palette === 'custom') ||
    (effect.id === 'ascii' && params.colorMode === 'custom');

  // 当前图标
  const IconComponent = EFFECT_ICONS[effect.id] || SlidersHorizontal;

  return (
    <NodeSideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={effect.name}
      subtitle={effect.description.split('：')[0]}
      icon={<IconComponent size={14} className="text-accent" />}
      width={310}
    >
      <div className="flex flex-col gap-4 font-sans text-xs text-ink-light select-none">
        {/* 1. 下拉选择控件（如 24 种触感质感风格） */}
        {selectDefs.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {selectDefs.map((def) => (
              <div key={def.key} className="flex flex-col gap-1.5">
                <label className="text-ink-faint text-[11px] font-medium tracking-wide">
                  {def.label}
                </label>
                <Select
                  size="sm"
                  value={String(params[def.key] ?? def.default)}
                  disabled={disabled}
                  onChange={(val) => onParamChange(def.key, val)}
                  options={def.options}
                  className="w-full text-xs"
                />
              </div>
            ))}
          </div>
        )}

        {/* 2. 分段单选控件（如算法、网点形状、字符集、配色预设等） */}
        {segmentDefs.length > 0 && (
          <div className="flex flex-col gap-3">
            {segmentDefs.map((def) => {
              const gridCols = getSegmentGridColsClass(def.options.length);
              return (
                <div key={def.key} className="flex flex-col gap-1.5" role="radiogroup" aria-label={def.label}>
                  <span className="text-ink-faint text-[11px] font-medium tracking-wide">
                    {def.label}
                  </span>
                  <div className={`grid ${gridCols} p-0.5 rounded-lg bg-paper-grid/40 border border-paper-grid/60 gap-1 shadow-2xs`}>
                    {def.options.map((opt) => {
                      const isChecked = params[def.key] === opt.value;
                      return (
                        <button
                          key={String(opt.value)}
                          type="button"
                          role="radio"
                          aria-checked={isChecked}
                          title={opt.label}
                          onClick={() => onParamChange(def.key, opt.value)}
                          disabled={disabled}
                          className={`py-1.5 px-1 rounded-md text-[11px] font-medium leading-none text-center truncate transition-[background-color,color,border-color,box-shadow,transform] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-accent ${
                            isChecked
                              ? 'bg-paper text-accent font-semibold shadow-2xs border border-paper-grid/40'
                              : 'text-ink-light hover:text-ink hover:bg-paper-grid/30 border border-transparent'
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 3. 自定义色板高级配置栏（抖动模式/ASCII 模式选用自定义色板时展开） */}
        {showCustomPalette && (
          <div className="pt-0.5 pb-1 border-t border-b border-paper-grid/40">
            <CustomPaletteEditor
              value={String(params.customPalette ?? '#000000,#ffffff')}
              onChange={(nextPalette) => onParamChange('customPalette', nextPalette)}
              disabled={disabled}
              imageSrc={activeImageSrc}
            />
          </div>
        )}

        {/* 4. 连续滑杆调节区（单列舒适间距） */}
        {sliderDefs.length > 0 && (
          <div className="flex flex-col gap-2.5 pt-1">
            <span className="text-ink-faint text-[11px] font-medium tracking-wide">
              微调参数
            </span>
            <div className="flex flex-col gap-2 p-2 rounded-lg bg-paper-grid/20 border border-paper-grid/40">
              {sliderDefs.map((def) => (
                <SliderRow
                  key={def.key}
                  label={def.label}
                  value={Number(params[def.key])}
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  display={def.display ? def.display(Number(params[def.key])) : String(params[def.key])}
                  disabled={disabled}
                  onChange={(v) => onParamChange(def.key, v)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </NodeSideDrawer>
  );
};

export default ImageProcessStudioPanel;

import React, { useState, useMemo } from 'react';
import {
  Palette,
  Gauge,
  Sliders,
  Check,
  Flame,
  Eraser,
  Sparkles,
  Pipette,
} from 'lucide-react';
import { NodeSideDrawer } from '../../../platform/components/node/NodeSideDrawer';
import { NumberStepperRow } from '../../../platform/components/ui/NumberStepper';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { ColorPickerPopover } from '../../../platform/components/ui/ColorPicker';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import {
  type InkWashState,
  type InkWashPaperStyle,
  type InkWashAspectRatio,
  type InkWashResolution,
  INKWASH_PRESET_INKS,
} from './types';

export interface InkWashStudioPanelProps {
  isOpen: boolean;
  size: number;
  flow: number;
  bleed: number;
  dry: number;
  color: number;
  bink: number;
  inkColor: string;
  paperStyle: InkWashPaperStyle;
  aspectRatio: InkWashAspectRatio;
  resolution: InkWashResolution;
  upstreamText?: string | null;
  disabled?: boolean;
  onUpdate: (patch: Partial<InkWashState>) => void;
  onClose: () => void;
  onFix?: () => void;
  onClear?: () => void;
}

type PanelTab = 'physics' | 'palette' | 'canvas';

const PAPER_STYLE_OPTIONS: SelectOption[] = [
  { value: 'raw_xuan', label: '生宣纸·墨韵洇漫', title: '吸水迅速、渗漏生动、古朴温润' },
  { value: 'sized_xuan', label: '熟宣纸·细腻聚墨', title: '墨色收敛、齿感细腻、清雅澄净' },
  { value: 'antique_silk', label: '仿古绢本·古雅金黄', title: '微赭微黄、绢本重彩、文人画风' },
  { value: 'pure_white', label: '澄心雪白·极简黑白', title: '爽脆明朗、黑白分明' },
  { value: 'transparent', label: '透明底·便于合成', title: '仅输出墨色笔触，背景透明' },
];

const ASPECT_RATIO_OPTIONS: SelectOption[] = [
  { value: '1:1', label: '1:1 方形立轴' },
  { value: '3:4', label: '3:4 竖幅中堂' },
  { value: '4:3', label: '4:3 横幅手卷' },
  { value: '9:16', label: '9:16 移动端全屏' },
  { value: '16:9', label: '16:9 宽屏通景' },
];

const RESOLUTION_OPTIONS: SelectOption[] = [
  { value: '1024', label: '1024p 标准高清' },
  { value: '1536', label: '1536p 超清精绘' },
  { value: '2048', label: '2048p 2K典藏级' },
];

export const InkWashStudioPanel: React.FC<InkWashStudioPanelProps> = ({
  isOpen,
  size,
  flow,
  bleed,
  dry,
  color,
  bink,
  inkColor,
  paperStyle,
  aspectRatio,
  resolution,
  upstreamText,
  disabled = false,
  onUpdate,
  onClose,
  onFix,
  onClear,
}) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('physics');

  // 当前激活的预设墨色 ID
  const activePresetInkId = useMemo(() => {
    const match = INKWASH_PRESET_INKS.find(
      (p) => p.hex.toLowerCase() === (inkColor || '').toLowerCase()
    );
    return match?.id || null;
  }, [inkColor]);

  // 是否为自定义墨色（与贴纸制作节点一致，未匹配到预设墨色时为自定义模式）
  const isCustomInkColor = !activePresetInkId;

  return (
    <NodeSideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="水墨画室参数"
      subtitle="流体物理动力学、名家墨色与宣纸质感精调"
    >
      <div className="flex flex-col gap-4 text-xs font-sans">
        {/* 顶部三段式 Tab 切换器 */}
        <div className="grid grid-cols-3 p-0.5 rounded-lg bg-paper-grid/40 border border-paper-grid text-ink-light select-none">
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
            <span>水墨流场</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('palette')}
            className={`flex items-center justify-center gap-1 py-1 px-1 rounded-md text-[11px] transition-[transform,background-color,color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
              activeTab === 'palette'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <Palette size={11} className="shrink-0" />
            <span>名家墨色</span>
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
            <span>宣纸画幅</span>
          </button>
        </div>

        {/* Tab 1: 水墨流场物理 */}
        {activeTab === 'physics' && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-[11px] text-ink-light font-medium px-0.5">
              <span>物理流体与手绘微调</span>
              <span className="text-[10px] text-ink-faint">60fps 实时流体模拟</span>
            </div>

            <div className="flex flex-col gap-2 p-2 rounded-lg bg-paper/70 border border-paper-grid/50">
              <NumberStepperRow
                label="笔触尺寸"
                value={Math.round(size * 100)}
                min={10}
                max={100}
                step={1}
                unit="%"
                labelWidth="w-18"
                disabled={disabled}
                onChange={(val) => onUpdate({ size: Number((val / 100).toFixed(2)), mode: 'custom' })}
              />

              <NumberStepperRow
                label="水流扩散"
                value={Math.round(flow * 100)}
                min={10}
                max={100}
                step={1}
                unit="%"
                labelWidth="w-18"
                disabled={disabled}
                onChange={(val) => onUpdate({ flow: Number((val / 100).toFixed(2)), mode: 'custom' })}
              />

              <NumberStepperRow
                label="渗墨晕染"
                value={Math.round(bleed * 100)}
                min={0}
                max={100}
                step={1}
                unit="%"
                labelWidth="w-18"
                disabled={disabled}
                onChange={(val) => onUpdate({ bleed: Number((val / 100).toFixed(2)), mode: 'custom' })}
              />
            </div>

            <div className="flex flex-col gap-2 p-2 rounded-lg bg-paper/70 border border-paper-grid/50">
              <NumberStepperRow
                label="干燥速度"
                value={Math.round(dry * 100)}
                min={5}
                max={95}
                step={1}
                unit="%"
                labelWidth="w-18"
                disabled={disabled}
                onChange={(val) => onUpdate({ dry: Number((val / 100).toFixed(2)), mode: 'custom' })}
              />

              <NumberStepperRow
                label="边缘泛彩"
                value={Math.round(color * 100)}
                min={0}
                max={100}
                step={1}
                unit="%"
                labelWidth="w-18"
                disabled={disabled}
                onChange={(val) => onUpdate({ color: Number((val / 100).toFixed(2)), mode: 'custom' })}
              />

              <NumberStepperRow
                label="笔刷含墨"
                value={Math.round(bink * 100)}
                min={0}
                max={80}
                step={1}
                unit="%"
                labelWidth="w-18"
                disabled={disabled}
                onChange={(val) => onUpdate({ bink: Number((val / 100).toFixed(2)), mode: 'custom' })}
              />
            </div>

            {/* 快捷物理操作按钮：两列等宽等高网格排版，附带详细功能 Tooltip 说明 */}
            <div className="pt-2 border-t border-paper-grid grid grid-cols-2 gap-2">
              <Tooltip content="立即烘干并固化当前画布上的流动水墨，锁定墨韵停止扩散，便于多层积墨与罩染 (Fix)">
                <button
                  type="button"
                  onClick={onFix}
                  disabled={disabled}
                  className="w-full h-8 px-2 rounded-lg border border-paper-grid bg-paper hover:bg-accent/10 hover:border-accent/40 text-ink hover:text-accent flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer text-xs whitespace-nowrap active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                >
                  <Flame size={13} className="shrink-0 text-amber-600" />
                  <span className="font-medium">定墨烘干</span>
                </button>
              </Tooltip>

              <Tooltip content="清空宣纸上的所有墨痕与水流，洗去铅华恢复洁净宣纸重新挥毫 (Clear)">
                <button
                  type="button"
                  onClick={onClear}
                  disabled={disabled}
                  className="w-full h-8 px-2 rounded-lg border border-paper-grid bg-paper hover:bg-rose-500/10 hover:border-rose-500/40 text-ink hover:text-rose-600 flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer text-xs whitespace-nowrap active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                >
                  <Eraser size={13} className="shrink-0 text-rose-500" />
                  <span className="font-medium">澄心洗纸</span>
                </button>
              </Tooltip>
            </div>
          </div>
        )}

        {/* Tab 2: 名家墨色 */}
        {activeTab === 'palette' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-light flex items-center gap-1">
                <Sparkles size={12} className="text-accent" />
                <span>名家名墨配方</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {INKWASH_PRESET_INKS.map((ink) => {
                  const isSelected = activePresetInkId === ink.id;
                  return (
                    <Tooltip key={ink.id} content={`${ink.name} (${ink.hex})`}>
                      <button
                        type="button"
                        onClick={() => onUpdate({ inkColor: ink.hex })}
                        disabled={disabled}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-all duration-150 cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${
                          isSelected
                            ? 'border-accent bg-accent/10 ring-1 ring-accent text-accent font-medium shadow-2xs'
                            : 'border-paper-grid bg-paper/60 hover:bg-paper hover:border-paper-grid/80 text-ink'
                        }`}
                      >
                        <span
                          className="w-4 h-4 rounded-full border border-paper-grid shrink-0 shadow-2xs"
                          style={{ backgroundColor: ink.hex }}
                        />
                        <span className="text-xs flex-1 truncate">{ink.name}</span>
                        {isSelected && <Check size={12} className="text-accent shrink-0" />}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            {/* 自定义墨色色调：复用贴纸制作节点自定义颜色样式 */}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-paper-grid">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-ink-light">自定义墨色色调</label>
                <span className="text-[10px] text-ink-faint font-mono uppercase">
                  {inkColor || '#16161e'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* 贴纸制作节点同款 ColorPickerPopover 自定义色盘与取色器 */}
                <ColorPickerPopover
                  value={inkColor || '#16161e'}
                  onChange={(hex) => onUpdate({ inkColor: hex })}
                  disabled={disabled}
                  align="left"
                >
                  <Tooltip
                    content={
                      isCustomInkColor
                        ? `自定义墨色（当前: ${inkColor || '#16161e'}）`
                        : '自定义颜色 / 吸管取色'
                    }
                  >
                    <button
                      type="button"
                      disabled={disabled}
                      style={{ backgroundColor: isCustomInkColor ? inkColor : undefined }}
                      className={`w-8 h-8 rounded-lg border flex items-center justify-center transition cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                        isCustomInkColor
                          ? 'border-accent ring-2 ring-accent/40 shadow-2xs'
                          : 'border-paper-grid/80 hover:border-accent hover:scale-105 bg-paper/80 text-ink-light hover:text-accent'
                      }`}
                    >
                      {!isCustomInkColor ? (
                        <Pipette size={13} strokeWidth={2} />
                      ) : (
                        <Pipette size={12} strokeWidth={2} className="text-white drop-shadow-xs" />
                      )}
                    </button>
                  </Tooltip>
                </ColorPickerPopover>

                <input
                  type="text"
                  value={inkColor || '#16161e'}
                  onChange={(e) => onUpdate({ inkColor: e.target.value })}
                  disabled={disabled}
                  placeholder="#16161e"
                  maxLength={7}
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-paper-grid bg-paper text-xs font-mono text-ink uppercase focus:outline-none focus:border-accent disabled:opacity-50"
                />
              </div>
              <span className="text-[10px] text-ink-faint">
                支持任意经典墨相，输入冷暖色阶自动推算光谱吸光率向量
              </span>
            </div>

            {upstreamText && (
              <div className="p-2 rounded-lg bg-accent/5 border border-accent/20 text-[11px] text-ink-light">
                <span className="text-accent font-medium">上游题款建议：</span>
                <span className="line-clamp-2">{upstreamText}</span>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: 宣纸画幅 */}
        {activeTab === 'canvas' && (
          <div className="flex flex-col gap-3">
            {/* 宣纸底色 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-light">宣纸材质与底色</label>
              <Select
                value={paperStyle}
                onChange={(val) => onUpdate({ paperStyle: val as InkWashPaperStyle })}
                options={PAPER_STYLE_OPTIONS}
                disabled={disabled}
                size="sm"
                className="w-full"
              />
              <span className="text-[10px] text-ink-faint">
                生宣洇漫润泽，熟宣骨感聚墨，仿古绢本带金黄古色
              </span>
            </div>

            {/* 画幅比例 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-light">画幅构图比例</label>
              <Select
                value={aspectRatio}
                onChange={(val) => onUpdate({ aspectRatio: val as InkWashAspectRatio })}
                options={ASPECT_RATIO_OPTIONS}
                disabled={disabled}
                size="sm"
                className="w-full"
              />
              <span className="text-[10px] text-ink-faint">
                不同比例自动换算物理流体模拟网格
              </span>
            </div>

            {/* 导出分辨率 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-ink-light">导出分辨率规格</label>
              <Select
                value={String(resolution)}
                onChange={(val) => onUpdate({ resolution: Number(val) as InkWashResolution })}
                options={RESOLUTION_OPTIONS}
                disabled={disabled}
                size="sm"
                className="w-full"
              />
              <span className="text-[10px] text-ink-faint">
                点击「生成水墨」时以此像素规格离屏渲染高清 PNG
              </span>
            </div>
          </div>
        )}
      </div>
    </NodeSideDrawer>
  );
};

export default InkWashStudioPanel;

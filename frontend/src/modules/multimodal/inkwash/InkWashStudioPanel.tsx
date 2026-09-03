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
  Stamp,
  Dices,
  ScanLine,
  RotateCcw,
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
  type InkWashInscription,
  type InkWashTraceConfig,
  DEFAULT_INKWASH_TRACE_CONFIG,
  INKWASH_TRACE_PRESETS,
  INKWASH_PRESET_INKS,
} from './types';
import { JOURNAL_FONTS } from '../journal/text/fontRegistry';
import { extractInscriptionFromUpstream, getRandomSealSrc } from './inscription';

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
  inscription?: InkWashInscription;
  traceConfig?: InkWashTraceConfig;
  disabled?: boolean;
  onUpdate: (patch: Partial<InkWashState>) => void;
  onClose: () => void;
  onFix?: () => void;
  onClear?: () => void;
  onRetrace?: () => void;
}

type PanelTab = 'physics' | 'palette' | 'trace' | 'canvas';

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
  inscription,
  traceConfig,
  disabled = false,
  onUpdate,
  onClose,
  onFix,
  onClear,
  onRetrace,
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

  // 拓印参数快捷更新逻辑
  const currentTraceConfig = useMemo(
    () => traceConfig || DEFAULT_INKWASH_TRACE_CONFIG,
    [traceConfig]
  );

  const updateTraceField = (field: keyof InkWashTraceConfig, val: number) => {
    onUpdate({
      traceConfig: {
        ...currentTraceConfig,
        [field]: val,
      },
    });
  };

  const handleApplyTracePreset = (cfg: InkWashTraceConfig) => {
    onUpdate({
      traceConfig: { ...cfg },
    });
  };

  return (
    <NodeSideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="水墨画室参数"
      subtitle="流体物理动力学、名家墨色与工笔白描拓印精调"
    >
      <div className="flex flex-col gap-4 text-xs font-sans">
        {/* 顶部四段式 Tab 切换器 */}
        <div className="grid grid-cols-4 p-0.5 rounded-lg bg-paper-grid/40 border border-paper-grid text-ink-light select-none">
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
            onClick={() => setActiveTab('trace')}
            className={`flex items-center justify-center gap-1 py-1 px-1 rounded-md text-[11px] transition-[transform,background-color,color] duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
              activeTab === 'trace'
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink'
            }`}
          >
            <ScanLine size={11} className="shrink-0" />
            <span>白描拓印</span>
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

            {/* 诗书画印：题款与钤印控制组 */}
            <div className="flex flex-col gap-2 pt-2 border-t border-paper-grid/60">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-ink flex items-center gap-1.5">
                  <Stamp size={13} className="text-accent" />
                  <span>书画题款与古印</span>
                </label>
                <label className="text-[11px] text-ink-light flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(inscription?.enabled)}
                    onChange={(e) =>
                      onUpdate({
                        inscription: {
                          ...(inscription || {
                            id: 'default',
                            text: extractInscriptionFromUpstream(upstreamText),
                            fontFamily: '钟齐志莽行书',
                            writingMode: 'vertical',
                            textAlign: 'center',
                            color: '#16161e',
                            fontSizeRatio: 0.038,
                            x: 82,
                            y: 28,
                            sealEnabled: true,
                            sealSrc: getRandomSealSrc(),
                          }),
                          enabled: e.target.checked,
                        },
                      })
                    }
                    disabled={disabled}
                    className="rounded text-accent focus:ring-accent"
                  />
                  <span>开启题款</span>
                </label>
              </div>

              {inscription?.enabled && (
                <div className="flex flex-col gap-2 p-2 rounded-xl bg-paper/80 border border-paper-grid text-[11px]">
                  {/* 题款文本输入与填入上游建议 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[10px] text-ink-faint">
                      <span>题款文字（支持换行）</span>
                      {upstreamText && (
                        <button
                          type="button"
                          onClick={() => {
                            const extracted = extractInscriptionFromUpstream(upstreamText);
                            onUpdate({
                              inscription: {
                                ...inscription,
                                text: extracted,
                              },
                            });
                          }}
                          className="text-accent hover:underline flex items-center gap-0.5 cursor-pointer"
                        >
                          <Sparkles size={10} />
                          <span>填入上游建议</span>
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={2}
                      value={inscription.text || ''}
                      onChange={(e) =>
                        onUpdate({
                          inscription: {
                            ...inscription,
                            text: e.target.value,
                          },
                        })
                      }
                      placeholder="题款文案（如：松风水月）"
                      disabled={disabled}
                      className="w-full px-2 py-1.5 rounded-lg border border-paper-grid bg-white text-ink text-xs focus:outline-none focus:border-accent resize-none leading-relaxed"
                    />
                  </div>

                  {/* 字体选择与横竖排 */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-ink-faint">书法字体</span>
                      <Select
                        value={inscription.fontFamily || '钟齐志莽行书'}
                        onChange={(val) =>
                          onUpdate({
                            inscription: {
                              ...inscription,
                              fontFamily: val,
                            },
                          })
                        }
                        options={JOURNAL_FONTS.filter((f) => f.category === 'chinese').map((f) => ({
                          value: f.family,
                          label: f.name,
                        }))}
                        disabled={disabled}
                        size="sm"
                        className="w-full"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-ink-faint">排版方式</span>
                      <div className="flex items-center h-8 p-0.5 rounded-lg bg-paper-grid/40 border border-paper-grid">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdate({
                              inscription: {
                                ...inscription,
                                writingMode: 'vertical',
                              },
                            })
                          }
                          className={`flex-1 h-full rounded text-[11px] font-medium transition-colors ${
                            inscription.writingMode !== 'horizontal'
                              ? 'bg-paper text-accent shadow-2xs'
                              : 'text-ink-light hover:text-ink'
                          }`}
                        >
                          传统竖排
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdate({
                              inscription: {
                                ...inscription,
                                writingMode: 'horizontal',
                              },
                            })
                          }
                          className={`flex-1 h-full rounded text-[11px] font-medium transition-colors ${
                            inscription.writingMode === 'horizontal'
                              ? 'bg-paper text-accent shadow-2xs'
                              : 'text-ink-light hover:text-ink'
                          }`}
                        >
                          横向排版
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 印章控制与随机换印 */}
                  <div className="flex items-center justify-between pt-1 border-t border-paper-grid/40">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(inscription.sealEnabled)}
                        onChange={(e) =>
                          onUpdate({
                            inscription: {
                              ...inscription,
                              sealEnabled: e.target.checked,
                            },
                          })
                        }
                        disabled={disabled}
                        className="rounded text-accent focus:ring-accent"
                      />
                      <span className="text-[11px] text-ink-light">钤盖古籍朱砂印</span>
                    </label>

                    <button
                      type="button"
                      disabled={disabled || !inscription.sealEnabled}
                      onClick={() =>
                        onUpdate({
                          inscription: {
                            ...inscription,
                            sealSrc: getRandomSealSrc(),
                            sealEnabled: true,
                          },
                        })
                      }
                      className="px-2 py-1 rounded-md bg-paper border border-paper-grid text-ink-light hover:text-accent hover:border-accent flex items-center gap-1 transition-colors text-[10px] disabled:opacity-40 cursor-pointer shadow-2xs"
                    >
                      <Dices size={11} className="text-accent" />
                      <span>换一枚古印</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 上游只读弱提示 */}
              {upstreamText && !inscription?.enabled && (
                <div className="p-2 rounded-lg bg-accent/5 border border-accent/20 text-[11px] text-ink-light flex items-center justify-between">
                  <div className="min-w-0 flex-1 mr-2">
                    <span className="text-accent font-medium">上游题款建议：</span>
                    <span className="line-clamp-1">{upstreamText}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate({
                        inscription: {
                          ...(inscription || {
                            id: 'default',
                            fontFamily: '钟齐志莽行书',
                            writingMode: 'vertical',
                            textAlign: 'center',
                            color: '#16161e',
                            fontSizeRatio: 0.038,
                            x: 82,
                            y: 28,
                            sealEnabled: true,
                            sealSrc: getRandomSealSrc(),
                          }),
                          text: extractInscriptionFromUpstream(upstreamText),
                          enabled: true,
                        },
                      })
                    }
                    className="px-2 py-1 rounded bg-accent/10 hover:bg-accent/20 text-accent font-medium text-[10px] shrink-0 cursor-pointer"
                  >
                    采用题款
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: 白描拓印 */}
        {activeTab === 'trace' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-[11px] text-ink-light font-medium px-0.5">
              <span>底图拓印与工笔白描调校</span>
              <span className="text-[10px] text-accent font-normal">计白当黑·纯线勾勒</span>
            </div>

            {/* 一键风格预设 */}
            <div className="flex flex-col gap-1.5 p-2 rounded-xl bg-paper/70 border border-paper-grid/50">
              <span className="text-[11px] font-medium text-ink-light">一键白描风格</span>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.entries(INKWASH_TRACE_PRESETS).map(([key, item]) => {
                  const isSelected =
                    Math.abs((currentTraceConfig.threshold || 0.35) - item.config.threshold) < 0.02 &&
                    Math.abs((currentTraceConfig.hatchSuppression ?? 0.6) - item.config.hatchSuppression) < 0.02;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleApplyTracePreset(item.config)}
                      disabled={disabled}
                      className={`px-2 py-1.5 rounded-lg border text-center transition-all cursor-pointer ${
                        isSelected
                          ? 'border-accent bg-accent/10 text-accent font-medium shadow-2xs'
                          : 'border-paper-grid hover:border-accent/40 bg-paper/50 text-ink-light hover:text-ink'
                      }`}
                    >
                      <div className="text-[11px] font-medium">{item.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 核心微调滑块组 */}
            <div className="flex flex-col gap-2 p-2 rounded-xl bg-paper/70 border border-paper-grid/50">
              <NumberStepperRow
                label="勾线纯净度"
                value={Math.round((currentTraceConfig.threshold || 0.35) * 100)}
                min={10}
                max={85}
                step={5}
                unit="%"
                disabled={disabled}
                onChange={(val) =>
                  updateTraceField('threshold', Number((val / 100).toFixed(2)))
                }
              />
              <span className="text-[10px] text-ink-faint -mt-1 px-1">
                数值越高越极简纯净，强力滤除版画石刻阴影与密集排线
              </span>

              <NumberStepperRow
                label="排线抑制力"
                value={Math.round((currentTraceConfig.hatchSuppression ?? 0.6) * 100)}
                min={0}
                max={100}
                step={5}
                unit="%"
                disabled={disabled}
                onChange={(val) =>
                  updateTraceField('hatchSuppression', Number((val / 100).toFixed(2)))
                }
              />
              <span className="text-[10px] text-ink-faint -mt-1 px-1">
                智能识别并消除平行阴影排线（Hatching），凸显主骨架
              </span>

              <NumberStepperRow
                label="去噪平滑度"
                value={currentTraceConfig.smooth || 2}
                min={1}
                max={4}
                step={1}
                unit="级"
                disabled={disabled}
                onChange={(val) => updateTraceField('smooth', val)}
              />
              <span className="text-[10px] text-ink-faint -mt-1 px-1">
                高斯滤波强度，彻底平息古纸纤维与石材质感杂点
              </span>

              <NumberStepperRow
                label="铁线线宽"
                value={Math.round((currentTraceConfig.lineWidth || 1.0) * 100)}
                min={40}
                max={220}
                step={10}
                unit="%"
                disabled={disabled}
                onChange={(val) =>
                  updateTraceField('lineWidth', Number((val / 100).toFixed(2)))
                }
              />
              <span className="text-[10px] text-ink-faint -mt-1 px-1">
                控制焦墨工笔勾线笔笔骨，从游丝描到铁线描自由缩放
              </span>

              <NumberStepperRow
                label="焦墨浓黑度"
                value={Math.round(((currentTraceConfig.density || 1.4) / 1.4) * 100)}
                min={50}
                max={200}
                step={10}
                unit="%"
                disabled={disabled}
                onChange={(val) =>
                  updateTraceField('density', Number(((val / 100) * 1.4).toFixed(2)))
                }
              />
            </div>

            {/* 重置为默认拓印参数按钮 */}
            <button
              type="button"
              onClick={() => {
                handleApplyTracePreset(DEFAULT_INKWASH_TRACE_CONFIG);
                onRetrace?.();
              }}
              disabled={disabled}
              className="w-full py-2 px-3 rounded-xl border border-paper-grid hover:border-accent/40 bg-paper/60 hover:bg-paper text-ink-light hover:text-ink text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs active:scale-[0.98]"
            >
              <RotateCcw size={12} className="text-ink-faint" />
              <span>参数重置</span>
            </button>
          </div>
        )}

        {/* Tab 4: 宣纸画幅 */}
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

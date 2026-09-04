/**
 * 文本成图节点 - 侧边吸附排版调优抽屉 (TextImageStudioPanel)
 * 遵循 NodeSideDrawer 规范，将富参数调优从主卡片外挂至侧边，所见即所得 60fps 实时渲染联动。
 */
import React from 'react';
import { SlidersHorizontal, PenLine, Square, Type, Layout } from 'lucide-react';
import { NodeSideDrawer } from '../../../platform/components/node/NodeSideDrawer';
import { Slider } from '../../../platform/components/ui/Slider';
import { NumberStepper } from '../../../platform/components/ui/NumberStepper';
import type { TextImageItem, TextImageState } from './types';
import { TEXT_IMAGE_CANVAS, TEXT_IMAGE_CANVAS_PRESETS, getTextImageCanvasPreset } from './types';
import { textFontSize } from '../journal/text/drawText';
import {
  FontFamilySelect,
  TextColorPalette,
  WritingModeToggle,
  TextAlignToggle,
} from '../journal/text/FontControls';

export interface TextImageStudioPanelProps {
  isOpen: boolean;
  onClose: () => void;
  state: TextImageState;
  selectedItem?: TextImageItem | null;
  onUpdateState: (patch: Partial<TextImageState>, undoable?: boolean) => void;
  onUpdateItem?: (itemId: string, patch: Partial<TextImageItem>, undoable?: boolean) => void;
  disabled?: boolean;
}

/** 微型开关组件 (Switch/Toggle) */
const MiniSwitch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}> = ({ checked, onChange, disabled = false, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-3.5 w-6.5 shrink-0 items-center rounded-full border transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.95] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent cursor-pointer ${
      checked ? 'bg-accent border-accent' : 'bg-paper-grid/60 border-paper-grid'
    }`}
    title={label}
  >
    <span
      className={`inline-block h-2.5 w-2.5 transform rounded-full bg-paper shadow-2xs transition-transform duration-150 ease-out ${
        checked ? 'translate-x-3' : 'translate-x-0.5'
      }`}
    />
  </button>
);

export const TextImageStudioPanel: React.FC<TextImageStudioPanelProps> = ({
  isOpen,
  onClose,
  state,
  selectedItem = null,
  onUpdateState,
  onUpdateItem,
  disabled = false,
}) => {
  const currentFontSize = selectedItem
    ? Math.round(textFontSize(selectedItem.w, TEXT_IMAGE_CANVAS))
    : 96;

  return (
    <NodeSideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="文本排版调优"
      subtitle={
        selectedItem
          ? `${selectedItem.writingMode === 'vertical' ? '竖排' : '横排'} · 选中文本「${(selectedItem.text || '').slice(0, 6)}」`
          : '全局画布背景与排版'
      }
      icon={<SlidersHorizontal size={14} className="text-accent" />}
      width={290}
    >
      <div className="flex flex-col gap-4 font-sans text-xs text-ink-light select-none">
        {selectedItem ? (
          <>
            {/* 1. 字体与排版 */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-faint">
                <Type size={12} className="text-accent" />
                <span>字体与排版</span>
              </div>

              {/* 字体下拉选择 */}
              <FontFamilySelect
                value={selectedItem.fontFamily}
                onChange={(family) => onUpdateItem?.(selectedItem.id, { fontFamily: family }, true)}
                disabled={disabled}
                className="w-full"
              />

              {/* 横竖排与对齐方式 */}
              <div className="flex items-center justify-between gap-1.5 pt-1">
                <WritingModeToggle
                  value={selectedItem.writingMode}
                  onChange={(mode) => onUpdateItem?.(selectedItem.id, { writingMode: mode }, true)}
                  disabled={disabled}
                />
                <TextAlignToggle
                  value={selectedItem.textAlign}
                  writingMode={selectedItem.writingMode}
                  onChange={(align) => onUpdateItem?.(selectedItem.id, { textAlign: align }, true)}
                  disabled={disabled}
                />
              </div>

              {/* 字号步进器 */}
              <div className="flex items-center justify-between gap-1.5 pt-1">
                <span className="text-ink-faint text-[11px]">字号大小</span>
                <NumberStepper
                  value={currentFontSize}
                  min={12}
                  max={300}
                  step={4}
                  unit="px"
                  inputWidth="w-12"
                  className="h-7"
                  disabled={disabled}
                  onChange={(v) => {
                    const nextW = Math.max(1, Math.min(50, (v / TEXT_IMAGE_CANVAS) * 100));
                    onUpdateItem?.(selectedItem.id, { w: nextW }, false);
                  }}
                />
              </div>
            </div>

            {/* 分割线 */}
            <div className="h-px bg-paper-grid/50" />

            {/* 2. 墨色调色盘 */}
            <div className="flex flex-col gap-2">
              <span className="text-ink-faint text-[11px] font-medium">墨色选择</span>
              <TextColorPalette
                value={selectedItem.color}
                onChange={(c) => onUpdateItem?.(selectedItem.id, { color: c }, true)}
                disabled={disabled}
                customLabel="自定义墨色"
                size="normal"
              />
            </div>

            {/* 分割线 */}
            <div className="h-px bg-paper-grid/50" />

            {/* 3. 描边设置 */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <PenLine size={12} className={selectedItem.strokeEnabled ? 'text-accent' : 'text-ink-faint'} />
                  <span className="text-[11px] font-medium text-ink">文字描边</span>
                </div>
                <MiniSwitch
                  checked={Boolean(selectedItem.strokeEnabled)}
                  onChange={(checked) => onUpdateItem?.(selectedItem.id, { strokeEnabled: checked }, true)}
                  disabled={disabled}
                  label="开启/关闭描边"
                />
              </div>

              {selectedItem.strokeEnabled && (
                <div className="flex flex-col gap-2.5 p-2 rounded-lg bg-paper-grid/25 border border-paper-grid/60">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-ink-faint">描边颜色</span>
                    <TextColorPalette
                      value={selectedItem.strokeColor || '#ffffff'}
                      onChange={(c) => onUpdateItem?.(selectedItem.id, { strokeColor: c }, true)}
                      disabled={disabled}
                      customLabel="描边颜色"
                      size="compact"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-ink-faint shrink-0">描边粗细</span>
                    <div className="flex-1 flex items-center">
                      <Slider
                        min={1}
                        max={24}
                        step={1}
                        value={selectedItem.strokeWidth || 4}
                        disabled={disabled}
                        onChange={(v) => onUpdateItem?.(selectedItem.id, { strokeWidth: v }, false)}
                        aria-label="描边粗细"
                        aria-valuetext={`${selectedItem.strokeWidth || 4}px`}
                      />
                    </div>
                    <span className="text-[10px] text-ink-light w-6 text-right tabular-nums font-mono shrink-0">
                      {selectedItem.strokeWidth || 4}px
                    </span>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="p-3 rounded-lg bg-paper-grid/20 border border-paper-grid/50 text-[11px] text-ink-faint text-center leading-relaxed">
            在画布中点击选中任意文字，即可在此处精细调优其字体、字号、墨色与描边。
          </div>
        )}

        {/* 分割线 */}
        <div className="h-px bg-paper-grid/50" />

        {/* 4. 画布比例设置 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Layout size={12} className="text-accent" />
              <span className="text-[11px] font-medium text-ink">画布比例</span>
            </div>
            <span className="text-[10px] text-ink-faint font-mono">
              {getTextImageCanvasPreset(state.aspectRatio).width}×{getTextImageCanvasPreset(state.aspectRatio).height}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-1 pt-0.5">
            {TEXT_IMAGE_CANVAS_PRESETS.map((p) => {
              const active = (state.aspectRatio || '1:1') === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onUpdateState({ aspectRatio: p.id }, true)}
                  className={`py-1 rounded text-center text-xs font-mono transition-[color,background-color,border-color,transform] active:scale-[0.96] cursor-pointer border ${
                    active
                      ? 'bg-accent text-white border-accent shadow-2xs font-semibold'
                      : 'bg-paper border-paper-grid/70 text-ink-light hover:text-accent hover:border-accent/40'
                  }`}
                  title={`${p.label} (${p.width}×${p.height})`}
                >
                  {p.id}
                </button>
              );
            })}
          </div>
        </div>

        {/* 分割线 */}
        <div className="h-px bg-paper-grid/50" />

        {/* 5. 背景设置 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Square size={12} className={state.backgroundEnabled ? 'text-accent' : 'text-ink-faint'} />
              <span className="text-[11px] font-medium text-ink">画布背景</span>
            </div>
            <MiniSwitch
              checked={state.backgroundEnabled}
              onChange={(checked) => onUpdateState({ backgroundEnabled: checked }, true)}
              disabled={disabled}
              label="开启/关闭背景底色"
            />
          </div>

          {state.backgroundEnabled ? (
            <div className="flex items-center justify-between p-2 rounded-lg bg-paper-grid/25 border border-paper-grid/60">
              <span className="text-[10px] text-ink-faint">底色填充</span>
              <TextColorPalette
                value={state.backgroundColor}
                onChange={(c) => onUpdateState({ backgroundColor: c }, true)}
                disabled={disabled}
                customLabel="背景底色"
                size="compact"
              />
            </div>
          ) : (
            <span className="text-[10px] text-ink-faint/80 italic pl-5">默认无背景（输出透明 PNG）</span>
          )}
        </div>
      </div>
    </NodeSideDrawer>
  );
};

import React from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { PALETTE_METHODS } from './ColorSearchNode';
import { getReadableTextColor, getSuggestionsForTile } from './_shared/color';
import type { ColorItem, ColorHarmonyItem } from './ColorSearchNode';

interface PaletteGeneratorTabProps {
  palette: ColorItem[];
  method: string;
  onMethodChange: (method: string) => void;
  onGenerate: (anchorId?: string, nextMethod?: string) => void;
  generatorLoading: boolean;
  isLocked: boolean;
  items: ColorItem[];
  colorCacheRef: React.MutableRefObject<Map<string, ColorItem>>;
  selectedColor: ColorItem | null;
  onCopyFullPalette: () => void;
  onReplaceSingleColor: (index: number, replacement: ColorHarmonyItem) => void;
  onCopyToClipboard: (text: string, label?: string) => void;
}

export const PaletteGeneratorTab = React.memo<PaletteGeneratorTabProps>(({
  palette,
  method,
  onMethodChange,
  onGenerate,
  generatorLoading,
  isLocked,
  items,
  colorCacheRef,
  selectedColor,
  onCopyFullPalette,
  onReplaceSingleColor,
  onCopyToClipboard,
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-0 gap-2.5">
      <div className="shrink-0 flex items-center justify-between gap-1 flex-wrap">
        <div className="flex items-center gap-1 bg-ink/5 p-0.5 rounded-lg border border-paper-grid/40">
          {PALETTE_METHODS.map((m) => (
            <button
              key={m.key}
              type="button"
              disabled={isLocked}
              onClick={() => {
                onMethodChange(m.key);
                onGenerate(selectedColor?.id, m.key);
              }}
              className={`px-2 py-1 text-xs font-serif rounded-md transition-all ${
                method === m.key
                  ? 'bg-paper text-ink font-bold shadow-xs'
                  : 'text-ink-muted hover:text-ink'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              title={isLocked ? '有下级节点，不可更换算法' : m.desc}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onGenerate(selectedColor?.id, method)}
            disabled={generatorLoading || isLocked}
            className="flex items-center gap-1 px-2.5 py-1 bg-paper border border-paper-grid/60 hover:border-accent/60 text-ink rounded-md text-xs font-serif shadow-xs hover:bg-ink/5 active:scale-[0.96] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title={isLocked ? '有下级节点，不可更换色板' : '换一组搭配'}
          >
            <RefreshCw className={`w-3 h-3 ${generatorLoading ? 'animate-spin' : ''}`} />
            <span>换一组</span>
          </button>
          <button
            type="button"
            onClick={onCopyFullPalette}
            className="p-1 rounded-md text-ink-muted hover:text-ink hover:bg-ink/5 transition-colors border border-paper-grid/40 active:scale-[0.96] cursor-pointer"
            title="复制完整 5 色调色板"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-5 gap-1.5 rounded-xl overflow-hidden p-1 bg-ink/5 border border-paper-grid/50">
        {palette.map((color, index) => {
          const textColor = getReadableTextColor(color.hex);
          const suggestions = getSuggestionsForTile(color, method, colorCacheRef.current, items);
          return (
            <div
              key={`${color.id}-${index}`}
              className="group/tile relative flex flex-col justify-between p-2 rounded-lg transition-transform duration-200 hover:scale-[1.02] shadow-xs"
              style={{ backgroundColor: color.hex, color: textColor }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold opacity-75">0{index + 1}</span>
              </div>
              <div className="flex flex-col my-auto text-center gap-0.5">
                <span className="text-xs font-serif font-bold truncate tracking-wide">{color.name}</span>
                <button
                  type="button"
                  onClick={() => onCopyToClipboard(color.hex, color.name)}
                  className="text-[10px] font-mono opacity-80 hover:opacity-100 hover:underline cursor-pointer"
                  title="点击复制 HEX"
                >
                  {color.hex}
                </button>
              </div>
              <div className="pt-2 flex items-center justify-center gap-1">
                {suggestions.map((sug, sIdx) => (
                  <button
                    key={sIdx}
                    type="button"
                    disabled={isLocked}
                    onClick={() => onReplaceSingleColor(index, sug)}
                    className="w-3.5 h-3.5 rounded-full border border-white/60 shadow-xs hover:scale-125 transition-transform disabled:opacity-30 disabled:hover:scale-100 disabled:cursor-not-allowed cursor-pointer"
                    style={{ backgroundColor: sug.hex }}
                    title={isLocked ? '有下级节点，不可替换单色' : `替换为: ${sug.name} (${sug.hex})`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {palette.length > 0 && (
        <div className="shrink-0 flex flex-col p-2 rounded-lg bg-paper-grid/20 border border-paper-grid/40">
          <span className="text-xs font-serif font-bold text-ink truncate">
            当前基准：{selectedColor?.name || palette[0]?.name}
          </span>
          <span className="text-[11px] font-serif text-ink-muted truncate">
            包含 {palette.map((p) => p.name).join('、')}
          </span>
        </div>
      )}
    </div>
  );
});
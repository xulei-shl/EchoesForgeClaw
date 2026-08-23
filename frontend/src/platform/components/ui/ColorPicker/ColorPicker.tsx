import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pipette } from 'lucide-react';
import {
  hexToHsv,
  hsvToHex,
  hsvToRgb,
  isValidHex,
  normalizeHex,
  type HsvColor,
} from './colorUtils';

export interface ColorPickerProps {
  /** 当前 Hex 颜色，如 "#d5853e" */
  value: string;
  /** 颜色变更回调 */
  onChange: (hex: string) => void;
  /** 是否禁用 */
  disabled?: boolean;
  className?: string;
}

/** 经典高频复古纸墨色系预设 */
const PAPER_SWATCHES = [
  { name: '素白', hex: '#fdfbf7' },
  { name: '宣墨', hex: '#1c1b1a' },
  { name: '松烟', hex: '#3d443e' },
  { name: '黛青', hex: '#264e5a' },
  { name: '竹绿', hex: '#5b7e5b' },
  { name: '赭石', hex: '#8c4b2d' },
  { name: '琥珀', hex: '#d36c28' },
  { name: '藤黄', hex: '#e5a93c' },
  { name: '栗壳', hex: '#482f23' },
  { name: '霁蓝', hex: '#345d8a' },
];

export const ColorPicker: React.FC<ColorPickerProps> = memo(({
  value,
  onChange,
  disabled = false,
  className = '',
}) => {
  const normHex = useMemo(() => normalizeHex(value || '#000000'), [value]);
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(normHex));
  const [hexInput, setHexInput] = useState<string>(normHex);

  // 同步外部传入的 value
  useEffect(() => {
    setHexInput(normHex);
    setHsv(hexToHsv(normHex));
  }, [normHex]);

  const svPanelRef = useRef<HTMLDivElement>(null);
  const isDraggingSv = useRef(false);

  /** 更新 HSV 并向上触发 Hex 变更 */
  const updateHsv = useCallback(
    (newHsv: HsvColor) => {
      setHsv(newHsv);
      const nextHex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
      setHexInput(nextHex);
      onChange(nextHex);
    },
    [onChange]
  );

  /** 计算并更新 SV 坐标 */
  const handleSvMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!svPanelRef.current || disabled) return;
      const rect = svPanelRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));

      const s = Math.round((x / rect.width) * 100);
      const v = Math.round((1 - y / rect.height) * 100);
      updateHsv({ ...hsv, s, v });
    },
    [disabled, hsv, updateHsv]
  );

  const handleSvMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    isDraggingSv.current = true;
    handleSvMove(e.clientX, e.clientY);

    const onMouseMove = (ev: MouseEvent) => {
      if (isDraggingSv.current) {
        handleSvMove(ev.clientX, ev.clientY);
      }
    };
    const onMouseUp = () => {
      isDraggingSv.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  /** 色相条更新 */
  const handleHueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const h = Number(e.target.value);
    updateHsv({ ...hsv, h });
  };

  /** Hex 输入框失焦或变更 */
  const handleHexBlur = () => {
    if (isValidHex(hexInput)) {
      const fixed = normalizeHex(hexInput);
      setHexInput(fixed);
      setHsv(hexToHsv(fixed));
      onChange(fixed);
    } else {
      // 还原
      setHexInput(normHex);
    }
  };

  /** 浏览器原生吸管 */
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const handlePickEyeDropper = async () => {
    if (!hasEyeDropper || disabled) return;
    try {
      // @ts-ignore
      const eyeDropper = new window.EyeDropper();
      // @ts-ignore
      const result = await eyeDropper.open();
      if (result?.sRGBHex) {
        const picked = normalizeHex(result.sRGBHex);
        setHexInput(picked);
        setHsv(hexToHsv(picked));
        onChange(picked);
      }
    } catch {
      // 用户取消吸管
    }
  };

  // 当前纯色相背景（用于 2D 底色）
  const hueBgRgb = useMemo(() => {
    const { r, g, b } = hsvToRgb(hsv.h, 100, 100);
    return `rgb(${r}, ${g}, ${b})`;
  }, [hsv.h]);

  return (
    <div
      className={`flex flex-col gap-2 p-2.5 w-[210px] select-none text-xs font-sans text-ink ${className}`}
    >
      {/* 2D 饱和度与明度面板 */}
      <div
        ref={svPanelRef}
        onMouseDown={handleSvMouseDown}
        style={{ backgroundColor: hueBgRgb }}
        className="relative w-full h-[110px] rounded-md cursor-crosshair overflow-hidden border border-black/10 shadow-inner"
        role="slider"
        aria-label="色彩饱和度与明度面板"
      >
        {/* 水平渐变：白 -> 透明 */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to right, #ffffff, rgba(255, 255, 255, 0))',
          }}
        />
        {/* 垂直渐变：透明 -> 黑 */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to top, #000000, rgba(0, 0, 0, 0))',
          }}
        />
        {/* 拾色指示手柄 */}
        <div
          className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_2px_rgba(0,0,0,0.8)] pointer-events-none transition-[left,top] duration-75"
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            backgroundColor: normHex,
          }}
        />
      </div>

      {/* 色相滑轨 */}
      <div className="flex items-center gap-1.5">
        <input
          type="range"
          min={0}
          max={360}
          value={hsv.h}
          disabled={disabled}
          onChange={handleHueChange}
          aria-label="色相选择滑条"
          className="w-full h-2.5 rounded-full appearance-none cursor-pointer outline-none shadow-2xs"
          style={{
            background:
              'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
          }}
        />
      </div>

      {/* 数值栏与工具项 */}
      <div className="flex items-center gap-1.5 pt-0.5">
        {/* 预览色圆点 */}
        <div
          className="w-5 h-5 rounded-full border border-black/15 shrink-0 shadow-2xs"
          style={{ backgroundColor: normHex }}
          title={normHex}
        />

        {/* Hex 输入 */}
        <div className="flex-1 flex items-center bg-paper-grid/30 border border-paper-grid/80 rounded px-1.5 py-0.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent transition-colors shadow-2xs">
          <input
            type="text"
            value={hexInput}
            onChange={(e) => setHexInput(e.target.value)}
            onBlur={handleHexBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleHexBlur()}
            disabled={disabled}
            className="w-full bg-transparent text-ink text-[11px] font-mono outline-none uppercase"
            aria-label="十六进制色值"
          />
        </div>

        {/* 原生屏幕吸管 */}
        {hasEyeDropper && (
          <button
            type="button"
            onClick={handlePickEyeDropper}
            disabled={disabled}
            title="屏幕吸管取色"
            className="p-1 rounded text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.9] transition-all border border-paper-grid/50 shadow-2xs"
          >
            <Pipette size={12} />
          </button>
        )}
      </div>

      {/* 经典纸墨预设快捷条 */}
      <div className="flex flex-col gap-1 pt-1 border-t border-paper-grid/40">
        <div className="grid grid-cols-5 gap-1">
          {PAPER_SWATCHES.map((swatch) => (
            <button
              key={swatch.hex}
              type="button"
              onClick={() => {
                const fixed = normalizeHex(swatch.hex);
                setHexInput(fixed);
                setHsv(hexToHsv(fixed));
                onChange(fixed);
              }}
              disabled={disabled}
              title={`${swatch.name} (${swatch.hex})`}
              className="w-full h-4 rounded border border-black/10 hover:scale-110 active:scale-95 transition-transform shadow-2xs"
              style={{ backgroundColor: swatch.hex }}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

ColorPicker.displayName = 'ColorPicker';

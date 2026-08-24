import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Dices,
  Sparkles,
  Sliders,
  Palette,
  Bookmark,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  ColorPickerPopover,
  hexToRgb,
  rgbToHex,
  normalizeHex,
  isValidHex,
} from '../../../platform/components/ui/ColorPicker';

export interface CustomPaletteEditorProps {
  /** 逗号分隔的 Hex 字符串，如 "#000000,#ffffff" */
  value: string;
  /** 颜色变更回调，输出标准逗号分隔字符串 */
  onChange: (paletteStr: string) => void;
  /** 是否禁用编辑（如正在生成或有下级节点） */
  disabled?: boolean;
  /** 当前输入图片的 Data URL 或链接（用于原图提取主色） */
  imageSrc?: string | null;
}

type EditorTab = 'ramp' | 'swatches' | 'presets';

/** 经典复古与艺术灵感预设 */
const PRESETS: Array<{ name: string; colors: string[]; description: string }> = [
  {
    name: '赛博朋克',
    colors: ['#0d0221', '#0f084b', '#26408b', '#a6cfd5', '#ff71ce'],
    description: '深邃暗夜与霓虹粉蓝',
  },
  {
    name: '暖阳复古',
    colors: ['#2b1e16', '#d35400', '#f39c12', '#f9e79f'],
    description: '秋日琥珀与阳光暖黄',
  },
  {
    name: '莫兰迪',
    colors: ['#2c3e50', '#7f8c8d', '#bdc3c7', '#f5f7fa'],
    description: '高级低饱和素雅色调',
  },
  {
    name: '蓝晒印相',
    colors: ['#0b1d3a', '#1b4965', '#62b6cb', '#bee9e8'],
    description: '古典摄影蓝调质感',
  },
  {
    name: '蒸汽波',
    colors: ['#ff71ce', '#01cdfe', '#05ffa1', '#b967ff'],
    description: '梦幻电子复古浪漫',
  },
  {
    name: '赤金墨韵',
    colors: ['#16212b', '#2b4c59', '#c99e64', '#e4d7b2'],
    description: '东方雅致黑金古典',
  },
];

/** 随机灵感库（用于一键摇骰子） */
const RANDOM_SEEDS: string[][] = [
  ['#1a1c23', '#475569', '#94a3b8', '#f8fafc'],
  ['#220901', '#621708', '#941b0c', '#bc3908', '#f6aa1c'],
  ['#03071e', '#370617', '#6a040f', '#9d0208', '#d00000', '#dc2f02', '#e85d04', '#f48c06', '#faa307', '#ffba08'],
  ['#10002b', '#240046', '#3c096c', '#5a189a', '#7b2cbf', '#9d4edd', '#c77dff', '#e0aaff'],
  ['#283618', '#606c38', '#dda15e', '#bc6c25'],
  ['#2b2d42', '#8d99ae', '#edf2f4', '#ef233c', '#d90429'],
  ['#003049', '#d62828', '#fdf0d5', '#669bbc'],
  ['#132a13', '#31572c', '#4f772d', '#90a955', '#ecf39e'],
  ['#2d00f7', '#6a00f4', '#8900f2', '#a100f2', '#b100e8', '#bc00dd', '#d100d1', '#db00b6', '#e500a4', '#f20089'],
];

/** 解析逗号分隔的颜色字符串为 hex 数组 */
function parseColors(input: string): string[] {
  const parts = input.split(',').map((s) => s.trim());
  const valid = parts.filter(isValidHex).map(normalizeHex);
  return valid.length >= 2 ? valid : ['#000000', '#ffffff'];
}

/** 根据起点和终点颜色及阶数生成线性色阶 */
function generateRamp(startHex: string, endHex: string, steps: number): string[] {
  const { r: r1, g: g1, b: b1 } = hexToRgb(startHex);
  const { r: r2, g: g2, b: b2 } = hexToRgb(endHex);
  const result: string[] = [];
  const count = Math.max(2, Math.min(8, steps));
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const r = r1 + (r2 - r1) * t;
    const g = g1 + (g2 - g1) * t;
    const b = b1 + (b2 - b1) * t;
    result.push(rgbToHex(r, g, b));
  }
  return result;
}

/** 从图像采样主色（轻量异步 Canvas 采样） */
async function extractPaletteFromImage(src: string, steps = 4): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 64;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(['#000000', '#ffffff']);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        const pixels: Array<{ r: number; g: number; b: number; luma: number }> = [];
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          pixels.push({ r, g, b, luma });
        }
        pixels.sort((a, b) => a.luma - b.luma);

        const result: string[] = [];
        const chunkSize = Math.floor(pixels.length / steps);
        for (let s = 0; s < steps; s++) {
          const start = s * chunkSize;
          const end = s === steps - 1 ? pixels.length : (s + 1) * chunkSize;
          let sumR = 0, sumG = 0, sumB = 0, count = 0;
          for (let p = start; p < end; p++) {
            sumR += pixels[p].r;
            sumG += pixels[p].g;
            sumB += pixels[p].b;
            count++;
          }
          if (count > 0) {
            result.push(rgbToHex(sumR / count, sumG / count, sumB / count));
          }
        }
        resolve(result.length >= 2 ? result : ['#000000', '#ffffff']);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

export const CustomPaletteEditor: React.FC<CustomPaletteEditorProps> = memo(({
  value,
  onChange,
  disabled = false,
  imageSrc,
}) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('ramp');
  const [showHexInput, setShowHexInput] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  // 解析当前色板
  const colors = useMemo(() => parseColors(value), [value]);

  // 色阶状态（默认暗部为第 1 色，亮部为最后 1 色，阶数为当前色板长度）
  const [rampDark, setRampDark] = useState<string>(() => colors[0] || '#000000');
  const [rampLight, setRampLight] = useState<string>(() => colors[colors.length - 1] || '#ffffff');
  const [rampSteps, setRampSteps] = useState<number>(() => Math.max(2, Math.min(6, colors.length)));

  /** 应用颜色列表并通知父组件 */
  const applyColors = useCallback(
    (newColors: string[]) => {
      onChange(newColors.join(','));
    },
    [onChange]
  );

  /** 修改色阶参数并同步色板 */
  const handleRampChange = useCallback(
    (dark: string, light: string, steps: number) => {
      setRampDark(dark);
      setRampLight(light);
      setRampSteps(steps);
      const ramp = generateRamp(dark, light, steps);
      applyColors(ramp);
    },
    [applyColors]
  );

  /** 自由色卡：修改单个颜色 */
  const handleUpdateSingleColor = useCallback(
    (index: number, newHex: string) => {
      const next = [...colors];
      next[index] = normalizeHex(newHex);
      applyColors(next);
    },
    [colors, applyColors]
  );

  /** 自由色卡：添加新颜色 */
  const handleAddColor = useCallback(() => {
    if (colors.length >= 8) return;
    const lastColor = colors[colors.length - 1] || '#ffffff';
    const { r, g, b } = hexToRgb(lastColor);
    const nextHex = rgbToHex(
      Math.min(255, r + 25),
      Math.min(255, g + 25),
      Math.min(255, b + 25)
    );
    applyColors([...colors, nextHex]);
  }, [colors, applyColors]);

  /** 自由色卡：删除指定颜色 */
  const handleRemoveColor = useCallback(
    (index: number) => {
      if (colors.length <= 2) return;
      const next = colors.filter((_, i) => i !== index);
      applyColors(next);
    },
    [colors, applyColors]
  );

  /** 摇灵感（随机选取种子） */
  const handleRandomize = useCallback(() => {
    const randomIndex = Math.floor(Math.random() * RANDOM_SEEDS.length);
    const chosen = RANDOM_SEEDS[randomIndex];
    applyColors(chosen);
    setRampDark(chosen[0]);
    setRampLight(chosen[chosen.length - 1]);
    setRampSteps(Math.max(2, Math.min(6, chosen.length)));
  }, [applyColors]);

  /** 从输入图片一键提取主色 */
  const handleExtractFromImage = useCallback(async () => {
    if (!imageSrc || isExtracting) return;
    setIsExtracting(true);
    try {
      const extracted = await extractPaletteFromImage(imageSrc, 4);
      applyColors(extracted);
      setRampDark(extracted[0]);
      setRampLight(extracted[extracted.length - 1]);
      setRampSteps(extracted.length);
    } catch (e) {
      console.warn('提取原图主色失败:', e);
    } finally {
      setIsExtracting(false);
    }
  }, [imageSrc, isExtracting, applyColors]);

  return (
    <div className="flex flex-col gap-1 p-1.5 rounded-lg bg-paper/90 border border-paper-grid/60 shadow-2xs font-sans text-xs text-ink-light">
      {/* 顶部标签切换栏与快捷按钮 */}
      <div className="flex items-center justify-between gap-1 pb-0.5 border-b border-paper-grid/30">
        <div className="flex items-center gap-0.5 p-0.5 rounded bg-paper-grid/20 border border-paper-grid/30">
          <button
            type="button"
            onClick={() => setActiveTab('ramp')}
            disabled={disabled}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.96] leading-none ${
              activeTab === 'ramp'
                ? 'bg-accent text-paper shadow-2xs'
                : 'text-ink-faint hover:text-ink hover:bg-paper/50'
            }`}
          >
            <Sliders size={10} />
            <span>色阶</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('swatches')}
            disabled={disabled}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.96] leading-none ${
              activeTab === 'swatches'
                ? 'bg-accent text-paper shadow-2xs'
                : 'text-ink-faint hover:text-ink hover:bg-paper/50'
            }`}
          >
            <Palette size={10} />
            <span>自选</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            disabled={disabled}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.96] leading-none ${
              activeTab === 'presets'
                ? 'bg-accent text-paper shadow-2xs'
                : 'text-ink-faint hover:text-ink hover:bg-paper/50'
            }`}
          >
            <Bookmark size={10} />
            <span>预设</span>
          </button>
        </div>

        {/* 快捷操作：摇灵感与原图提取 */}
        <div className="flex items-center gap-1">
          {imageSrc && (
            <button
              type="button"
              onClick={handleExtractFromImage}
              disabled={disabled || isExtracting}
              title="从当前输入图片提取 4 色主色板"
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-accent bg-accent/10 hover:bg-accent/20 active:scale-[0.96] transition-[background-color,transform] border border-accent/20 disabled:opacity-50 leading-none"
            >
              <Sparkles size={10} className={isExtracting ? 'animate-spin' : ''} />
              <span>提取原图</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleRandomize}
            disabled={disabled}
            title="随机生成一组配色灵感"
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-ink-light bg-paper-grid/20 hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,transform] border border-paper-grid/40 disabled:opacity-50 leading-none"
          >
            <Dices size={10} />
            <span>随机</span>
          </button>
        </div>
      </div>

      {/* Tab 1: 渐变色阶生成器（小白最推荐） */}
      {activeTab === 'ramp' && (
        <div className="flex items-center justify-between gap-1.5 pt-0.5">
          {/* 暗部色选择 */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-ink-faint shrink-0">暗部:</span>
            <ColorPickerPopover
              value={rampDark}
              disabled={disabled}
              onChange={(nextDark) => handleRampChange(nextDark, rampLight, rampSteps)}
            />
          </div>

          {/* 色阶数选择 */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-ink-faint shrink-0">阶数:</span>
            <div className="flex items-center p-0.5 rounded bg-paper border border-paper-grid/50 gap-0.5">
              {[2, 3, 4, 5, 6].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleRampChange(rampDark, rampLight, num)}
                  disabled={disabled}
                  className={`w-4.5 h-4 rounded text-[10px] font-medium leading-none transition-all ${
                    rampSteps === num
                      ? 'bg-accent text-paper shadow-2xs'
                      : 'text-ink-faint hover:text-ink hover:bg-paper-grid/30'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          {/* 亮部色选择 */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-ink-faint shrink-0">亮部:</span>
            <ColorPickerPopover
              value={rampLight}
              disabled={disabled}
              align="right"
              onChange={(nextLight) => handleRampChange(rampDark, nextLight, rampSteps)}
            />
          </div>
        </div>
      )}

      {/* Tab 2: 自由色卡编辑 */}
      {activeTab === 'swatches' && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {colors.map((hex, idx) => (
            <div
              key={idx}
              className="group relative flex items-center gap-0.5 rounded bg-paper border border-paper-grid/60 shadow-2xs hover:border-accent/80 transition-colors pl-0.5 pr-1 py-0.5"
            >
              <ColorPickerPopover
                value={hex}
                disabled={disabled}
                align={idx > 3 ? 'right' : 'left'}
                onChange={(nextHex) => handleUpdateSingleColor(idx, nextHex)}
              />
              {colors.length > 2 && (
                <button
                  type="button"
                  onClick={() => handleRemoveColor(idx)}
                  disabled={disabled}
                  title="删除该颜色"
                  aria-label={`删除颜色 ${hex}`}
                  className="p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 active:scale-[0.9] transition-all ml-0.5"
                >
                  <Trash2 size={9} />
                </button>
              )}
            </div>
          ))}

          {colors.length < 8 && (
            <button
              type="button"
              onClick={handleAddColor}
              disabled={disabled}
              title="添加新色块"
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-dashed border-paper-grid/80 hover:border-accent text-ink-faint hover:text-accent bg-paper/40 active:scale-[0.96] transition-all text-[10px]"
            >
              <Plus size={10} />
              <span>加色</span>
            </button>
          )}
        </div>
      )}

      {/* Tab 3: 灵感库预设 */}
      {activeTab === 'presets' && (
        <div className="grid grid-cols-3 gap-1 pt-0.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => {
                applyColors(preset.colors);
                setRampDark(preset.colors[0]);
                setRampLight(preset.colors[preset.colors.length - 1]);
                setRampSteps(preset.colors.length);
              }}
              disabled={disabled}
              title={`${preset.name}：${preset.description}`}
              className="flex flex-col gap-0.5 p-1 rounded bg-paper border border-paper-grid/60 hover:border-accent/80 hover:bg-paper-grid/20 active:scale-[0.97] transition-all text-left shadow-2xs group"
            >
              <span className="text-[9px] font-medium text-ink group-hover:text-accent truncate">
                {preset.name}
              </span>
              <div className="flex items-center gap-0.5 h-1.5 w-full rounded overflow-hidden border border-black/10">
                {preset.colors.map((c, i) => (
                  <span
                    key={i}
                    className="flex-1 h-full"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 底部当前色板条预览 + Hex 代码折叠开关 */}
      <div className="flex items-center justify-between gap-1.5 pt-0.5 border-t border-paper-grid/30">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[10px] text-ink-faint shrink-0">实时色板:</span>
          <div className="flex items-center gap-0.5 p-0.5 rounded bg-paper border border-paper-grid/40">
            {colors.map((c, i) => (
              <span
                key={i}
                className="w-2.5 h-2.5 rounded-full border border-black/15 shadow-2xs shrink-0"
                style={{ backgroundColor: c }}
                title={`${c} (${i + 1}/${colors.length})`}
              />
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowHexInput(!showHexInput)}
          className="flex items-center gap-0.5 text-[10px] text-ink-faint hover:text-ink transition-colors"
        >
          <span>Hex 代码</span>
          {showHexInput ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
        </button>
      </div>

      {/* 折叠的 Hex 单行输入框（支持高级用户手动粘贴复制） */}
      {showHexInput && (
        <div className="pt-0.5">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#000000,#ffffff,..."
            className="w-full bg-paper border border-paper-grid rounded px-2 py-0.5 text-ink text-[10px] font-mono outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors shadow-2xs disabled:opacity-60"
            disabled={disabled}
            aria-label="自定义十六进制色板文本"
          />
        </div>
      )}
    </div>
  );
});

CustomPaletteEditor.displayName = 'CustomPaletteEditor';

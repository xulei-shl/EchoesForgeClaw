import React, { useState } from 'react';
import { RefreshCw, Stamp } from 'lucide-react';
import { getReceiptTheme } from '../../themes';
import { generateRandomSeals, getRandomSealSrc } from '../../sealGenerator';
import type { ReceiptSealItem, ReceiptState } from '../../types';
import { stopEvent } from './common/stopEvent';

export interface AncientBookmarkPaperProps {
  state: ReceiptState;
  onChange: (patch: Partial<ReceiptState>) => void;
  upstreamImageUrl?: string | null;
  disabled?: boolean;
}

/**
 * 预设 6：古籍版心书签纸张组件 (Ancient Bookmark Paper View)
 *
 * 经典古籍雕版与版心书签排版：
 * 1. 材质与肌理：泛黄做旧宣纸（中亮缘暗径向渐变）+ 纸浆微颗粒噪点 + 沉稳内阴影磨损感；
 * 2. 版心区（左侧）：上象鼻细线 + 上鱼尾 + 竖排版心题名 + 下鱼尾 + 下象鼻细线；
 * 3. 正文区（右侧）：从右向左多列排布（row-reverse），乌丝栏细线分割；
 *    - 第一列（最右侧）：汇文明朝体大字号竖排题名 + 卷号 / 副标题；
 *    - 第二列（中间）：竖排精彩文摘 / 提要精句；
 *    - 第三列（最左侧）：著者署名 + 出版社 · 出版年；
 * 4. 随机印章体系：从 39 枚古籍真迹印章中随机抽取分布，支持正片叠底（multiply）、旋转角度与一键「重新盖印」。
 */
export const AncientBookmarkPaper = React.forwardRef<HTMLDivElement, AncientBookmarkPaperProps>(
  ({ state, onChange, disabled = false }, ref) => {
    const theme = getReceiptTheme(state.themeId || 'ancient');
    const [hoveredSealId, setHoveredSealId] = useState<string | null>(null);

    // 字体栈：优先汇文明朝体与又又意宋
    const minchoFontFamily =
      "'Huiwen-mincho', 'Huiwen Mincho', '又又意宋', 'Shippori Mincho B1', 'Shippori Mincho', 'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', serif";
    const kaitiFontFamily =
      "'Kaiti SC', 'STKaiti', 'KaiTi', '楷体', 'LXGW WenKai', serif";

    // 确保有印章数据
    const seals = state.seals && state.seals.length > 0 ? state.seals : generateRandomSeals(4);

    // 重新生成整组随机印章
    const handleRerollAllSeals = (e: React.MouseEvent) => {
      stopEvent(e);
      if (disabled) return;
      const newSeals = generateRandomSeals();
      onChange({ seals: newSeals });
    };

    // 单独更换某枚印章图片
    const handleRerollSingleSeal = (sealId: string, e: React.MouseEvent) => {
      stopEvent(e);
      if (disabled) return;
      const nextSeals = seals.map((s) => {
        if (s.id === sealId) {
          return {
            ...s,
            src: getRandomSealSrc(),
            rotate: Number((Math.random() * 6 - 3).toFixed(1)),
          };
        }
        return s;
      });
      onChange({ seals: nextSeals });
    };

    // 背景做旧渐变
    const paperBackgroundStyle: React.CSSProperties = {
      backgroundColor: theme.bg || '#e4d1a9',
      backgroundImage: `
        radial-gradient(circle at 50% 42%, color-mix(in srgb, ${theme.bg} 85%, white) 0%, ${theme.bg} 68%, color-mix(in srgb, ${theme.bg} 76%, black) 100%),
        url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.06'/%3E%3C/svg%3E")
      `,
    };

    return (
      <div
        ref={ref}
        data-receipt-paper="true"
        className="relative w-[260px] min-h-[600px] h-[600px] mx-auto my-2 select-text transition-colors duration-300 font-sans overflow-hidden group"
        style={{
          ...paperBackgroundStyle,
          border: `4px solid ${theme.text}`,
          padding: '4px',
          boxShadow: '4px 10px 20px rgba(0, 0, 0, 0.25), inset 0 0 16px rgba(139, 69, 19, 0.15)',
          color: theme.text,
        }}
      >
        {/* 顶部悬浮「重新盖印」快捷按钮（导出时自动过滤） */}
        <div
          data-export-ignore="true"
          className="absolute top-2 right-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-black/70 hover:bg-black/85 text-white/90 text-[10px] px-1.5 py-0.5 rounded shadow backdrop-blur-xs cursor-pointer"
          onClick={handleRerollAllSeals}
          title="点击重新随机生成印章"
        >
          <Stamp size={11} className="text-amber-300" />
          <span>重新盖印</span>
          <RefreshCw size={10} className="hover:rotate-180 transition-transform duration-300" />
        </div>

        {/* 内框 Inner Frame */}
        <div
          className="relative w-full h-full flex flex-row overflow-hidden"
          style={{
            border: `1px solid ${theme.text}`,
          }}
        >
          {/* ========== 1. 版心区（左侧 Banxin Area） ========== */}
          <div
            className="w-[42px] shrink-0 flex flex-col items-center py-4 select-none relative z-10"
            style={{
              borderRight: `1px solid ${theme.text}`,
            }}
          >
            {/* 上象鼻线 */}
            <div
              className="w-[1.5px] grow"
              style={{ backgroundColor: theme.text }}
            />

            {/* 上鱼尾 */}
            <div
              className="w-[18px] h-[28px] my-1 shrink-0 transition-opacity"
              style={{
                backgroundColor: theme.text,
                clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 65%, 0 100%)',
                opacity: 0.88,
              }}
              title="版心上鱼尾"
            />

            {/* 版心题名（竖排垂直居中） */}
            <div className="my-2 py-1 flex items-center justify-center">
              <input
                type="text"
                value={state.banxinTitle || state.storeName || '資治通鑑'}
                disabled={disabled}
                onChange={(e) => onChange({ banxinTitle: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="版心题名"
                style={{
                  fontFamily: minchoFontFamily,
                  color: theme.text,
                  writingMode: 'vertical-lr',
                  letterSpacing: '4px',
                }}
                className="text-[14px] font-medium text-center bg-transparent outline-none border-r border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent py-1 tracking-widest max-h-[160px]"
                title="版心题名（点击编辑）"
              />
            </div>

            {/* 下鱼尾 */}
            <div
              className="w-[18px] h-[28px] my-1 shrink-0 transition-opacity"
              style={{
                backgroundColor: theme.text,
                clipPath: 'polygon(0 0, 50% 35%, 100% 0, 100% 100%, 0 100%)',
                opacity: 0.88,
              }}
              title="版心下鱼尾"
            />

            {/* 下象鼻线 */}
            <div
              className="w-[1.5px] grow"
              style={{ backgroundColor: theme.text }}
            />
          </div>

          {/* ========== 2. 正文区（右侧 Content Area，从右向左排列） ========== */}
          <div
            className="grow flex flex-row-reverse relative overflow-hidden"
            style={{
              fontFamily: minchoFontFamily,
            }}
          >
            {/* ---------- 第一列（最右侧）：大字书名 + 卷号/副标题 ---------- */}
            <div
              className="grow flex flex-col items-center justify-start pt-6 pb-4 px-2 relative"
              style={{
                writingMode: 'vertical-rl',
                borderLeft: `1px solid color-mix(in srgb, ${theme.text} 55%, transparent)`,
              }}
            >
              {/* 大字题名（汇文明朝体加粗） */}
              <input
                type="text"
                value={state.storeName || '资治通鉴'}
                disabled={disabled}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange({ storeName: val, banxinTitle: state.banxinTitle || val });
                }}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="书名"
                style={{
                  fontFamily: minchoFontFamily,
                  color: theme.text,
                  writingMode: 'vertical-rl',
                  letterSpacing: '8px',
                }}
                className="text-[26px] font-bold text-center bg-transparent outline-none border-l border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent my-1 leading-normal"
                title="大字书名（点击编辑）"
              />

              {/* 卷号 / 副标题 */}
              <input
                type="text"
                value={state.bookmarkVolume || '卷第一'}
                disabled={disabled}
                onChange={(e) => onChange({ bookmarkVolume: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="卷第一"
                style={{
                  fontFamily: kaitiFontFamily,
                  color: theme.text,
                  writingMode: 'vertical-rl',
                  letterSpacing: '4px',
                }}
                className="text-[15px] font-medium text-center bg-transparent outline-none border-l border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent mt-4 opacity-90 leading-relaxed"
                title="卷号/副题（点击编辑）"
              />
            </div>

            {/* ---------- 第二列（中间）：精彩文摘 / 提要精句 ---------- */}
            <div
              className="grow flex flex-col items-center justify-center py-6 px-2 relative"
              style={{
                writingMode: 'vertical-rl',
                borderLeft: `1px solid color-mix(in srgb, ${theme.text} 55%, transparent)`,
              }}
            >
              <textarea
                value={state.bookmarkExcerpt || '起著雍摄提格\n尽玄黓困敦'}
                disabled={disabled}
                onChange={(e) => onChange({ bookmarkExcerpt: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="在此输入精彩文摘或提要..."
                rows={6}
                style={{
                  fontFamily: kaitiFontFamily,
                  color: theme.text,
                  writingMode: 'vertical-rl',
                  letterSpacing: '3px',
                  lineHeight: '1.9',
                }}
                className="w-full text-[14px] bg-transparent outline-none resize-none border-l border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent opacity-90 text-justify"
                title="文摘提要（点击编辑）"
              />
            </div>

            {/* ---------- 第三列（最左侧）：著者署名 + 出版社/年份 ---------- */}
            <div
              className="grow flex flex-col items-center justify-end pb-8 pt-6 px-2 relative"
              style={{
                writingMode: 'vertical-rl',
              }}
            >
              <textarea
                value={state.bookmarkExtra || '司马光 著\n中华书局 · 2011'}
                disabled={disabled}
                onChange={(e) => onChange({ bookmarkExtra: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="著者与出版信息..."
                rows={5}
                style={{
                  fontFamily: kaitiFontFamily,
                  color: theme.text,
                  writingMode: 'vertical-rl',
                  letterSpacing: '2.5px',
                  lineHeight: '1.8',
                }}
                className="w-full text-[13px] bg-transparent outline-none resize-none border-l border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent opacity-85 text-right"
                title="著者与出版信息（点击编辑）"
              />
            </div>

            {/* ========== 3. 动态印章渲染图层（绝对定位 + 正片叠底） ========== */}
            {seals.map((seal: ReceiptSealItem) => {
              const style: React.CSSProperties = {
                position: 'absolute',
                mixBlendMode: 'multiply',
                zIndex: 20,
                width: seal.width ? `${seal.width}px` : '32px',
                transform: seal.rotate ? `rotate(${seal.rotate}deg)` : undefined,
                opacity: seal.opacity ?? 0.85,
                pointerEvents: disabled ? 'none' : 'auto',
                cursor: 'pointer',
              };

              // 根据预设位置或定位坐标定位
              if (seal.positionPreset === 'top-right' || seal.id === 'seal-1') {
                style.top = seal.top !== undefined ? `${seal.top}px` : '24px';
                style.right = seal.right !== undefined ? `${seal.right}px` : '8px';
              } else if (seal.positionPreset === 'bottom-left' || seal.id === 'seal-2') {
                style.bottom = seal.bottom !== undefined ? `${seal.bottom}px` : '28px';
                style.left = seal.left !== undefined ? `${seal.left}px` : '6px';
              } else if (seal.positionPreset === 'middle-cross' || seal.id === 'seal-3') {
                style.top = seal.topPercent !== undefined ? `${seal.topPercent}%` : '46%';
                style.right = seal.left !== undefined ? `${60 + Math.abs(seal.left)}px` : '68px';
              } else if (seal.positionPreset === 'top-left' || seal.id === 'seal-4') {
                style.top = seal.top !== undefined ? `${seal.top}px` : '72px';
                style.left = seal.left !== undefined ? `${seal.left}px` : '8px';
              } else {
                if (seal.top !== undefined) style.top = `${seal.top}px`;
                if (seal.left !== undefined) style.left = `${seal.left}px`;
                if (seal.right !== undefined) style.right = `${seal.right}px`;
                if (seal.bottom !== undefined) style.bottom = `${seal.bottom}px`;
              }

              return (
                <img
                  key={seal.id}
                  src={seal.src}
                  alt={seal.name || '古籍印章'}
                  style={style}
                  onMouseEnter={() => setHoveredSealId(seal.id)}
                  onMouseLeave={() => setHoveredSealId(null)}
                  onClick={(e) => handleRerollSingleSeal(seal.id, e)}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  className={`transition-all duration-200 select-none ${
                    hoveredSealId === seal.id ? 'scale-110 drop-shadow-md ring-1 ring-amber-700/50' : ''
                  }`}
                  title={`${seal.name || '印章'}（点击随机换一枚）`}
                  onError={(e) => {
                    // 图片加载失败时隐藏，防止出现破图
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);

AncientBookmarkPaper.displayName = 'AncientBookmarkPaper';

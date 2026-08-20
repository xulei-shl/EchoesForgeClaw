import React, { useState } from 'react';
import { RefreshCw, Stamp } from 'lucide-react';
import { getReceiptTheme } from '../../themes';
import { generateRandomSeals, getRandomSealSrc } from '../../sealGenerator';
import type { ReceiptSealItem, ReceiptState } from '../../types';
import { stopEvent } from './common/stopEvent';
import { AncientVerticalLayout } from '../../../../../platform/components/ui/AncientVerticalLayout';

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
 * 2. 书眉天头区（顶部）：系列丛书名 + 书名卷次 + 著者责任者；
 * 3. 版心区（左侧）：上象鼻细线 + 上鱼尾 + 竖排版心题名与叶码 + 下鱼尾 + 下象鼻细线；
 * 4. 正文区（右侧）：基于通用 AncientVerticalLayout 实现原生 vertical-rl 竖排流、乌丝栏与朱圈/朱点句读；
 * 5. 随机印章体系：从 39 枚古籍真迹印章中随机抽取分布，支持正片叠底（multiply）、旋转角度与一键「重新盖印」。
 */
export const AncientBookmarkPaper = React.forwardRef<HTMLDivElement, AncientBookmarkPaperProps>(
  ({ state, onChange, disabled = false }, ref) => {
    const theme = getReceiptTheme(state.themeId || 'ancient');
    const [hoveredSealId, setHoveredSealId] = useState<string | null>(null);
    const [isEditingExcerpt, setIsEditingExcerpt] = useState<boolean>(false);

    // 字体栈：优先汇文明朝体与又又意宋
    const minchoFontFamily =
      "'Huiwen-mincho', 'Huiwen Mincho', '又又意宋', 'Shippori Mincho B1', 'Shippori Mincho', 'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', serif";

    const excerptText =
      state.bookmarkExcerpt ||
      '起著雍摄提格，尽玄黓困敦。初命晋大夫魏斯、赵籍、韩虔为诸侯。臣光曰：臣闻天子之职莫大于礼，礼莫大于分，分莫大于名。';

    // 确保有印章数据
    const seals = state.seals && state.seals.length > 0 ? state.seals : generateRandomSeals();

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
            rotate: 0,
          };
        }
        return s;
      });
      onChange({ seals: nextSeals });
    };

    // 固定使用宣纸真迹肌理背景图 (paper.jpg)
    const paperBackgroundStyle: React.CSSProperties = {
      backgroundColor: '#f6f1e6',
      backgroundImage: 'url("/assets/receipt/paper.jpg")',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };

    return (
      <div
        ref={ref}
        data-receipt-paper="true"
        className="relative w-[300px] min-h-[640px] h-[640px] mx-auto my-2 select-text transition-colors duration-300 font-sans overflow-hidden group"
        style={{
          ...paperBackgroundStyle,
          border: `4px solid ${theme.text}`,
          padding: '4px',
          boxShadow: '4px 10px 20px rgba(0, 0, 0, 0.25), inset 0 0 16px rgba(139, 69, 19, 0.15)',
          color: theme.text,
        }}
      >
        {/* 顶部悬浮「重置印谱」快捷按钮（下移至天头下方，不遮挡书眉文字；导出时自动过滤） */}
        <div
          data-export-ignore="true"
          className={`absolute top-10 right-2 z-30 transition-opacity flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded shadow backdrop-blur-xs select-none ${
            disabled
              ? 'opacity-40 bg-black/40 text-white/50 cursor-not-allowed pointer-events-none'
              : 'opacity-0 group-hover:opacity-100 bg-black/70 hover:bg-black/85 text-white/90 cursor-pointer'
          }`}
          onClick={disabled ? undefined : handleRerollAllSeals}
          title={disabled ? '有下级节点，不可重置印谱' : '点击随机重置 6~14 枚印章，重新排布大小与位置'}
        >
          <Stamp size={11} className={disabled ? 'text-gray-400' : 'text-amber-300'} />
          <span>重置印谱</span>
          <RefreshCw size={10} className={disabled ? '' : 'hover:rotate-180 transition-transform duration-300'} />
        </div>

        {/* 内框 Inner Frame */}
        <div
          className="relative w-full h-full flex flex-col overflow-hidden"
          style={{
            border: `1.2px solid ${theme.text}`,
          }}
        >
          {/* ========== 1. 古籍书眉天头区 (Top Shumei Header Bar) ========== */}
          <div
            className="w-full h-[32px] shrink-0 flex flex-row items-center justify-between px-3 select-none relative z-10"
            style={{
              borderBottom: `1px solid color-mix(in srgb, ${theme.text} 65%, transparent)`,
              fontFamily: minchoFontFamily,
            }}
          >
            {/* 左侧：丛书/系列名（如 欽定四庫全書） */}
            <input
              type="text"
              value={state.seriesTitle || '欽定四庫全書'}
              disabled={disabled}
              onChange={(e) => onChange({ seriesTitle: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              placeholder="系列丛书"
              style={{ color: theme.text }}
              className="text-[12px] font-medium tracking-[3px] bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed max-w-[100px]"
              title="书眉系列名（点击编辑）"
            />

            {/* 中间：书名与卷次 */}
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={state.storeName || '資治通鑑'}
                disabled={disabled}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange({ storeName: val, banxinTitle: `${val}${state.bookmarkVolume || '卷一'}` });
                }}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="书名"
                style={{ color: theme.text }}
                className="text-[13px] font-bold tracking-[2px] text-center bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed max-w-[100px]"
                title="书名（点击编辑）"
              />
              <input
                type="text"
                value={state.bookmarkVolume || '卷第一'}
                disabled={disabled}
                onChange={(e) => onChange({ bookmarkVolume: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="卷次"
                style={{ color: theme.text }}
                className="text-[12px] font-medium tracking-wider text-center bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed max-w-[50px] opacity-90"
                title="卷次（点击编辑）"
              />
            </div>

            {/* 右侧：责任者署名 */}
            <span
              className="text-[11px] opacity-80 tracking-widest truncate max-w-[70px]"
              title="著者责任者"
            >
              {state.metaFields?.find((f) => f.key === 'author')?.value || '司马光'} 撰
            </span>
          </div>

          {/* ========== 2. 雕版正文与版心区 (Body Area) ========== */}
          <div className="grow flex flex-row overflow-hidden relative">
            {/* ---------- 左侧：版心与中缝 (Banxin Area) ---------- */}
            <div
              className="w-[36px] shrink-0 flex flex-col items-center py-2 select-none relative z-10"
              style={{
                borderRight: `1px solid ${theme.text}`,
              }}
            >
              {/* 上象鼻线 */}
              <div
                className="w-[1.2px] grow"
                style={{ backgroundColor: theme.text }}
              />

              {/* 上鱼尾 (黑鱼尾) */}
              <div
                className="w-[16px] h-[22px] my-0.5 shrink-0 transition-opacity"
                style={{
                  backgroundColor: theme.text,
                  clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 65%, 0 100%)',
                  opacity: 0.9,
                }}
                title="版心上鱼尾"
              />

              {/* 版心题名 */}
              <div className="my-1 py-0.5 flex flex-col items-center justify-center">
                <input
                  type="text"
                  value={state.banxinTitle || `${state.storeName || '資治通鑑'}${state.bookmarkVolume || '卷一'}`}
                  disabled={disabled}
                  onChange={(e) => onChange({ banxinTitle: e.target.value })}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="版心"
                  style={{
                    fontFamily: minchoFontFamily,
                    color: theme.text,
                    writingMode: 'vertical-lr',
                    letterSpacing: '3px',
                  }}
                  className="text-[12px] font-medium text-center bg-transparent outline-none border-r border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed max-h-[140px]"
                  title="版心书名（点击编辑）"
                />
                {/* 古代叶码 */}
                <input
                  type="text"
                  value={state.leafNumber || '一'}
                  disabled={disabled}
                  onChange={(e) => onChange({ leafNumber: e.target.value })}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="叶码"
                  style={{
                    fontFamily: minchoFontFamily,
                    color: theme.text,
                    writingMode: 'vertical-lr',
                  }}
                  className="text-[11px] text-center bg-transparent outline-none border-r border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed mt-1 opacity-80"
                  title="版心叶码（点击编辑）"
                />
              </div>

              {/* 下鱼尾 (黑鱼尾) */}
              <div
                className="w-[16px] h-[22px] my-0.5 shrink-0 transition-opacity"
                style={{
                  backgroundColor: theme.text,
                  clipPath: 'polygon(0 0, 50% 35%, 100% 0, 100% 100%, 0 100%)',
                  opacity: 0.9,
                }}
                title="版心下鱼尾"
              />

              {/* 下象鼻线 */}
              <div
                className="w-[1.2px] grow"
                style={{ backgroundColor: theme.text }}
              />
            </div>

            {/* ---------- 右侧：通用古籍竖排正文流 (Ancient Vertical Content Flow) ---------- */}
            <div className="grow relative overflow-hidden p-2">
              {isEditingExcerpt && !disabled ? (
                <div className="absolute inset-0 z-30 bg-amber-50/95 p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[11px] text-amber-900 border-b border-amber-200 pb-1">
                    <span>编辑古籍正文与文摘（标点自动转换为朱笔句读）</span>
                    <button
                      type="button"
                      onClick={() => setIsEditingExcerpt(false)}
                      className="px-2 py-0.5 bg-amber-800 text-white rounded text-[10px]"
                    >
                      完成
                    </button>
                  </div>
                  <textarea
                    autoFocus
                    value={state.bookmarkExcerpt || ''}
                    onBlur={() => setIsEditingExcerpt(false)}
                    onChange={(e) => onChange({ bookmarkExcerpt: e.target.value })}
                    onMouseDown={stopEvent}
                    onPointerDown={stopEvent}
                    rows={12}
                    className="w-full grow bg-transparent outline-none resize-none text-[13px] leading-relaxed font-serif"
                    placeholder="输入古籍文摘或图书简介正文..."
                  />
                </div>
              ) : null}

              <AncientVerticalLayout
                text={excerptText}
                bookTitle={`${state.storeName || '資治通鑑'}  ${state.bookmarkVolume || '卷第一'}`}
                authorName={`${state.metaFields?.find((f) => f.key === 'author')?.value || '司马光'} 撰`}
                footerNote={state.bookmarkExtra || '中华书局 谨印'}
                fontSize={13}
                columnWidth={30}
                letterSpacing={3.5}
                textColor={theme.text}
                puncColor="#b82828"
                showRuledLines={true}
                onClick={() => !disabled && setIsEditingExcerpt(true)}
                className="cursor-pointer"
                title={disabled ? undefined : '点击编辑正文与文摘（自动转换为古籍朱批句读）'}
              />
            </div>
          </div>
        </div>

            {/* ========== 3. 动态印章渲染图层（绝对定位 + 正片叠底） ========== */}
            {seals.map((seal: ReceiptSealItem) => {
              const style: React.CSSProperties = {
                position: 'absolute',
                mixBlendMode: 'multiply',
                zIndex: 20,
                width: seal.width ? `${seal.width}px` : '32px',
                opacity: seal.opacity ?? 0.85,
                pointerEvents: disabled ? 'none' : 'auto',
                cursor: disabled ? 'default' : 'pointer',
              };

              // 若具备归一化百分比坐标，采用中心锚点精确定位（无旋转倾斜）
              if (seal.leftPercent !== undefined && seal.topPercent !== undefined) {
                style.left = `${seal.leftPercent}%`;
                style.top = `${seal.topPercent}%`;
                style.transform = 'translate(-50%, -50%)';
              } else if (seal.positionPreset === 'top-right' || seal.id === 'seal-1') {
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
                  onMouseEnter={disabled ? undefined : () => setHoveredSealId(seal.id)}
                  onMouseLeave={disabled ? undefined : () => setHoveredSealId(null)}
                  onClick={disabled ? undefined : (e) => handleRerollSingleSeal(seal.id, e)}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  className={`transition-all duration-200 select-none ${
                    !disabled && hoveredSealId === seal.id ? 'scale-110 drop-shadow-md ring-1 ring-amber-700/50' : ''
                  }`}
                  title={disabled ? (seal.name || '古籍印章') : `${seal.name || '印章'}（点击随机换一枚）`}
                  onError={(e) => {
                    // 图片加载失败时隐藏，防止出现破图
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              );
            })}
      </div>
    );
  }
);

AncientBookmarkPaper.displayName = 'AncientBookmarkPaper';

import React, { useState } from 'react';
import { RefreshCw, Stamp } from 'lucide-react';
import { getReceiptTheme } from '../../themes';
import { generateRandomSeals, getRandomSealSrc } from '../../sealGenerator';
import {
  getAncientBookmarkWidthConfig,
  ANCIENT_BOOKMARK_WIDTH_OPTIONS,
  type ReceiptSealItem,
  type ReceiptState,
} from '../../types';
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
 * 4. 版心中缝留白：版心右侧固定 1 列乌丝栏留白栏，消除“左密右疏”，提供优雅呼吸感；
 * 5. 正文区（右侧）：基于通用 AncientVerticalLayout 实现原生 vertical-rl 竖排流、乌丝栏与朱圈/朱点句读；
 * 6. 多规格支持：窄版(300px) / 标准版(380px) / 宽版(460px) / 长卷版(540px) 动态切换；
 * 7. 随机印章体系：从 39 枚古籍真迹印章中随机抽取分布，支持正片叠底（multiply）、旋转角度与一键「重新盖印」。
 */
export const AncientBookmarkPaper = React.forwardRef<HTMLDivElement, AncientBookmarkPaperProps>(
  ({ state, onChange, disabled = false }, ref) => {
    const theme = getReceiptTheme(state.themeId || 'ancient');
    const widthConfig = getAncientBookmarkWidthConfig(state.bookmarkWidth);
    const [hoveredSealId, setHoveredSealId] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [focusTarget, setFocusTarget] = useState<'title' | 'author' | 'excerpt' | 'banxin' | 'extra' | 'all'>('all');

    // 字体栈：优先汇文明朝体与又又意宋
    const minchoFontFamily =
      "'Huiwen-mincho', 'Huiwen Mincho', '又又意宋', 'Shippori Mincho B1', 'Shippori Mincho', 'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', serif";

    const excerptText =
      state.bookmarkExcerpt ||
      '起著雍摄提格，尽玄黓困敦。初命晋大夫魏斯、赵籍、韩虔为诸侯。臣光曰：臣闻天子之职莫大于礼，礼莫大于分，分莫大于名。';

    const authorValue = state.metaFields?.find((f) => f.key === 'author')?.value || '司马光';
    const authorDisplay = authorValue.includes('撰') || authorValue.includes('著') ? authorValue : `${authorValue} 撰`;

    // 确保有印章数据
    const seals = state.seals && state.seals.length > 0 ? state.seals : generateRandomSeals();

    // 开启指定字段的编辑浮层并聚焦
    const handleOpenEdit = (target: 'title' | 'author' | 'excerpt' | 'banxin' | 'extra' | 'all' = 'all') => {
      if (disabled) return;
      setFocusTarget(target);
      setIsEditing(true);
    };

    // 更新责任者/作者
    const handleUpdateAuthor = (newAuthor: string) => {
      if (disabled) return;
      const metaFields = [...(state.metaFields || [])];
      const idx = metaFields.findIndex((f) => f.key === 'author');
      if (idx >= 0) {
        metaFields[idx] = { ...metaFields[idx], value: newAuthor };
      } else {
        metaFields.push({ key: 'author', label: '作者', value: newAuthor, visible: true });
      }
      onChange({ metaFields });
    };

    // 更新书名/题名
    const handleUpdateTitle = (newTitle: string) => {
      if (disabled) return;
      const metaFields = [...(state.metaFields || [])];
      const idx = metaFields.findIndex((f) => f.key === 'title');
      if (idx >= 0) {
        metaFields[idx] = { ...metaFields[idx], value: newTitle };
      } else {
        metaFields.push({ key: 'title', label: '书名', value: newTitle, visible: true });
      }
      const patch: Partial<ReceiptState> = { storeName: newTitle, metaFields };
      if (!state.banxinTitle || state.banxinTitle === (state.storeName || '資治通鑑')) {
        patch.banxinTitle = newTitle;
      }
      onChange(patch);
    };

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
        className="relative min-h-[640px] h-[640px] mx-auto my-2 select-text transition-all duration-300 font-sans overflow-hidden group shrink-0"
        style={{
          ...paperBackgroundStyle,
          width: `${widthConfig.domWidth}px`,
          minWidth: `${widthConfig.domWidth}px`,
          border: `4px solid ${theme.text}`,
          padding: '4px',
          boxShadow: '4px 10px 20px rgba(0, 0, 0, 0.25), inset 0 0 16px rgba(139, 69, 19, 0.15)',
          color: theme.text,
        }}
      >
        {/* 顶部悬浮「重置印谱」快捷按钮（导出时自动过滤） */}
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
          {/* ========== 雕版正文与版心区 (Body Area) ========== */}
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
                  value={state.banxinTitle || state.storeName || '資治通鑑'}
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
                  title="版心书名（点击就地编辑，或点击右侧进入全元素面板）"
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

            {/* ---------- 版心与正文之间的固定空白留白竖栏 (Blank Buffer Column) ---------- */}
            <div
              className="w-[30px] shrink-0 h-full select-none pointer-events-none"
              style={{
                borderRight: `1px solid color-mix(in srgb, ${theme.text} 35%, transparent)`,
              }}
              title="版心与正文留白栏"
            />

            {/* ---------- 右侧：通用古籍竖排正文流 (Ancient Vertical Content Flow) ---------- */}
            <div className="grow relative overflow-hidden py-2 pr-2 pl-0">
              <AncientVerticalLayout
                text={excerptText}
                bookTitle={state.storeName || '資治通鑑'}
                authorName={authorDisplay}
                footerNote={state.bookmarkExtra || '中华书局 谨印'}
                fontSize={13}
                columnWidth={30}
                letterSpacing={3.5}
                textColor={theme.text}
                puncColor="#b82828"
                showRuledLines={true}
                onTitleClick={() => handleOpenEdit('title')}
                onAuthorClick={() => handleOpenEdit('author')}
                onTextClick={() => handleOpenEdit('excerpt')}
                onFooterClick={() => handleOpenEdit('extra')}
                titleTooltip="点击编辑古籍题名"
                authorTooltip="点击编辑著者责任者"
                textTooltip="点击编辑正文文摘（自动朱批句读）"
                footerTooltip="点击编辑校勘跋文印记"
              />
            </div>
          </div>
        </div>

        {/* ========== 4. 全元素结构化编辑浮层 (Full-Element Drawer / Modal) ========== */}
        {isEditing && !disabled && (
          <div
            data-export-ignore="true"
            className="absolute inset-1 z-30 bg-paper/95 backdrop-blur-md p-3 flex flex-col rounded shadow-2xl border border-paper-grid overflow-hidden text-ink select-text"
          >
            {/* 顶栏：标题与完成按钮 */}
            <div className="flex items-center justify-between border-b border-paper-grid pb-2 mb-2 shrink-0">
              <span className="text-[12px] font-bold text-ink flex items-center gap-1">
                <span>编辑古籍排版元素</span>
              </span>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-2.5 py-0.5 bg-accent hover:bg-accent-hover active:bg-accent text-white rounded text-[11px] font-medium shadow-xs transition-colors"
              >
                完成
              </button>
            </div>

            {/* 表单内容区 */}
            <div className="grow overflow-y-auto space-y-2.5 pr-0.5 text-[11px]">
              {/* 版式规格选择 */}
              <div>
                <label className="block font-semibold text-ink mb-1">
                  版式规格（宽度与容量）
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {ANCIENT_BOOKMARK_WIDTH_OPTIONS.map((opt) => {
                    const isSelected = (state.bookmarkWidth || 'standard') === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onChange({ bookmarkWidth: opt.id })}
                        className={`px-2 py-1.5 text-left rounded border transition-all text-[11px] ${
                          isSelected
                            ? 'bg-accent text-white border-accent shadow-xs font-semibold'
                            : 'bg-paper border-paper-grid text-ink hover:border-accent/50 hover:bg-paper-grid/30'
                        }`}
                      >
                        <div className="font-serif leading-tight">{opt.label}</div>
                        <div className={`text-[9px] mt-0.5 ${isSelected ? 'text-white/80' : 'text-ink-faint'}`}>
                          {opt.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 1. 第一栏：题名 / 书名 */}
              <div>
                <label className="block font-semibold text-ink mb-0.5">
                  第一栏：题名 / 书名
                </label>
                <input
                  type="text"
                  autoFocus={focusTarget === 'title'}
                  value={state.storeName || ''}
                  onChange={(e) => handleUpdateTitle(e.target.value)}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="输入古籍题名（如：資治通鑑）"
                  className="w-full px-2 py-1 bg-paper/80 border border-paper-grid focus:border-accent focus:bg-paper focus:ring-1 focus:ring-accent/30 rounded outline-none text-[12px] font-serif transition-all text-ink"
                />
              </div>

              {/* 2. 第二栏：著者 / 责任者 */}
              <div>
                <label className="block font-semibold text-ink mb-0.5">
                  第二栏：著者 / 责任者
                </label>
                <input
                  type="text"
                  autoFocus={focusTarget === 'author'}
                  value={state.metaFields?.find((f) => f.key === 'author')?.value || ''}
                  onChange={(e) => handleUpdateAuthor(e.target.value)}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="著者署名（如：司马光 或 [俄] 列夫·托尔斯泰）"
                  className="w-full px-2 py-1 bg-paper/80 border border-paper-grid focus:border-accent focus:bg-paper focus:ring-1 focus:ring-accent/30 rounded outline-none text-[12px] font-serif transition-all text-ink"
                />
              </div>

              {/* 3. 左侧：版心题名 */}
              <div>
                <label className="block font-semibold text-ink mb-0.5">
                  左侧：版心题名
                </label>
                <input
                  type="text"
                  autoFocus={focusTarget === 'banxin'}
                  value={state.banxinTitle || ''}
                  onChange={(e) => onChange({ banxinTitle: e.target.value })}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="中缝版心文字（留空默认同书名）"
                  className="w-full px-2 py-1 bg-paper/80 border border-paper-grid focus:border-accent focus:bg-paper focus:ring-1 focus:ring-accent/30 rounded outline-none text-[12px] font-serif transition-all text-ink"
                />
              </div>

              {/* 4. 第三栏起：正文与文摘 */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="font-semibold text-ink">
                    第三栏起：正文文摘
                  </label>
                  <span className="text-[10px] text-ink-faint">标点自动朱批句读</span>
                </div>
                <textarea
                  autoFocus={focusTarget === 'excerpt'}
                  rows={6}
                  value={state.bookmarkExcerpt || ''}
                  onChange={(e) => onChange({ bookmarkExcerpt: e.target.value })}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="输入古籍正文或图书文摘..."
                  className="w-full p-2 bg-paper/80 border border-paper-grid focus:border-accent focus:bg-paper focus:ring-1 focus:ring-accent/30 rounded outline-none text-[12px] leading-relaxed resize-none font-serif transition-all text-ink"
                />
              </div>

              {/* 5. 尾列：校勘跋文 / 出品印记 */}
              <div>
                <label className="block font-semibold text-ink mb-0.5">
                  尾列：校勘跋文 / 印记
                </label>
                <input
                  type="text"
                  autoFocus={focusTarget === 'extra'}
                  value={state.bookmarkExtra || ''}
                  onChange={(e) => onChange({ bookmarkExtra: e.target.value })}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="尾列小字题跋（如：中华书局 谨印）"
                  className="w-full px-2 py-1 bg-paper/80 border border-paper-grid focus:border-accent focus:bg-paper focus:ring-1 focus:ring-accent/30 rounded outline-none text-[12px] font-serif transition-all text-ink"
                />
              </div>
            </div>
          </div>
        )}

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
                    !disabled && hoveredSealId === seal.id ? 'scale-110 drop-shadow-md ring-1 ring-accent/60' : ''
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

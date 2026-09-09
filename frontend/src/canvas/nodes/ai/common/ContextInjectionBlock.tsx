import React, { memo, useState } from 'react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import { ChevronDown, ChevronUp, Link2 } from 'lucide-react';
import type { InjectedContextBlock } from '../../../../shared/types';

/**
 * 注入上下文折叠块（chat / 图像生成 等节点共用）：与 ReasoningBlock 体验一致，
 * 弱化样式、默认收起，支持文本与图片预览。
 */
const ContextInjectionBlockInner: React.FC<{
  block: InjectedContextBlock;
}> = memo(({ block }) => {
  const [open, setOpen] = useState(false);
  const text = block.text?.trim() || '';
  const images = block.images || [];
  const hasText = text.length > 0;
  const hasImages = images.length > 0;

  // 单行摘要预览
  const tailText = hasText
    ? text.slice(-40).replace(/\n/g, ' ')
    : !hasImages
      ? '(暂无内容)'
      : '';
  const imageCountText = hasImages ? `[${images.length}张图片]` : '';

  return (
    <div className="w-full mb-1.5 rounded-lg border border-dashed border-paper-grid/80 bg-paper-grid/15 overflow-hidden msg-enter-anim">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-ink-faint hover:text-ink-light font-sans transition-colors overflow-hidden"
        title={open ? `收起上下文：${block.title}` : `展开上下文：${block.title}`}
      >
        <Link2 size={11} strokeWidth={1.75} className={open ? 'text-accent shrink-0' : 'shrink-0'} />
        <span className={`font-medium shrink-0 ${open ? 'text-ink-light' : ''}`}>
          上下文注入 · {block.title}
        </span>

        {!open && (imageCountText || tailText) && (
          <span className="flex-1 min-w-0 mx-1 overflow-hidden whitespace-nowrap text-right mask-gradient-left text-ink-faint/70 select-none">
            {imageCountText} {tailText}
          </span>
        )}

        <span className={`flex items-center gap-1 shrink-0 ${open || (!imageCountText && !tailText) ? 'ml-auto' : ''}`}>
          {open ? (
            <ChevronUp size={11} strokeWidth={2} />
          ) : (
            <ChevronDown size={11} strokeWidth={2} />
          )}
        </span>
      </button>

      {/* grid-rows 0fr/1fr 过渡：折叠/展开平滑动画 */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-2.5 pb-2 pt-1 border-t border-dashed border-paper-grid/50 space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
            {hasImages && (
              <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
                <div className="flex flex-wrap gap-1.5">
                  {images.map((img, i) => (
                    <PhotoView key={i} src={img}>
                      <img
                        src={img}
                        alt={`上下文图片 ${i + 1}`}
                        className="w-14 h-14 rounded-md object-cover cursor-zoom-in border border-paper-grid shadow-sm hover:opacity-90 active:scale-95 transition"
                        loading="lazy"
                      />
                    </PhotoView>
                  ))}
                </div>
              </PhotoProvider>
            )}
            {hasText ? (
              <pre className="text-[11px] text-ink-light font-sans whitespace-pre-wrap leading-relaxed">
                {text}
              </pre>
            ) : !hasImages ? (
              <p className="text-[10px] text-ink-faint font-sans italic">
                （上级节点暂无输出内容）
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});
ContextInjectionBlockInner.displayName = 'ContextInjectionBlock';

export const ContextInjectionBlock = ContextInjectionBlockInner;
export default ContextInjectionBlock;

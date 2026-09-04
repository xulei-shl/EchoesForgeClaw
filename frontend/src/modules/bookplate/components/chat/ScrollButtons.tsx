import { memo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const ScrollButton = memo(({ direction, onClick, title }: {
  direction: 'up' | 'down'; onClick: () => void; title: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={title}
    title={title}
    className="pointer-events-auto flex items-center justify-center w-8 h-8 rounded-full bg-paper/95 border border-paper-grid/70 shadow-sm text-ink-faint hover:text-ink hover:bg-paper-grid/60 hover:shadow backdrop-blur-md transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
  >
    {direction === 'up' ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
  </button>
));
ScrollButton.displayName = 'ScrollButton';

/** 消息区悬浮滚动按钮组（回到顶部 / 回到底部），显隐由父级滚动状态驱动。 */
export const ScrollButtons = memo(({ showTop, showBottom, onScrollTop, onScrollBottom }: {
  showTop: boolean;
  showBottom: boolean;
  onScrollTop: () => void;
  onScrollBottom: () => void;
}) => (
  <div className="absolute right-3.5 bottom-14 flex flex-col gap-1.5 z-20 pointer-events-none">
    <div className={`transition-[opacity,transform] duration-200 ease-out ${showTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
      <ScrollButton direction="up" onClick={onScrollTop} title="回到顶部" />
    </div>
    <div className={`transition-[opacity,transform] duration-200 ease-out ${showBottom ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
      <ScrollButton
        direction="down"
        onClick={onScrollBottom}
        title="回到底部"
      />
    </div>
  </div>
));
ScrollButtons.displayName = 'ScrollButtons';
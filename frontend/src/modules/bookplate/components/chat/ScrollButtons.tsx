import { memo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const ScrollButton = memo(({ direction, onClick, title }: {
  direction: 'up' | 'down'; onClick: () => void; title: string;
}) => (
  <button
    onClick={onClick}
    className="pointer-events-auto flex items-center justify-center w-7 h-7 rounded-full bg-paper/90 border border-paper-grid/60 shadow-sm text-ink-faint hover:text-ink hover:bg-paper-grid hover:shadow backdrop-blur-md transition-all active:scale-[0.96]"
    title={title}
  >
    {direction === 'up' ? <ChevronUp size={16} strokeWidth={2} /> : <ChevronDown size={16} strokeWidth={2} />}
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
  <div className="absolute right-4 bottom-14 flex flex-col gap-2 z-20 pointer-events-none">
    <div className={`transition-all duration-200 ${showTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
      <ScrollButton direction="up" onClick={onScrollTop} title="回到顶部" />
    </div>
    <div className={`transition-all duration-200 ${showBottom ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
      <ScrollButton
        direction="down"
        onClick={onScrollBottom}
        title="回到底部"
      />
    </div>
  </div>
));
ScrollButtons.displayName = 'ScrollButtons';
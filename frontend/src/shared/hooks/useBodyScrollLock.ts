import { useEffect } from 'react';

/**
 * 统一的 Body 背景滚动锁定 Hook：
 * - 当 locked 为 true 时，锁定 body 滚动 (overflow = 'hidden')；
 * - 针对 Windows 桌面环境计算滚动条宽度差额，动态补偿 paddingRight，杜绝 17px 剧烈重排与抖动；
 * - 卸载或关闭时精准复原原始样式。
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [locked]);
}

import { useEffect, useRef, useState } from 'react';

/**
 * 打字机平滑渲染（借鉴 Proma useSmoothStream 的简化版）：
 *
 * 流式增量直接 setState 会导致正文以不均匀的块状跳动；本 hook 维护一个
 * 「已展示长度」游标，rAF 循环按剩余量动态加速追赶目标文本（剩余越多步进越大，
 * 保证高吞吐时不清屏积压、低吞吐时不卡顿），流结束后一次性补齐。
 *
 * 仅用于正在流式输出的最后一条 assistant 消息；历史消息 enabled=false 直接原文返回。
 */
export function useSmoothStream(target: string, active: boolean, enabled = true): string {
  const [shownLen, setShownLen] = useState<number>(() => (enabled && active ? 0 : target.length));
  const shownLenRef = useRef(shownLen);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // 非平滑模式 / 非活跃（历史消息或流已结束）：立即对齐全文
    if (!enabled || !active) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      shownLenRef.current = target.length;
      setShownLen(target.length);
      return;
    }
    // 新一轮开始：目标变短（重置）时游标归零
    if (target.length < shownLenRef.current) {
      shownLenRef.current = 0;
      setShownLen(0);
    }
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      const remaining = target.length - shownLenRef.current;
      if (remaining <= 0) return; // 已追平，等待下次 target 变化重启 effect
      // 动态步进：剩余 1/6，下限 2 字符——长段积压加速排空，尾部细腻
      const step = Math.max(2, Math.ceil(remaining / 6));
      shownLenRef.current = Math.min(target.length, shownLenRef.current + step);
      setShownLen(shownLenRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, active, enabled]);

  return enabled ? target.slice(0, shownLen) : target;
}

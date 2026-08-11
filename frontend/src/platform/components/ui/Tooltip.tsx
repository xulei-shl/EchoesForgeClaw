import React, { useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content?: string;
  children: React.ReactNode;
}

export const Tooltip: React.FC<TooltipProps & Record<string, any>> = ({ content, children, ...rest }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLElement>(null);

  if (!content) return <>{React.cloneElement(children as React.ReactElement<any>, rest)}</>;

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
      setIsVisible(true);
    }
  };

  // 组合 ref：既保留子元素原有的 ref（部分调用方用于弹层定位等），也让 Tooltip 自身的
  // triggerRef（hover 定位）生效。此前 cloneElement 直接覆写 ref，导致子元素 ref 永久为 null
  // （如 AI 对话节点「对话设置」按钮的定位 ref，点击后弹层渲染在视口左上角外，表现为点击无效）。
  const composeRef = (node: HTMLElement | null) => {
    triggerRef.current = node;
    const childRef = (children as React.ReactElement<any>).props?.ref;
    if (typeof childRef === 'function') {
      childRef(node);
    } else if (childRef && typeof childRef === 'object') {
      childRef.current = node;
    }
  };

  return (
    <>
      {React.cloneElement(children as React.ReactElement<any>, {
        ...rest,
        ref: composeRef,
        onMouseEnter: (e: any) => {
          handleMouseEnter();
          (children as any).props.onMouseEnter?.(e);
        },
        onMouseLeave: (e: any) => {
          setIsVisible(false);
          (children as any).props.onMouseLeave?.(e);
        },
      })}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isVisible && (
              <div
                className="fixed z-[9999] pointer-events-none"
                style={{ left: coords.x, top: coords.y }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 0, scale: 0.95 }}
                  animate={{ opacity: 1, y: -4, scale: 1 }}
                  exit={{ opacity: 0, y: 0, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-max max-w-xs px-2.5 py-1.5 bg-paper border border-dashed border-paper-grid rounded-md shadow-[0_4px_12px_rgba(43,41,38,0.08)] text-xs text-ink text-center"
                >
                  {content}
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
};

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

  return (
    <>
      {React.cloneElement(children as React.ReactElement<any>, {
        ...rest,
        ref: triggerRef,
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
                  className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2.5 py-1.5 bg-paper border border-dashed border-paper-grid rounded-md shadow-[0_4px_12px_rgba(43,41,38,0.08)] text-xs text-ink whitespace-nowrap"
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

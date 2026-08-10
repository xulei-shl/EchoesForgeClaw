import React from 'react';
import { AlertTriangle, CircleAlert, CircleCheck, Info } from 'lucide-react';

export type ToastType = 'info' | 'success' | 'error' | 'warning';
export type ToastPosition = 'bottom-center' | 'top-right';

interface ToastProps {
  text: string;
  type?: ToastType;
  position?: ToastPosition;
}

const TOAST_ICON: Record<ToastType, React.ReactNode> = {
  info: <Info size={15} strokeWidth={1.75} />,
  success: <CircleCheck size={15} strokeWidth={1.75} />,
  error: <CircleAlert size={15} strokeWidth={1.75} />,
  warning: <AlertTriangle size={15} strokeWidth={1.75} />,
};

const TOAST_COLOR: Record<ToastType, string> = {
  info: 'text-accent',
  success: 'text-success',
  error: 'text-error',
  warning: 'text-warning',
};

/**
 * 全局统一的轻提示：纸张质感 + 虚线边框 + 类型图标，
 * 与全站「藏书票」设计语言保持一致，由 FeedbackProvider 统一渲染。
 */
export const Toast: React.FC<ToastProps> = ({ text, type = 'info', position = 'bottom-center' }) => (
  <div
    role="status"
    className={`fixed z-[60] ${
      position === 'top-right' ? 'top-20 right-5' : 'bottom-8 left-1/2 -translate-x-1/2'
    }`}
  >
    <div className="toast-in flex items-center gap-2 px-4 py-2 bg-node-bg border border-dashed border-paper-grid rounded-md shadow-[0_4px_16px_rgba(43,41,38,0.10)] text-sm text-ink font-sans">
      <span className={`shrink-0 ${TOAST_COLOR[type]}`}>{TOAST_ICON[type]}</span>
      <span className="whitespace-pre-wrap">{text}</span>
    </div>
  </div>
);

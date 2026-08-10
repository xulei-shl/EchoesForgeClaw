import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Input } from './Input';
import { Toast, type ToastPosition, type ToastType } from './Toast';

/* ========== 弹窗 ========== */

export interface DialogBaseOptions {
  /** 标题，缺省显示「提示」 */
  title?: React.ReactNode;
  /** 正文内容 */
  message?: React.ReactNode;
  /** 确认按钮文案 */
  confirmText?: string;
  /** 取消按钮文案（仅 confirm / prompt） */
  cancelText?: string;
  /** 危险操作：确认按钮使用警示样式 */
  danger?: boolean;
}

interface PendingDialog extends DialogBaseOptions {
  kind: 'alert' | 'confirm' | 'prompt';
  defaultValue?: string;
  placeholder?: string;
}

/* ========== 轻提示 ========== */

export interface ToastOptions {
  /** 提示类型（决定图标与颜色），缺省 info */
  type?: ToastType;
  /** 显示位置，缺省底部居中 */
  position?: ToastPosition;
  /** 自动关闭时长（毫秒），缺省 2600 */
  duration?: number;
}

interface PendingToast {
  id: number;
  text: string;
  type: ToastType;
  position: ToastPosition;
}

/* ========== 统一 API ========== */

export interface FeedbackApi {
  /** 弹窗（替代浏览器原生 alert / confirm / prompt） */
  dialog: {
    /** 轻提示弹窗（单按钮），返回 Promise<void> */
    alert: (options?: DialogBaseOptions) => Promise<void>;
    /** 确认框，返回用户是否确认 */
    confirm: (options: DialogBaseOptions) => Promise<boolean>;
    /** 输入框，取消 / Esc / 点击遮罩时返回 null */
    prompt: (options: DialogBaseOptions & { defaultValue?: string; placeholder?: string }) => Promise<string | null>;
  };
  /** 轻提示 toast；连续调用会替换上一条 */
  showToast: (text: string, options?: ToastOptions) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

/** 读取全局反馈 API（弹窗 + 轻提示），必须在 <FeedbackProvider> 内使用 */
export const useFeedback = (): FeedbackApi => {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error('useFeedback 必须在 <FeedbackProvider> 内使用');
  }
  return ctx;
};

/**
 * 全局反馈 Provider：统一管理弹窗（alert / confirm / prompt）与轻提示（toast），
 * 替代浏览器原生弹窗并统一全站视觉风格。在应用根部挂载一次即可。
 */
export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  /* ---------- 弹窗状态 ---------- */
  const [dialog, setDialog] = useState<PendingDialog | null>(null);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // 待决 Promise 的 resolve，避免在 state updater 内产生副作用
  const resolveRef = useRef<((value: boolean | string | null) => void) | null>(null);

  /* ---------- 轻提示状态 ---------- */
  const [toast, setToast] = useState<PendingToast | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);

  const requestDialog = useCallback(
    (options: PendingDialog) =>
      new Promise<boolean | string | null>((resolve) => {
        // 若已有弹窗未关闭，先以「取消」语义收尾，避免悬挂的 Promise
        // （用 null 收尾：confirm 的 if (!ok) 同样判假，prompt 的取消哨兵值也是 null）
        resolveRef.current?.(null);
        resolveRef.current = resolve;
        setDialog(options);
        setInputValue(options.kind === 'prompt' ? (options.defaultValue ?? '') : '');
      }),
    []
  );

  const closeDialog = useCallback((value: boolean | string | null) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setDialog(null);
  }, []);

  const handleDialogConfirm = useCallback(() => {
    if (!dialog) return;
    if (dialog.kind === 'prompt') closeDialog(inputValue);
    else closeDialog(dialog.kind !== 'alert');
  }, [dialog, inputValue, closeDialog]);

  const handleDialogCancel = useCallback(() => {
    if (!dialog) return;
    closeDialog(dialog.kind === 'prompt' ? null : false);
  }, [dialog, closeDialog]);

  const dismissToast = useCallback(() => {
    setToast(null);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
  }, []);

  const showToast = useCallback(
    (text: string, options?: ToastOptions) => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({
        id: ++toastIdRef.current,
        text,
        type: options?.type ?? 'info',
        position: options?.position ?? 'bottom-center',
      });
      toastTimerRef.current = window.setTimeout(dismissToast, options?.duration ?? 2600);
    },
    [dismissToast]
  );

  // 卸载时清理定时器
  useEffect(
    () => () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    },
    []
  );

  const value = useMemo<FeedbackApi>(
    () => ({
      dialog: {
        alert: (options = {}) => requestDialog({ ...options, kind: 'alert' }).then(() => undefined),
        confirm: (options) => requestDialog({ ...options, kind: 'confirm' }) as Promise<boolean>,
        prompt: (options) => requestDialog({ ...options, kind: 'prompt' }) as Promise<string | null>,
      },
      showToast,
    }),
    [requestDialog, showToast]
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <Dialog
        open={dialog !== null}
        onClose={handleDialogCancel}
        title={dialog?.title ?? '提示'}
        initialFocusRef={dialog?.kind === 'prompt' ? inputRef : confirmRef}
        footer={
          dialog ? (
            <>
              {dialog.kind !== 'alert' && (
                <Button type="button" variant="ghost" size="sm" onClick={handleDialogCancel}>
                  {dialog.cancelText ?? '取消'}
                </Button>
              )}
              <Button
                ref={confirmRef}
                type="button"
                size="sm"
                variant={dialog.danger ? 'danger' : 'primary'}
                onClick={handleDialogConfirm}
              >
                {dialog.confirmText ?? (dialog.kind === 'alert' ? '知道了' : '确定')}
              </Button>
            </>
          ) : null
        }
      >
        {dialog && (
          <>
            {dialog.message != null && (
              <p className="text-sm text-ink-light font-sans leading-relaxed whitespace-pre-wrap">
                {dialog.message}
              </p>
            )}

            {dialog.kind === 'prompt' && (
              <div className="mt-3">
                <Input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={dialog.placeholder}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleDialogConfirm();
                    }
                  }}
                />
              </div>
            )}
          </>
        )}
      </Dialog>

      {toast && <Toast key={toast.id} text={toast.text} type={toast.type} position={toast.position} />}
    </FeedbackContext.Provider>
  );
};

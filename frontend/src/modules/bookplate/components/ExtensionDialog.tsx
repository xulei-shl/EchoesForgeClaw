"use client";
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, CornerDownLeft, Keyboard, Send, Sparkles, X } from 'lucide-react';
import type { PendingUiRequest } from '../piStream';

/**
 * 扩展交互弹层（RPC dialog：select / confirm / input / editor）。
 *
 * - 由 PiChatNodeHost 的 pendingUi 驱动（SSE extension_ui_request 归约而来）。
 * - 逐题单实例：RPC walker 逐题阻塞，同轮最多一个请求；reducer 保证最新覆盖。
 * - 作答回调 (answer) 交给宿主写回 POST /chat/ui-response；cancelled 同样必须回写
 *   （RPC 协议要求 stdin 必须应答，否则 pi 工具挂起直到超时）。
 * - 前端 React 转义全部字段，无注入面。
 */

interface ExtensionDialogProps {
  request: PendingUiRequest | null;
  onAnswer: (
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean }
  ) => void;
}

export function ExtensionDialog({ request, onAnswer }: ExtensionDialogProps): React.ReactNode | null {
  return (
    <AnimatePresence mode="wait">
      {request && (
        <motion.div
          key={request.id}
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.99 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="shrink-0 my-2"
          role="region"
          aria-label="模型交互提问"
        >
          <div className="rounded-xl border border-accent/35 bg-paper/95 dark:bg-node-bg shadow-md backdrop-blur-xs overflow-hidden">
            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-accent/5 border-b border-accent/15">
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles size={13} className="shrink-0 text-accent" />
                <span className="text-xs font-semibold font-sans text-accent truncate">
                  {request.title || '模型提问'}
                </span>
              </div>
              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-accent/10 text-accent border border-accent/20">
                {request.method === 'confirm' ? '确认' : request.method === 'select' ? '选择' : '输入'}
              </span>
            </div>

            {/* 内容与操作区 */}
            <div className="px-3.5 py-3">
              {request.method === 'confirm' && <ConfirmBody request={request} onAnswer={onAnswer} />}
              {request.method === 'select' && <SelectBody request={request} onAnswer={onAnswer} />}
              {(request.method === 'input' || request.method === 'editor') && (
                <InputBody request={request} onAnswer={onAnswer} />
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ConfirmBody({
  request,
  onAnswer,
}: {
  request: PendingUiRequest;
  onAnswer: ExtensionDialogProps['onAnswer'];
}) {
  return (
    <div className="space-y-2.5">
      {request.message && (
        <p className="text-xs font-sans text-ink leading-relaxed select-text">
          {request.message}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onAnswer(request.id, { confirmed: true })}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium font-sans text-white hover:bg-accent/90 active:scale-[0.96] transition-transform shadow-xs cursor-pointer"
        >
          <Check size={13} strokeWidth={2.5} /> 是
        </button>
        <button
          type="button"
          onClick={() => onAnswer(request.id, { confirmed: false })}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-paper-grid bg-paper px-3.5 py-1.5 text-xs font-medium font-sans text-ink hover:border-accent/40 hover:text-accent hover:bg-accent/5 active:scale-[0.96] transition-transform cursor-pointer"
        >
          否
        </button>
        <div className="h-4 w-px bg-paper-grid/60 mx-0.5" />
        <button
          type="button"
          onClick={() => onAnswer(request.id, { cancelled: true })}
          className="inline-flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-sans text-ink-faint hover:text-error hover:bg-error/5 active:scale-[0.96] transition-transform cursor-pointer"
          title="取消本轮提问"
        >
          <X size={12} strokeWidth={2} /> 取消
        </button>
      </div>
    </div>
  );
}

function SelectBody({
  request,
  onAnswer,
}: {
  request: PendingUiRequest;
  onAnswer: ExtensionDialogProps['onAnswer'];
}) {
  const options = request.options ?? [];
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (customMode) inputRef.current?.focus();
  }, [customMode]);

  const submit = (value: string) => onAnswer(request.id, { value });

  return (
    <div className="space-y-2">
      {request.message && (
        <p className="text-xs font-sans text-ink leading-relaxed select-text">
          {request.message}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => submit(opt)}
            className="group flex items-center gap-1.5 rounded-lg border border-paper-grid bg-paper px-3 py-1.5 text-xs font-sans text-ink hover:border-accent/50 hover:bg-accent/5 hover:text-accent active:scale-[0.96] transition-transform cursor-pointer shadow-2xs"
          >
            <span>{opt}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomMode((v) => !v)}
          className={`group flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-sans active:scale-[0.96] transition-transform cursor-pointer ${
            customMode
              ? 'border-accent bg-accent/10 text-accent font-medium'
              : 'border-paper-grid bg-paper text-ink-faint hover:text-accent hover:border-accent/40'
          }`}
        >
          <Keyboard size={13} className={customMode ? 'text-accent' : 'text-ink-faint group-hover:text-accent'} />
          <span>自定义输入</span>
        </button>
      </div>

      <AnimatePresence>
        {customMode && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden pt-1"
          >
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = customText.trim();
                    if (v) {
                      setCustomMode(false);
                      setCustomText('');
                      submit(v);
                    }
                  }
                  if (e.key === 'Escape') {
                    setCustomMode(false);
                    setCustomText('');
                  }
                }}
                placeholder="输入回答后按 Enter 提交…"
                className="flex-1 min-w-0 rounded-lg border border-paper-grid bg-paper px-2.5 py-1.5 text-xs font-sans text-ink placeholder:text-ink-faint focus:outline-hidden focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all shadow-2xs"
              />
              <button
                type="button"
                onClick={() => {
                  const v = customText.trim();
                  if (v) {
                    setCustomMode(false);
                    setCustomText('');
                    submit(v);
                  }
                }}
                disabled={!customText.trim()}
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium font-sans text-white hover:bg-accent/90 active:scale-[0.96] transition-transform disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-xs"
              >
                <CornerDownLeft size={12} strokeWidth={2.5} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InputBody({
  request,
  onAnswer,
}: {
  request: PendingUiRequest;
  onAnswer: ExtensionDialogProps['onAnswer'];
}) {
  const [value, setValue] = useState(request.prefill ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const v = value.trim();
    if (v) onAnswer(request.id, { value: v });
  };

  return (
    <div className="space-y-2.5">
      {request.message && (
        <p className="text-xs font-sans text-ink leading-relaxed select-text">
          {request.message}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
            if (e.key === 'Escape') {
              onAnswer(request.id, { cancelled: true });
            }
          }}
          placeholder={request.placeholder ?? '输入回答…'}
          className="flex-1 min-w-0 rounded-lg border border-paper-grid bg-paper px-2.5 py-1.5 text-xs font-sans text-ink placeholder:text-ink-faint focus:outline-hidden focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all shadow-2xs"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium font-sans text-white hover:bg-accent/90 active:scale-[0.96] transition-transform disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-xs"
        >
          <Send size={12} strokeWidth={2} />
          <span>提交</span>
        </button>
      </div>
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[10px] font-sans text-ink-faint">
          按 <kbd className="px-1 py-0.5 rounded bg-paper-grid/30 font-mono text-[9.5px]">Enter</kbd> 提交 · <kbd className="px-1 py-0.5 rounded bg-paper-grid/30 font-mono text-[9.5px]">Esc</kbd> 取消
        </span>
        <button
          type="button"
          onClick={() => onAnswer(request.id, { cancelled: true })}
          className="inline-flex items-center gap-1 text-[11px] font-sans text-ink-faint hover:text-error active:scale-[0.96] transition-transform cursor-pointer"
        >
          <X size={11} strokeWidth={2} /> 取消提问
        </button>
      </div>
    </div>
  );
}

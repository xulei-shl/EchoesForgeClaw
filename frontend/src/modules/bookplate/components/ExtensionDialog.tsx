"use client";
import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
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
  if (!request) return null;
  return (
    <div className="shrink-0 my-1.5">
      <div className="rounded-lg border border-accent/40 bg-node-bg shadow-sm">
        <div className="flex items-center justify-between gap-2 px-3 pt-2">
          <div className="text-[11px] font-medium font-sans text-accent">
            模型提问（{request.title}）
          </div>
          <span className="text-[10px] font-sans text-ink-faint">
            {request.method === 'confirm' ? '确认' : request.method === 'select' ? '选择' : '输入'}
          </span>
        </div>
        <div className="px-3 pb-3 pt-1">
          {request.method === 'confirm' && <ConfirmBody request={request} onAnswer={onAnswer} />}
          {request.method === 'select' && <SelectBody request={request} onAnswer={onAnswer} />}
          {(request.method === 'input' || request.method === 'editor') && (
            <InputBody request={request} onAnswer={onAnswer} />
          )}
        </div>
      </div>
    </div>
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
    <div>
      {request.message && (
        <p className="mb-2 text-xs font-sans text-ink">{request.message}</p>
      )}
      <div className="flex gap-1.5">
        <button
          onClick={() => onAnswer(request.id, { confirmed: true })}
          className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-sans text-white hover:bg-accent/90 active:scale-[0.98] transition"
        >
          <Check size={12} strokeWidth={2.5} /> 是
        </button>
        <button
          onClick={() => onAnswer(request.id, { confirmed: false })}
          className="flex items-center gap-1 rounded-md border border-paper-grid px-3 py-1.5 text-xs font-sans text-ink hover:border-error/40 hover:text-error active:scale-[0.98] transition"
        >
          否
        </button>
        <button
          onClick={() => onAnswer(request.id, { cancelled: true })}
          className="flex items-center gap-1 rounded-md border border-paper-grid px-2.5 py-1.5 text-xs font-sans text-ink-faint hover:text-error active:scale-[0.98] transition"
        >
          <X size={12} strokeWidth={2.5} /> 取消
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
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => submit(opt)}
            className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-sans transition active:scale-[0.98] border-paper-grid bg-paper text-ink hover:border-accent/40 hover:bg-accent/5"
          >
            {opt}
          </button>
        ))}
        <button
          onClick={() => setCustomMode((v) => !v)}
          className="flex items-center gap-1 rounded-md border border-dashed border-paper-grid px-2.5 py-1.5 text-xs font-sans text-ink-faint hover:text-accent hover:border-accent/40 active:scale-[0.98] transition"
        >
          ⌨ 输入自定义
        </button>
      </div>
      {customMode && (
        <div className="flex gap-1.5 pt-0.5">
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
            className="flex-1 min-w-0 rounded-md border border-dashed border-paper-grid bg-paper px-2 py-1.5 text-xs font-sans text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={() => {
              const v = customText.trim();
              if (v) {
                setCustomMode(false);
                setCustomText('');
                submit(v);
              }
            }}
            disabled={!customText.trim()}
            className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-sans text-white hover:bg-accent/90 transition disabled:opacity-40"
          >
            <Check size={12} strokeWidth={2.5} />
          </button>
        </div>
      )}
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
    const v = value;
    if (v) onAnswer(request.id, { value: v });
  };

  return (
    <div className="space-y-1.5">
      {request.message && (
        <p className="text-xs font-sans text-ink">{request.message}</p>
      )}
      <div className="flex gap-1.5">
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
          className="flex-1 min-w-0 rounded-md border border-dashed border-paper-grid bg-paper px-2 py-1.5 text-xs font-sans text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={submit}
          disabled={!value}
          className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-sans text-white hover:bg-accent/90 transition disabled:opacity-40"
        >
          <Check size={12} strokeWidth={2.5} /> 提交
        </button>
      </div>
      <button
        onClick={() => onAnswer(request.id, { cancelled: true })}
        className="flex items-center gap-1 text-[11px] font-sans text-ink-faint hover:text-error transition"
      >
        <X size={11} strokeWidth={2.5} /> 取消提问
      </button>
    </div>
  );
}

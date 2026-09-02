import React, { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

export interface TextSizeStepperProps {
  value: number;
  onChange: (value: number) => void;
}

/** 紧凑字号调节器（自由文本块工具栏用，支持手动输入与加减微调） */
export const TextSizeStepper: React.FC<TextSizeStepperProps> = ({
  value,
  onChange,
}) => {
  const roundedValue = Math.round(value);
  const [inputValue, setInputValue] = useState<string>(String(roundedValue));

  useEffect(() => {
    setInputValue(String(Math.round(value)));
  }, [value]);

  const commitValue = (text: string) => {
    const parsed = parseInt(text.trim(), 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(8, Math.min(240, parsed));
      onChange(clamped);
      setInputValue(String(clamped));
    } else {
      setInputValue(String(Math.round(value)));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      commitValue(inputValue);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setInputValue(String(Math.round(value)));
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div
      className="flex items-center h-7 px-1 rounded-md bg-paper-grid/25 border border-paper-grid/40 shrink-0 select-none"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          const next = Math.max(8, roundedValue - 2);
          onChange(next);
          setInputValue(String(next));
        }}
        className="relative w-5 h-6 flex items-center justify-center rounded-sm text-ink-light hover:text-accent hover:bg-paper active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out cursor-pointer before:absolute before:-inset-1 before:content-['']"
        aria-label="减小字号"
      >
        <Minus size={11} strokeWidth={2} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={() => commitValue(inputValue)}
        onFocus={(e) => e.target.select()}
        onKeyDown={handleKeyDown}
        className="w-8 h-6 text-center text-[11px] tabular-nums font-mono text-ink leading-none bg-transparent hover:bg-paper/40 focus:bg-paper focus:text-accent focus:outline-none focus:ring-1 focus:ring-accent/40 rounded-sm transition-colors"
        aria-label="输入字号"
      />
      <button
        type="button"
        onClick={() => {
          const next = Math.min(240, roundedValue + 2);
          onChange(next);
          setInputValue(String(next));
        }}
        className="relative w-5 h-6 flex items-center justify-center rounded-sm text-ink-light hover:text-accent hover:bg-paper active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out cursor-pointer before:absolute before:-inset-1 before:content-['']"
        aria-label="增大字号"
      >
        <Plus size={11} strokeWidth={2} />
      </button>
    </div>
  );
};

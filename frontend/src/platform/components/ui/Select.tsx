import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  size?: 'sm' | 'md';
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  disabled = false,
  className,
  placeholder = '请选择',
  size = 'md',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className={clsx("relative", className)} ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          "flex items-center justify-between w-full cursor-pointer rounded-md border border-dashed border-paper-grid bg-transparent focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
          size === 'sm' ? "h-8 px-2.5 text-xs" : "h-10 px-3 text-sm",
        )}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={14} className="ml-2 text-ink-faint shrink-0" />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-1 left-0 w-full bg-paper border border-dashed border-paper-grid rounded-md shadow-md z-50 overflow-hidden max-h-60 overflow-y-auto"
          >
            {options.length > 0 ? (
              options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={clsx(
                    "flex w-full text-left hover:bg-paper-grid/50 transition-colors",
                    size === 'sm' ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
                    value === opt.value ? 'text-accent font-medium' : 'text-ink'
                  )}
                >
                  {opt.label}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-ink-faint text-center">暂无数据</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Select;

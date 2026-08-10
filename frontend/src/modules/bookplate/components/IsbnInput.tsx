import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../../platform/components/ui/Button';
import { Input } from '../../../platform/components/ui/Input';
import { Tooltip } from '../../../platform/components/ui/Tooltip';

interface IsbnInputProps {
  onSubmit: (isbn: string) => void;
  isLoading?: boolean;
  /** 进入阶段流程后锁定输入（清空画布可重新开始） */
  disabled?: boolean;
}

export const IsbnInput: React.FC<IsbnInputProps> = ({ onSubmit, isLoading, disabled = false }) => {
  const [isbn, setIsbn] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isbn.trim()) {
      onSubmit(isbn.trim());
      setIsbn(''); // Optional: clear after submit
    }
  };

  const locked = disabled && !isLoading;

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
      <Tooltip content={locked ? '已进入流程，输入已锁定（清空画布后可重新开始）' : undefined}>
        <form
          onSubmit={handleSubmit}
          className={`bg-paper/90 backdrop-blur-md rounded-lg p-2 flex items-center gap-2 shadow-sm transition-opacity duration-200 ${locked ? 'opacity-60' : ''}`}
        >
          <div className="paper-holes flex flex-col justify-center h-full px-2" />
          <Input
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            placeholder={locked ? '流程进行中，输入已锁定' : '例如: 9787108068940'}
            className="w-64 bg-transparent shadow-none"
            disabled={isLoading || disabled}
          />
          <Button type="submit" disabled={!isbn.trim() || isLoading || disabled}>
            <Plus size={20} strokeWidth={2} />
          </Button>
        </form>
      </Tooltip>
    </div>
  );
};

export default IsbnInput;

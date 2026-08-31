/**
 * 手账制作文本模块 - 文本悬浮微交互工具栏
 * 复用 UniversalTextToolbar
 */
import React from 'react';
import type { JournalMakerItem } from '../types';
import { UniversalTextToolbar } from './UniversalTextToolbar';

interface JournalTextToolbarProps {
  item: JournalMakerItem;
  disabled?: boolean;
  onUpdate: (patch: Partial<JournalMakerItem>) => void;
  onOpenEdit: () => void;
  onDelete: () => void;
  onBumpLayer: (mode: 'up' | 'down' | 'top' | 'bottom') => void;
  onRotateStep?: (mode: 'cw' | 'ccw') => void;
}

export const JournalTextToolbar: React.FC<JournalTextToolbarProps> = ({
  item,
  disabled = false,
  onUpdate,
  onOpenEdit,
  onDelete,
  onBumpLayer,
  onRotateStep,
}) => {
  return (
    <UniversalTextToolbar
      item={item}
      disabled={disabled}
      onUpdate={onUpdate}
      onOpenEdit={onOpenEdit}
      onDelete={onDelete}
      onBumpLayer={onBumpLayer}
      onRotateStep={onRotateStep}
    />
  );
};


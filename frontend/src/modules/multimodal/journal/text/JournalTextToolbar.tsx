/**
 * 手账制作文本模块 - 文本悬浮微交互工具栏
 * 复用 UniversalTextToolbar
 */
import React from 'react';
import type { JournalMakerItem } from '../types';
import { UniversalTextToolbar } from './UniversalTextToolbar';

interface JournalTextToolbarProps {
  item: JournalMakerItem;
  variant?: 'floating' | 'docked';
  disabled?: boolean;
  onUpdate: (patch: Partial<JournalMakerItem>) => void;
  onOpenEdit: () => void;
  onDelete: () => void;
  onBumpLayer: (mode: 'up' | 'down' | 'top' | 'bottom') => void;
  onRotateStep?: (mode: 'cw' | 'ccw') => void;
  onClose?: () => void;
}

export const JournalTextToolbar: React.FC<JournalTextToolbarProps> = ({
  item,
  variant = 'floating',
  disabled = false,
  onUpdate,
  onOpenEdit,
  onDelete,
  onBumpLayer,
  onRotateStep,
  onClose,
}) => {
  return (
    <UniversalTextToolbar
      item={item}
      variant={variant}
      disabled={disabled}
      onUpdate={onUpdate}
      onOpenEdit={onOpenEdit}
      onDelete={onDelete}
      onBumpLayer={onBumpLayer}
      onRotateStep={onRotateStep}
      onClose={onClose}
    />
  );
};


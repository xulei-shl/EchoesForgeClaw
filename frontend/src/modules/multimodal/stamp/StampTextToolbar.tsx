/**
 * 邮票截图框文字模块 - 文本悬浮微交互工具栏
 * 结构复用 UniversalTextToolbar，并保留邮票专属预设词条
 */
import React from 'react';
import type { StampTextItem } from './types';
import { UniversalTextToolbar } from '../journal/text/UniversalTextToolbar';

export interface StampTextPresetItem {
  label: string;
  text: string;
  w?: number;
  writingMode?: 'horizontal' | 'vertical';
  textAlign?: 'left' | 'center' | 'right';
}

export interface StampTextPresetGroup {
  group: string;
  items: StampTextPresetItem[];
}

/** 经典邮票文字快捷预设词（供文案编辑弹窗使用） */
export const STAMP_TEXT_PRESETS: StampTextPresetGroup[] = [
  {
    group: '面值',
    items: [
      { label: '¥6.00', text: '¥6.00', w: 9 },
      { label: '¥1.20', text: '¥1.20', w: 8 },
      { label: '80分', text: '80分', w: 8 },
      { label: '20分', text: '20分', w: 8 },
    ],
  },
  {
    group: '地名与主题',
    items: [
      { label: '北京 BEIJING', text: '北京\nBEIJING', writingMode: 'vertical', w: 7 },
      { label: '故宫 PALACE', text: '故宫\nPALACE', writingMode: 'vertical', w: 7 },
      { label: '中华风光', text: '中华风光', writingMode: 'vertical', w: 6.5 },
    ],
  },
  {
    group: '志号与铭记',
    items: [
      { label: '2024-1', text: '2024-1', w: 4.5 },
      { label: '中国邮政 CHINA', text: '中国邮政 CHINA', w: 5 },
      { label: '(4-1)T', text: '(4-1)T', w: 4.5 },
    ],
  },
];

interface StampTextToolbarProps {
  item: StampTextItem;
  disabled?: boolean;
  onUpdate: (patch: Partial<StampTextItem>) => void;
  onOpenEdit: () => void;
  onDelete: () => void;
  onBumpLayer: (mode: 'up' | 'down' | 'top' | 'bottom') => void;
  onRotateStep?: (mode: 'cw' | 'ccw') => void;
}

export const StampTextToolbar: React.FC<StampTextToolbarProps> = ({
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

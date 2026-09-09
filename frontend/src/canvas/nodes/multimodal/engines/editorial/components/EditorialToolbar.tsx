import React from 'react';
import { FileText, Sliders } from 'lucide-react';
import { Select, type SelectOption } from '../../../../../../shared/components/ui/Select';
import { Tooltip } from '../../../../../../shared/components/ui/Tooltip';
import {
  type EditorialPageRatio,
  type EditorialState,
  EDITORIAL_PAGE_RATIOS,
} from '../types';
import { EDITORIAL_TEMPLATES, FREE_LAYOUT_SKELETONS } from '../templates';

/** 预设选择下拉选项 */
const PRESET_OPTIONS: SelectOption[] = EDITORIAL_TEMPLATES.map((p) => ({
  label: p.name,
  value: p.id,
}));

/** 比例选择下拉选项 */
const RATIO_OPTIONS: SelectOption[] = EDITORIAL_PAGE_RATIOS.map((r) => ({
  label: r.name,
  value: r.id,
}));

/** 自由排版初始骨架下拉选项 */
const SKELETON_OPTIONS: SelectOption[] = FREE_LAYOUT_SKELETONS.map((s) => ({
  label: s.name,
  value: s.id,
}));

export interface EditorialToolbarProps {
  id: string;
  presetId: string;
  pageSize: EditorialPageRatio;
  freeSkeletonId: string;
  isFreeLayout: boolean;
  activeTab: 'preview' | 'article' | 'style';
  toolbarTabsRef: React.RefObject<HTMLDivElement | null>;
  onSelectPreset: (presetId: string) => void;
  onPageSizeChange: (ratio: EditorialPageRatio) => void;
  onApplySkeleton: (skeletonId: string) => void;
  onTabChange: (tab: 'preview' | 'article' | 'style') => void;
  onUpdateState?: (id: string, patch: Partial<EditorialState>, undoable?: boolean) => void;
}

/** 杂志排版顶部控制与切换工具栏 */
export const EditorialToolbar: React.FC<EditorialToolbarProps> = ({
  id,
  presetId,
  pageSize,
  freeSkeletonId,
  isFreeLayout,
  activeTab,
  toolbarTabsRef,
  onSelectPreset,
  onPageSizeChange,
  onApplySkeleton,
  onTabChange,
  onUpdateState,
}) => {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-paper-grid/20 border border-paper-grid/40 text-xs font-sans text-ink-light select-none">
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <Select
          size="sm"
          value={presetId}
          onChange={(val) => onSelectPreset(String(val))}
          options={PRESET_OPTIONS}
          className={isFreeLayout ? 'flex-[1.2] min-w-0' : 'flex-1 min-w-0'}
        />

        {isFreeLayout && (
          <>
            <Select
              size="sm"
              value={pageSize}
              onChange={(val) => {
                const r = val as EditorialPageRatio;
                onPageSizeChange(r);
                onUpdateState?.(id, { pageSize: r }, true);
              }}
              options={RATIO_OPTIONS}
              className="flex-1 min-w-0"
            />

            <Select
              size="sm"
              value={freeSkeletonId}
              onChange={(val) => onApplySkeleton(String(val))}
              options={SKELETON_OPTIONS}
              className="flex-1 min-w-0"
            />
          </>
        )}
      </div>

      <div ref={toolbarTabsRef} className="flex items-center gap-1 shrink-0">
        <Tooltip content="编辑文章结构（大标题、导语、正文等）">
          <button
            type="button"
            onClick={() => onTabChange(activeTab === 'article' ? 'preview' : 'article')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] ${
              activeTab === 'article'
                ? 'bg-accent/15 text-accent font-medium'
                : 'text-ink-light hover:text-accent hover:bg-paper-grid/40'
            }`}
          >
            <FileText size={13} strokeWidth={1.8} />
            <span>文章</span>
          </button>
        </Tooltip>

        <Tooltip content="字体与排版参数配置">
          <button
            type="button"
            onClick={() => onTabChange(activeTab === 'style' ? 'preview' : 'style')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] ${
              activeTab === 'style'
                ? 'bg-accent/15 text-accent font-medium'
                : 'text-ink-light hover:text-accent hover:bg-paper-grid/40'
            }`}
          >
            <Sliders size={13} strokeWidth={1.8} />
            <span>排版</span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

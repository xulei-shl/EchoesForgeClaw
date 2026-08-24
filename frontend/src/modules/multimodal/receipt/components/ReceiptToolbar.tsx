import React from 'react';
import { Layers } from 'lucide-react';
import { Select } from '../../../../platform/components/ui/Select';
import { getAllReceiptThemes } from '../themes';
import { getAllReceiptTemplates, buildReceiptState } from '../templates';
import {
  ANCIENT_BOOKMARK_WIDTH_OPTIONS,
  type AncientBookmarkWidth,
  type BookMetadataInput,
  type ReceiptState,
  type ReceiptTemplateId,
  type ReceiptThemeId,
} from '../types';

interface ReceiptToolbarProps {
  state: ReceiptState;
  onChange: (patch: Partial<ReceiptState>) => void;
  upstreamBookData?: BookMetadataInput | null;
  upstreamImageUrl?: string | null;
  disabled?: boolean;
}

export const ReceiptToolbar: React.FC<ReceiptToolbarProps> = ({
  state,
  onChange,
  upstreamBookData,
  upstreamImageUrl,
  disabled = false,
}) => {
  const allThemes = getAllReceiptThemes();
  const allTemplates = getAllReceiptTemplates();
  const templateOptions = allTemplates.map((t) => ({ value: t.id, label: t.name }));
  const bookmarkWidthOptions = ANCIENT_BOOKMARK_WIDTH_OPTIONS.map((opt) => ({
    value: opt.id,
    label: opt.label,
    title: opt.description,
  }));

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 p-2 bg-paper-grid/20 border border-paper-grid rounded-md text-xs font-sans ${disabled ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        {/* 模板选择 */}
        <div className="flex items-center gap-1.5" title={disabled ? '有下级节点，不可切换模板' : undefined}>
          <Layers size={14} className="text-ink-faint shrink-0" />
          <Select
            size="sm"
            value={state.templateId}
            disabled={disabled}
            options={templateOptions}
            onChange={(val) => {
              const tmplId = val as ReceiptTemplateId;
              // 切换模板时，使用公共核心函数 buildReceiptState 重新构建新模板下的完整状态，并自动映射当前图书元数据与专属默认主题
              const nextState = buildReceiptState(
                tmplId,
                upstreamBookData,
                {
                  ditherEnabled: state.ditherEnabled,
                },
                {
                  overrideUserEdits: true,
                  upstreamImageUrl,
                }
              );
              onChange(nextState);
            }}
            className="w-28 sm:w-32 min-w-[100px]"
          />
        </div>

        {/* 古籍书签专属规格选择器 */}
        {state.templateId === 'ancient_bookmark' && (
          <div
            className="flex items-center gap-1.5"
            title={disabled ? '有下级节点，不可修改规格' : '选择古籍版式宽度规格（适配不同长短的文摘正文）'}
          >
            <span className="text-[11px] text-ink-faint">规格:</span>
            <Select
              size="sm"
              value={state.bookmarkWidth || 'standard'}
              disabled={disabled}
              options={bookmarkWidthOptions}
              onChange={(val) => onChange({ bookmarkWidth: val as AncientBookmarkWidth })}
              className="w-36 sm:w-44 min-w-[130px] font-serif"
            />
          </div>
        )}
      </div>

      {/* 主题配色选择器 */}
      <div className="flex items-center gap-1.5" title={disabled ? '有下级节点，不可修改纸色' : undefined}>
        <span className="text-[11px] text-ink-faint">纸色:</span>
        <div className="flex items-center gap-1">
          {allThemes.map((theme) => {
            const isSelected = (state.themeId || 'white') === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ themeId: theme.id as ReceiptThemeId })}
                className={`w-4 h-4 rounded-full border transition-all ${
                  isSelected
                    ? 'ring-2 ring-accent ring-offset-1 scale-110 border-ink/40'
                    : 'border-black/20 hover:scale-105 opacity-80 hover:opacity-100'
                } disabled:cursor-not-allowed disabled:opacity-40`}
                style={{ backgroundColor: theme.previewColor }}
                title={disabled ? '有下级节点，不可修改纸色' : theme.name}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

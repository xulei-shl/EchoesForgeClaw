import React from 'react';
import { Layers } from 'lucide-react';
import { getAllReceiptThemes } from '../themes';
import { getAllReceiptTemplates, buildReceiptState } from '../templates';
import type { BookMetadataInput, ReceiptState, ReceiptTemplateId, ReceiptThemeId } from '../types';

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

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 p-2 bg-paper-grid/20 border border-paper-grid rounded-md text-xs font-sans ${disabled ? 'opacity-70' : ''}`}>
      {/* 模板选择 */}
      <div className="flex items-center gap-1.5" title={disabled ? '有下级节点，不可切换模板' : undefined}>
        <Layers size={14} className="text-ink-faint shrink-0" />
        <select
          value={state.templateId}
          disabled={disabled}
          onChange={(e) => {
            const tmplId = e.target.value as ReceiptTemplateId;
            // 切换模板时，使用公共核心函数 buildReceiptState 重新构建新模板下的完整状态，并自动映射当前图书元数据与图片
            const nextState = buildReceiptState(
              tmplId,
              upstreamBookData,
              {
                themeId: state.themeId,
                ditherEnabled: state.ditherEnabled,
              },
              {
                overrideUserEdits: true,
                upstreamImageUrl,
              }
            );
            onChange(nextState);
          }}
          className="bg-paper border border-paper-grid text-ink rounded px-2 py-1 text-xs outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {allTemplates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
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

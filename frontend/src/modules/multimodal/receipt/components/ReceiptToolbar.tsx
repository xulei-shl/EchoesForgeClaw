import React from 'react';
import { Sparkles, RefreshCw, Layers } from 'lucide-react';
import { getAllReceiptThemes } from '../themes';
import { getAllReceiptTemplates } from '../templates';
import type { ReceiptState, ReceiptTemplateId, ReceiptThemeId } from '../types';

interface ReceiptToolbarProps {
  state: ReceiptState;
  onChange: (patch: Partial<ReceiptState>) => void;
  onSyncUpstreamBook?: () => void;
  hasUpstreamBook?: boolean;
}

export const ReceiptToolbar: React.FC<ReceiptToolbarProps> = ({
  state,
  onChange,
  onSyncUpstreamBook,
  hasUpstreamBook,
}) => {
  const allThemes = getAllReceiptThemes();
  const allTemplates = getAllReceiptTemplates();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-paper-grid/20 border border-paper-grid rounded-md text-xs font-sans">
      {/* 模板选择 */}
      <div className="flex items-center gap-1.5">
        <Layers size={14} className="text-ink-faint shrink-0" />
        <select
          value={state.templateId}
          onChange={(e) => {
            const tmplId = e.target.value as ReceiptTemplateId;
            const tmpl = allTemplates.find((t) => t.id === tmplId);
            if (tmpl) {
              const init = tmpl.createInitialState();
              onChange({
                templateId: tmplId,
                ...init,
                themeId: state.themeId, // 保持当前选中的配色
              });
            }
          }}
          className="bg-paper border border-paper-grid text-ink rounded px-2 py-1 text-xs outline-none focus:border-accent"
        >
          {allTemplates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* 主题配色选择器 */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-ink-faint">纸色:</span>
        <div className="flex items-center gap-1">
          {allThemes.map((theme) => {
            const isSelected = (state.themeId || 'white') === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => onChange({ themeId: theme.id as ReceiptThemeId })}
                className={`w-4 h-4 rounded-full border transition-all ${
                  isSelected
                    ? 'ring-2 ring-accent ring-offset-1 scale-110 border-ink/40'
                    : 'border-black/20 hover:scale-105 opacity-80 hover:opacity-100'
                }`}
                style={{ backgroundColor: theme.previewColor }}
                title={theme.name}
              />
            );
          })}
        </div>
      </div>

      {/* 点阵化开关 & 同步元数据 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ ditherEnabled: !state.ditherEnabled })}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors ${
            state.ditherEnabled
              ? 'bg-accent/10 border-accent/40 text-accent font-medium'
              : 'bg-paper border-paper-grid text-ink-faint hover:text-ink'
          }`}
          title="切换热敏纸黑白点阵颗粒打印效果"
        >
          <Sparkles size={12} />
          <span>点阵滤镜</span>
        </button>

        {hasUpstreamBook && onSyncUpstreamBook && (
          <button
            type="button"
            onClick={onSyncUpstreamBook}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-paper border border-paper-grid text-ink-light hover:text-ink hover:border-accent transition-colors"
            title="从连线的图书元数据节点重新继承填充"
          >
            <RefreshCw size={11} />
            <span>同步图书</span>
          </button>
        )}
      </div>
    </div>
  );
};

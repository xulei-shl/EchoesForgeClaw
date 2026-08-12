import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { NODE_COLORS } from '../nodeTypes';
import type { PlaceholderSource } from '../textTemplate';

/**
 * 占位符来源面板（公共展示组件，纯受控、无业务状态）
 *
 * 职责：展示「上级节点占位符」列表——每行含节点色点 / 标题 / 可编辑别名 / 插入按钮，
 * 以及模板中未匹配占位符的琥珀色提示。全部行为通过回调上抛：
 * - onRename(sourceId, alias)：别名编辑提交（失焦 / Enter；Esc 还原；空别名忽略）
 * - onInsert(alias)：点击「插入」（由持有模板的父级决定插入位置）
 *
 * 数据由 toPlaceholderSources（textTemplate.ts）从画布上级节点映射而来，
 * 组件本身不感知图结构 / 端口类型 / 模板——任何带占位符模板的节点均可复用。
 */

/** 单个来源的别名编辑行（本地草稿，失焦 / Enter 提交，Esc 还原） */
const SourceRow: React.FC<{
  source: PlaceholderSource;
  onCommit: (sourceId: string, alias: string) => void;
  onInsert: (alias: string) => void;
}> = ({ source, onCommit, onInsert }) => {
  const [draft, setDraft] = useState(source.alias);
  useEffect(() => setDraft(source.alias), [source.alias]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== source.alias) onCommit(source.id, v);
    else setDraft(source.alias);
  };

  return (
    <div className="flex items-center gap-1.5 rounded-md px-1.5 py-1 bg-paper-grid/20">
      <span
        className="w-1.5 h-1.5 shrink-0 rounded-full"
        style={{ background: NODE_COLORS[source.type] }}
        title={source.title}
      />
      <span
        className="min-w-0 flex-1 truncate text-[11px] text-ink-light font-sans"
        title={source.title}
      >
        {source.title}
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(source.alias);
          }
        }}
        spellCheck={false}
        className="w-28 min-w-0 rounded border border-dashed border-paper-grid bg-transparent px-1.5 py-0.5 text-[11px] font-mono text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
        title="占位符别名（在模板中用 {别名} 引用）"
      />
      <button
        onMouseDown={(e) => e.preventDefault()} // 阻止编辑框失焦：避免提前提交草稿产生重复历史
        onClick={() => onInsert(source.alias)}
        title={`插入 {${source.alias}} 到模板光标处`}
        className="inline-flex items-center gap-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-sans text-accent border border-dashed border-accent/40 hover:bg-accent/10 active:scale-95 transition"
      >
        <Plus size={10} strokeWidth={2.5} />
        插入
      </button>
    </div>
  );
};

export interface PlaceholderPanelProps {
  /** 已映射好的占位符来源列表（toPlaceholderSources 产出） */
  sources: PlaceholderSource[];
  /** 模板中未匹配到任何来源的占位符名（不含花括号），非空时展示琥珀色提示 */
  unmatchedPlaceholders?: string[];
  onRename: (sourceId: string, alias: string) => void;
  onInsert: (alias: string) => void;
  /** 无来源时展示的提示（节点自定文案） */
  emptyHint?: React.ReactNode;
}

export const PlaceholderPanel: React.FC<PlaceholderPanelProps> = ({
  sources,
  unmatchedPlaceholders = [],
  onRename,
  onInsert,
  emptyHint,
}) => (
  <div className="rounded-md border border-dashed border-paper-grid p-2 flex flex-col gap-1.5">
    <p className="text-[10px] font-sans font-medium text-ink-light">
      上级节点占位符（点击「插入」写入模板，或直接改名）
    </p>
    {sources.length === 0 ? (
      <p className="text-[11px] font-sans text-ink-faint py-1">
        {emptyHint ?? '尚未连接上级节点'}
      </p>
    ) : (
      /* 仅来源行可滚动，未匹配警告常驻可见 */
      <div className="max-h-[120px] min-h-0 overflow-y-auto flex flex-col gap-1">
        {sources.map((s) => (
          <SourceRow
            key={s.id}
            source={s}
            onCommit={onRename}
            onInsert={onInsert}
          />
        ))}
      </div>
    )}
    {unmatchedPlaceholders.length > 0 && (
      <div className="rounded-md border border-dashed border-[oklch(0.75 0.12 80)]/60 bg-[oklch(0.95 0.04 80)]/30 px-2 py-1.5 shrink-0">
        <p className="text-[10px] font-sans text-[oklch(0.55 0.13 55)]">
          未匹配到上级的占位符：
          {unmatchedPlaceholders.map((n) => `{${n}}`).join('、')}
          （连上对应节点或重命名占位符后自动生效）
        </p>
      </div>
    )}
  </div>
);

export default PlaceholderPanel;

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NODE_COLORS } from '../nodeTypes';
import { extractPlaceholderNames, toPlaceholderSources } from '../textTemplate';
import { PlaceholderPanel } from './PlaceholderPanel';
import type { PortTypesLookup } from '../execution';
import type { NodeData } from '../graphTypes';

export interface TextAggregateNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 直接连线的上级节点（占位符来源） */
  parents: NodeData[];
  /** 占位符模板（{别名} 引用上级输出） */
  template: string;
  /** 上级节点 id → 占位符别名 */
  placeholders: Record<string, string>;
  /** 实时计算出的聚合结果（上级变化自动重算） */
  output: string;
  onRemove?: (id: string) => void;
  /** 保存模板（本地草稿失焦 / Ctrl+Enter 时提交） */
  onUpdateTemplate?: (id: string, template: string) => void;
  /** 重命名某上级节点的占位符别名 */
  onRenamePlaceholder?: (id: string, parentId: string, alias: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 是否有下级关联节点 */
  hasDownstream?: boolean;
  /** 入边端口类型不匹配数徽标（如「类型不匹配 ×1」） */
  mismatchBadge?: string | null;
  /** 端口类型查找（后端模板声明优先，前端静态镜像兜底）：用于判断哪些上级是文本输出 */
  portTypesOf: PortTypesLookup;
}

const TextAggregateNodeInner: React.FC<TextAggregateNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  parents = [],
  template = '',
  placeholders = {},
  output = '',
  onRemove,
  onUpdateTemplate,
  onRenamePlaceholder,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  hasDownstream,
  mismatchBadge,
  portTypesOf,
}) => {
  // 模板编辑草稿：失焦 / Ctrl+Enter 提交，Esc 还原
  const [draft, setDraft] = useState(template);
  useEffect(() => setDraft(template), [template]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'template' | 'preview'>('template');
  // 插入占位符后待定位的光标位置：草稿提交渲染后再定位，避免命中旧内容
  const pendingCaret = useRef<number | null>(null);
  useEffect(() => {
    if (pendingCaret.current == null || !textareaRef.current) return;
    const el = textareaRef.current;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(pos, pos);
  }, [draft]);

  const commitTemplate = () => {
    if (draft !== template) onUpdateTemplate?.(id, draft);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      commitTemplate();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(template);
    }
  };

  /** 在模板光标处插入 {别名}（由 useEffect 在草稿提交后定位光标） */
  const insertPlaceholder = useCallback(
    (alias: string) => {
      const el = textareaRef.current;
      const token = `{${alias}}`;
      if (!el) {
        setDraft((prev) => (prev ? `${prev}\n\n${token}` : token));
        return;
      }
      const start = el.selectionStart ?? draft.length;
      const end = el.selectionEnd ?? start;
      setDraft(draft.slice(0, start) + token + draft.slice(end));
      pendingCaret.current = start + token.length;
    },
    [draft]
  );

  // 占位符来源（端口类型声明推导，公共组件渲染）+ 未匹配提示
  const sources = toPlaceholderSources(parents, placeholders, portTypesOf);
  const availableAliases = new Set(Object.values(placeholders));
  const unmatched = extractPlaceholderNames(draft).filter((n) => !availableAliases.has(n));

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '文本聚合'}
      dotColor={NODE_COLORS.text_aggregate}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 460, height: 520 }}
      showLeftAnchor={true}
      showRightAnchor={true}
      footer={footer}
      disableRemove={hasDownstream}
      mismatchBadge={mismatchBadge}
    >
      <div className="relative h-full flex flex-col flex-1 min-h-0">
        {/* 模式切换：默认模板编辑；预览展示实时聚合结果 */}
        <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5">
          <div className="inline-flex items-center rounded-md border border-paper-grid bg-paper-grid/30 p-0.5">
            <button
              onClick={() => setMode('template')}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-sans transition ${
                mode === 'template'
                  ? 'bg-accent/90 text-paper shadow-sm'
                  : 'text-ink-light hover:text-ink'
              }`}
            >
              <Pencil size={11} strokeWidth={2.5} />
              模板
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-sans transition ${
                mode === 'preview'
                  ? 'bg-accent/90 text-paper shadow-sm'
                  : 'text-ink-light hover:text-ink'
              }`}
            >
              <Eye size={11} strokeWidth={2.5} />
              预览
            </button>
          </div>
          <span className="ml-auto text-[10px] font-sans text-ink-faint">
            上级变化自动重算
          </span>
        </div>

        {mode === 'template' ? (
          <div className="flex flex-col flex-1 min-h-0 gap-2 px-3 pb-2">
            <div className="relative flex-1 min-h-0">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitTemplate}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                placeholder={'用 {占位符} 引用上级节点文本，支持任意 Markdown 格式\n\n示例：\n## 我是自定义标题\n\n{我是上级节点1的占位符}\n\n---\n\n{我是上级节点2的占位符}'}
                className="h-full w-full resize-none rounded-md border border-dashed border-paper-grid bg-transparent px-2.5 py-2 text-[12px] leading-relaxed font-mono text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              />
            </div>

            <PlaceholderPanel
              sources={sources}
              unmatchedPlaceholders={unmatched}
              onRename={(sourceId, alias) => onRenamePlaceholder?.(id, sourceId, alias)}
              onInsert={insertPlaceholder}
              emptyHint={
                '尚未连接上级节点：拖线连接任意文本输出节点（文本 / AI 对话 / 图片分析 / 提示词生成 / 图书元数据 / 文本聚合）后，此处自动列出其占位符。'
              }
            />
          </div>
        ) : (
          /* 预览：实时聚合结果（Markdown 渲染） */
          <div className="w-full min-w-0 flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-2">
            {output.trim() ? (
              <div className="w-full min-w-0 font-sans text-sm leading-relaxed">
                <Streamdown
                  plugins={{ cjk, code }}
                  isAnimating={false}
                  caret="block"
                  linkSafety={{ enabled: false }}
                >
                  {normalizeMarkdown(output)}
                </Streamdown>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-1 text-center min-h-[120px]">
                <p className="text-xs text-ink-faint font-sans">暂无聚合结果</p>
                <p className="text-[10px] text-ink-faint font-sans">
                  {parents.length === 0
                    ? '先连接上级文本节点，再在「模板」中插入占位符'
                    : '上级节点暂无文本输出（如文本内容为空 / 尚未运行）'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </CanvasNode>
  );
};

export const TextAggregateNode = memo(TextAggregateNodeInner);
TextAggregateNode.displayName = 'TextAggregateNode';
export default TextAggregateNode;

import React, { memo, useEffect, useState, useCallback } from 'react';
import { BookOpen, Loader2, Search, AlertTriangle, Link2, X } from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { NODE_COLORS } from '../nodeTypes';

export interface VuFindCallNumberNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 手动输入的 ISBN（写入 data.isbn） */
  isbn?: string;
  /** 连线上级文本节点提供的 ISBN（连线即输入，优先于手动输入） */
  upstreamIsbn?: string;
  /** 获取的索书号结果（写入 data.callNumber，对外输出为 data.output = JSON） */
  callNumber?: string;
  /** 对外输出文本（data.output，JSON 格式） */
  output?: string;
  isGenerating?: boolean;
  error?: string | null;
  /** 提交查询 */
  onFetch?: (id: string, isbn: string) => void;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
}

const VuFindCallNumberNodeInner: React.FC<VuFindCallNumberNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  isbn = '',
  upstreamIsbn = '',
  callNumber = '',
  output = '',
  isGenerating = false,
  error = null,
  onFetch,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  hasDownstream,
}) => {
  const [isbnInput, setIsbnInput] = useState(isbn);

  useEffect(() => {
    setIsbnInput(isbn);
  }, [isbn]);

  const hasUpstream = upstreamIsbn.trim().length > 0;
  const effectiveIsbn = hasUpstream ? upstreamIsbn.trim() : isbnInput.trim();

  const handleQuery = useCallback(
    (targetIsbn?: string) => {
      if (isGenerating) return;
      const i = targetIsbn !== undefined ? targetIsbn.trim() : effectiveIsbn;
      if (!i) return;
      onFetch?.(id, i);
    },
    [effectiveIsbn, id, isGenerating, onFetch]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleQuery();
  };

  const renderActionBar = () => {
    if (isGenerating) return undefined;
    return (
      <NodeActionBar>
        {(output.trim() || error) && (
          <NodeActionBar.Retry
            onClick={() => handleQuery()}
            error={!!error}
            hasDownstream={hasDownstream}
            tooltip={error ? '重试获取' : '重新获取索书号'}
          />
        )}
        {output.trim() && (
          <NodeActionBar.Copy
            text={callNumber || output}
            tooltip="复制索书号"
            toastMessage="索书号已复制到剪贴板"
          />
        )}
      </NodeActionBar>
    );
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || 'VuFind 索书号'}
      dotColor={NODE_COLORS.vufind_call_number}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 400 }}
      className={isGenerating && !error ? 'transition-[box-shadow,border-color,opacity] duration-200 border-transparent' : ''}
      glowOverlay={isGenerating && !error ? <BeamGlow /> : undefined}
      showLeftAnchor
      showRightAnchor
      footer={footer}
      actionBar={renderActionBar()}
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-3">
        <div className="shrink-0 space-y-2">
          {hasUpstream ? (
            <div className="flex items-center justify-between p-2.5 rounded-md border border-accent/40 bg-accent/5">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center shrink-0 text-accent">
                  <Link2 size={13} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-serif text-accent uppercase tracking-wider">上级连线输入 ISBN</div>
                  <div className="text-sm font-medium text-ink truncate font-mono">{upstreamIsbn}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQuery(upstreamIsbn)}
                disabled={isGenerating || hasDownstream}
                title={hasDownstream ? '有下级节点，不可修改输出' : '获取索书号'}
                className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Search size={12} strokeWidth={2} />
                获取
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <input
                  value={isbnInput}
                  onChange={(e) => setIsbnInput(e.target.value)}
                  placeholder="输入 ISBN（如 9787544799317）"
                  disabled={isGenerating}
                  className="w-full h-10 rounded-md border border-dashed border-paper-grid bg-transparent pl-3 pr-8 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
                />
                {isbnInput && !isGenerating && (
                  <button
                    type="button"
                    onClick={() => setIsbnInput('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                    title="清除"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isGenerating || !effectiveIsbn || hasDownstream}
                title={hasDownstream ? '有下级节点，不可修改输出' : '获取索书号'}
                className="flex items-center justify-center w-10 h-10 shrink-0 rounded-md bg-accent text-paper hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Search size={15} strokeWidth={2} />
              </button>
            </form>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          {isGenerating ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[140px]">
              <div className="w-12 h-12 rounded-full border border-dashed border-accent/40 bg-accent/5 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-serif text-accent font-medium">正在从 vufind 检索索书号...</p>
                <p className="text-[11px] font-mono text-ink-faint">ISBN：{effectiveIsbn}</p>
              </div>
            </div>
          ) : error ? (
            <div className="p-3.5 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
              <AlertTriangle size={15} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-1.5 font-sans">
                <p className="text-[12px] text-error/90 leading-relaxed break-words">{error}</p>
                <button
                  type="button"
                  onClick={() => handleQuery()}
                  className="inline-flex items-center text-[11px] text-error font-medium hover:underline active:scale-[0.96] transition-transform"
                >
                  重试
                </button>
              </div>
            </div>
          ) : callNumber ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[140px]">
              <div className="w-14 h-14 rounded-full border border-dashed border-accent/40 bg-accent/5 flex items-center justify-center text-accent">
                <BookOpen size={24} strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-serif text-ink-faint uppercase tracking-wider">索书号</p>
                <p className="text-lg font-mono font-bold text-ink tracking-wide">{callNumber}</p>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[140px]">
              <div className="w-14 h-14 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
                <BookOpen size={24} strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-serif text-ink-light">输入 ISBN 获取索书号</p>
                <p className="text-xs text-ink-faint font-sans">可连线上级图书元数据节点自动读取 ISBN</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const VuFindCallNumberNode = memo(VuFindCallNumberNodeInner);
VuFindCallNumberNode.displayName = 'VuFindCallNumberNode';
export default VuFindCallNumberNode;
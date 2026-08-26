import React, { memo, useEffect, useRef, useState, useCallback } from 'react';
import { BookOpen, Loader2, AlertTriangle, Link2, X } from 'lucide-react';
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
  /** 连线继承的 ISBN（到达时自动填入输入框一次，仍可手动编辑） */
  upstreamIsbn?: string;
  /** 获取的索书号结果（写入 data.callNumber，对外输出为 data.output = JSON） */
  callNumber?: string;
  /** 对外输出文本（data.output，JSON 格式） */
  output?: string;
  isGenerating?: boolean;
  error?: string | null;
  /** 提交查询 */
  onFetch?: (id: string, isbn: string) => void;
  /** 编辑器状态写入 node.data（持久化 ISBN 手动输入 / 继承注入） */
  onUpdateEditor?: (id: string, patch: Record<string, any>) => void;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
}

/** VuFind ISBN 检索页 URL 模板（与后端 fetchCallNumber 同一模板） */
const VUFIND_ISBN_URL_TEMPLATE =
  'https://vufind.library.sh.cn/Search/Results?searchtype=vague&lookfor={isbn}&type=AllFields&limit=20';

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
  onUpdateEditor,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  hasDownstream,
}) => {
  const [isbnInput, setIsbnInput] = useState(isbn);

  // 撤销 / 重做 / 历史恢复时同步草稿
  useEffect(() => {
    setIsbnInput(isbn);
  }, [isbn]);

  // 上级连线 ISBN 到达时写入输入框；仅在上游 ISBN 本身变化时注入一次，
  // 手动编辑后的内容不被覆盖（与文本节点同口径）
  const lastUpstreamRef = useRef<string | null>(null);
  useEffect(() => {
    const up = upstreamIsbn.trim();
    if (!up || lastUpstreamRef.current === up) return;
    lastUpstreamRef.current = up;
    if (up !== isbn) {
      setIsbnInput(up);
      onUpdateEditor?.(id, { isbn: up });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamIsbn]);

  const hasUpstream = upstreamIsbn.trim().length > 0;

  /** 持久化手动输入（失焦 / 清空时落盘，避免每次击键写 node.data） */
  const persistIsbn = (value: string) => {
    if (value !== isbn) onUpdateEditor?.(id, { isbn: value });
  };

  const handleQuery = useCallback(() => {
    if (isGenerating || hasDownstream) return;
    const i = isbnInput.trim();
    if (!i) return;
    persistIsbn(isbnInput);
    onFetch?.(id, i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isbnInput, id, isGenerating, hasDownstream, onFetch, isbn, onUpdateEditor]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleQuery();
  };

  const renderActionBar = () => {
    if (isGenerating) return undefined;
    const hasIsbn = isbnInput.trim().length > 0;
    const linkIsbn = isbnInput.trim() || isbn.trim();
    const vuFindUrl = linkIsbn
      ? VUFIND_ISBN_URL_TEMPLATE.replace('{isbn}', encodeURIComponent(linkIsbn))
      : '';

    if (!output.trim() && !error) {
      return (
        <NodeActionBar>
          <NodeActionBar.Run
            onClick={handleQuery}
            disabled={!hasIsbn}
            hasDownstream={hasDownstream}
            tooltip={hasIsbn ? '获取索书号' : '输入或连线上级节点获取 ISBN'}
            downstreamTooltip="有下级节点，不可修改输出"
          />
          {vuFindUrl && (
            <NodeActionBar.ExternalLink href={vuFindUrl} tooltip="在 VuFind 中查看" />
          )}
        </NodeActionBar>
      );
    }

    return (
      <NodeActionBar>
        <NodeActionBar.Retry
          onClick={handleQuery}
          error={!!error}
          hasDownstream={hasDownstream}
          downstreamTooltip="有下级节点，不可修改输出"
          tooltip={error ? '重试获取' : '重新获取索书号'}
        />
        {output.trim() && (
          <NodeActionBar.Copy
            text={callNumber || output}
            tooltip="复制索书号"
            toastMessage="索书号已复制到剪贴板"
          />
        )}
        {vuFindUrl && (
          <NodeActionBar.ExternalLink href={vuFindUrl} tooltip="在 VuFind 中查看" />
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
        <div className="shrink-0 space-y-1.5">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <input
                value={isbnInput}
                onChange={(e) => setIsbnInput(e.target.value)}
                onBlur={() => persistIsbn(isbnInput.trim())}
                placeholder="输入 ISBN（如 9787544799317）"
                disabled={isGenerating}
                className="w-full h-10 rounded-md border border-dashed border-paper-grid bg-transparent pl-3 pr-8 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
              />
              {isbnInput && !isGenerating && (
                <button
                  type="button"
                  onClick={() => {
                    setIsbnInput('');
                    persistIsbn('');
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                  title="清除"
                >
                  <X size={13} strokeWidth={2} />
                </button>
              )}
            </div>
          </form>
          {hasUpstream && (
            <div className="flex items-center gap-1 px-0.5 text-[10px] font-sans text-accent">
              <Link2 size={10} strokeWidth={2} />
              ISBN 已从上级连线自动填入，可手动修改
            </div>
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
                <p className="text-[11px] font-mono text-ink-faint">ISBN：{isbnInput.trim()}</p>
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
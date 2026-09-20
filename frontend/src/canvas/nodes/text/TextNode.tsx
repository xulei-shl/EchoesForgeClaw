import React, { memo, useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { CanvasNode } from '../_shared/CanvasNode';
import { MarkdownContent } from '../../../shared/components/ui/MarkdownContent';
import { NodeActionBar } from '../_shared/NodeActionBar';
import { Textarea } from '../../../shared/components/ui/Textarea';
import { NODE_COLORS } from '../_shared/nodeTypes';

export interface TextNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** Markdown 文本内容 */
  content?: string;
  /**
   * 连线上级文本节点传入的内容（连线即输入）：**仅在本节点内容为空、且该上游值未继承过时注入**，
   * 已有内容（用户手输 / Agent 写入）永不被覆盖。
   */
  upstreamText?: string;
  /** 已继承过的上游文本值（存在 node.data，跨刷新/切页生效）；为空表示尚未继承任何上游 */
  inheritedFrom?: string;
  /** 直接 patch node.data（上游继承写内容 + inheritedFrom 记录） */
  onUpdateEditor?: (id: string, patch: Record<string, any>, undoable?: boolean) => void;
  onRemove?: (id: string) => void;
  /** 保存编辑后的文本 */
  onEditContent?: (id: string, content: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  /** 卡片底部「+」插槽 */
  footer?: React.ReactNode;
  /** 根节点右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const TextNodeInner: React.FC<TextNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  content = '',
  upstreamText = '',
  inheritedFrom = '',
  onUpdateEditor,
  onRemove,
  onEditContent,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 空内容（新建节点）时直接进入编辑态，方便即输即存
  const [isEditing, setIsEditing] = useState(() => !content.trim());
  const [editContent, setEditContent] = useState(content);

  // 外部内容变化（撤销/重做/历史恢复）时同步编辑草稿
  useEffect(() => {
    setEditContent(content);
  }, [content]);

  // 上游继承（本地优先语义）：
  // - 本地已有内容（含正在编辑的草稿）→ 本地优先，永不覆盖；
  // - 本地为空且该上游值未继承过 → 注入，并把 inheritedFrom 记入 node.data；
  // - 上游断开 → 抹掉 inheritedFrom（内容不动），以便重新连回同一来源时能再次继承。
  // 记录放在 node.data 而非组件内 ref：刷新 / 切页 / 手动清空三个动作判定一致——
  // 清空后刷新不会把上游内容「复活」（清空 = 明确不要该内容）。
  useEffect(() => {
    const upstream = upstreamText.trim();
    if (!upstream) {
      if (inheritedFrom) onUpdateEditor?.(id, { inheritedFrom: null });
      return;
    }
    if (inheritedFrom === upstream) return;
    // 空节点会自动进入编辑态：草稿也算「已有内容」，否则上游到达会冲掉用户正在输入的文字
    if (content.trim() || editContent.trim()) return;
    onUpdateEditor?.(id, { content: upstream, inheritedFrom: upstream });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamText]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  const handleSave = () => {
    onEditContent?.(id, editContent);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditContent(content);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  const renderActionBar = () => {
    if (isEditing) {
      return (
        <NodeActionBar>
          <NodeActionBar.Save onClick={handleSave} />
          <NodeActionBar.Cancel onClick={handleCancel} />
        </NodeActionBar>
      );
    }
    return (
      <NodeActionBar>
        <NodeActionBar.Edit onClick={() => setIsEditing(true)} />
        {content.trim() && (
          <NodeActionBar.Copy
            text={content}
            tooltip="复制文本内容"
            toastMessage="文本内容已复制到剪贴板"
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
      title={title || '文本'}
      dotColor={NODE_COLORS.text}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 400 }}
      showLeftAnchor={true}
      showRightAnchor={true}
      footer={footer}
      actionBar={renderActionBar()}
    >
      <div className="relative h-full flex flex-col flex-1 min-h-0">
        {isEditing ? (
          <div className="flex flex-col flex-1 min-h-0 gap-2">
            <Textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入 Markdown 文本…（支持标题、列表、代码块等，Ctrl+Enter 保存）"
              className="flex-1 min-h-0 w-full resize-none"
            />
          </div>
        ) : (
          /* 查看态：复用 canvas 公共 Markdown 渲染组件（与图片分析 / 文本生成节点一致） */
          <div className="w-full min-w-0 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {content.trim() ? (
              <MarkdownContent content={content} className="w-full min-w-0 font-sans text-sm leading-relaxed" />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center min-h-[120px]">
                <p className="text-xs text-ink-faint font-sans">暂无内容</p>
                <button
                  onClick={() => setIsEditing(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-sans text-accent border border-dashed border-accent/40 hover:bg-accent/10 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Pencil size={11} strokeWidth={2} />
                  点击编辑
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </CanvasNode>
  );
};

export const TextNode = memo(TextNodeInner);
TextNode.displayName = 'TextNode';
export default TextNode;

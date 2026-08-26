import React, { memo, useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Textarea } from '../../../platform/components/ui/Textarea';
import { NODE_COLORS } from '../nodeTypes';

export interface TextNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** Markdown 文本内容 */
  content?: string;
  /** 连线上级文本节点传入的内容（连线即输入，写入后仍可手动编辑，与文本翻译节点同口径） */
  upstreamText?: string;
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

  // 上级连线文本到达时写入内容；仅在上游文本本身变化时注入一次，
  // 手动编辑保存后的内容不被覆盖（与文本翻译节点同口径）
  const lastUpstreamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!upstreamText.trim() || lastUpstreamRef.current === upstreamText) return;
    lastUpstreamRef.current = upstreamText;
    if (upstreamText !== content) {
      onEditContent?.(id, upstreamText);
    }
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
          /* 查看态：复用公共 Markdown 渲染组件（与图片分析 / 提示词节点一致） */
          <div className="w-full min-w-0 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {content.trim() ? (
              <div className="w-full min-w-0 font-sans text-sm leading-relaxed">
                <Streamdown
                  plugins={{ cjk, code }}
                  isAnimating={false}
                  caret="block"
                  linkSafety={{ enabled: false }}
                >
                  {normalizeMarkdown(content)}
                </Streamdown>
              </div>
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

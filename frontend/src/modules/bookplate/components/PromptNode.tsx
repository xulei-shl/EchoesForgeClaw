import React, { memo, useState, useRef, useEffect } from 'react';
import { Pencil, Check, X, RefreshCw, AlertTriangle } from 'lucide-react';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { Textarea } from '../../../platform/components/ui/Textarea';
import { AgentActivity } from '../../../platform/components/agent/AgentActivity';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import type { AgentStep } from '../../../platform/types';

export interface PromptNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  content: string;
  /** Agent 模式中间步骤（工具调用 / 思考状态） */
  agentSteps?: AgentStep[];
  /** Agent 名称（该节点配置为 agent 模式时展示） */
  agentName?: string;
  isGenerating: boolean;
  error?: string | null;
  onRemove?: (id: string) => void;
  /** 重新生成（基于上游图书元数据 + 图片分析结果重新流式生成） */
  onRetry?: (id: string) => void;
  onEditContent?: (id: string, content: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  /** 卡片底部「+」插槽 */
  footer?: React.ReactNode;
  /** 根节点右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 所属自定义分组（配置了分组时在标题旁展示小标签） */
  group?: string;
}

const PromptNodeInner: React.FC<PromptNodeProps> = ({
  id,
  initialX,
  initialY,
  content,
  agentSteps,
  agentName,
  isGenerating,
  error,
  onRemove,
  onRetry,
  onEditContent,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  group,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditContent(content);
  }, [content]);

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

  const actionBtn =
    'flex items-center justify-center w-7 h-7 rounded-full ' +
    'text-ink-light hover:text-ink hover:bg-paper-grid/40 ' +
    'active:scale-[0.97] transition ' +
    'disabled:opacity-40 disabled:cursor-not-allowed ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  const renderActionBar = () => {
    if (isGenerating) return undefined;

    if (isEditing) {
      return (
        <>
          <Tooltip content="保存 (Ctrl+Enter)">
            <button onClick={handleSave} className={actionBtn}>
              <Check size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
          <Tooltip content="取消 (Esc)">
            <button onClick={handleCancel} className={actionBtn}>
              <X size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </>
      );
    }

    if (!content && !error) return undefined;

    return (
      <>
        {(error || content) && onRetry && (
          <Tooltip content={error ? '重试' : '重新生成'}>
            <button
              onClick={() => onRetry?.(id)}
              className={actionBtn + (error ? ' text-error hover:text-error hover:bg-error/10' : '')}
            >
              <RefreshCw size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
        {content && onEditContent && (
          <Tooltip content="编辑">
            <button onClick={() => setIsEditing(true)} className={actionBtn}>
              <Pencil size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
      </>
    );
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title="图像提示词"
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 500 }}
      className={`transition-[box-shadow,border-color,opacity] duration-200 ${isGenerating && !content ? 'border-transparent' : ''}`}
      glowOverlay={isGenerating && !content ? <BeamGlow /> : undefined}
      showLeftAnchor={true}
      showRightAnchor={true}
      footer={footer}
      groupBadge={group}
      actionBar={renderActionBar()}
    >
      <div className="relative h-full flex flex-col flex-1 min-h-0">
        <AgentActivity
          steps={agentSteps}
          agentName={agentName}
          running={isGenerating && !!agentName}
        />
        <div className="relative z-10 flex flex-col h-full flex-1 min-h-0">
          {isEditing ? (
            <div className="flex flex-col flex-1 min-h-0 gap-2">
              <Textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 min-h-0 w-full resize-none"
              />
            </div>
          ) : (!content && isGenerating) ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 h-full min-h-[120px]">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-3 h-3 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-sm font-serif text-accent">构思提示词中...</span>
            </div>
          ) : (
            /* 流式 Markdown：Streamdown（内置 GFM + CJK 插件 + 流式光标） */
            <div className="w-full min-w-0 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              <div className="w-full min-w-0 font-sans text-sm leading-relaxed">
                {error && !isGenerating && (
                  <div className="mb-3 p-3 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
                    <AlertTriangle size={14} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 font-sans">
                      <p className="text-[12px] text-error/90 leading-relaxed break-words">{error}</p>
                    </div>
                  </div>
                )}
                <Streamdown
                  plugins={{ cjk, code }}
                  isAnimating={isGenerating}
                  caret="block"
                  linkSafety={{ enabled: false }}
                >
                  {normalizeMarkdown(content) || (!error ? '等待上游数据，点击「+」添加节点或运行' : '')}
                </Streamdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const PromptNode = memo(PromptNodeInner);
PromptNode.displayName = 'PromptNode';
export default PromptNode;

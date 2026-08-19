import React, { memo, useState, useRef, useEffect } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { Textarea } from '../../../platform/components/ui/Textarea';
import { AgentActivity } from '../../../platform/components/agent/AgentActivity';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { NodeRunPlaceholder } from '../../../platform/components/node/NodeRunPlaceholder';
import type { AgentStep, InjectedContextBlock, NodeRunSettings } from '../../../platform/types';
import { NODE_COLORS } from '../nodeTypes';
import { NodeSettingsPopover } from './NodeSettingsPopover';
import { ContextInjectionBlock } from './ContextInjectionBlock';

export interface TextGenerationNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  content: string;
  agentSteps?: AgentStep[];
  agentName?: string;
  isGenerating: boolean;
  error?: string | null;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  onEditContent?: (id: string, content: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  group?: string;
  onRun?: (id: string) => void;
  settings?: NodeRunSettings;
  /** 注入的上下文块（文本上级 / 图书元数据 / 图片分析等，折叠卡片展示） */
  contextBlocks?: InjectedContextBlock[];
  onUpdateSettings?: (id: string, settings: NodeRunSettings) => void;
  hasBookInfo?: boolean;
  mismatchBadge?: string | null;
  hasDownstream?: boolean;
  mode?: 'llm' | 'agent' | 'skill_agent';
  configId?: number | null;
}

const TextGenerationNodeInner: React.FC<TextGenerationNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
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
  onRun,
  settings,
  contextBlocks,
  onUpdateSettings,
  hasBookInfo,
  mismatchBadge,
  hasDownstream,
  mode,
  configId,
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

  const renderActionBar = () => {
    if (isGenerating) return undefined;

    if (isEditing) {
      return (
        <NodeActionBar>
          <NodeActionBar.Save onClick={handleSave} disabled={hasDownstream} />
          <NodeActionBar.Cancel onClick={handleCancel} />
        </NodeActionBar>
      );
    }

    if (!content && !error) {
      return (
        <NodeActionBar>
          {onRun && (
            <NodeActionBar.Run onClick={() => onRun?.(id)} hasDownstream={hasDownstream} />
          )}
          {onUpdateSettings && settings && (
            <NodeSettingsPopover
              settings={settings}
              onChange={(s) => onUpdateSettings?.(id, s)}
              disabled={hasDownstream}
              hasBookInfo={hasBookInfo}
              showModelOption
              mode={mode}
              configId={configId}
            />
          )}
        </NodeActionBar>
      );
    }

    return (
      <NodeActionBar>
        {(error || content) && onRetry && (
          <NodeActionBar.Retry
            onClick={() => onRetry?.(id)}
            hasDownstream={hasDownstream}
            error={!!error}
          />
        )}
        {content && onEditContent && (
          <NodeActionBar.Edit onClick={() => setIsEditing(true)} hasDownstream={hasDownstream} />
        )}
        {onUpdateSettings && settings && (
          <NodeSettingsPopover
            settings={settings}
            onChange={(s) => onUpdateSettings?.(id, s)}
            disabled={isGenerating || hasDownstream}
            hasBookInfo={hasBookInfo}
            showModelOption
            mode={mode}
            configId={configId}
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
      title={title || "AI 文本生成"}
      dotColor={NODE_COLORS.text_generation}
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
      mismatchBadge={mismatchBadge}
      actionBar={renderActionBar()}
    >
      <div className="relative h-full flex flex-col flex-1 min-h-0">
        <AgentActivity
          steps={agentSteps}
          agentName={agentName}
          running={isGenerating && !!agentName}
        />
        <div className="relative z-10 flex flex-col h-full flex-1 min-h-0">
          {/* 顶部展示各个上级节点的上下文注入折叠块（与 ImageNode / ChatNode 共用组件） */}
          {contextBlocks && contextBlocks.length > 0 && (
            <div className="space-y-1.5 shrink-0 mb-2">
              {contextBlocks.map((block) => (
                <ContextInjectionBlock key={block.id} block={block} />
              ))}
            </div>
          )}

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
              <span className="text-sm font-serif text-accent">生成文本内容中...</span>
            </div>
          ) : (!content && !error) ? (
            <NodeRunPlaceholder
              icon={
                <div className="w-10 h-10 rounded-full bg-paper shadow-sm border border-paper-grid flex items-center justify-center overflow-hidden">
                  <div className="absolute inset-0 bg-ink-faint/5 animate-pulse" />
                  <Sparkles size={16} strokeWidth={1.5} className="opacity-50" />
                </div>
              }
              text="连线上游节点后点击 ▶ 运行"
              subtext="支持文本 / 图片分析 / 图书元数据"
            />
          ) : (
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
                  {normalizeMarkdown(content)}
                </Streamdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const TextGenerationNode = memo(TextGenerationNodeInner);
TextGenerationNode.displayName = 'TextGenerationNode';
export default TextGenerationNode;
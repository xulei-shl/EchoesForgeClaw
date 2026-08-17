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
import type { AgentStep, NodeRunSettings } from '../../../platform/types';
import { NODE_COLORS } from '../nodeTypes';
import { NodeSettingsPopover } from './NodeSettingsPopover';

export interface PromptNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
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
  /** 手动运行（待运行态点击「运行」触发） */
  onRun?: (id: string) => void;
  /** 运行设置（包含图书元数据） */
  settings?: NodeRunSettings;
  onUpdateSettings?: (id: string, settings: NodeRunSettings) => void;
  /** 画布是否已有图书元数据节点 */
  hasBookInfo?: boolean;
  /** 标题旁的类型不匹配提示 */
  mismatchBadge?: string | null;
  /** 是否有下级关联节点 */
  hasDownstream?: boolean;
  /** 节点执行模式：仅 LLM 模式展示「模型」下拉（Agent 模式由 Agent 侧决定模型） */
  mode?: 'llm' | 'agent' | 'skill_agent';
  /** 绑定的节点配置 id（拉取服务商模型列表用） */
  configId?: number | null;
}

const PromptNodeInner: React.FC<PromptNodeProps> = ({
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

    // 待运行态（无内容、无错误）：提供手动「运行」按钮 + 运行设置
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
      title={title || "图像提示词"}
      dotColor={NODE_COLORS.prompt_generation}
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

export const PromptNode = memo(PromptNodeInner);
PromptNode.displayName = 'PromptNode';
export default PromptNode;

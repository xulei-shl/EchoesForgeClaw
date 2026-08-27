import React, { useEffect, useState } from 'react';
import { BookOpen, Bot, Globe, Heart, Palette, Trash2 } from 'lucide-react';
import type { Generation } from '../../types';
import { generationMeta, generationNodeTypeLabel } from '../../utils/generation';
import { formatDateTime } from '../../utils/format';

export interface GenerationCardProps {
  gen: Generation;
  /** 当前是否处于选中（详情面板打开）状态 */
  active?: boolean;
  onOpen: () => void;
  onToggleFavorite?: (gen: Generation) => void;
  onTogglePublic?: (gen: Generation) => void;
  onOpenInCanvas?: (gen: Generation) => void;
  onRemove?: (gen: Generation) => void;
  /** 删除按钮的 tooltip（收藏页为「取消收藏」） */
  removeTitle?: string;
}

export const GenerationCard: React.FC<GenerationCardProps> = ({
  gen,
  active,
  onOpen,
  onToggleFavorite,
  onTogglePublic,
  onOpenInCanvas,
  onRemove,
  removeTitle = '删除记录',
}) => {
  const { title, author, cover, imageUrl, agentSteps } = generationMeta(gen);
  const thumb = imageUrl || cover;
  // 缩略图加载失败时显示占位图标（历史记录的封面 URL 可能已失效/被豆瓣限流）
  const [thumbFailed, setThumbFailed] = useState(false);

  useEffect(() => {
    setThumbFailed(false);
  }, [thumb]);

  const ghostBtn =
    'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-sans text-ink-light ' +
    'hover:text-ink hover:bg-paper-grid/30 active:scale-[0.96] rounded transition-transform transition-colors ' +
    'disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <div
      onClick={onOpen}
      className={`flex items-center gap-4 px-4 py-3.5 border-b border-paper-grid/50 transition-colors cursor-pointer ${
        active ? 'bg-accent-surface' : 'hover:bg-accent-surface/50'
      }`}
    >
      {/* 缩略图 */}
      <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-md overflow-hidden bg-paper flex items-center justify-center border border-paper-grid/60 shadow-[0_1px_3px_rgba(43,41,38,0.05)]">
        {thumb && !thumbFailed ? (
          <img
            src={thumb}
            alt={title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <BookOpen size={20} strokeWidth={1.5} className="text-ink-faint" />
        )}
      </div>

      {/* 元数据 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-serif text-base font-semibold text-ink truncate">{title}</h3>
          {/* 节点类型徽标 */}
          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-sm bg-paper border border-paper-grid/60 text-[10px] leading-none text-ink-faint font-sans">
            {generationNodeTypeLabel(gen.node_type)}
          </span>
        </div>
        <p className="text-[13px] text-ink-light font-sans mt-0.5 truncate">{author}</p>
        <p className="text-xs text-ink-faint font-sans mt-0.5 tabular-nums">
          {formatDateTime(gen.created_at)}
          {gen.username ? ` · ${gen.username}` : ''}
        </p>
        {/* Agent 运行过程标记 */}
        {agentSteps.length > 0 && (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-sans text-accent">
            <Bot size={11} strokeWidth={1.5} />
            Agent 运行 · {agentSteps.length} 步
          </p>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        {onOpenInCanvas && (
          <button
            type="button"
            className={ghostBtn}
            title="在画板中打开"
            onClick={() => onOpenInCanvas(gen)}
          >
            <Palette size={14} strokeWidth={1.5} />
            <span className="hidden sm:inline">画板</span>
          </button>
        )}
        {onToggleFavorite && (
          <button
            type="button"
            className={ghostBtn}
            title={gen.is_favorited ? '取消收藏' : '收藏'}
            onClick={() => onToggleFavorite(gen)}
          >
            <Heart
              size={14}
              strokeWidth={1.5}
              className={gen.is_favorited ? 'fill-accent text-accent' : ''}
            />
            <span className="hidden sm:inline">收藏</span>
          </button>
        )}
        {onTogglePublic && (
          <button
            type="button"
            className={ghostBtn}
            title={gen.is_public ? '从画廊撤下' : '公开到画廊'}
            onClick={() => onTogglePublic(gen)}
          >
            <Globe size={14} strokeWidth={1.5} className={gen.is_public ? 'text-accent' : ''} />
            <span className="hidden sm:inline">公开</span>
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            className={`${ghostBtn} text-ink-faint hover:text-error`}
            title={removeTitle}
            onClick={() => onRemove(gen)}
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
};

export default GenerationCard;

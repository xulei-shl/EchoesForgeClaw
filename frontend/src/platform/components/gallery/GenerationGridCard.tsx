import React, { useEffect, useState } from 'react';
import { BookOpen, Bot, Globe, Heart, Palette, Trash2 } from 'lucide-react';
import type { Generation } from '../../types';
import { generationMeta, generationNodeTypeLabel } from '../../utils/generation';
import { formatDateTime } from '../../utils/format';

export interface GenerationGridCardProps {
  gen: Generation;
  active?: boolean;
  onOpen: () => void;
  onToggleFavorite?: (gen: Generation) => void;
  onTogglePublic?: (gen: Generation) => void;
  onOpenInCanvas?: (gen: Generation) => void;
  onRemove?: (gen: Generation) => void;
  removeTitle?: string;
}

export const GenerationGridCard: React.FC<GenerationGridCardProps> = ({
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
  const [thumbFailed, setThumbFailed] = useState(false);

  useEffect(() => {
    setThumbFailed(false);
  }, [thumb]);

  const iconBtn =
    'p-1.5 rounded-full bg-paper/90 backdrop-blur-sm text-ink-light hover:text-ink ' +
    'hover:bg-paper active:scale-[0.92] transition-transform transition-colors ' +
    'shadow-[0_2px_6px_rgba(43,41,38,0.12)] border border-paper-grid/40 ' +
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

  return (
    <div
      onClick={onOpen}
      className={`group relative flex flex-col rounded-lg bg-node-bg border border-paper-grid/70 overflow-hidden cursor-pointer shadow-[0_2px_8px_rgba(43,41,38,0.04)] hover:shadow-[0_6px_20px_rgba(43,41,38,0.08)] transition-all duration-200 hover:-translate-y-0.5 ${
        active ? 'ring-2 ring-accent border-transparent' : ''
      }`}
    >
      {/* 图像大图区 */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-paper flex items-center justify-center border-b border-paper-grid/40">
        {thumb && !thumbFailed ? (
          <img
            src={thumb}
            alt={title}
            loading="lazy"
            onError={() => setThumbFailed(true)}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-ink-faint">
            <BookOpen size={28} strokeWidth={1.2} />
            <span className="text-[11px] font-sans">暂无预览图</span>
          </div>
        )}

        {/* 节点类型角标 */}
        <div className="absolute left-2.5 top-2.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-paper/90 backdrop-blur-sm text-[10px] font-sans font-medium text-ink-light border border-paper-grid/40 shadow-sm">
            {generationNodeTypeLabel(gen.node_type)}
          </span>
        </div>

        {/* 右上角悬浮快捷操作栏 */}
        <div
          className="absolute right-2.5 top-2.5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 sm:opacity-90 transition-opacity duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          {onOpenInCanvas && (
            <button
              type="button"
              className={iconBtn}
              title="在画板中打开"
              onClick={() => onOpenInCanvas(gen)}
            >
              <Palette size={13} strokeWidth={1.75} />
            </button>
          )}

          {onToggleFavorite && (
            <button
              type="button"
              className={iconBtn}
              title={gen.is_favorited ? '取消收藏' : '收藏'}
              onClick={() => onToggleFavorite(gen)}
            >
              <Heart
                size={13}
                strokeWidth={1.75}
                className={gen.is_favorited ? 'fill-accent text-accent' : ''}
              />
            </button>
          )}

          {onTogglePublic && (
            <button
              type="button"
              className={iconBtn}
              title={gen.is_public ? '从画廊撤下' : '公开到画廊'}
              onClick={() => onTogglePublic(gen)}
            >
              <Globe
                size={13}
                strokeWidth={1.75}
                className={gen.is_public ? 'text-accent' : ''}
              />
            </button>
          )}

          {onRemove && (
            <button
              type="button"
              className={`${iconBtn} hover:text-error`}
              title={removeTitle}
              onClick={() => onRemove(gen)}
            >
              <Trash2 size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {/* 底部信息区 */}
      <div className="p-3.5 flex-1 flex flex-col justify-between">
        <div>
          <h3
            className="font-serif text-sm font-bold text-ink truncate leading-tight group-hover:text-accent transition-colors"
            title={title}
          >
            {title}
          </h3>
          {author && (
            <p className="text-xs text-ink-light font-sans mt-1 truncate" title={author}>
              {author}
            </p>
          )}
        </div>

        <div className="mt-3 pt-2.5 border-t border-paper-grid/40 flex items-center justify-between text-[11px] text-ink-faint font-sans tabular-nums">
          <span>{formatDateTime(gen.created_at)}</span>
          {agentSteps.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-accent">
              <Bot size={11} strokeWidth={1.5} />
              {agentSteps.length} 步
            </span>
          ) : (
            <span>{gen.username || ''}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default GenerationGridCard;

import React, { useState } from 'react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { Streamdown, cjk } from '../../shared/utils/markdown';
import { normalizeMarkdown } from '../../shared/utils/normalizeMarkdown';
import { AgentActivity } from '../../shared/components/agent/AgentActivity';
import { Drawer } from '../../shared/components/ui/Drawer';
import {
  Download,
  Globe,
  Heart,
  Loader2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Palette,
  ExternalLink,
} from 'lucide-react';
import type { Generation } from '../../shared/types';
import { generationMeta, generationNodeTypeLabel } from '../../shared/utils/generation';
import { formatDateTime } from '../../shared/utils/format';

export interface GenerationDetailPanelProps {
  gen: Generation | null;
  onClose: () => void;
  onToggleFavorite: (gen: Generation) => Promise<boolean>;
  onTogglePublic: (gen: Generation) => Promise<boolean>;
  onRemove: (gen: Generation) => Promise<boolean>;
  onOpenInCanvas?: (gen: Generation) => void;
  canManage?: boolean;
  canRemove?: boolean;
  removeTitle?: string;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
}

export const GenerationDetailPanel: React.FC<GenerationDetailPanelProps> = ({
  gen,
  onClose,
  onToggleFavorite,
  onTogglePublic,
  onRemove,
  onOpenInCanvas,
  canManage = true,
  canRemove = true,
  removeTitle = '删除记录',
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}) => {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const meta = gen ? generationMeta(gen) : null;

  const run = async (fn: (g: Generation) => Promise<boolean>, okMsg: string) => {
    if (!gen) return;
    setBusy(true);
    setNotice(null);
    try {
      const ok = await fn(gen);
      setNotice(ok ? okMsg : '操作失败，请重试');
    } catch (e: any) {
      setNotice(e?.message || '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!gen || !meta?.imageUrl) return;
    setBusy(true);
    setNotice(null);
    try {
      // 1. 下载图片
      const res = await fetch(meta.imageUrl);
      const blob = await res.blob();
      const ext = meta.imageUrl.split('.').pop() || 'png';

      const imgLink = document.createElement('a');
      imgLink.href = URL.createObjectURL(blob);
      imgLink.download = `bookplate-${gen.id}.${ext}`;
      document.body.appendChild(imgLink);
      imgLink.click();
      imgLink.remove();
      URL.revokeObjectURL(imgLink.href);

      await new Promise((r) => setTimeout(r, 150));

      // 2. 生成并下载 Markdown
      const mdParts = [`# ${meta.title || '未命名图像'}\n`];

      const metaFields = [
        meta.author && `- **作者**: ${meta.author}`,
        meta.translator && `- **译者**: ${meta.translator}`,
        meta.subtitle && `- **副标题**: ${meta.subtitle}`,
        meta.publisher && `- **出版社**: ${meta.publisher}`,
        meta.producer && `- **出品方**: ${meta.producer}`,
        meta.series && `- **丛书**: ${meta.series}`,
        meta.pub_year && `- **出版时间**: ${meta.pub_year}`,
        meta.isbn && `- **ISBN**: ${meta.isbn}`,
        meta.rating ? `- **豆瓣评分**: ${meta.rating}` : null,
        meta.url && `- **相关链接**: ${meta.url}`,
      ].filter(Boolean);

      if (metaFields.length > 0) {
        mdParts.push(`## 图书元数据\n\n${metaFields.join('\n')}\n`);
      }

      if (meta.summary) {
        mdParts.push(`## 内容摘要\n\n${meta.summary}\n`);
      }

      if (meta.prompt) {
        mdParts.push(`## 生成提示词\n\n${meta.prompt}\n`);
      }

      if (meta.agentSteps.length > 0) {
        const stepLines = meta.agentSteps.map((s) => {
          if (s.type === 'agent_tool_call') {
            const args = s.arguments ? `\n\n    \`\`\`json\n    ${s.arguments}\n    \`\`\`` : '';
            return `- 调用工具 **${s.name || '未知工具'}**${args}`;
          }
          if (s.type === 'agent_tool_result') {
            const result = s.result
              ? `\n\n    ${s.result.slice(0, 500)}${s.result.length > 500 ? '…' : ''}`
              : '';
            return `- **${s.name || '工具'}** 返回结果${result}`;
          }
          return `- 状态：${s.message || '更新'}`;
        });
        mdParts.push(`## Agent 运行过程（${meta.agentSteps.length} 步）\n\n${stepLines.join('\n')}\n`);
      }

      const mdContent = mdParts.join('\n');
      const mdBlob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });

      const mdLink = document.createElement('a');
      mdLink.href = URL.createObjectURL(mdBlob);
      mdLink.download = `bookplate-${gen.id}.md`;
      document.body.appendChild(mdLink);
      mdLink.click();
      mdLink.remove();
      URL.revokeObjectURL(mdLink.href);

      setNotice('已开始下载文件');
    } catch {
      setNotice('下载失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const ghostBtn =
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-sans text-ink-light ' +
    'hover:text-ink hover:bg-paper-grid/30 active:scale-[0.96] transition-transform transition-colors rounded-md ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  // 顶部导航按钮
  const navHeader = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onPrev}
        disabled={!hasPrev}
        aria-label="上一条作品 (←)"
        title="上一条 (←)"
        className="p-1.5 rounded-md text-ink-light hover:text-ink hover:bg-paper-grid/30 active:scale-[0.94] transition-all disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <ChevronLeft size={18} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext}
        aria-label="下一条作品 (→)"
        title="下一条 (→)"
        className="p-1.5 rounded-md text-ink-light hover:text-ink hover:bg-paper-grid/30 active:scale-[0.94] transition-all disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <ChevronRight size={18} strokeWidth={1.75} />
      </button>
      <div className="h-4 w-px bg-paper-grid/50 mx-1" />
    </div>
  );

  return (
    <Drawer
      isOpen={!!gen && !!meta}
      onClose={onClose}
      title="作品详情"
      headerRight={navHeader}
      footer={
        gen && meta ? (
          <>
            {busy && (
              <Loader2 size={16} strokeWidth={1.5} className="text-accent animate-spin mr-auto" />
            )}

            {onOpenInCanvas && (
              <button
                type="button"
                className={ghostBtn}
                title="在画板中打开继续创作"
                disabled={busy}
                onClick={() => onOpenInCanvas(gen)}
              >
                <Palette size={15} strokeWidth={1.5} />
                在画板中打开
              </button>
            )}

            <button
              type="button"
              className={ghostBtn}
              title={gen.is_favorited ? '取消收藏' : '收藏'}
              disabled={busy}
              onClick={() => run(onToggleFavorite, gen.is_favorited ? '已取消收藏' : '已收藏')}
            >
              <Heart
                size={15}
                strokeWidth={1.5}
                className={gen.is_favorited ? 'fill-accent text-accent' : ''}
              />
              收藏
            </button>

            {canManage && (
              <button
                type="button"
                className={ghostBtn}
                title={gen.is_public ? '从画廊撤下' : '公开到画廊'}
                disabled={busy}
                onClick={() => run(onTogglePublic, gen.is_public ? '已撤下公开' : '已公开到画廊')}
              >
                <Globe size={15} strokeWidth={1.5} className={gen.is_public ? 'text-accent' : ''} />
                公开
              </button>
            )}

            <button
              type="button"
              className={ghostBtn}
              title="下载作品与元数据"
              disabled={busy || !meta.imageUrl}
              onClick={handleDownload}
            >
              <Download size={15} strokeWidth={1.5} />
              下载
            </button>

            {canRemove && (
              <button
                type="button"
                className={`${ghostBtn} text-ink-faint hover:text-error`}
                title={removeTitle}
                disabled={busy}
                onClick={() => run(onRemove, '已删除')}
              >
                <Trash2 size={15} strokeWidth={1.5} />
                删除
              </button>
            )}
          </>
        ) : null
      }
    >
      {gen && meta && (
        <>
          {/* 作品大图 */}
          {meta.imageUrl ? (
            <div className="relative group border border-paper-grid/70 rounded-lg p-2 bg-node-bg/60 h-64 sm:h-72 max-h-[300px] flex items-center justify-center overflow-hidden shadow-inner">
              <PhotoProvider maskOpacity={0.85} bannerVisible={false}>
                <PhotoView src={meta.imageUrl}>
                  <img
                    src={meta.imageUrl}
                    alt={meta.title}
                    className="max-h-full max-w-full object-contain rounded-md shadow-sm cursor-pointer group-hover:opacity-95 active:scale-[0.98] transition-all outline outline-1 outline-[oklch(0_0_0/0.08)] outline-offset-[-1px]"
                    title="点击全屏查看"
                    loading="lazy"
                  />
                </PhotoView>
              </PhotoProvider>

              <div className="absolute right-3 bottom-3 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-sm text-white/95 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-sm flex items-center gap-1 text-[11px] font-sans">
                <Maximize2 size={12} strokeWidth={2} />
                <span>全屏预览</span>
              </div>
            </div>
          ) : (
            <div className="h-40 border border-dashed border-paper-grid rounded-lg bg-node-bg/40 flex items-center justify-center text-sm text-ink-faint font-sans">
              暂无图片
            </div>
          )}

          {/* 图书与作品信息 */}
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-accent/10 text-accent font-sans text-xs font-medium">
                {generationNodeTypeLabel(gen.node_type)}
              </span>
              <span className="text-xs text-ink-faint font-sans tabular-nums">
                {formatDateTime(gen.created_at)}
              </span>
            </div>

            <h3
              className="font-serif text-xl font-bold text-ink leading-snug mt-2"
              style={{ textWrap: 'balance' }}
            >
              {meta.title}
            </h3>

            <div className="mt-3 text-sm text-ink-light font-sans space-y-2">
              {meta.author && (
                <div className="flex gap-2.5">
                  <span className="text-ink-faint w-16 shrink-0">作者</span>
                  <span className="flex-1 text-ink min-w-0 break-words">{meta.author}</span>
                </div>
              )}
              {meta.translator && (
                <div className="flex gap-2.5">
                  <span className="text-ink-faint w-16 shrink-0">译者</span>
                  <span className="flex-1 text-ink min-w-0 break-words">{meta.translator}</span>
                </div>
              )}
              {meta.subtitle && (
                <div className="flex gap-2.5">
                  <span className="text-ink-faint w-16 shrink-0">副标题</span>
                  <span className="flex-1 text-ink min-w-0 break-words">{meta.subtitle}</span>
                </div>
              )}
              {meta.publisher && (
                <div className="flex gap-2.5">
                  <span className="text-ink-faint w-16 shrink-0">出版社</span>
                  <span className="flex-1 text-ink min-w-0 break-words">{meta.publisher}</span>
                </div>
              )}
              {meta.producer && (
                <div className="flex gap-2.5">
                  <span className="text-ink-faint w-16 shrink-0">出品方</span>
                  <span className="flex-1 text-ink min-w-0 break-words">{meta.producer}</span>
                </div>
              )}
              {meta.series && (
                <div className="flex gap-2.5">
                  <span className="text-ink-faint w-16 shrink-0">丛书</span>
                  <span className="flex-1 text-ink min-w-0 break-words">{meta.series}</span>
                </div>
              )}
              {meta.pub_year && (
                <div className="flex gap-2.5">
                  <span className="text-ink-faint w-16 shrink-0">出版时间</span>
                  <span className="flex-1 text-ink tabular-nums min-w-0 break-words">
                    {meta.pub_year}
                  </span>
                </div>
              )}
              {meta.isbn && (
                <div className="flex gap-2.5">
                  <span className="text-ink-faint w-16 shrink-0">ISBN</span>
                  <span className="flex-1 font-mono text-[13px] text-ink tabular-nums min-w-0 break-words">
                    {meta.isbn}
                  </span>
                </div>
              )}
              {meta.rating ? (
                <div className="flex gap-2.5">
                  <span className="text-ink-faint w-16 shrink-0">豆瓣评分</span>
                  <span className="flex-1 text-ink tabular-nums min-w-0 break-words font-medium">
                    {meta.rating}
                  </span>
                </div>
              ) : null}
              {meta.url && (
                <div className="flex gap-2.5">
                  <span className="text-ink-faint w-16 shrink-0">相关链接</span>
                  <span className="flex-1 min-w-0 break-words">
                    <a
                      href={meta.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline inline-flex items-center gap-1 text-xs"
                    >
                      豆瓣页面
                      <ExternalLink size={12} strokeWidth={1.75} />
                    </a>
                  </span>
                </div>
              )}
            </div>

            {meta.summary && (
              <details className="mt-4 group border border-paper-grid/50 rounded-md p-2.5 bg-paper/50">
                <summary className="list-none [&::-webkit-details-marker]:hidden text-xs text-ink-faint cursor-pointer hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded flex items-center justify-between select-none">
                  <span className="font-medium text-ink-light">内容摘要</span>
                  <ChevronRight
                    size={14}
                    strokeWidth={1.75}
                    className="transition-transform group-open:rotate-90 text-ink-faint"
                  />
                </summary>
                <div
                  className="mt-2.5 pt-2 border-t border-paper-grid/30 text-[13px] leading-relaxed text-ink-light font-sans"
                  style={{ textWrap: 'pretty' }}
                >
                  {meta.summary.split('\n').map((line, i) => (
                    <p key={i} className="mb-1.5 last:mb-0">
                      {line}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* 生成提示词 */}
          {meta.prompt && (
            <div className="border-t border-paper-grid/60 pt-4">
              <div className="text-xs font-medium text-ink-faint font-sans mb-1.5">生成提示词</div>
              <div className="w-full min-w-0 overflow-x-hidden font-sans text-[13px] leading-relaxed p-3 bg-node-bg/70 rounded-md border border-paper-grid/50">
                <Streamdown
                  mode="static"
                  plugins={{ cjk }}
                  controls={false}
                  linkSafety={{ enabled: false }}
                >
                  {normalizeMarkdown(meta.prompt)}
                </Streamdown>
              </div>
            </div>
          )}

          {/* Agent 运行过程 */}
          {meta.agentSteps.length > 0 && (
            <div className="border-t border-paper-grid/60 pt-4">
              <AgentActivity key={gen.id} steps={meta.agentSteps} />
            </div>
          )}

          {notice && (
            <div className="text-xs text-accent font-sans text-right py-1 animate-fade-in">
              {notice}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
};

export default GenerationDetailPanel;

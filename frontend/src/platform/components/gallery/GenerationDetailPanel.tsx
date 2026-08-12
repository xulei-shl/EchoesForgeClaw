import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { Streamdown, cjk } from '../../utils/markdown';
import { normalizeMarkdown } from '../../utils/normalizeMarkdown';
import { AgentActivity } from '../agent/AgentActivity';
import { Download, Globe, Heart, Loader2, Trash2, X, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import type { Generation } from '../../types';
import { generationMeta, generationNodeTypeLabel } from '../../utils/generation';
import { formatDateTime } from '../../utils/format';

export interface GenerationDetailPanelProps {
  gen: Generation | null;
  onClose: () => void;
  /** 收藏切换（resolve 为是否成功，失败信息由调用方 toast 展示） */
  onToggleFavorite: (gen: Generation) => Promise<boolean>;
  /** 公开切换（resolve 为是否成功） */
  onTogglePublic: (gen: Generation) => Promise<boolean>;
  /** 删除/取消收藏（resolve 为是否成功） */
  onRemove: (gen: Generation) => Promise<boolean>;
  /** 是否展示「公开/删除」操作（画廊中他人的作品为 false） */
  canManage?: boolean;
  /** 是否展示「删除」操作（收藏页「取消收藏」始终可操作；删除记录仅限本人） */
  canRemove?: boolean;
  /** 删除按钮的 tooltip（收藏页为「取消收藏」） */
  removeTitle?: string;
  /** 是否有上一条 */
  hasPrev?: boolean;
  /** 是否有下一条 */
  hasNext?: boolean;
  /** 点击上一条 */
  onPrev?: () => void;
  /** 点击下一条 */
  onNext?: () => void;
}

export const GenerationDetailPanel: React.FC<GenerationDetailPanelProps> = ({
  gen,
  onClose,
  onToggleFavorite,
  onTogglePublic,
  onRemove,
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
      // handler 返回 false 表示失败（失败信息已由页面 toast 展示）
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

      // 稍微延迟，避免某些浏览器拦截连续下载
      await new Promise(r => setTimeout(r, 150));

      // 2. 生成并下载 Markdown
      const mdParts = [
        `# ${meta.title || '未命名藏书票'}\n`
      ];

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
        meta.url && `- **相关链接**: ${meta.url}`
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

      // Agent 运行过程：工具调用 / 返回结果 / 状态（持久化的中间步骤）
      if (meta.agentSteps.length > 0) {
        const stepLines = meta.agentSteps.map((s) => {
          if (s.type === 'agent_tool_call') {
            const args = s.arguments ? `\n\n    \`\`\`json\n    ${s.arguments}\n    \`\`\`` : '';
            return `- 调用工具 **${s.name || '未知工具'}**${args}`;
          }
          if (s.type === 'agent_tool_result') {
            const result = s.result ? `\n\n    ${s.result.slice(0, 500)}${s.result.length > 500 ? '…' : ''}` : '';
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
    'hover:text-ink hover:bg-paper-grid/30 active:scale-[0.97] transition rounded ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <AnimatePresence>
      {gen && meta && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 pointer-events-auto"
            style={{ background: 'rgba(43,41,38,0.08)' }}
            onClick={onClose}
          />

          {/* 详情面板 */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute right-0 top-0 h-full w-[520px] max-w-[92vw] bg-paper border-l border-dashed border-paper-grid shadow-[0_4px_16px_rgba(43,41,38,0.10)] flex flex-col pointer-events-auto"
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-4 h-[52px] shrink-0 border-b border-dashed border-paper-grid">
              <span className="font-serif text-lg text-ink">作品详情</span>
              <button
                onClick={onClose}
                className="p-2 rounded text-ink-light hover:text-ink hover:bg-paper-grid/30 active:scale-[0.97] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex items-center justify-center min-w-[40px] min-h-[40px] -mr-2"
                title="关闭"
              >
                <X size={20} strokeWidth={1.5} />
              </button>
            </div>

            {/* 悬浮导航按钮 */}
            {(onPrev !== undefined || onNext !== undefined) && (
              <>
                <button
                  onClick={onPrev}
                  disabled={!hasPrev}
                  className="absolute left-3 sm:left-4 top-[65%] -translate-y-1/2 z-10 p-2 rounded-full bg-paper/90 backdrop-blur border border-paper-grid shadow-[0_2px_8px_rgba(43,41,38,0.08)] text-ink-light hover:text-ink hover:bg-paper active:scale-[0.97] transition disabled:opacity-0 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex items-center justify-center min-w-[40px] min-h-[40px]"
                  title="上一条"
                >
                  <ChevronLeft size={20} strokeWidth={1.5} className="-ml-0.5" />
                </button>
                <button
                  onClick={onNext}
                  disabled={!hasNext}
                  className="absolute right-4 sm:right-6 top-[65%] -translate-y-1/2 z-10 p-2 rounded-full bg-paper/90 backdrop-blur border border-paper-grid shadow-[0_2px_8px_rgba(43,41,38,0.08)] text-ink-light hover:text-ink hover:bg-paper active:scale-[0.97] transition disabled:opacity-0 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex items-center justify-center min-w-[40px] min-h-[40px]"
                  title="下一条"
                >
                  <ChevronRight size={20} strokeWidth={1.5} className="-mr-0.5" />
                </button>
              </>
            )}

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 relative">
              {/* 作品大图 */}
              {meta.imageUrl ? (
                <div className="relative group border border-dashed border-paper-grid rounded-sm p-1.5 bg-node-bg">
                  <PhotoProvider
                    maskOpacity={0.8}
                    bannerVisible={false}
                  >
                    <PhotoView src={meta.imageUrl}>
                      <img 
                        src={meta.imageUrl} 
                        alt={meta.title} 
                        className="w-full rounded-[3px] cursor-pointer group-hover:opacity-95 active:scale-[0.99] transition" 
                        title="点击全屏查看"
                        loading="lazy" 
                      />
                    </PhotoView>
                  </PhotoProvider>
                  
                  {/* 全屏提示图标 */}
                  <div className="absolute right-3 bottom-3 p-1.5 rounded bg-black/40 backdrop-blur-sm text-white/90 opacity-60 group-hover:opacity-100 transition-opacity pointer-events-none shadow-sm flex items-center justify-center">
                    <Maximize2 size={16} strokeWidth={2} />
                  </div>
                </div>
              ) : (
                <div className="h-40 border border-dashed border-paper-grid rounded-sm bg-node-bg flex items-center justify-center text-sm text-ink-faint font-sans">
                  暂无图片
                </div>
              )}

              {/* 图书信息 */}
              <div>
                <h3 className="font-serif text-xl font-bold text-ink leading-snug" style={{ textWrap: 'balance' }}>
                  {meta.title}
                </h3>
                <div className="mt-3 text-sm text-ink-light font-sans space-y-1.5">
                  <div className="flex gap-2">
                    <span className="text-ink-faint w-14 shrink-0">作者</span>
                    <span className="flex-1 text-ink min-w-0 break-words">{meta.author}</span>
                  </div>
                  {meta.translator && (
                    <div className="flex gap-2">
                      <span className="text-ink-faint w-14 shrink-0">译者</span>
                      <span className="flex-1 text-ink min-w-0 break-words">{meta.translator}</span>
                    </div>
                  )}
                  {meta.subtitle && (
                    <div className="flex gap-2">
                      <span className="text-ink-faint w-14 shrink-0">副标题</span>
                      <span className="flex-1 text-ink min-w-0 break-words">{meta.subtitle}</span>
                    </div>
                  )}
                  {meta.publisher && (
                    <div className="flex gap-2">
                      <span className="text-ink-faint w-14 shrink-0">出版社</span>
                      <span className="flex-1 text-ink min-w-0 break-words">{meta.publisher}</span>
                    </div>
                  )}
                  {meta.producer && (
                    <div className="flex gap-2">
                      <span className="text-ink-faint w-14 shrink-0">出品方</span>
                      <span className="flex-1 text-ink min-w-0 break-words">{meta.producer}</span>
                    </div>
                  )}
                  {meta.series && (
                    <div className="flex gap-2">
                      <span className="text-ink-faint w-14 shrink-0">丛书</span>
                      <span className="flex-1 text-ink min-w-0 break-words">{meta.series}</span>
                    </div>
                  )}
                  {meta.pub_year && (
                    <div className="flex gap-2">
                      <span className="text-ink-faint w-14 shrink-0">出版时间</span>
                      <span className="flex-1 text-ink tabular-nums min-w-0 break-words">{meta.pub_year}</span>
                    </div>
                  )}
                  {meta.isbn && (
                    <div className="flex gap-2">
                      <span className="text-ink-faint w-14 shrink-0">ISBN</span>
                      <span className="flex-1 font-mono text-[13px] text-ink tabular-nums min-w-0 break-words">{meta.isbn}</span>
                    </div>
                  )}
                  {meta.rating ? (
                    <div className="flex gap-2">
                      <span className="text-ink-faint w-14 shrink-0">豆瓣评分</span>
                      <span className="flex-1 text-ink tabular-nums min-w-0 break-words">{meta.rating}</span>
                    </div>
                  ) : null}
                  {meta.url && (
                    <div className="flex gap-2">
                      <span className="text-ink-faint w-14 shrink-0">相关链接</span>
                      <span className="flex-1 min-w-0 break-words">
                        <a 
                          href={meta.url} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-accent hover:underline inline-flex items-center gap-1"
                        >
                          豆瓣页面
                          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                        </a>
                      </span>
                    </div>
                  )}
                </div>
                
                {meta.summary && (
                  <details className="mt-4 group">
                    <summary className="list-none [&::-webkit-details-marker]:hidden text-sm text-ink-faint cursor-pointer hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded w-max select-none">
                      <span className="inline-flex items-center gap-1">
                        内容摘要
                        <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                      </span>
                    </summary>
                    <div className="mt-2 text-[13px] leading-relaxed text-ink-light font-sans" style={{ textWrap: 'pretty' }}>
                      {meta.summary.split('\n').map((line, i) => (
                        <p key={i} className="mb-1 last:mb-0">{line}</p>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              {/* 提示词：Streamdown 静态模式渲染已保存的 markdown */}
              {meta.prompt && (
                <div className="border-t border-dashed border-paper-grid pt-3">
                  <div className="text-xs text-ink-faint font-sans mb-1.5">生成提示词</div>
                  <div className="w-full min-w-0 overflow-x-hidden font-sans text-[13px] leading-relaxed">
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

              {/* Agent 运行过程：历史记录持久化的中间步骤（工具调用 / 返回结果 / 状态） */}
              {meta.agentSteps.length > 0 && (
                <div className="border-t border-dashed border-paper-grid pt-3">
                  {/* key=gen.id：切换上/下一条时重置折叠状态 */}
                  <AgentActivity key={gen.id} steps={meta.agentSteps} />
                </div>
              )}

              {/* 元信息 */}
              <div className="border-t border-dashed border-paper-grid pt-3 text-xs text-ink-faint font-sans space-y-1">
                <div className="flex justify-between">
                  <span>创建时间</span>
                  <span className="tabular-nums">{formatDateTime(gen.created_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span>节点类型</span>
                  <span>{generationNodeTypeLabel(gen.node_type)}</span>
                </div>
                {gen.username && (
                  <div className="flex justify-between">
                    <span>分享者</span>
                    <span>{gen.username}</span>
                  </div>
                )}
              </div>

              {notice && <div className="text-xs text-ink-faint font-sans text-right">{notice}</div>}
            </div>

            {/* 操作栏 */}
            <div className="flex items-center justify-end gap-1 p-3 shrink-0 border-t border-dashed border-paper-grid">
              {busy && <Loader2 size={16} strokeWidth={1.5} className="text-accent animate-spin mr-auto" />}
              <button
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
                className={ghostBtn}
                title="下载图片"
                disabled={busy || !meta.imageUrl}
                onClick={handleDownload}
              >
                <Download size={15} strokeWidth={1.5} />
                下载
              </button>
              {canRemove && (
                <button
                  className={`${ghostBtn} text-ink-faint hover:text-error`}
                  title={removeTitle}
                  disabled={busy}
                  onClick={() => run(onRemove, '已删除')}
                >
                  <Trash2 size={15} strokeWidth={1.5} />
                  删除
                </button>
              )}
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
};

export default GenerationDetailPanel;

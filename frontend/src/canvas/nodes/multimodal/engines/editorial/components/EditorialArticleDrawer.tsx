import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { EditorialArticleData, EditorialState } from '../types';

export interface EditorialArticleDrawerProps {
  id: string;
  isOpen: boolean;
  article: EditorialArticleData;
  drawerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  setArticle: React.Dispatch<React.SetStateAction<EditorialArticleData>>;
  onUpdateState?: (id: string, patch: Partial<EditorialState>, undoable?: boolean) => void;
}

/** 文章结构编辑侧边抽屉组件 */
export const EditorialArticleDrawer: React.FC<EditorialArticleDrawerProps> = ({
  id,
  isOpen,
  article,
  drawerRef,
  onClose,
  setArticle,
  onUpdateState,
}) => {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          ref={drawerRef}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 10, transition: { duration: 0.1, ease: 'easeOut' } }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-y-2 right-2 w-72 max-w-[calc(100%-16px)] bg-paper/95 backdrop-blur-md border border-paper-grid/60 rounded-xl p-3 shadow-xl z-40 flex flex-col gap-2.5 overflow-y-auto text-xs text-ink select-text"
        >
          <div className="flex items-center justify-between font-medium text-ink pb-1 border-b border-paper-grid/40 select-none">
            <span>文章结构编辑</span>
            <button
              type="button"
              onClick={onClose}
              className="relative p-1 rounded-md text-ink-light hover:text-ink hover:bg-paper-grid/40 transition-colors before:absolute before:-inset-1 before:content-[''] cursor-pointer"
              aria-label="关闭文章编辑"
            >
              ✕
            </button>
          </div>

          <div>
            <label className="block text-[11px] font-sans text-ink-faint mb-1 select-none">
              刊头 / 眉标 (Masthead)
            </label>
            <input
              type="text"
              value={article.masthead || ''}
              onChange={(e) => {
                const masthead = e.target.value;
                setArticle((prev) => ({ ...prev, masthead }));
                onUpdateState?.(id, { article: { ...article, masthead } });
              }}
              className="w-full bg-paper/80 border border-dashed border-paper-grid rounded-md px-2.5 py-1 text-ink text-xs placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-sans text-ink-faint mb-1 select-none">
              打字机眉标 / 小标签 (Eyebrow)
            </label>
            <input
              type="text"
              value={article.eyebrow || ''}
              onChange={(e) => {
                const eyebrow = e.target.value;
                setArticle((prev) => ({ ...prev, eyebrow }));
                onUpdateState?.(id, { article: { ...article, eyebrow } });
              }}
              className="w-full bg-paper/80 border border-dashed border-paper-grid rounded-md px-2.5 py-1 text-ink text-xs placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-sans text-ink-faint mb-1 select-none">
              大标题 (Headline)
            </label>
            <input
              type="text"
              value={article.headline || ''}
              onChange={(e) => {
                const headline = e.target.value;
                setArticle((prev) => ({ ...prev, headline }));
                onUpdateState?.(id, { article: { ...article, headline } });
              }}
              className="w-full bg-paper/80 border border-dashed border-paper-grid rounded-md px-2.5 py-1 text-ink text-xs font-bold placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-sans text-ink-faint mb-1 select-none">
              导语 / 副标题 (Deck)
            </label>
            <textarea
              rows={2}
              value={article.deck || ''}
              onChange={(e) => {
                const deck = e.target.value;
                setArticle((prev) => ({ ...prev, deck }));
                onUpdateState?.(id, { article: { ...article, deck } });
              }}
              className="w-full bg-paper/80 border border-dashed border-paper-grid rounded-md px-2.5 py-1 text-ink text-xs placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none transition-colors"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1 select-none">
              <label className="block text-[11px] font-sans text-ink-faint">
                精彩引语 / 金句 (Pull Quote)
                <span className="text-[10px] opacity-60 ml-1">（选填，留空则无引文卡片）</span>
              </label>
              {article.pullquote && article.pullquote.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    setArticle((prev) => ({ ...prev, pullquote: '' }));
                    onUpdateState?.(id, { article: { ...article, pullquote: '' } }, true);
                  }}
                  className="text-[10px] text-accent hover:underline active:scale-[0.96] transition-transform"
                >
                  清空引文
                </button>
              )}
            </div>
            <textarea
              rows={2}
              placeholder="输入需要重点突出的引文金句，留空则正文无引文平滑排版..."
              value={article.pullquote || ''}
              onChange={(e) => {
                const pullquote = e.target.value;
                setArticle((prev) => ({ ...prev, pullquote }));
                onUpdateState?.(id, { article: { ...article, pullquote } });
              }}
              className="w-full bg-paper/80 border border-dashed border-paper-grid rounded-md px-2.5 py-1 text-ink text-xs placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-sans text-ink-faint mb-1 select-none">
              编者按 / 贴士 (Pro Tip)
            </label>
            <input
              type="text"
              value={article.proTip || ''}
              onChange={(e) => {
                const proTip = e.target.value;
                setArticle((prev) => ({ ...prev, proTip }));
                onUpdateState?.(id, { article: { ...article, proTip } });
              }}
              className="w-full bg-paper/80 border border-dashed border-paper-grid rounded-md px-2.5 py-1 text-ink text-xs placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            />
          </div>

          <div className="flex-1 flex flex-col min-h-[100px]">
            <label className="block text-[11px] font-sans text-ink-faint mb-1 select-none">
              正文全文 (Body)
            </label>
            <textarea
              rows={6}
              value={article.body || ''}
              onChange={(e) => {
                const body = e.target.value;
                setArticle((prev) => ({ ...prev, body }));
                onUpdateState?.(id, { article: { ...article, body } });
              }}
              className="w-full flex-1 bg-paper/80 border border-dashed border-paper-grid rounded-md px-2.5 py-1.5 text-ink text-xs placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none leading-relaxed transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-sans text-ink-faint mb-1 select-none">
              页脚版记 / 期号
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Folio"
                value={article.folio || ''}
                onChange={(e) => {
                  const folio = e.target.value;
                  setArticle((prev) => ({ ...prev, folio }));
                  onUpdateState?.(id, { article: { ...article, folio } });
                }}
                className="flex-1 bg-paper/80 border border-dashed border-paper-grid rounded-md px-2 py-1 text-ink text-xs focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              />
              <input
                type="text"
                placeholder="Date"
                value={article.issueDate || ''}
                onChange={(e) => {
                  const issueDate = e.target.value;
                  setArticle((prev) => ({ ...prev, issueDate }));
                  onUpdateState?.(id, { article: { ...article, issueDate } });
                }}
                className="w-24 bg-paper/80 border border-dashed border-paper-grid rounded-md px-2 py-1 text-ink text-xs focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

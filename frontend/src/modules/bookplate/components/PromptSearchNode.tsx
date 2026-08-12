import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileSearch, ImageOff, Loader2, Search, ChevronLeft, Check, Maximize2 } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import api from '../../../platform/services/api';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Dialog } from '../../../platform/components/ui/Dialog';
import { Button } from '../../../platform/components/ui/Button';
import { Input } from '../../../platform/components/ui/Input';
import { NODE_COLORS } from '../nodeTypes';
import type { BifrostPrompt, PromptSelection } from '../../../platform/types';

export interface PromptSearchNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 已选提示词的 Bifrost id（null = 未选择） */
  promptId?: string | null;
  promptName?: string;
  /** 已选提示词的正文文本（写入 data.content，作为对外文本输出） */
  content?: string;
  /** 已选提示词的本地预览图 */
  promptImage?: string | null;
  onUpdatePrompt?: (id: string, selection: PromptSelection) => void;
  onRemove?: () => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
}

/** 默认加载的提示词条数上限（展示层截断；检索仍走服务端全量 q） */
const MAX_LIST_ITEMS = 50;

const PromptSearchNodeInner: React.FC<PromptSearchNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  promptId,
  promptName = '',
  content = '',
  promptImage = null,
  onUpdatePrompt,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  hasDownstream,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [prompts, setPrompts] = useState<BifrostPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<BifrostPrompt | null>(null);
  // 悬停预览：跟随鼠标的浮层大图（fixed 覆盖层，portal 到 body 避免被画布 transform 裁剪）
  const [hoverPreview, setHoverPreview] = useState<{ x: number; y: number; url: string } | null>(null);
  // 请求序号：丢弃过期响应，防止快速输入时旧结果覆盖新结果
  const requestSeq = useRef(0);

  const loadPrompts = useCallback(async (keyword?: string) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError('');
    try {
      const res: { prompts: BifrostPrompt[] } = await api.get(
        '/modules/bookplate/bifrost/prompts',
        {
          params: keyword?.trim() ? { q: keyword.trim() } : {},
          timeout: 20000,
        }
      );
      if (seq !== requestSeq.current) return;
      setPrompts(res.prompts ?? []);
    } catch (e: any) {
      if (seq !== requestSeq.current) return;
      setError(e?.message || '加载提示词失败，请重试');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  const openPicker = useCallback(() => {
    setQ('');
    setDetail(null);
    setPrompts([]);
    // 首次加载交由下方搜索防抖 effect 触发（打开后 350ms 内完成），避免重复请求
    setLoading(true);
    setError('');
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setDetail(null);
    setHoverPreview(null);
  }, []);

  // 搜索防抖：输入停止 350ms 后按关键词重新加载
  useEffect(() => {
    if (!pickerOpen) return;
    const t = window.setTimeout(() => {
      void loadPrompts(q);
    }, 350);
    return () => window.clearTimeout(t);
  }, [pickerOpen, q, loadPrompts]);

  const handleSelect = (p: BifrostPrompt) => {
    onUpdatePrompt?.(id, {
      promptId: p.id,
      name: p.name,
      content: p.content,
      imageUrl: p.preview_image,
    });
    closePicker();
  };

  const formatDate = (s?: string | null) =>
    s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '';

  const renderList = () => (
    <div className="space-y-1.5">
      {loading && (
        <div className="py-10 flex items-center justify-center gap-2 text-sm text-ink-light font-sans">
          <Loader2 className="w-4 h-4 animate-spin text-accent" strokeWidth={1.5} />
          加载中...
        </div>
      )}
      {!loading && error && (
        <div className="py-10 text-center">
          <p className="text-sm text-error font-sans">{error}</p>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => void loadPrompts(q)}>
            重试
          </Button>
        </div>
      )}
      {!loading && !error && prompts.length === 0 && (
        <div className="py-10 flex flex-col items-center gap-2 text-center">
          <FileSearch size={30} strokeWidth={1} className="text-ink-faint" />
          <p className="text-sm text-ink-light font-sans">
            {q.trim() ? `没有匹配「${q.trim()}」的提示词` : '提示词库为空'}
          </p>
        </div>
      )}
      {!loading && !error && prompts.length > MAX_LIST_ITEMS && (
        <p className="text-xs text-ink-faint font-sans px-1 pt-1">
          共 {prompts.length} 条，仅显示前 {MAX_LIST_ITEMS} 条；输入关键词可精确检索
        </p>
      )}
      {!loading &&
        !error &&
        prompts.slice(0, MAX_LIST_ITEMS).map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 p-2.5 rounded-md cursor-pointer transition border border-transparent hover:border-paper-grid hover:bg-paper-grid/30 active:scale-[0.99]"
            onClick={() => {
              setHoverPreview(null);
              setDetail(p);
            }}
            onMouseEnter={(e) =>
              p.preview_image &&
              setHoverPreview({ x: e.clientX + 18, y: e.clientY + 12, url: p.preview_image })
            }
            onMouseMove={(e) =>
              p.preview_image &&
              setHoverPreview({ x: e.clientX + 18, y: e.clientY + 12, url: p.preview_image })
            }
            onMouseLeave={() => setHoverPreview(null)}
          >
            <div className="w-11 h-11 shrink-0 rounded overflow-hidden bg-paper border border-paper-grid flex items-center justify-center">
              {p.preview_image ? (
                <img src={p.preview_image} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <ImageOff size={16} strokeWidth={1.5} className="text-ink-faint" />
              )}
            </div>
            <div className="min-w-0 flex-1 py-0.5">
              <p className="text-sm font-medium text-ink truncate">{p.name}</p>
              <p className="text-xs text-ink-light line-clamp-2 leading-relaxed mt-1">{p.content || '（空内容）'}</p>
            </div>
            {p.folder_name && (
              <span className="shrink-0 text-[10px] text-ink-faint border border-dashed border-paper-grid rounded-pill px-1.5 py-px font-mono">
                {p.folder_name}
              </span>
            )}
          </div>
        ))}
    </div>
  );

  const renderDetail = () => {
    if (!detail) return null;
    return (
      <div className="space-y-3">
        <button
          onClick={() => setDetail(null)}
          className="flex items-center gap-1 text-sm text-accent hover:text-accent-hover font-sans active:scale-95 transition"
        >
          <ChevronLeft size={15} strokeWidth={1.5} />
          返回列表
        </button>
        <div className="rounded-md border border-dashed border-paper-grid bg-paper overflow-hidden">
          {detail.preview_image ? (
            <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
              <PhotoView src={detail.preview_image}>
                <div className="relative group cursor-pointer" title="点击全屏查看">
                  <img
                    src={detail.preview_image}
                    alt={detail.name}
                    className="w-full max-h-56 object-contain bg-paper group-hover:opacity-95 transition"
                  />
                  <div className="absolute right-3 bottom-3 p-1.5 rounded bg-black/40 backdrop-blur-sm text-white/90 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-sm flex items-center justify-center">
                    <Maximize2 size={16} strokeWidth={2} />
                  </div>
                </div>
              </PhotoView>
            </PhotoProvider>
          ) : (
            <div className="h-32 flex items-center justify-center">
              <ImageOff size={28} strokeWidth={1} className="text-ink-faint" />
            </div>
          )}
        </div>
        <div>
          <p className="font-serif text-base font-semibold text-ink">{detail.name}</p>
          <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs text-ink-light font-sans">
            {detail.folder_name && (
              <span className="border border-dashed border-paper-grid rounded-pill px-2 py-px font-mono">
                {detail.folder_name}
              </span>
            )}
            {typeof detail.version_number === 'number' && (
              <span className="font-mono">v{detail.version_number}</span>
            )}
            {detail.updated_at && <span>{formatDate(detail.updated_at)}</span>}
          </div>
        </div>
        <pre className="text-sm text-ink font-sans whitespace-pre-wrap leading-relaxed bg-paper border border-paper-grid rounded-md p-3 max-h-64 overflow-y-auto custom-scrollbar">
          {detail.content || '（空内容）'}
        </pre>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={closePicker}>
            关闭
          </Button>
          <Button size="sm" onClick={() => handleSelect(detail)}>
            <Check size={14} strokeWidth={2} className="mr-1" />
            选用此提示词
          </Button>
        </div>
      </div>
    );
  };

  const actionBar = promptId ? (
    <NodeActionBar>
      <NodeActionBar.Edit onClick={openPicker} hasDownstream={hasDownstream} />
    </NodeActionBar>
  ) : undefined;

  return (
    <>
      <CanvasNode
        id={id}
        initialX={initialX}
        initialY={initialY}
        title={title || '提示词检索'}
        dotColor={NODE_COLORS.prompt_search}
        onRemove={onRemove}
        onPositionChange={onPositionChange}
        onSizeChange={onSizeChange}
        onDrag={onDrag}
        onContextMenu={onContextMenu}
        resizable
        defaultSize={{ width: 420, height: 440 }}
        footer={footer}
        actionBar={actionBar}
        showLeftAnchor
        showRightAnchor
      >
        {!promptId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-paper border border-dashed border-paper-grid flex items-center justify-center">
              <FileSearch size={22} strokeWidth={1.5} className="text-ink-faint" />
            </div>
            <div>
              <p className="font-serif text-sm text-ink">尚未选择提示词</p>
              <p className="text-xs text-ink-light mt-0.5">从 Bifrost 提示词库检索并选用一条</p>
            </div>
            <Button size="sm" onClick={openPicker}>
              从提示词库选择
            </Button>
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-hidden gap-3">
            {promptImage && (
              <img
                src={promptImage}
                alt={promptName}
                className="w-full h-28 object-cover rounded-md border border-paper-grid shrink-0"
              />
            )}
            <div className="flex-1 overflow-y-auto min-h-0 pr-1.5 custom-scrollbar text-sm text-ink-light font-sans whitespace-pre-wrap leading-relaxed">
              {content || '（空内容）'}
            </div>
          </div>
        )}
      </CanvasNode>

      {/* 选择器弹窗：portal 到 body，避开画布节点 transform 对 fixed 定位的影响 */}
      {typeof document !== 'undefined' &&
        createPortal(
          <>
            <Dialog
              open={pickerOpen}
              onClose={closePicker}
              title="选择提示词"
              panelClassName="max-w-2xl"
            >
              <div className="space-y-3">
                <div className="relative">
                  <Search
                    size={15}
                    strokeWidth={1.5}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
                  />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="搜索提示词名称或内容…"
                    className="pl-9"
                    autoFocus
                  />
                </div>
                <div className="max-h-[52vh] overflow-y-auto -mx-2 px-2">
                  {detail ? renderDetail() : renderList()}
                </div>
              </div>
            </Dialog>
            {hoverPreview && (
              <div
                className="fixed z-[80] pointer-events-none"
                style={{ left: hoverPreview.x, top: hoverPreview.y }}
              >
                <div className="bg-paper border border-dashed border-paper-grid rounded-lg shadow-xl p-1.5">
                  <img
                    src={hoverPreview.url}
                    alt=""
                    className="w-48 h-48 object-cover rounded"
                  />
                </div>
              </div>
            )}
          </>,
          document.body
        )}
    </>
  );
};

export const PromptSearchNode = memo(PromptSearchNodeInner);
export default PromptSearchNode;

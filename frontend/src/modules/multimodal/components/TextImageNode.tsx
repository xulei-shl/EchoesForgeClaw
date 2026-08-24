/**
 * 文本成图节点：输入文字并自由调整字体 / 字号 / 颜色 / 横竖排 / 描边与背景，
 * 浏览器端渲染为 PNG 输出（背景默认无 = 透明）。预览与导出共用同一 Canvas 渲染。
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wand2, Heart, Globe, Loader2, Check, PenLine, Square } from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { ColorPickerPopover } from '../../../platform/components/ui/ColorPicker';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type TextImageState,
  TEXT_IMAGE_CANVAS,
  TEXT_IMAGE_DEFAULTS,
  normalizeTextImageState,
  paintTextImage,
  composeTextImage,
  downloadTextImage,
} from '../textimage';
import {
  JOURNAL_FONTS,
  JOURNAL_TEXT_COLORS,
  loadFontFamily,
  preloadAllJournalFonts,
} from '../journal/text/fontRegistry';

export interface TextImageNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<TextImageState>;
  isFavorited?: boolean;
  isPublic?: boolean;
  isSelected?: boolean;
  recordDeleted?: boolean;
  onSelect?: (id: string) => void;
  onRemove?: (id: string) => void;
  onToggleFavorite?: (id: string) => Promise<boolean>;
  onTogglePublic?: (id: string) => Promise<boolean>;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
  mismatchBadge?: string | null;
  /** 样式更新写入 node.data（undoable=true 记撤销历史，用于离散样式选择） */
  onUpdateState?: (
    id: string,
    patch: Partial<TextImageState>,
    undoable?: boolean
  ) => void;
  /** 导出文本图片：PNG Data URL 落盘保存 + 写入历史数据库 */
  onExport?: (id: string, dataUrl: string, state: TextImageState) => Promise<void>;
}

/** 透明底棋盘格衬托（PNG alpha 可视化） */
const checkerStyle: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, rgba(23,23,23,0.07) 25%, transparent 25%, transparent 75%, rgba(23,23,23,0.07) 75%), linear-gradient(45deg, rgba(23,23,23,0.07) 25%, transparent 25%, transparent 75%, rgba(23,23,23,0.07) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
};

const TextImageNodeInner: React.FC<TextImageNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  data,
  isFavorited = false,
  isPublic = false,
  isSelected = false,
  recordDeleted = false,
  onSelect,
  onRemove,
  onToggleFavorite,
  onTogglePublic,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  hasDownstream,
  mismatchBadge,
  onUpdateState,
  onExport,
}) => {
  const { showToast } = useFeedback();

  // 受控于 node.data：控件变更即 patch（滑杆仅持久化不记撤销历史，避免拖动刷历史）
  const st = useMemo(() => normalizeTextImageState(data), [data]);
  const patch = useCallback(
    (p: Partial<TextImageState>, undoable = true) => {
      onUpdateState?.(id, p, undoable);
    },
    [id, onUpdateState]
  );

  const [isWorking, setIsWorking] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 预加载全部手账字体预设（与手账共享字体基建）
  useEffect(() => {
    preloadAllJournalFonts();
  }, []);

  useEffect(() => {
    if (data?.imageUrl) setIsEditing(false);
    else setIsEditing(true);
  }, [data?.imageUrl]);

  // 实时渲染：字体就绪后再重绘一次（Google Fonts 异步加载完成即刷新）
  useEffect(() => {
    if (!isEditing) return;
    let cancelled = false;
    const repaint = () => {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && !cancelled) paintTextImage(ctx, st);
    };
    repaint();
    loadFontFamily(st.fontFamily)
      .then(repaint)
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [st, isEditing]);

  // 生成：全分辨率导出 PNG data URL 写入 node.data.imageUrl（下游按图片输出消费）
  const handleGenerate = useCallback(async () => {
    if (isWorking || isExporting) return;
    if (!st.text.trim()) {
      showToast('请先输入文字内容', { type: 'warning' });
      return;
    }
    setIsWorking(true);
    try {
      const resultDataUrl = await composeTextImage(st);
      await new Promise((resolve) => setTimeout(resolve, 200));
      patch({ imageUrl: resultDataUrl, isSaved: false });
      setIsEditing(false);
      showToast('文本成图已生成（可点击保存按钮写入数据库）', { type: 'success' });
    } catch (err: any) {
      console.error('生成文本图片失败:', err);
      showToast(err?.message || '生成文本图片失败，请重试', { type: 'error' });
    } finally {
      setIsWorking(false);
    }
  }, [st, isWorking, isExporting, patch, showToast]);

  // 独立保存到数据库（与手账同链路：落盘 + generations 记录）
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);
    try {
      await onExport(id, imgUrl, { ...st, imageUrl: imgUrl, isSaved: true });
      patch({ isSaved: true }, false);
      onSelect?.(id);
      showToast('文本成图已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      console.error('保存到数据库失败:', err);
      showToast(err?.detail || err?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [data?.imageUrl, isExporting, onExport, id, st, patch, onSelect, showToast]);

  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    downloadTextImage(url, `text-image-${Date.now()}.png`);
    showToast('文本图片已下载', { type: 'success' });
  }, [data?.imageUrl, showToast]);

  const handleReset = useCallback(() => {
    setIsEditing(true);
    patch({ ...TEXT_IMAGE_DEFAULTS, imageUrl: null, isSaved: false });
    showToast('已重置文字与样式', { type: 'success' });
  }, [patch, showToast]);

  const runToggle = async (
    fn: ((id: string) => Promise<boolean>) | undefined,
    okMsg: (active: boolean) => string
  ) => {
    if (!fn) return;
    try {
      const active = await fn(id);
      showToast(okMsg(active), { type: 'success' });
    } catch {
      showToast('操作失败，请重试', { type: 'error' });
    }
  };

  const hasGenerated = Boolean(data?.imageUrl && !isEditing);
  const isSaved = Boolean(data?.isSaved);
  const busy = isWorking || isExporting;
  const locked = Boolean(hasDownstream);
  const isCustomColor = !JOURNAL_TEXT_COLORS.some(
    (preset) => preset.color.toLowerCase() === st.color.toLowerCase()
  );
  const isCustomStroke = st.strokeEnabled && st.strokeColor.toLowerCase() !== '#ffffff';

  const renderSwatches = (
    current: string,
    onPick: (color: string) => void,
    customActive: boolean,
    customLabel: string
  ) => (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        {JOURNAL_TEXT_COLORS.map((preset) => {
          const selected = current.toLowerCase() === preset.color.toLowerCase();
          return (
            <Tooltip key={preset.name} content={`${preset.name} (${preset.color})`}>
              <button
                type="button"
                disabled={locked}
                onClick={() => onPick(preset.color)}
                className={`relative w-4 h-4 rounded-full transition-all duration-150 ease-out active:scale-[0.92] shrink-0 ${
                  preset.border ? 'border border-paper-grid/80' : ''
                } ${
                  selected
                    ? 'ring-2 ring-accent ring-offset-1 scale-110 shadow-sm'
                    : 'hover:scale-110 opacity-90 hover:opacity-100'
                }`}
                style={{ backgroundColor: preset.color }}
                aria-label={preset.name}
              />
            </Tooltip>
          );
        })}
      </div>
      <div className="w-px h-3 bg-paper-grid/50 my-auto mx-0.5 shrink-0" />
      <ColorPickerPopover value={current} onChange={onPick} disabled={locked} align="right">
        <Tooltip content={customActive ? `${customLabel} (当前: ${current})` : '自定义颜色 / 吸管取色'}>
          <button
            type="button"
            disabled={locked}
            style={{ backgroundColor: customActive ? current : undefined }}
            className={`w-4 h-4 rounded-full border flex items-center justify-center transition active:scale-[0.92] shrink-0 ${
              customActive
                ? 'border-accent ring-2 ring-accent ring-offset-1 scale-110 shadow-sm'
                : 'border-paper-grid/70 hover:border-accent hover:scale-110 bg-paper/80 text-ink-light hover:text-accent'
            }`}
            aria-label="自定义颜色"
          />
        </Tooltip>
      </ColorPickerPopover>
    </>
  );

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '文本成图'}
      dotColor={NODE_COLORS.text_image || 'oklch(0.68 0.15 195)'}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 560 }}
      className={`transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out ${
        isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''
      }`}
      showLeftAnchor={false}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      mismatchBadge={mismatchBadge}
      actionBar={
        <NodeActionBar>
          {hasGenerated ? (
            <>
              <NodeActionBar.Retry
                onClick={() => setIsEditing(true)}
                disabled={busy}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重新调整"
                tooltip="返回编辑模式"
                aria-label="返回编辑模式"
              />
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={isSaved ? 2.5 : 1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={busy || isSaved}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可保存"
                tooltip={isSaved ? '已保存到数据库' : '保存到数据库（保存后可公开/收藏）'}
                aria-label={isSaved ? '已保存到数据库' : '保存到数据库'}
                className={isSaved ? 'text-accent opacity-70' : 'text-ink-light hover:text-accent'}
              />
              <NodeActionBar.Custom
                icon={
                  <Heart
                    size={16}
                    strokeWidth={1.5}
                    className={isSaved && isFavorited ? 'fill-accent text-accent' : ''}
                  />
                }
                tooltip={!isSaved ? '请先保存到数据库后再收藏' : isFavorited ? '取消收藏' : '收藏'}
                aria-label={!isSaved ? '请先保存到数据库后再收藏' : isFavorited ? '取消收藏' : '收藏'}
                onClick={() =>
                  isSaved && runToggle(onToggleFavorite, (act) => (act ? '已收藏' : '已取消收藏'))
                }
                disabled={!isSaved || busy || !onToggleFavorite}
              />
              <NodeActionBar.Custom
                icon={<Globe size={16} strokeWidth={1.5} className={isSaved && isPublic ? 'text-accent' : ''} />}
                tooltip={!isSaved ? '请先保存到数据库后再公开' : isPublic ? '从画廊撤下' : '公开到画廊'}
                aria-label={!isSaved ? '请先保存到数据库后再公开' : isPublic ? '从画廊撤下' : '公开到画廊'}
                onClick={() =>
                  isSaved && runToggle(onTogglePublic, (act) => (act ? '已公开' : '已撤下'))
                }
                disabled={!isSaved || busy || !onTogglePublic}
              />
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isExporting}
                tooltip="直接下载 PNG"
                aria-label="直接下载文本图片 PNG"
              />
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={busy}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重置"
                tooltip="重置文字与结果"
                aria-label="重置文字与结果"
              />
            </>
          ) : (
            <>
              <NodeActionBar.Custom
                icon={
                  busy ? (
                    <Loader2 size={16} className="animate-spin text-accent" />
                  ) : (
                    <Wand2 size={16} strokeWidth={1.5} />
                  )
                }
                tooltip="生成图片"
                aria-label="生成图片"
                downstreamTooltip="有下级节点，不可生成"
                onClick={handleGenerate}
                disabled={busy || locked}
                hasDownstream={hasDownstream}
              />
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={busy}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重置"
                tooltip="重置文字与样式"
                aria-label="重置文字与样式"
              />
            </>
          )}
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 编辑模式：文字内容 + 样式控制 */}
        {isEditing && (
          <div className="flex flex-col gap-1.5 px-2 py-1.5 rounded-lg bg-paper-grid/20 border border-paper-grid/40 text-xs font-sans text-ink-light select-none">
            {/* 文字内容 */}
            <textarea
              value={st.text}
              onChange={(e) => patch({ text: e.target.value }, false)}
              disabled={locked}
              rows={2}
              placeholder="输入文字…（支持多行，Enter 换行）"
              className="w-full resize-none rounded-lg border border-paper-grid/60 bg-paper px-2.5 py-1.5 text-xs text-ink leading-relaxed outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition font-sans"
            />

            {/* 第 1 行：字体 + 横竖排 */}
            <div className="flex items-center gap-1.5">
              <select
                value={st.fontFamily}
                onChange={(e) => {
                  loadFontFamily(e.target.value);
                  patch({ fontFamily: e.target.value });
                }}
                disabled={locked}
                aria-label="选择字体"
                className="h-6 pl-2 pr-5 rounded-md border border-paper-grid/60 bg-paper/90 text-xs text-ink outline-none hover:border-accent/60 focus:border-accent cursor-pointer transition"
              >
                {JOURNAL_FONTS.map((font) => (
                  <option key={font.id} value={font.family}>
                    {font.name}
                  </option>
                ))}
              </select>
              <div className="ml-auto flex items-center gap-1">
                {(['horizontal', 'vertical'] as const).map((mode) => {
                  const active = st.writingMode === mode;
                  return (
                    <Tooltip key={mode} content={mode === 'vertical' ? '纵向排版（列自右向左）' : '横向排版'}>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => patch({ writingMode: mode })}
                        className={`px-2 py-0.5 rounded border text-[11px] transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.96] ${
                          active
                            ? 'bg-accent/15 border-accent/50 text-accent font-medium'
                            : 'border-paper-grid/50 hover:bg-paper-grid/30 text-ink-light'
                        }`}
                      >
                        {mode === 'vertical' ? '竖排' : '横排'}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            {/* 第 2 行：字号滑杆 */}
            <div className="flex items-center gap-1.5">
              <span className="text-ink-faint text-[11px] whitespace-nowrap">字号:</span>
              <input
                type="range"
                min={24}
                max={240}
                step={2}
                value={st.fontSize}
                disabled={locked}
                onChange={(e) => patch({ fontSize: Number(e.target.value) }, false)}
                className="flex-1 h-1 accent-[var(--accent)] cursor-pointer min-w-[60px]"
              />
              <span className="text-[11px] text-ink-faint w-9 text-right tabular-nums font-mono">
                {st.fontSize}px
              </span>
            </div>

            {/* 第 3 行：墨色色盘 + 自定义取色 */}
            <div className="flex items-center gap-1.5">
              <span className="text-ink-faint text-[11px] whitespace-nowrap">墨色:</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {renderSwatches(st.color, (c) => patch({ color: c }), isCustomColor, '自定义墨色')}
              </div>
            </div>

            {/* 第 4 行：描边开关 + 颜色 + 宽度 */}
            <div className="flex items-center gap-1.5 pt-0.5 border-t border-paper-grid/40">
              <Tooltip content={st.strokeEnabled ? '已开启文字描边' : '已关闭描边'}>
                <button
                  type="button"
                  onClick={() => patch({ strokeEnabled: !st.strokeEnabled })}
                  disabled={locked}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] shrink-0 ${
                    st.strokeEnabled
                      ? 'bg-accent/15 text-accent font-medium'
                      : 'hover:bg-paper-grid/40 text-ink-light'
                  }`}
                >
                  <PenLine size={12} />
                  <span>描边</span>
                </button>
              </Tooltip>
              {st.strokeEnabled && (
                <>
                  <div className="flex items-center gap-1 shrink-0">
                    {renderSwatches(
                      st.strokeColor,
                      (c) => patch({ strokeColor: c }),
                      isCustomStroke,
                      '自定义描边色'
                    )}
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={24}
                    step={1}
                    value={st.strokeWidth}
                    disabled={locked}
                    onChange={(e) => patch({ strokeWidth: Number(e.target.value) }, false)}
                    className="flex-1 h-1 accent-[var(--accent)] cursor-pointer min-w-[50px]"
                    aria-label="描边宽度"
                  />
                  <span className="text-[11px] text-ink-faint w-7 text-right tabular-nums font-mono">
                    {st.strokeWidth}px
                  </span>
                </>
              )}
            </div>

            {/* 第 5 行：背景开关 + 颜色（默认关 = 透明背景） */}
            <div className="flex items-center gap-1.5">
              <Tooltip content={st.backgroundEnabled ? `纯色背景 ${st.backgroundColor}` : '透明背景（PNG 保留 alpha 通道）'}>
                <button
                  type="button"
                  onClick={() => patch({ backgroundEnabled: !st.backgroundEnabled })}
                  disabled={locked}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] shrink-0 ${
                    st.backgroundEnabled
                      ? 'bg-accent/15 text-accent font-medium'
                      : 'hover:bg-paper-grid/40 text-ink-light'
                  }`}
                >
                  <Square size={12} />
                  <span>背景</span>
                </button>
              </Tooltip>
              {st.backgroundEnabled &&
                renderSwatches(
                  st.backgroundColor,
                  (c) => patch({ backgroundColor: c }),
                  st.backgroundColor.toLowerCase() !== '#ffffff',
                  '自定义背景色'
                )}
              {!st.backgroundEnabled && (
                <span className="text-[11px] text-ink-faint">无（透明）</span>
              )}
            </div>
          </div>
        )}

        {/* 预览画布：编辑态实时渲染 / 生成态展示输出图（同一渲染实现，所见即所得） */}
        <div className="relative flex-1 min-h-0 w-full overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none p-2 sm:p-3">
          <AnimatePresence mode="wait" initial={false}>
            {!hasGenerated ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full flex items-center justify-center"
              >
                <canvas
                  ref={canvasRef}
                  width={TEXT_IMAGE_CANVAS}
                  height={TEXT_IMAGE_CANVAS}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xs"
                  style={checkerStyle}
                  aria-label="文本成图实时预览"
                />
              </motion.div>
            ) : (
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="relative w-full h-full flex items-center justify-center"
              >
                {st.imageUrl ? (
                  <div className="relative max-w-full max-h-full flex items-center justify-center p-2 rounded-2xl bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_16px_48px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03),0_2px_4px_rgba(0,0,0,0.02)]">
                    <img
                      src={st.imageUrl}
                      alt="Text Image Output"
                      className="max-w-full max-h-[500px] rounded-lg object-contain select-none pointer-events-none drop-shadow-sm"
                    />
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无文本成图结果</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 状态与弱提示 */}
        {recordDeleted && hasGenerated && !isExporting && (
          <div className="flex items-center justify-end gap-1.5 text-right text-xs text-ink-faint font-sans">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/60" />
            记录已删除 · 收藏将重新生成记录
          </div>
        )}
      </div>
    </CanvasNode>
  );
};

export const TextImageNode = memo(TextImageNodeInner);
TextImageNode.displayName = 'TextImageNode';
export default TextImageNode;

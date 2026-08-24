/**
 * 文本成图节点：输入文字并自由调整字体 / 字号 / 颜色 / 横竖排 / 描边与背景，
 * 浏览器端渲染为 PNG 输出（背景默认无 = 透明）。预览与导出共用同一 Canvas 渲染。
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wand2,
  Heart,
  Globe,
  Loader2,
  Check,
  PenLine,
  Square,
  ChevronUp,
  SlidersHorizontal,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { Slider } from '../../../platform/components/ui/Slider';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type TextImageState,
  type TextImageWritingMode,
  TEXT_IMAGE_CANVAS,
  TEXT_IMAGE_DEFAULTS,
  normalizeTextImageState,
  paintTextImage,
  composeTextImage,
  downloadTextImage,
} from '../textimage';
import { loadFontFamily } from '../journal/text/fontRegistry';
import {
  FontFamilySelect,
  TextColorPalette,
  usePreloadJournalFonts,
} from '../journal/text/FontControls';

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
    'linear-gradient(45deg, rgba(23,23,23,0.06) 25%, transparent 25%, transparent 75%, rgba(23,23,23,0.06) 75%), linear-gradient(45deg, rgba(23,23,23,0.06) 25%, transparent 25%, transparent 75%, rgba(23,23,23,0.06) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
};

/**
 * 胶囊式横竖排选择器 (Segmented Control)
 */
interface WritingModeToggleProps {
  value: TextImageWritingMode;
  onChange: (mode: TextImageWritingMode) => void;
  disabled?: boolean;
}

const WritingModeToggle: React.FC<WritingModeToggleProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const options: { id: TextImageWritingMode; label: string; tooltip: string }[] = [
    { id: 'horizontal', label: '横排', tooltip: '横向自然排版' },
    { id: 'vertical', label: '竖排', tooltip: '纵向传统排版（列自右向左）' },
  ];

  return (
    <div className="inline-flex items-center p-0.5 rounded-md bg-paper-grid/50 border border-paper-grid/70 select-none shrink-0">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <Tooltip key={opt.id} content={opt.tooltip}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.id)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-sans transition-[transform,background-color,color,box-shadow] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed leading-none ${
                active
                  ? 'bg-paper text-accent font-medium shadow-2xs border border-paper-grid/40'
                  : 'text-ink-faint hover:text-ink'
              }`}
            >
              {opt.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
};

/**
 * 微型开关组件 (Switch/Toggle)
 */
interface MiniSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}

const MiniSwitch: React.FC<MiniSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  label,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-3.5 w-6.5 shrink-0 items-center rounded-full border transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.95] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
      checked ? 'bg-accent border-accent' : 'bg-paper-grid/60 border-paper-grid'
    }`}
    title={label}
  >
    <span
      className={`inline-block h-2.5 w-2.5 transform rounded-full bg-paper shadow-2xs transition-transform duration-150 ease-out ${
        checked ? 'translate-x-3' : 'translate-x-0.5'
      }`}
    />
  </button>
);

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
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 预加载全部手账字体预设（与手账共享字体基建）
  usePreloadJournalFonts();

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
      defaultSize={{ width: 440, height: 640 }}
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
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2.5">
        {/* 编辑模式：高密度、紧凑高效的控制面板 */}
        {isEditing && (
          <div className="flex flex-col gap-1.5 p-2 rounded-xl bg-paper/95 border border-paper-grid/80 shadow-2xs text-xs font-sans text-ink-light select-none shrink-0">
            {/* 1. 文字内容输入 + 折叠/展开快捷按钮 */}
            <div className="relative flex items-center gap-1">
              <textarea
                value={st.text}
                onChange={(e) => patch({ text: e.target.value }, false)}
                disabled={locked}
                rows={isPanelCollapsed ? 1 : 2}
                placeholder="输入文字…（Enter 换行）"
                className="w-full resize-none rounded-lg border border-paper-grid/80 bg-paper px-2.5 py-1.5 text-xs text-ink leading-relaxed outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-[border-color,box-shadow,height] font-sans placeholder:text-ink-faint/60"
              />
              <Tooltip content={isPanelCollapsed ? '展开样式设置' : '收起样式设置，扩大预览画布'}>
                <button
                  type="button"
                  onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
                  className="p-1 rounded-md border border-paper-grid/70 text-ink-faint hover:text-accent hover:border-accent/60 bg-paper/60 transition-[color,border-color,transform] active:scale-[0.94] shrink-0"
                  aria-label={isPanelCollapsed ? '展开面板' : '收起面板'}
                >
                  {isPanelCollapsed ? <SlidersHorizontal size={13} /> : <ChevronUp size={13} />}
                </button>
              </Tooltip>
            </div>

            {/* 展开的参数配置区（支持一键平滑收起以释放全部视口） */}
            <AnimatePresence initial={false}>
              {!isPanelCollapsed && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden flex flex-col gap-1.5"
                >
                  {/* 2. 字体选择 + 横竖排 + 字号滑杆整合 */}
                  <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                    {/* 字体下拉 */}
                    <FontFamilySelect
                      value={st.fontFamily}
                      onChange={(family) => patch({ fontFamily: family })}
                      disabled={locked}
                    />

                    {/* 横竖排胶囊 */}
                    <WritingModeToggle
                      value={st.writingMode}
                      onChange={(mode) => patch({ writingMode: mode })}
                      disabled={locked}
                    />

                    {/* 字号滑杆 */}
                    <div className="flex items-center gap-1.5 flex-1 min-w-[120px]">
                      <span className="text-ink-faint text-[10px] shrink-0">字号</span>
                      <div className="flex-1 min-w-[50px] flex items-center">
                        <Slider
                          min={24}
                          max={240}
                          step={2}
                          value={st.fontSize}
                          disabled={locked}
                          onChange={(v) => patch({ fontSize: v }, false)}
                          aria-label="字号大小"
                          aria-valuetext={`${st.fontSize}px`}
                        />
                      </div>
                      <span className="text-[10px] text-ink-light w-8 text-right tabular-nums font-mono">
                        {st.fontSize}px
                      </span>
                    </div>
                  </div>

                  {/* 3. 墨色调色盘 */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-ink-faint text-[10px] shrink-0 w-6">墨色</span>
                    <div className="flex-1 min-w-0">
                      <TextColorPalette
                        value={st.color}
                        onChange={(c) => patch({ color: c })}
                        disabled={locked}
                        customLabel="自定义墨色"
                        size="compact"
                      />
                    </div>
                  </div>

                  {/* 4. 描边设置（紧凑行内整合） */}
                  <div className="flex items-center gap-1.5 pt-1 border-t border-paper-grid/50 min-h-[24px]">
                    <div className="flex items-center gap-1 shrink-0">
                      <PenLine size={11} className={st.strokeEnabled ? 'text-accent' : 'text-ink-faint'} />
                      <span className="text-[10px] text-ink font-medium">描边</span>
                      <MiniSwitch
                        checked={st.strokeEnabled}
                        onChange={(checked) => patch({ strokeEnabled: checked })}
                        disabled={locked}
                        label="开启/关闭描边"
                      />
                    </div>

                    {st.strokeEnabled ? (
                      <div className="flex items-center gap-1.5 flex-1 min-w-0 ml-1">
                        <TextColorPalette
                          value={st.strokeColor}
                          onChange={(c) => patch({ strokeColor: c })}
                          disabled={locked}
                          customLabel="描边颜色"
                          size="compact"
                        />
                        <div className="w-px h-3 bg-paper-grid/70 mx-0.5 shrink-0" />
                        <div className="flex-1 min-w-[40px] flex items-center">
                          <Slider
                            min={1}
                            max={24}
                            step={1}
                            value={st.strokeWidth}
                            disabled={locked}
                            onChange={(v) => patch({ strokeWidth: v }, false)}
                            aria-label="描边粗细"
                            aria-valuetext={`${st.strokeWidth}px`}
                          />
                        </div>
                        <span className="text-[10px] text-ink-light w-7 text-right tabular-nums font-mono shrink-0">
                          {st.strokeWidth}px
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-ink-faint/70 ml-1">已关闭</span>
                    )}
                  </div>

                  {/* 5. 背景设置（紧凑行内整合） */}
                  <div className="flex items-center gap-1.5 min-h-[24px]">
                    <div className="flex items-center gap-1 shrink-0">
                      <Square size={11} className={st.backgroundEnabled ? 'text-accent' : 'text-ink-faint'} />
                      <span className="text-[10px] text-ink font-medium">背景</span>
                      <MiniSwitch
                        checked={st.backgroundEnabled}
                        onChange={(checked) => patch({ backgroundEnabled: checked })}
                        disabled={locked}
                        label="开启/关闭背景"
                      />
                    </div>

                    {st.backgroundEnabled ? (
                      <div className="flex-1 min-w-0 ml-1">
                        <TextColorPalette
                          value={st.backgroundColor}
                          onChange={(c) => patch({ backgroundColor: c })}
                          disabled={locked}
                          customLabel="背景底色"
                          size="compact"
                        />
                      </div>
                    ) : (
                      <span className="text-[10px] text-ink-faint/70 ml-1">透明 (PNG Alpha)</span>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 预览画布：占据全部剩余大空间，自动弹性撑满（Concentric Radius & Subtle Shadows） */}
        <div className="relative flex-1 min-h-[260px] w-full overflow-hidden rounded-xl bg-paper-grid/15 border border-paper-grid/60 flex items-center justify-center select-none p-3 sm:p-4">
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
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xs border border-paper-grid/40"
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
                  <div className="relative max-w-full max-h-full flex items-center justify-center p-2.5 rounded-2xl bg-paper border border-paper-grid/60 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_16px_48px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.02)]">
                    <img
                      src={st.imageUrl}
                      alt="Text Image Output"
                      className="max-w-full max-h-[520px] rounded-lg object-contain select-none pointer-events-none drop-shadow-sm"
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


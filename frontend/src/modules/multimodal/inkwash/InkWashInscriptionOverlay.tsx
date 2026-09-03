/**
 * 水墨写意 (InkWash) - 宣纸所见即所得书画题款与真迹印章浮动层
 * 支持多段题款组件排布、独立拖拽、多字体选择、横竖排切换、视口正顶部 UniversalTextToolbar 微交互与单项删除
 * 交互规范对齐手账制作节点：前置弹窗确认输入添加、Enter 确认、Escape 取消、全局撤销栈 undoable
 */
import React, { useState, useRef, useEffect } from 'react';
import { Dices, Stamp, X, Check } from 'lucide-react';
import type { InkWashInscriptionItem } from './types';
import { UniversalTextToolbar } from '../journal/text/UniversalTextToolbar';
import type { TextAlignment } from '../journal/text/FontControls';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { getRandomSealSrc } from './inscription';

export interface InkWashInscriptionOverlayProps {
  inscriptions: InkWashInscriptionItem[];
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
  containerWidth: number;
  containerHeight: number;
  disabled?: boolean;
  isAddingNew?: boolean;
  onConfirmAdd?: (text: string) => void;
  onCancelAdd?: () => void;
  onUpdateItem: (id: string, patch: Partial<InkWashInscriptionItem>, undoable?: boolean) => void;
  onDeleteItem: (id: string) => void;
}

export const InkWashInscriptionOverlay: React.FC<InkWashInscriptionOverlayProps> = ({
  inscriptions,
  selectedId,
  onSelectId,
  containerWidth,
  containerHeight,
  disabled = false,
  isAddingNew = false,
  onConfirmAdd,
  onCancelAdd,
  onUpdateItem,
  onDeleteItem,
}) => {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ dxPercent: number; dyPercent: number } | null>(null);

  const dragStartRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const isModalOpen = isAddingNew || Boolean(editingItemId);

  // 当外部进入新建模式时，重置草稿
  useEffect(() => {
    if (isAddingNew) {
      setDraftText('');
    }
  }, [isAddingNew]);

  const selectedItem = inscriptions.find((it) => it.id === selectedId);

  // 点击外部或宣纸空白区域取消选中状态
  useEffect(() => {
    if (!selectedId || isModalOpen) return;
    const handleGlobalPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        overlayRef.current &&
        !overlayRef.current.contains(target) &&
        toolbarRef.current &&
        !toolbarRef.current.contains(target)
      ) {
        onSelectId(null);
      }
    };
    window.addEventListener('pointerdown', handleGlobalPointerDown);
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown);
    };
  }, [selectedId, isModalOpen, onSelectId]);

  // 根据当前宣纸视口大小自适应计算字号基准 (px)
  const minDim = Math.min(containerWidth, containerHeight) || 400;

  /** 开始拖拽指定题款 */
  const handlePointerDownItem = (e: React.PointerEvent, item: InkWashInscriptionItem) => {
    if (disabled || isModalOpen) return;
    // 阻止画板产生手绘水墨笔触
    e.stopPropagation();
    onSelectId(item.id);
    setDraggingId(item.id);
    setDragOffset(null);

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: item.x ?? 82,
      initY: item.y ?? 28,
    };

    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  /** 拖拽移动中：仅在当前浮层局部更新偏移量，解耦顶层组件与 WebGL 参数更新的高频开销 */
  const handlePointerMoveItem = (e: React.PointerEvent, item: InkWashInscriptionItem) => {
    if (draggingId !== item.id || !dragStartRef.current) return;
    e.stopPropagation();

    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;

    const deltaXPercent = (dx / (containerWidth || 400)) * 100;
    const deltaYPercent = (dy / (containerHeight || 400)) * 100;

    setDragOffset({ dxPercent: deltaXPercent, dyPercent: deltaYPercent });
  };

  /** 结束拖拽：提交最终坐标并记入撤销栈 */
  const handlePointerUpItem = (e: React.PointerEvent, item: InkWashInscriptionItem) => {
    if (draggingId === item.id && dragStartRef.current) {
      e.stopPropagation();
      const dx = e.clientX - dragStartRef.current.startX;
      const dy = e.clientY - dragStartRef.current.startY;

      const deltaXPercent = (dx / (containerWidth || 400)) * 100;
      const deltaYPercent = (dy / (containerHeight || 400)) * 100;

      const finalX = Math.max(5, Math.min(95, Number((dragStartRef.current.initX + deltaXPercent).toFixed(1))));
      const finalY = Math.max(5, Math.min(95, Number((dragStartRef.current.initY + deltaYPercent).toFixed(1))));

      // 仅在发生真实拖拽位移时更新父级状态并记入撤销栈
      if (Math.abs(deltaXPercent) > 0.2 || Math.abs(deltaYPercent) > 0.2) {
        onUpdateItem(item.id, { x: finalX, y: finalY }, true);
      }

      setDraggingId(null);
      setDragOffset(null);
      dragStartRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  /** 打开已有题款文案编辑弹窗 */
  const handleOpenEdit = (item: InkWashInscriptionItem) => {
    setEditingItemId(item.id);
    setDraftText(item.text || '');
  };

  /** 保存文案（新建或更新已有） */
  const handleSaveText = () => {
    if (isAddingNew) {
      onConfirmAdd?.(draftText.trim());
      setDraftText('');
    } else if (editingItemId) {
      onUpdateItem(editingItemId, { text: draftText.trim() }, true);
      setEditingItemId(null);
      setDraftText('');
    }
  };

  /** 取消文案编辑/新建 */
  const handleCancel = () => {
    if (isAddingNew) {
      onCancelAdd?.();
    }
    setEditingItemId(null);
    setDraftText('');
  };

  /** 键盘快捷键：Enter 确认，Shift+Enter 换行，Escape 取消 */
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveText();
    }
  };

  /** 一键随机抽取一枚古籍真迹名章 */
  const handleRerollSeal = (item: InkWashInscriptionItem) => {
    const newSeal = getRandomSealSrc();
    onUpdateItem(item.id, { sealSrc: newSeal, sealEnabled: true }, true);
  };

  const activeInscriptions = inscriptions.filter((it) => it.enabled && it.text !== undefined);

  return (
    <div ref={overlayRef} className="absolute inset-0 pointer-events-none select-none z-30">
      {/* 选中文本时的微交互工具栏：固定在宣纸视口正顶部居中 (与 StampCutterNode / EditorialLayoutNode 规范一致) */}
      {selectedItem && !disabled && !isModalOpen && (
        <div
          ref={toolbarRef}
          className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-auto z-40 max-w-[calc(100%-16px)] transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <UniversalTextToolbar
            item={{
              id: selectedItem.id,
              text: selectedItem.text,
              fontFamily: selectedItem.fontFamily || '钟齐志莽行书',
              color: selectedItem.color || '#16161e',
              writingMode: selectedItem.writingMode || 'vertical',
              textAlign: (selectedItem.textAlign || 'center') as TextAlignment,
            }}
            variant="floating"
            onUpdate={(patch) =>
              onUpdateItem(selectedItem.id, patch as Partial<InkWashInscriptionItem>, true)
            }
            onOpenEdit={() => handleOpenEdit(selectedItem)}
            onDelete={() => {
              onDeleteItem(selectedItem.id);
              onSelectId(null);
            }}
            extraRow={
              <div className="flex items-center gap-1 shrink-0 ml-auto">
                <Tooltip content="随机换一枚古籍名章（从39枚真迹中全随机抽取）">
                  <button
                    type="button"
                    onClick={() => handleRerollSeal(selectedItem)}
                    className="h-7 px-2 rounded-md bg-paper border border-paper-grid/80 hover:border-accent hover:text-accent text-ink text-xs font-medium flex items-center gap-1 transition-colors shadow-2xs cursor-pointer shrink-0"
                  >
                    <Dices size={12} strokeWidth={2} className="text-accent" />
                    <span>换印</span>
                  </button>
                </Tooltip>
                <Tooltip content={selectedItem.sealEnabled ? '隐藏钤印' : '钤上古籍朱砂印'}>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateItem(
                        selectedItem.id,
                        { sealEnabled: !selectedItem.sealEnabled },
                        true
                      )
                    }
                    className={`h-7 px-2 rounded-md border text-xs font-medium transition-colors cursor-pointer shrink-0 flex items-center gap-1 ${
                      selectedItem.sealEnabled
                        ? 'bg-accent/10 border-accent/40 text-accent font-semibold'
                        : 'bg-paper border-paper-grid/80 text-ink-light hover:text-ink'
                    }`}
                  >
                    <Stamp size={12} strokeWidth={2} />
                    <span>印章</span>
                  </button>
                </Tooltip>
              </div>
            }
          />
        </div>
      )}

      {/* 遍历渲染所有文本组件 */}
      {activeInscriptions.map((item) => {
        const isSelected = item.id === selectedId;
        const isDragging = item.id === draggingId;
        const isVertical = item.writingMode !== 'horizontal';
        const currentFont = item.fontFamily || '钟齐志莽行书';
        const currentColor = item.color || '#16161e';
        const fontSizePx = Math.max(14, Math.round(minDim * (item.fontSizeRatio || 0.038)));
        const sealSizePx = Math.max(20, Math.round(fontSizePx * 1.35));

        const posX =
          isDragging && dragOffset
            ? Math.max(5, Math.min(95, Number(((item.x ?? 82) + dragOffset.dxPercent).toFixed(1))))
            : (item.x ?? 82);
        const posY =
          isDragging && dragOffset
            ? Math.max(5, Math.min(95, Number(((item.y ?? 28) + dragOffset.dyPercent).toFixed(1))))
            : (item.y ?? 28);

        return (
          <div
            key={item.id}
            tabIndex={0}
            role="button"
            aria-label={`书画题款：${item.text || '点击输入题款'}，按回车编辑`}
            className={`absolute pointer-events-auto touch-none transition-[box-shadow,outline] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded ${
              isDragging ? 'cursor-grabbing will-change-transform z-35' : 'cursor-grab z-30'
            }`}
            style={{
              left: `${posX}%`,
              top: `${posY}%`,
              transform: 'translate(-50%, -50%)',
            }}
            onPointerDown={(e) => handlePointerDownItem(e, item)}
            onPointerMove={(e) => handlePointerMoveItem(e, item)}
            onPointerUp={(e) => handlePointerUpItem(e, item)}
            onPointerCancel={(e) => handlePointerUpItem(e, item)}
            onClick={(e) => {
              e.stopPropagation();
              onSelectId(item.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!disabled) handleOpenEdit(item);
            }}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                handleOpenEdit(item);
              } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                onDeleteItem(item.id);
                onSelectId(null);
              }
            }}
          >
            {/* 题款与印章展示体 */}
            <div
              className={`flex ${isVertical ? 'flex-col items-center gap-2' : 'items-center gap-2'} rounded p-1 transition-[outline,box-shadow] ${
                isSelected
                  ? 'outline outline-1.5 outline-accent/80 bg-accent/5 ring-2 ring-accent/20'
                  : 'hover:outline hover:outline-1 hover:outline-accent/40'
              }`}
            >
              {/* 毛笔书法题款文字 */}
              <div
                style={{
                  fontFamily: `"${currentFont}", cursive, sans-serif`,
                  fontSize: `${fontSizePx}px`,
                  color: currentColor,
                  lineHeight: 1.35,
                  textShadow: '0 1px 1px rgba(0,0,0,0.06)',
                  ...(isVertical
                    ? {
                        writingMode: 'vertical-rl',
                        textOrientation: 'mixed',
                        letterSpacing: '0.12em',
                        whiteSpace: 'pre-wrap',
                        textAlign:
                          item.textAlign === 'left'
                            ? 'start'
                            : item.textAlign === 'right'
                              ? 'end'
                              : 'center',
                      }
                    : {
                        writingMode: 'horizontal-tb',
                        whiteSpace: 'pre-wrap',
                        textAlign: item.textAlign || 'center',
                      }),
                }}
              >
                {item.text || '点击输入题款'}
              </div>

              {/* 朱砂真迹印章（正片叠底透入宣纸肌理） */}
              {item.sealEnabled && item.sealSrc && (
                <div
                  className="shrink-0 relative overflow-hidden select-none pointer-events-none"
                  style={{
                    width: `${sealSizePx}px`,
                    height: `${sealSizePx}px`,
                  }}
                >
                  <img
                    src={item.sealSrc}
                    alt="印章"
                    className="w-full h-full object-contain filter drop-shadow-xs"
                    style={{
                      mixBlendMode: 'multiply',
                      opacity: 0.92,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* 文案快捷编辑 / 前置添加弹窗 */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 pointer-events-auto transition-opacity duration-150 motion-reduce:transition-none"
          onClick={handleCancel}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-paper p-4 shadow-2xl border border-paper-grid flex flex-col gap-3 font-sans text-xs transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none scale-100 opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm text-ink flex items-center gap-1.5">
                <span>{isAddingNew ? '添加书画题款' : '编辑书画题款文案'}</span>
              </span>
              <button
                type="button"
                onClick={handleCancel}
                aria-label="关闭题款编辑"
                className="relative p-1 rounded text-ink-light hover:text-ink hover:bg-paper-grid/50 transition-colors cursor-pointer before:absolute before:-inset-2 before:content-['']"
              >
                <X size={14} />
              </button>
            </div>

            <textarea
              rows={4}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder={
                isAddingNew
                  ? '请输入书画题款，回车确认（如：松风水月、远山如黛）'
                  : '请输入书画题款，支持换行（如：伊加利亚的女儿们\n布兰腾伯格 题）'
              }
              className="w-full p-2.5 rounded-lg border border-paper-grid bg-white text-ink text-xs focus:outline-none focus:border-accent leading-relaxed resize-none"
              autoFocus
            />

            <div className="flex items-center justify-between text-[11px] text-ink-faint">
              <span>Enter 确认 · Shift+Enter 换行 · Esc 取消</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-2.5 py-1.5 rounded-md border border-paper-grid text-ink-light hover:text-ink cursor-pointer active:scale-[0.96] transition-[color,transform] duration-150"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveText}
                  className="px-3 py-1.5 rounded-md bg-accent text-white font-medium hover:bg-accent/90 flex items-center gap-1 shadow-xs cursor-pointer active:scale-[0.96] transition-[background-color,transform] duration-150"
                >
                  <Check size={12} strokeWidth={2.5} />
                  <span>确定</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

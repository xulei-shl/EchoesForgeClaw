import React, { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** 颜色预设项（由页面传入，保持本组件与业务模块解耦） */
export interface GroupColorOption {
  name: string;
  value: string;
}

interface CanvasGroupFrameProps {
  id: string;
  name: string;
  color: string;
  /** 画布坐标包围盒（已含内边距，由成员位置+尺寸实时推导） */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 组内任一成员被选中时高亮边框与标题 */
  active?: boolean;
  /** 预设色板（低饱和纸感色系；接受 readonly 常量元组） */
  colors: readonly GroupColorOption[];
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
  /** 解散分组（仅删除组记录，节点与连线不动） */
  onDisband: () => void;
  /** 点击标题/分组框：选中整组成员 */
  onSelect: () => void;
  /** 标题或分组框按下开始整组拖动（指针循环由页面协调器接管） */
  onDragStart: (e: ReactPointerEvent) => void;
}

/** 名称清空时的回退值 */
const FALLBACK_NAME = '未命名分组';

/**
 * 画布分组框（软分组的视觉/操作载体）：
 * - 容器 pointer-events-auto，可直接按住背景或边框平移整组
 * - 背景高透明（8%）、边框中透明（68%），色值经 color-mix 混入，纸感低饱和
 * - zIndex：未激活时为 1（位于普通连线之上、节点之下）；激活选中时提升至 120 置顶显示，覆盖未选中底层节点
 */
export const CanvasGroupFrame: React.FC<CanvasGroupFrameProps> = ({
  id,
  name,
  color,
  x,
  y,
  width,
  height,
  active,
  colors,
  onNameChange,
  onColorChange,
  onDisband,
  onSelect,
  onDragStart,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  // 进入编辑时聚焦并全选
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // 外部名称变化（撤销/他人修改）时同步草稿
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  // 色板点击外部关闭
  useEffect(() => {
    if (!paletteOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (paletteRef.current?.contains(e.target as Node)) return;
      setPaletteOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [paletteOpen]);

  const commitName = () => {
    setEditing(false);
    const trimmed = draft.trim();
    const next = trimmed || FALLBACK_NAME;
    if (next !== name) onNameChange(next);
    else setDraft(name);
  };

  return (
    <div
      data-group-frame={id}
      className="absolute pointer-events-auto cursor-grab"
      style={{
        left: x,
        top: y,
        width,
        height,
        zIndex: active ? 120 : 1,
        borderRadius: 8,
        border: `1px solid color-mix(in srgb, ${color} ${active ? 85 : 68}%, transparent)`,
        background: `color-mix(in srgb, ${color} ${active ? 10 : 8}%, transparent)`,
        boxShadow: active ? `0 4px 20px rgba(0,0,0,0.08), 0 0 0 1px color-mix(in srgb, ${color} 40%, transparent)` : undefined,
        transition: 'border-color 150ms ease, box-shadow 150ms ease, z-index 0ms',
      }}
      onPointerDown={(e) => {
        // 仅主键（左键）拖拽；按住 Shift 留给画布框选
        if (e.button !== 0 || e.shiftKey) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, input, textarea, a')) return;
        e.stopPropagation();
        onDragStart(e);
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, input, textarea, a')) return;
        e.stopPropagation();
        onSelect();
      }}
      title="拖动移动整组 · 单击选中整组"
    >
      <style>{`
        [data-group-frame="${id}"].group-dragging {
          transition: none !important;
          user-select: none !important;
          cursor: grabbing !important;
        }
      `}</style>
      {/* 左上角标题 chip：略微压住边框 */}
      <div
        className="absolute -top-3 left-3 flex items-center gap-1 pointer-events-auto max-w-[calc(100%-48px)] h-7 px-1.5 rounded-md select-none cursor-grab active:cursor-grabbing"
        style={{
          background: `color-mix(in srgb, ${color} ${active ? 20 : 14}%, var(--color-paper))`,
          border: `1px solid color-mix(in srgb, ${color} ${active ? 75 : 55}%, transparent)`,
          boxShadow: active ? '0 2px 6px rgba(0,0,0,0.12)' : '0 1px 2px rgba(0,0,0,0.06)',
          zIndex: 2,
        }}
        onPointerDown={(e) => {
          // 编辑态/色板/按钮不触发拖动；其余区域按下即开始整组拖动（页面协调器接管后续指针）
          const target = e.target as HTMLElement;
          if (editing || target.closest('button, input')) return;
          e.stopPropagation();
          onDragStart(e);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(name);
          setEditing(true);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (!editing) onSelect();
        }}
        title="拖动移动整组 · 双击重命名 · 单击选中整组"
      >
        {/* 背景色按钮 + 色板 */}
        <div ref={paletteRef} className="relative shrink-0">
          <button
            title="分组背景色"
            className="w-3.5 h-3.5 rounded-full border border-black/10 transition-transform duration-150 hover:scale-110"
            style={{ backgroundColor: color }}
            onClick={(e) => {
              e.stopPropagation();
              setPaletteOpen((v) => !v);
            }}
          />
          {paletteOpen && (
            <div
              className="absolute left-0 top-5 z-50 flex gap-1 p-1.5 rounded-lg bg-paper border border-paper-grid shadow-lg"
              style={{ width: 'max-content' }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {colors.map((c) => (
                <button
                  key={c.value}
                  title={c.name}
                  className="w-4 h-4 rounded-full border transition-transform duration-150 hover:scale-110"
                  style={{
                    backgroundColor: c.value,
                    borderColor: c.value === color ? 'var(--color-ink)' : 'rgba(0,0,0,0.1)',
                    transform: c.value === color ? 'scale(1.15)' : undefined,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onColorChange(c.value);
                    setPaletteOpen(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* 名称：双击进入编辑 */}
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              else if (e.key === 'Escape') {
                setDraft(name);
                setEditing(false);
              }
            }}
            className="w-28 font-serif text-[13px] text-ink bg-transparent outline-none border-b border-accent/50"
            maxLength={30}
          />
        ) : (
          <span className="font-serif text-[13px] text-ink truncate max-w-[160px] leading-none py-1">
            {name || FALLBACK_NAME}
          </span>
        )}

        {/* 解散分组 */}
        <button
          title="解散分组（节点与连线保留）"
          className="shrink-0 p-0.5 text-ink-light/70 hover:text-error transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onDisband();
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default CanvasGroupFrame;

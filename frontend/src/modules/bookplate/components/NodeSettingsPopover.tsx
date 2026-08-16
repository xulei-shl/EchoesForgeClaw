import React, { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Toggle } from '../../../platform/components/ui/Toggle';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import type { NodeRunSettings } from '../../../platform/types';

/** 图像生成节点可选尺寸档位（Agnes 契约：1K/2K/3K/4K 档位式，配合宽高比使用） */
const IMAGE_SIZE_OPTIONS: SelectOption[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '3K', label: '3K' },
  { value: '4K', label: '4K' },
];

/** 图像生成节点可选宽高比（Agnes 支持的 ratio 枚举） */
const IMAGE_RATIO_OPTIONS: SelectOption[] = [
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '4:3', label: '4:3' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '2:3', label: '2:3' },
  { value: '3:2', label: '3:2' },
  { value: '21:9', label: '21:9' },
];

const POPOVER_STYLE = `
@keyframes ns-pop-enter {
  0% { opacity: 0; transform: scale(0.96); transform-origin: bottom right; }
  100% { opacity: 1; transform: scale(1); transform-origin: bottom right; }
}
.ns-pop-enter-anim { animation: ns-pop-enter 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
`;

export interface NodeSettingsPopoverProps {
  settings: NodeRunSettings;
  onChange: (settings: NodeRunSettings) => void;
  /** 生成中禁用 */
  disabled?: boolean;
  /** 画布是否已存在图书元数据节点（无根节点时禁用「包含图书元数据」） */
  hasBookInfo?: boolean;
  /** 是否有下级节点关联（有下级时禁用设置，避免影响下游输出） */
  hasDownstream?: boolean;
  /** 是否展示图像参数（尺寸/宽高比）区块：仅图像生成节点传入 */
  showImageParams?: boolean;
  /** 按钮样式（沿用各节点的 actionBtn 类） */
  className?: string;
}

const NodeSettingsPopoverInner: React.FC<NodeSettingsPopoverProps> = ({
  settings,
  onChange,
  disabled,
  hasBookInfo = true,
  hasDownstream,
  showImageParams = false,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  // 设置弹层：点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        popupRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setCoords({
        x: window.innerWidth - rect.right,
        y: window.innerHeight - rect.top + 8,
      });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <NodeActionBar.SettingsTrigger
        ref={btnRef}
        onClick={toggleOpen}
        disabled={disabled}
        hasDownstream={hasDownstream}
        className={className}
        tooltip="运行设置"
      />
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={popupRef} className="fixed z-[9999]" style={{ right: coords.x, bottom: coords.y }}>
          <style dangerouslySetInnerHTML={{ __html: POPOVER_STYLE }} />
          <div className="w-64 ns-pop-enter-anim">
            <div className="bg-paper border border-paper-grid rounded-xl shadow-xl">
              <div className="px-3 py-2.5 border-b border-dashed border-paper-grid bg-paper-grid/10 rounded-t-xl">
                <p className="text-xs font-sans font-medium text-ink-light">运行设置</p>
              </div>
              <div className="p-3 space-y-3">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-sans text-ink">包含图书元数据</p>
                    <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                      {hasBookInfo
                        ? '未直接连线时，优先注入连线上游图书元数据，无连通时取画布根节点'
                        : '画布中还没有图书元数据节点'}
                    </p>
                  </div>
                  <Toggle
                    checked={settings.includeBook}
                    onChange={(v) => onChange({ ...settings, includeBook: v })}
                    label="包含图书元数据"
                    disabled={disabled || !hasBookInfo}
                  />
                </div>

                {showImageParams && (
                  <div className="space-y-2.5 border-t border-dashed border-paper-grid pt-3">
                    <div>
                      <p className="text-xs font-sans text-ink mb-1.5">输出尺寸</p>
                      <Select
                        size="sm"
                        value={settings.imageSize ?? ''}
                        onChange={(v) => onChange({ ...settings, imageSize: v || undefined })}
                        placeholder="默认（不指定）"
                        options={IMAGE_SIZE_OPTIONS}
                        disabled={disabled}
                      />
                    </div>
                    <div>
                      <p className="text-xs font-sans text-ink mb-1.5">宽高比</p>
                      <Select
                        size="sm"
                        value={settings.imageRatio ?? ''}
                        onChange={(v) => onChange({ ...settings, imageRatio: v || undefined })}
                        placeholder="默认（不指定）"
                        options={IMAGE_RATIO_OPTIONS}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export const NodeSettingsPopover = memo(NodeSettingsPopoverInner);
NodeSettingsPopover.displayName = 'NodeSettingsPopover';
export default NodeSettingsPopover;

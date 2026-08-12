import React, { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Toggle } from '../../../platform/components/ui/Toggle';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import type { NodeRunSettings } from '../../../platform/types';

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
  /** 按钮样式（沿用各节点的 actionBtn 类） */
  className?: string;
}

const NodeSettingsPopoverInner: React.FC<NodeSettingsPopoverProps> = ({
  settings,
  onChange,
  disabled,
  hasBookInfo = true,
  hasDownstream,
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
            <div className="bg-paper border border-paper-grid rounded-xl shadow-xl overflow-hidden">
              <div className="px-3 py-2.5 border-b border-dashed border-paper-grid bg-paper-grid/10">
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
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-sans text-ink">自动运行</p>
                    <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                      输入就绪时自动执行；关闭后需点击「运行」按钮手动执行
                    </p>
                  </div>
                  <Toggle
                    checked={settings.autoRun}
                    onChange={(v) => onChange({ ...settings, autoRun: v })}
                    label="自动运行"
                    disabled={disabled}
                  />
                </div>
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

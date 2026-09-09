import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SliderRow } from '../../../../../../shared/components/ui/Slider';
import { Toggle } from '../../../../../../shared/components/ui/Toggle';
import { FontFamilySelect, TextColorPalette } from '../../journal';
import type { EditorialState, EditorialTypographySettings } from '../types';

export interface EditorialStyleDrawerProps {
  id: string;
  isOpen: boolean;
  typography: EditorialTypographySettings;
  drawerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  setTypography: React.Dispatch<React.SetStateAction<EditorialTypographySettings>>;
  onUpdateState?: (id: string, patch: Partial<EditorialState>, undoable?: boolean) => void;
}

/** 字体与排版样式侧边抽屉组件 */
export const EditorialStyleDrawer: React.FC<EditorialStyleDrawerProps> = ({
  id,
  isOpen,
  typography,
  drawerRef,
  onClose,
  setTypography,
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
          className="absolute inset-y-2 right-2 w-64 max-w-[calc(100%-16px)] bg-paper/95 backdrop-blur-md border border-paper-grid/60 rounded-xl p-3 shadow-xl z-40 flex flex-col gap-3 overflow-y-auto text-xs text-ink select-none"
        >
          <div className="flex items-center justify-between font-medium text-ink pb-1 border-b border-paper-grid/40">
            <span>字体与排版</span>
            <button
              type="button"
              onClick={onClose}
              className="relative p-1 rounded-md text-ink-light hover:text-ink hover:bg-paper-grid/40 transition-colors before:absolute before:-inset-1 before:content-[''] cursor-pointer"
              aria-label="关闭排版配置"
            >
              ✕
            </button>
          </div>

          <div>
            <label className="block text-[11px] font-sans text-ink-faint mb-1">标题字体</label>
            <FontFamilySelect
              value={typography.headlineFont}
              onChange={(f) => {
                setTypography((prev) => ({ ...prev, headlineFont: f }));
                onUpdateState?.(id, { typography: { ...typography, headlineFont: f } });
              }}
            />
          </div>

          <div>
            <label className="block text-[11px] font-sans text-ink-faint mb-1">正文字体</label>
            <FontFamilySelect
              value={typography.bodyFont}
              onChange={(f) => {
                setTypography((prev) => ({ ...prev, bodyFont: f }));
                onUpdateState?.(id, { typography: { ...typography, bodyFont: f } });
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <SliderRow
              label="正文字号"
              value={typography.bodyFontSize}
              min={14}
              max={28}
              step={1}
              unit="px"
              labelWidth="w-14"
              onChange={(s) => {
                const lh = Math.round(s * 1.6);
                setTypography((prev) => ({ ...prev, bodyFontSize: s, bodyLineHeight: lh }));
                onUpdateState?.(id, { typography: { ...typography, bodyFontSize: s, bodyLineHeight: lh } });
              }}
            />
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-paper-grid/40">
            <span className="text-[11px] font-sans text-ink-light">首字下沉 (Drop Cap)</span>
            <Toggle
              checked={typography.dropCap}
              onChange={(dc) => {
                setTypography((prev) => ({ ...prev, dropCap: dc }));
                onUpdateState?.(id, { typography: { ...typography, dropCap: dc } });
              }}
            />
          </div>

          <div className="pt-1 border-t border-paper-grid/40">
            <label className="block text-[11px] font-sans text-ink-faint mb-1.5">文字颜色</label>
            <TextColorPalette
              value={typography.textColor || '#000000'}
              onChange={(color) => {
                setTypography((prev) => ({ ...prev, textColor: color }));
                onUpdateState?.(id, { typography: { ...typography, textColor: color } });
              }}
              size="normal"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

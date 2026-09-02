import React from 'react';
import { UniversalTextToolbar } from '../../journal/text/UniversalTextToolbar';
import type { TextAlignment } from '../../journal/text/FontControls';
import type {
  EditorialArticleData,
  EditorialFreeTextItem,
  EditorialTextAlign,
} from '../types';
import { TextSizeStepper } from './widgets/TextSizeStepper';

export interface EditorialFreeTextToolbarProps {
  selectedTextId: string | null;
  editingTextId: string | null;
  freeTexts: EditorialFreeTextItem[];
  article: EditorialArticleData;
  onPatchFreeText: (id: string, patch: Partial<EditorialFreeTextItem>, undoable?: boolean) => void;
  onOpenEdit: (item: EditorialFreeTextItem) => void;
  onDeleteText: (id: string) => void;
  onBumpLayer: (id: string, mode: 'up' | 'down' | 'top' | 'bottom') => void;
  onRotateStep: (id: string, direction: 'cw' | 'ccw') => void;
}

/** 自由排版选中文本悬浮工具栏（浮于舞台顶层，不受内部 scale 和卡片 overflow-hidden 裁切影响） */
export const EditorialFreeTextToolbar: React.FC<EditorialFreeTextToolbarProps> = ({
  selectedTextId,
  editingTextId,
  freeTexts,
  article,
  onPatchFreeText,
  onOpenEdit,
  onDeleteText,
  onBumpLayer,
  onRotateStep,
}) => {
  if (!selectedTextId || editingTextId) return null;

  const selFt = freeTexts.find((ft) => ft.id === selectedTextId);
  if (!selFt) return null;

  const txtContent = selFt.bind ? String(article[selFt.bind] ?? '') : selFt.text;

  return (
    <div
      className="absolute top-2 z-40 pointer-events-auto max-w-[calc(100%-16px)]"
      style={{ left: '50%', transform: 'translateX(-50%)' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <UniversalTextToolbar
        item={{
          id: selFt.id,
          text: txtContent,
          fontFamily: selFt.fontFamily,
          color: selFt.color,
          writingMode: selFt.writingMode || 'horizontal',
          textAlign: (selFt.textAlign || 'left') as TextAlignment,
        }}
        variant="floating"
        onUpdate={(patch) =>
          onPatchFreeText(selFt.id, {
            fontFamily: patch.fontFamily,
            color: patch.color,
            writingMode: patch.writingMode as 'horizontal' | 'vertical' | undefined,
            textAlign: (patch.textAlign || selFt.textAlign || 'left') as EditorialTextAlign,
          })
        }
        onOpenEdit={() => onOpenEdit(selFt)}
        extraActions={
          <TextSizeStepper
            value={selFt.fontSize}
            onChange={(v) => onPatchFreeText(selFt.id, { fontSize: v }, false)}
          />
        }
        onDelete={() => onDeleteText(selFt.id)}
        onBumpLayer={(mode) => onBumpLayer(selFt.id, mode)}
        onRotateStep={(mode) => onRotateStep(selFt.id, mode)}
      />
    </div>
  );
};

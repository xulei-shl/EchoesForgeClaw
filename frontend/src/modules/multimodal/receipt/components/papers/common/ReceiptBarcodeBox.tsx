import React from 'react';
import { createBarcodeSvgUri } from '../../../barcode';
import { stopEvent } from './stopEvent';

export interface ReceiptBarcodeBoxProps {
  barcodeText?: string;
  textColor: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * 热敏小票条形码展示与编辑组件
 */
export const ReceiptBarcodeBox: React.FC<ReceiptBarcodeBoxProps> = ({
  barcodeText,
  textColor,
  disabled = false,
  onChange,
}) => {
  const barcodeSvg = createBarcodeSvgUri(barcodeText || '9787020002207', textColor);

  return (
    <div className="flex flex-col items-center gap-1.5 pt-1">
      <img src={barcodeSvg} alt="条形码" className="h-14 max-w-full object-contain" />
      <input
        type="text"
        value={barcodeText || ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={stopEvent}
        onPointerDown={stopEvent}
        placeholder="ISBN / 条形码数字"
        className="text-center text-[10px] tracking-widest bg-transparent outline-none opacity-60 hover:opacity-100 font-mono w-44 border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
        style={{ color: textColor }}
      />
    </div>
  );
};

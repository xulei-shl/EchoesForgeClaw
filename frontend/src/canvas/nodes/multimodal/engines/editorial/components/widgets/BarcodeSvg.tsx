import React, { useMemo } from 'react';

export interface BarcodeSvgProps {
  width: number;
  height: number;
  color?: string;
}

/** 矢量条形码组件 */
export const BarcodeSvg: React.FC<BarcodeSvgProps> = ({
  width,
  height,
  color = '#000000',
}) => {
  const barCount = 36;
  const unitW = width / (barCount * 1.5);
  const bars = useMemo(() => {
    const res: { x: number; w: number }[] = [];
    let curX = 0;
    for (let i = 0; i < barCount; i++) {
      const isThick = i % 3 === 0 || i % 7 === 0;
      const w = isThick ? unitW * 2 : unitW;
      res.push({ x: curX, w });
      curX += w + unitW * 0.8;
      if (curX > width) break;
    }
    return res;
  }, [width, unitW]);

  return (
    <svg width={width} height={height} className="overflow-visible">
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill={color} />
      ))}
    </svg>
  );
};

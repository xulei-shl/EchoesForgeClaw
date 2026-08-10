import React from 'react';

interface BeamGlowProps {
  className?: string;
}

/**
 * 边框光束动效：一束光沿组件边框循环滚动。
 */
export const BeamGlow: React.FC<BeamGlowProps> = ({ className = '' }) => (
  <div
    aria-hidden="true"
    className={`pointer-events-none absolute inset-[-1px] rounded-md z-50 ${className}`}
  >
    {/* 边框遮罩容器：精确贴合父容器，使用 CSS 遮罩技术镂空中心，只显示 2px 的边框 */}
    <div
      className="absolute inset-0 rounded-md overflow-hidden"
      style={{
        WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
        WebkitMaskComposite: 'xor',
        maskComposite: 'exclude',
        border: '2px solid transparent',
        borderRadius: 'inherit',
      }}
    >
      {/* 旋转的光束背景：放大到 200% 以确保旋转时始终覆盖四个角，且不会因为旋转而产生形变 */}
      <div
        className="absolute -inset-[50%] animate-[beam-spin_3s_linear_infinite] will-change-transform"
        style={{
          background: `conic-gradient(
            from 0deg,
            transparent 0deg,
            color-mix(in srgb, var(--color-accent) 5%, transparent) 3deg,
            color-mix(in srgb, var(--color-accent) 22%, white 40%) 8deg,
            color-mix(in srgb, var(--color-accent) 30%, white 70%) 12deg,
            color-mix(in srgb, var(--color-accent) 58%, transparent) 17deg,
            color-mix(in srgb, var(--color-accent) 41%, transparent) 25deg,
            color-mix(in srgb, var(--color-accent) 28%, transparent) 33deg,
            color-mix(in srgb, var(--color-accent) 19%, transparent) 42deg,
            color-mix(in srgb, var(--color-accent) 12%, transparent) 50deg,
            color-mix(in srgb, var(--color-accent) 7%, transparent) 57deg,
            color-mix(in srgb, var(--color-accent) 0%, transparent) 62deg,
            transparent 66deg
          )`,
        }}
      />
    </div>

    {/* 微弱基环（光束间隙边框仍可见）+ 柔和外发光 */}
    <div
      className="absolute inset-0 rounded-md"
      style={{
        boxShadow:
          'inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent), ' +
          'inset 0 0 12px color-mix(in srgb, var(--color-accent) 20%, transparent), ' +
          '0 0 20px color-mix(in srgb, var(--color-accent) 40%, transparent)',
      }}
    />
  </div>
);

export default BeamGlow;

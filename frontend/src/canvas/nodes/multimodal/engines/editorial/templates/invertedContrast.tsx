import type { EditorialTemplate, CanvasRenderContext } from '../types';

/**
 * ◼ 粗野反色模板 (Brutalist Inverted)
 * 特征：38:62 强反差黑白非对称对开、垂直旋转大标、工业坐标与 3px 重边框
 */
const drawInvertedContrastDecorations = (
  ctx: CanvasRenderingContext2D,
  { article, typography, H, accentColor, layoutProjection }: CanvasRenderContext
) => {
  if (layoutProjection.splitPanelRect) {
    ctx.save();
    ctx.fillStyle = '#111111';
    ctx.fillRect(
      layoutProjection.splitPanelRect.x,
      layoutProjection.splitPanelRect.y,
      layoutProjection.splitPanelRect.width,
      layoutProjection.splitPanelRect.height
    );

    // 分割垂直粗边框
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(layoutProjection.splitPanelRect.width, 0);
    ctx.lineTo(layoutProjection.splitPanelRect.width, H);
    ctx.stroke();

    // 工业坐标
    if (article.eyebrow) {
      ctx.fillStyle = accentColor;
      ctx.font = `600 ${Math.round(layoutProjection.splitPanelRect.width * 0.045)}px ${typography.accentFont || 'monospace'}`;
      ctx.textBaseline = 'top';
      ctx.fillText(
        article.eyebrow,
        layoutProjection.splitPanelRect.x + 24,
        Math.round(H * 0.05)
      );
    }
    ctx.restore();
  }
};

export const invertedContrastTemplate: EditorialTemplate = {
  id: 'inverted_contrast',
  name: '粗野反色',
  englishName: 'Brutalist Inverted',
  description: '38:62 强反差黑白非对称对开、垂直旋转大标、工业坐标与 3px 重边框',
  columns: 2,
  defaultRatio: '3:4',
  features: {
    layoutType: 'inverted',
    hasSplitPanel: true,
    hasBarcode: true,
    hasTabularBorder: true,
    headlinePlacement: 'left-col',
    pullquotePlacement: 'none',
  },
  defaultArticle: {
    masthead: 'BRUTALISM & SPATIAL SYSTEMS',
    eyebrow: 'LAT 31°14’N / LON 121°28’E',
    headline: 'STRUCTURE',
    deck: 'RAW MASS, UNFILTERED TEXTURE, RADICAL CONTRAST.',
    author: 'ECHOES FORGE CONSTRUCT',
    body: '粗野主义不是粗糙，而是对形式、材质与结构的极致坦诚。黑白对开不仅是色彩的反转，更是空间权力的重构。纯黑实心色块承载坚硬的垂直大标与技术坐标，白底多栏正文则承载精密的逻辑陈述。双重极性交织，释放出冷静而强大的工业美学力量。',
    folio: 'CONSTRUCT · ARCHIVE 09',
    issueDate: '2026.08.30',
  },
  defaultTypography: {
    headlineFont: 'MiSans, "JetBrains Mono", sans-serif',
    bodyFont: 'MiSans, "Helvetica Neue", sans-serif',
    accentFont: 'JetBrains Mono, monospace',
    textColor: '#111111',
    accentColor: '#e85d26',
    secondaryColor: '#666666',
    bodyFontSize: 19,
    bodyLineHeight: 31,
    dropCap: false,
    colGap: 36,
  },
  defaultBackground: {
    type: 'color',
    color: '#ffffff',
  },
  renderDecorations: ({ article, typography, ratioPreset, layoutProjection }) => (
    <>
      {/* 左侧纯黑分割面板 */}
      {layoutProjection.splitPanelRect && (
        <div
          className="absolute top-0 left-0 bg-[#111111] pointer-events-none"
          style={{
            width: `${layoutProjection.splitPanelRect.width}px`,
            height: '100%',
            borderRight: `4px solid ${typography.accentColor || '#e85d26'}`,
          }}
        >
          {/* 左侧工业坐标 / 眉标 */}
          {article.eyebrow && (
            <div
              className="absolute font-mono font-semibold tracking-widest text-[14px]"
              style={{
                top: `${Math.round(ratioPreset.height * 0.05)}px`,
                left: `${Math.round(ratioPreset.width * 0.05)}px`,
                color: typography.accentColor || '#e85d26',
              }}
            >
              {article.eyebrow}
            </div>
          )}
        </div>
      )}
    </>
  ),
  drawDecorations: drawInvertedContrastDecorations,
};

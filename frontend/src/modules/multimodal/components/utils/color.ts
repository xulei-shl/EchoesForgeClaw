import type { ColorItem, ColorHarmonyItem } from '../ColorSearchNode';

/** HEX 转 RGB */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

/** HEX 转 HSL */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const rgb = hexToRgb(hex);
  if (!rgb) return { h: 0, s: 0, l: 0 };
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * 格式化中国传统色及 5 色推荐调色板为结构化 Markdown
 * 供下游节点（AI 对话、文本聚合、图像生成等）作为上下文即时消费
 */
export function formatColorMarkdown(
  color: ColorItem | null | undefined,
  palette: ColorItem[] = []
): string {
  const baseColor = color || palette[0];
  if (!baseColor) return '';

  const effectivePalette = palette && palette.length > 0 ? palette : [baseColor];
  const paletteLines = effectivePalette
    .map((p, idx) => {
      const hsl = p.hsl || (p.h || p.s || p.l ? { h: p.h, s: p.s, l: p.l } : hexToHsl(p.hex));
      const tags = [p.hue_category, p.temperature].filter(Boolean).join(' · ');
      return `- **色 ${String(idx + 1).padStart(2, '0')} · ${p.name}**：HEX \`${p.hex}\` | HSL \`${hsl.h}°, ${hsl.s}%, ${hsl.l}%\`${
        tags ? ` (${tags})` : ''
      }`;
    })
    .join('\n');

  const baseHsl =
    baseColor.hsl ||
    (baseColor.h || baseColor.s || baseColor.l
      ? { h: baseColor.h, s: baseColor.s, l: baseColor.l }
      : hexToHsl(baseColor.hex));
  const baseRgb = baseColor.rgb || hexToRgb(baseColor.hex) || { r: 0, g: 0, b: 0 };
  const cid = baseColor.id ? `${baseColor.id} · ` : '';

  const harmonies = baseColor.harmonies || {};
  const formatRelation = (items: ColorHarmonyItem[] = []) =>
    items && items.length > 0 ? items.map((i) => `${i.name} (\`${i.hex}\`)`).join('、') : '无';

  return `# 【中国传统色】${cid}${baseColor.name} (${baseColor.hex})

> **基本属性**：${baseColor.hue_category || '传统色'} | **色温**：${baseColor.temperature || '中性'} | **HSL**：\`${baseHsl.h}°, ${baseHsl.s}%, ${baseHsl.l}%\` | **RGB**：\`${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}\`

---

### 🎨 5 色推荐调色板
${paletteLines}

---

### 📐 经典传统配色方案
- **主辅点缀方案**：${harmonies.curated_plan || '主色识别，辅色延展，点缀色提亮焦点。'}
- **同类色搭配**：${formatRelation(harmonies.same)}
- **邻近色搭配**：${formatRelation(harmonies.analogous)}
- **互补/分裂互补**：${formatRelation(harmonies.complementary)}${harmonies.split_complementary?.length ? ` | ${formatRelation(harmonies.split_complementary)}` : ''}
- **冷暖对照**：${formatRelation(harmonies.temperature_contrast)}
- **深浅层级**：明色 ${formatRelation(harmonies.lighter)} | 暗色 ${formatRelation(harmonies.darker)}
- **降噪中性**：灰调 ${formatRelation(harmonies.gray_tone)} | 中性 ${formatRelation(harmonies.neutral)}
`;
}

/** 判断 harmony 对象是否携带了可用的具体搭配数组（至少一类非空），
 *  用于区分「真的没有搭配」与「仅带 curated_plan/空数组」的残缺数据 */
export function hasUsableHarmonies(h: ColorItem['harmonies']): boolean {
  if (!h) return false;
  return [
    'same',
    'analogous',
    'complementary',
    'split_complementary',
    'triadic',
    'tetradic',
    'temperature_contrast',
    'lighter',
    'darker',
    'gray_tone',
    'neutral',
    'accent',
  ].some((k) => Array.isArray((h as any)[k]) && (h as any)[k].length > 0);
}

/** 判断颜色亮度，计算最易读的前景文字颜色 */
export function getReadableTextColor(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#1A1A1A';
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? '#1A1A1A' : '#FFFFFF';
}

/** 根据单色自身的搭配关系与当前算法模式（自动/近似/对比/三分/中性），计算该色块专属的 4 个替换候选 */
export function getSuggestionsForTile(
  color: ColorItem,
  currentMethod: string,
  cache: Map<string, ColorItem>,
  catalogItems: ColorItem[]
): ColorHarmonyItem[] {
  const padId = color.id ? String(color.id).padStart(3, '0') : '';
  const cached =
    cache.get(color.id) ||
    (padId ? cache.get(padId) : undefined) ||
    (color.name ? cache.get(color.name) : undefined);
  const harmonies = (hasUsableHarmonies(color.harmonies)
    ? color.harmonies
    : cached && hasUsableHarmonies(cached.harmonies)
      ? cached.harmonies
      : {}) || {};

  let pool: ColorHarmonyItem[] = [];
  if (currentMethod === 'analogous') {
    pool = [
      ...(harmonies.same || []),
      ...(harmonies.analogous || []),
      ...(harmonies.lighter || []),
      ...(harmonies.darker || []),
    ];
  } else if (currentMethod === 'complementary') {
    pool = [
      ...(harmonies.complementary || []),
      ...(harmonies.split_complementary || []),
      ...(harmonies.temperature_contrast || []),
      ...(harmonies.accent || []),
    ];
  } else if (currentMethod === 'triadic') {
    pool = [
      ...(harmonies.triadic || []),
      ...(harmonies.tetradic || []),
      ...(harmonies.accent || []),
      ...(harmonies.split_complementary || []),
    ];
  } else if (currentMethod === 'neutral') {
    pool = [
      ...(harmonies.neutral || []),
      ...(harmonies.gray_tone || []),
      ...(harmonies.same || []),
      ...(harmonies.lighter || []),
    ];
  } else {
    pool = [
      ...(harmonies.same || []).slice(0, 1),
      ...(harmonies.analogous || []).slice(0, 1),
      ...(harmonies.complementary || []).slice(0, 1),
      ...(harmonies.accent || []).slice(0, 1),
      ...(harmonies.triadic || []).slice(0, 1),
      ...(harmonies.temperature_contrast || []).slice(0, 1),
      ...(harmonies.lighter || []).slice(0, 1),
      ...(harmonies.darker || []).slice(0, 1),
      ...(harmonies.neutral || []).slice(0, 1),
    ];
  }

  if (pool.length < 4) {
    const all = [
      ...(harmonies.same || []),
      ...(harmonies.analogous || []),
      ...(harmonies.complementary || []),
      ...(harmonies.split_complementary || []),
      ...(harmonies.triadic || []),
      ...(harmonies.tetradic || []),
      ...(harmonies.accent || []),
      ...(harmonies.temperature_contrast || []),
      ...(harmonies.lighter || []),
      ...(harmonies.darker || []),
      ...(harmonies.neutral || []),
      ...(harmonies.gray_tone || []),
    ];
    pool = [...pool, ...all];
  }

  const seenIds = new Set<string>([color.id, padId, color.name]);
  const suggestions: ColorHarmonyItem[] = [];
  for (const h of pool) {
    if (h && (h.id || h.name) && !seenIds.has(h.id) && !seenIds.has(h.name)) {
      if (h.id) seenIds.add(h.id);
      if (h.name) seenIds.add(h.name);
      suggestions.push(h);
      if (suggestions.length >= 4) break;
    }
  }

  if (suggestions.length < 4 && catalogItems.length > 0) {
    for (const fallback of catalogItems) {
      if (
        fallback &&
        fallback.id &&
        !seenIds.has(fallback.id) &&
        !seenIds.has(fallback.name)
      ) {
        seenIds.add(fallback.id);
        if (fallback.name) seenIds.add(fallback.name);
        suggestions.push({
          id: fallback.id,
          name: fallback.name,
          hex: fallback.hex,
        });
        if (suggestions.length >= 4) break;
      }
    }
  }

  return suggestions;
}
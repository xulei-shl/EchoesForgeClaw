import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  Palette,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { SearchImageThumbnail } from './SearchImageThumbnail';
import api from '../../../platform/services/api';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { SMALL_TOOL_TIMEOUT_MS } from '../../../platform/utils/timeouts';
import { NODE_COLORS } from '../../bookplate/nodeTypes';

export interface ColorHarmonyItem {
  id: string;
  name: string;
  hex: string;
}

export interface ColorItem {
  id: string;
  name: string;
  hex: string;
  h: number;
  s: number;
  l: number;
  hsl?: { h: number; s: number; l: number };
  rgb?: { r: number; g: number; b: number };
  hue_category?: string;
  temperature?: string;
  full_image_url?: string;
  thumb_url?: string;
  preview_url?: string;
  harmonies?: {
    same?: ColorHarmonyItem[];
    analogous?: ColorHarmonyItem[];
    complementary?: ColorHarmonyItem[];
    split_complementary?: ColorHarmonyItem[];
    triadic?: ColorHarmonyItem[];
    tetradic?: ColorHarmonyItem[];
    temperature_contrast?: ColorHarmonyItem[];
    lighter?: ColorHarmonyItem[];
    darker?: ColorHarmonyItem[];
    gray_tone?: ColorHarmonyItem[];
    neutral?: ColorHarmonyItem[];
    primary?: string;
    secondary?: ColorHarmonyItem[];
    accent?: ColorHarmonyItem[];
    curated_plan?: string;
    algorithm_note?: string;
  };
}

export interface ColorSearchNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 已选色卡图片本地 URL（node.data.imageUrl，对外图片输出） */
  imageUrl?: string | null;
  /** 已选传统色元数据 */
  selectedColor?: ColorItem | null;
  /** 当前 5 色调色盘 */
  palette?: ColorItem[];
  /** 选中的分类（色系） */
  category?: string;
  /** 选中的冷暖 */
  temperature?: string;
  /** 当前激活的 Tab（'search' | 'generator'） */
  activeTab?: 'search' | 'generator';
  /** 配色算法（'auto' | 'analogous' | 'complementary' | 'triadic' | 'neutral'） */
  paletteMethod?: string;
  /** 连线上级文本（连线即输入：优先作为检索关键词） */
  upstreamKeyword?: string;
  /** 页面级错误 */
  error?: string | null;
  /** 选中色彩/色板：保存图片并生成 Markdown 写入 node.data */
  onSelectColor?: (id: string, color: ColorItem, palette?: ColorItem[]) => Promise<void>;
  /** 编辑器状态写入 node.data */
  onUpdateEditor?: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
}

export const DEFAULT_HUE_CATEGORIES = [
  '黄色系',
  '橙色系',
  '红色系',
  '绿色系',
  '青色系',
  '蓝色系',
  '紫色系',
  '灰色系',
];

export const PALETTE_METHODS = [
  { key: 'auto', label: '自动', desc: '主辅点缀与综合平衡搭配' },
  { key: 'analogous', label: '近似', desc: '同类与邻近色过渡，柔和统一' },
  { key: 'complementary', label: '对比', desc: '互补与分裂互补，焦点鲜明' },
  { key: 'triadic', label: '三分', desc: '三角与四角色，系列节奏感' },
  { key: 'neutral', label: '中性', desc: '低噪声灰调与留白承托' },
];

/** HEX 转 RGB */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

/** HEX 转 HSL */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
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
function hasUsableHarmonies(h: ColorItem['harmonies']): boolean {
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
function getReadableTextColor(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#1A1A1A';
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  // YIQ 亮度公式
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? '#1A1A1A' : '#FFFFFF';
}

/** 根据单色自身的搭配关系与当前算法模式（自动/近似/对比/三分/中性），计算该色块专属的 4 个替换候选 */
function getSuggestionsForTile(
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
    // 近似模式：同类 + 邻近 + 明色 + 暗色
    pool = [
      ...(harmonies.same || []),
      ...(harmonies.analogous || []),
      ...(harmonies.lighter || []),
      ...(harmonies.darker || []),
    ];
  } else if (currentMethod === 'complementary') {
    // 对比模式：互补 + 分裂互补 + 冷暖对照 + 点缀
    pool = [
      ...(harmonies.complementary || []),
      ...(harmonies.split_complementary || []),
      ...(harmonies.temperature_contrast || []),
      ...(harmonies.accent || []),
    ];
  } else if (currentMethod === 'triadic') {
    // 三分模式：三角 + 四角 + 点缀 + 分裂互补
    pool = [
      ...(harmonies.triadic || []),
      ...(harmonies.tetradic || []),
      ...(harmonies.accent || []),
      ...(harmonies.split_complementary || []),
    ];
  } else if (currentMethod === 'neutral') {
    // 中性模式：中性 + 灰调 + 同类 + 明色
    pool = [
      ...(harmonies.neutral || []),
      ...(harmonies.gray_tone || []),
      ...(harmonies.same || []),
      ...(harmonies.lighter || []),
    ];
  } else {
    // auto 自动模式：综合平衡搭配
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

  // 若搭配池不足 4 个，聚合全量关系池兜底
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

  // 极端情况下若仍不足 4 个，从已加载列表中智能借调补齐
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

const ColorSearchNodeInner: React.FC<ColorSearchNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  imageUrl = null,
  selectedColor = null,
  palette: savedPalette = [],
  category = '',
  temperature = '',
  activeTab = 'search',
  paletteMethod = 'auto',
  upstreamKeyword = '',
  error: _error = null,
  onSelectColor,
  onUpdateEditor,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  hasDownstream = false,
}) => {
  const { showToast } = useFeedback();

  // Tab 状态
  const [currentTab, setCurrentTab] = useState<'search' | 'generator'>(activeTab === 'generator' ? 'generator' : 'search');

  // 筛选与检索状态
  const [categories, setCategories] = useState<string[]>(DEFAULT_HUE_CATEGORIES);
  const [activeCategory, setActiveCategory] = useState<string>(category);
  const [activeTemp, setActiveTemp] = useState<string>(temperature);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ColorItem[]>([]);
  const [_total, setTotal] = useState<number>(0);
  const [loadingType, setLoadingType] = useState<'search' | 'refresh' | 'auto' | null>(null);
  const loading = loadingType !== null;
  const [searchError, setSearchError] = useState<string>('');
  const [savingId, setSavingId] = useState<string | null>(null);

  // 调色盘生成器状态
  const [palette, setPalette] = useState<ColorItem[]>(savedPalette);
  const [method, setMethod] = useState<string>(paletteMethod);
  const [generatorLoading, setGeneratorLoading] = useState(false);
  const colorCacheRef = useRef<Map<string, ColorItem>>(new Map());

  /** 请求序号：防并发竞争 */
  const requestSeq = useRef(0);
  const prevUpstreamRef = useRef(upstreamKeyword);

  /** 生效关键词：连线上级文本优先，其次当前手动输入 */
  const effectiveQuery = upstreamKeyword.trim() || query.trim();

  /** 有下级节点时锁定影响输出的修改操作（符合 NodeActionBar 统一规范） */
  const isLocked = Boolean(hasDownstream);

  // 1. 获取分类列表
  useEffect(() => {
    let unmounted = false;
    async function initMeta() {
      try {
        const catRes: any = await api.get('/modules/bookplate/color-search/categories', {
          timeout: SMALL_TOOL_TIMEOUT_MS,
        });
        if (!unmounted && Array.isArray(catRes?.categories)) {
          setCategories(catRes.categories);
        }
      } catch (e) {
        console.error('Failed to fetch color categories:', e);
      }
    }
    void initMeta();
    return () => {
      unmounted = true;
    };
  }, []);

  // 2. 加载色彩数据
  const loadColors = useCallback(
    async (
      cat: string,
      temp: string,
      queryText: string,
      type: 'search' | 'refresh' | 'auto' = 'auto',
      isRandom = false
    ) => {
      const seq = ++requestSeq.current;
      setLoadingType(type);
      setSearchError('');

      const hasFilter = Boolean(cat || temp || queryText);
      const effectivePerPage = isRandom && !hasFilter ? 36 : 500;

      try {
        const res: { items?: ColorItem[]; total?: number } = await api.post(
          '/modules/bookplate/color-search',
          {
            category: cat || null,
            temperature: temp || null,
            query: queryText || null,
            page: 1,
            per_page: effectivePerPage,
            random: isRandom,
          },
          { timeout: SMALL_TOOL_TIMEOUT_MS }
        );

        if (seq !== requestSeq.current) return;
        const list = Array.isArray(res.items) ? res.items : [];
        setItems(list);
        list.forEach((c) => {
          if (c.id && hasUsableHarmonies(c.harmonies)) colorCacheRef.current.set(c.id, c);
        });
        setTotal(typeof res.total === 'number' ? res.total : list.length);
        setSearchError('');
      } catch (e: any) {
        if (seq !== requestSeq.current) return;
        setSearchError(e?.detail || e?.message || '传统色检索失败，请重试');
        setItems([]);
        setTotal(0);
      } finally {
        if (seq === requestSeq.current) setLoadingType(null);
      }
    },
    []
  );

  // 挂载初次加载（随机 24 色）
  useEffect(() => {
    void loadColors(activeCategory, activeTemp, effectiveQuery, 'auto', !effectiveQuery);
  }, [activeCategory, activeTemp, effectiveQuery, loadColors]);

  // 上游关键词变化响应
  useEffect(() => {
    if (prevUpstreamRef.current !== upstreamKeyword) {
      prevUpstreamRef.current = upstreamKeyword;
      void loadColors(activeCategory, activeTemp, upstreamKeyword.trim() || query.trim(), 'auto', false);
    }
  }, [upstreamKeyword, activeCategory, activeTemp, query, loadColors]);

  // 3. 生成 5 色调色板
  const generatePalette = useCallback(
    async (anchorId?: string, nextMethod = method, curPalette = palette) => {
      if (isLocked) return;
      setGeneratorLoading(true);
      try {
        const anchor = anchorId || selectedColor?.id || curPalette[0]?.id || '001';
        const res: any = await api.post(
          '/modules/bookplate/color-search/palette',
          {
            anchor_id: anchor,
            method: nextMethod,
            previous_palette: curPalette,
          },
          { timeout: SMALL_TOOL_TIMEOUT_MS }
        );
        if (Array.isArray(res?.palette) && res.palette.length > 0) {
          setPalette(res.palette);
          res.palette.forEach((p: ColorItem) => {
            if (p.id && hasUsableHarmonies(p.harmonies)) colorCacheRef.current.set(p.id, p);
          });
          const curAnchor = selectedColor || res.palette[0];
          const newOutput = formatColorMarkdown(curAnchor, res.palette);
          onUpdateEditor?.(
            id,
            {
              palette: res.palette,
              paletteMethod: nextMethod,
              output: newOutput,
              ...(selectedColor ? {} : { selectedColor: curAnchor }),
            },
            false
          );
        }
      } catch (e) {
        console.error('Failed to generate palette:', e);
      } finally {
        setGeneratorLoading(false);
      }
    },
    [id, method, palette, selectedColor, isLocked, onUpdateEditor]
  );

  // 如果初始没有 palette 且有 selectedColor，自动生成一组
  useEffect(() => {
    if (palette.length === 0 && selectedColor?.id) {
      void generatePalette(selectedColor.id);
    }
  }, [selectedColor, palette.length, generatePalette]);

  // 同步父级传入的 savedPalette 变更
  useEffect(() => {
    if (Array.isArray(savedPalette) && savedPalette.length > 0) {
      setPalette((prev) => {
        if (prev.length !== savedPalette.length) return savedPalette;
        const isDifferent = savedPalette.some((p, i) => p.id !== prev[i]?.id);
        return isDifferent ? savedPalette : prev;
      });
    }
  }, [savedPalette]);

  // 调色板若有缺失 harmonies 的项，自动并行补全
  useEffect(() => {
    let unmounted = false;
    const hasMissing = palette.some((p) => !hasUsableHarmonies(p.harmonies));
    if (!hasMissing) return;

    async function enrichPalette() {
      let changed = false;
      const updated = await Promise.all(
        palette.map(async (p) => {
          if (hasUsableHarmonies(p.harmonies)) {
            colorCacheRef.current.set(p.id, p);
            return p;
          }
          const cid = p.id || p.name;
          const cached = colorCacheRef.current.get(cid) || (p.name ? colorCacheRef.current.get(p.name) : undefined);
          if (cached && hasUsableHarmonies(cached.harmonies)) {
            changed = true;
            return cached;
          }
          try {
            const res: any = await api.get(`/modules/bookplate/color-search/${encodeURIComponent(cid)}`, {
              timeout: SMALL_TOOL_TIMEOUT_MS,
            });
            if (res && res.id && hasUsableHarmonies(res.harmonies)) {
              changed = true;
              colorCacheRef.current.set(res.id, res);
              if (res.name) colorCacheRef.current.set(res.name, res);
              return res as ColorItem;
            }
          } catch {
            // ignore
          }
          return p;
        })
      );
      if (!unmounted && changed) {
        setPalette(updated);
        const curAnchor = selectedColor || updated[0];
        const newOutput = formatColorMarkdown(curAnchor, updated);
        onUpdateEditor?.(id, { palette: updated, output: newOutput }, false);
      }
    }
    void enrichPalette();
  }, [palette, selectedColor, id, onUpdateEditor]);

  const handleTabChange = (tab: 'search' | 'generator') => {
    setCurrentTab(tab);
    onUpdateEditor?.(id, { activeTab: tab }, false);
    if (tab === 'generator' && palette.length === 0) {
      void generatePalette();
    }
  };

  const handleCategoryChange = (cat: string) => {
    setActiveCategory(cat);
    onUpdateEditor?.(id, { category: cat }, false);
    void loadColors(cat, activeTemp, effectiveQuery, 'search', !effectiveQuery);
  };

  const handleTempChange = (temp: string) => {
    const next = activeTemp === temp ? '' : temp;
    setActiveTemp(next);
    onUpdateEditor?.(id, { temperature: next }, false);
    void loadColors(activeCategory, next, effectiveQuery, 'search', !effectiveQuery);
  };

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    void loadColors(activeCategory, activeTemp, effectiveQuery, 'search', false);
  };

  const handleRefresh = () => {
    if (loading) return;
    void loadColors(activeCategory, activeTemp, effectiveQuery, 'refresh', true);
  };

  // 选中一个颜色/色板为主色并输出
  const handleSelect = async (color: ColorItem, curPalette = palette) => {
    if (isLocked || savingId) return;
    setSavingId(color.id);
    try {
      await onSelectColor?.(id, color, curPalette.length > 0 ? curPalette : undefined);
      showToast(`已选用传统色「${color.name}」(${color.hex})，配色方案已同步`, {
        type: 'success',
        position: 'top-right',
      });
      // 带入生成器作为 anchor（若非当前 anchor）
      if (color.id !== selectedColor?.id) {
        void generatePalette(color.id);
      }
    } catch {
      // error 会被统一处理
    } finally {
      setSavingId(null);
    }
  };

  // 调色板中单色快速替换（补全完整 ColorItem 元数据以持续提供 harmonies 搭配圆点）
  const replaceSingleColor = async (index: number, replacement: ColorHarmonyItem) => {
    if (isLocked) return;

    const cid = replacement.id || replacement.name;
    const padId = replacement.id ? String(replacement.id).padStart(3, '0') : '';

    // 优先从内存缓存或当前已加载列表查找
    let targetItem: ColorItem | null =
      colorCacheRef.current.get(replacement.id) ||
      (padId ? colorCacheRef.current.get(padId) : undefined) ||
      (replacement.name ? colorCacheRef.current.get(replacement.name) : undefined) ||
      items.find((c) => c.id === replacement.id || c.name === replacement.name) ||
      null;

    if (!targetItem || !hasUsableHarmonies(targetItem.harmonies)) {
      try {
        const res: any = await api.get(`/modules/bookplate/color-search/${encodeURIComponent(cid)}`, {
          timeout: SMALL_TOOL_TIMEOUT_MS,
        });
        if (res && (res.id || res.name)) {
          targetItem = res as ColorItem;
        }
      } catch (err) {
        console.warn('Failed to fetch full color detail for replacement:', err);
      }
    }

    if (!targetItem) {
      targetItem = {
        id: replacement.id,
        name: replacement.name,
        hex: replacement.hex,
        h: 0,
        s: 0,
        l: 0,
      };
    }

    if (targetItem.id) {
      colorCacheRef.current.set(targetItem.id, targetItem);
      colorCacheRef.current.set(String(targetItem.id).padStart(3, '0'), targetItem);
    }
    if (targetItem.name) {
      colorCacheRef.current.set(targetItem.name, targetItem);
    }

    const nextPalette = [...palette];
    nextPalette[index] = targetItem;
    const curAnchor = selectedColor || nextPalette[0];
    const newOutput = formatColorMarkdown(curAnchor, nextPalette);

    setPalette(nextPalette);
    onUpdateEditor?.(
      id,
      {
        palette: nextPalette,
        output: newOutput,
        ...(selectedColor ? {} : { selectedColor: curAnchor }),
      },
      false
    );
    showToast(`色块 0${index + 1} 已替换为「${replacement.name}」，方案已实时生效`, {
      type: 'info',
      position: 'top-right',
    });
  };

  // 复制 HEX
  const copyToClipboard = (text: string, label = '颜色代码') => {
    navigator.clipboard.writeText(text);
    showToast(`已复制 ${label}: ${text}`, { type: 'success' });
  };

  // 复制整个调色板
  const copyFullPalette = () => {
    if (!palette.length) return;
    const text = palette.map((p) => `${p.name} ${p.hex}`).join(' | ');
    copyToClipboard(text, '5色调色板');
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    const ext = imageUrl.split('.').pop()?.split('?')[0]?.toLowerCase() || 'png';
    const colorName = selectedColor?.name || 'color';
    a.href = imageUrl;
    a.download = `chinese-color-${colorName}-${Date.now()}.${ext}`;
    a.click();
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '中国传统配色'}
      dotColor={NODE_COLORS.color_search}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 480, height: 620 }}
      showLeftAnchor
      showRightAnchor
      footer={footer}
      actionBar={
        <NodeActionBar>
          {imageUrl && (
            <NodeActionBar.Download tooltip="下载已选传统色卡" onClick={handleDownload} />
          )}
          <NodeActionBar.ExternalLink
            href="https://colors.xiaoxiaodong.ai/"
            tooltip="点击使用完整功能"
          />
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2 font-sans">
          {/* 顶栏 Tab 切换 */}
          <div className="shrink-0 flex items-center justify-between border-b border-paper-grid/50 pb-1.5 px-0.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleTabChange('search')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-serif transition-colors ${
                  currentTab === 'search'
                    ? 'bg-ink/10 text-ink font-bold shadow-xs'
                    : 'text-ink-muted hover:text-ink hover:bg-ink/5'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>色彩检索</span>
              </button>
              <button
                type="button"
                onClick={() => handleTabChange('generator')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-serif transition-colors ${
                  currentTab === 'generator'
                    ? 'bg-ink/10 text-ink font-bold shadow-xs'
                    : 'text-ink-muted hover:text-ink hover:bg-ink/5'
                }`}
              >
                <Palette className="w-3.5 h-3.5" />
                <span>配色生成器</span>
              </button>
            </div>

            {/* 右侧换一批 / 刷新按钮 */}
            {currentTab === 'search' && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading}
                className="flex items-center gap-1 text-[11px] font-serif text-ink-muted hover:text-ink px-1.5 py-0.5 rounded hover:bg-ink/5 transition-colors disabled:opacity-40 cursor-pointer"
                title="随机换一批传统色"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                <span>换一批</span>
              </button>
            )}
          </div>

          {/* ======================= Tab 1: 色彩检索 ======================= */}
          {currentTab === 'search' && (
            <div className="flex-1 flex flex-col min-h-0 gap-2">
              {/* 筛选与搜索条 */}
              <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
                {/* 色系下拉 */}
                <div className="relative min-w-[100px] flex-1">
                  <select
                    value={activeCategory}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className="w-full h-7 pl-2 pr-6 rounded-md border border-dashed border-paper-grid bg-transparent text-xs font-serif text-ink focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
                  >
                    <option value="" className="bg-paper text-ink">全部色系 (742 色)</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat} className="bg-paper text-ink">
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 冷暖单选 */}
                <div className="flex items-center gap-0.5 bg-ink/5 p-0.5 rounded-md border border-paper-grid/40">
                  {['暖', '冷', '中性'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTempChange(t)}
                      className={`px-1.5 py-0.5 text-[11px] font-serif rounded transition-colors ${
                        activeTemp === t
                          ? 'bg-paper text-ink font-bold shadow-xs'
                          : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* 搜索框 */}
                <form onSubmit={handleSearch} className="flex-1 min-w-[120px] flex items-center gap-1">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={upstreamKeyword ? `上游词: ${upstreamKeyword}` : '搜色名/拼音/HEX'}
                      className="w-full h-7 pl-2 pr-5 rounded-md border border-dashed border-paper-grid bg-transparent text-xs text-ink placeholder:text-ink-muted/50 focus:outline-none focus:border-accent transition-colors font-serif"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery('');
                          void loadColors(activeCategory, activeTemp, '', 'search', true);
                        }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* 色彩网格展示区 */}
              <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                {searchError ? (
                  <div className="h-full flex items-center justify-center text-xs text-red-500 font-serif p-4 text-center">
                    {searchError}
                  </div>
                ) : items.length === 0 && !loading ? (
                  <div className="h-full flex flex-col items-center justify-center text-ink-muted text-xs font-serif p-4 text-center gap-1">
                    <span>未找到匹配的传统色</span>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('');
                        setActiveCategory('');
                        setActiveTemp('');
                        void loadColors('', '', '', 'refresh', true);
                      }}
                      className="text-accent underline hover:opacity-80"
                    >
                      重置筛选条件
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {items.map((color) => {
                      const isSelected = selectedColor?.id === color.id;

                      return (
                        <div
                          key={color.id}
                          className={`group relative flex flex-col rounded-lg border overflow-hidden transition-all duration-200 ${
                            isSelected
                              ? 'border-accent ring-2 ring-accent/30 shadow-md scale-[1.02]'
                              : 'border-paper-grid/60 hover:border-accent/60 hover:shadow-xs'
                          }`}
                        >
                          {/* 色卡缩略图（可点击放大） */}
                          <div
                            className="relative aspect-4/3 overflow-hidden cursor-pointer"
                            style={{ backgroundColor: color.hex }}
                          >
                            <SearchImageThumbnail
                              thumbUrl={color.thumb_url || ''}
                              previewUrl={color.full_image_url || color.thumb_url || ''}
                              alt={color.name}
                              className="!aspect-4/3"
                            />

                            {/* 纯色色块指示角标 */}
                            <span
                              className="absolute top-1 left-1 w-3 h-3 rounded-full border border-white/60 shadow-xs z-10 pointer-events-none"
                              style={{ backgroundColor: color.hex }}
                              title={`HEX: ${color.hex}`}
                            />

                            {/* 选择 / 已选 按钮 */}
                            {isSelected ? (
                              <div
                                title="当前已选为此传统色输出"
                                className="absolute top-1 right-1 px-1.5 h-5 rounded-full flex items-center gap-0.5 bg-accent text-paper text-[10px] font-sans font-medium shadow-sm pointer-events-none z-10"
                              >
                                <Check size={11} strokeWidth={2.5} />
                                <span>已选</span>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleSelect(color);
                                }}
                                disabled={savingId === color.id || isLocked}
                                title={
                                  isLocked
                                    ? '有下级节点，不可更换输出'
                                    : '选用此传统色作为基准色并输出'
                                }
                                className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center bg-black/45 text-white/90 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent disabled:opacity-40 disabled:hover:bg-black/45 disabled:cursor-not-allowed active:scale-95 z-10"
                              >
                                {savingId === color.id ? (
                                  <Loader2 size={12} strokeWidth={2} className="animate-spin" />
                                ) : (
                                  <Check size={12} strokeWidth={2.5} />
                                )}
                              </button>
                            )}
                          </div>

                          {/* 底部色名与色值 */}
                          <div
                            className="px-2 py-1.5 flex flex-col justify-between transition-colors"
                            style={{ backgroundColor: `${color.hex}15` }}
                          >
                            <div className="flex items-baseline justify-between gap-1">
                              <span className="text-xs font-serif font-bold text-ink truncate">
                                {color.name}
                              </span>
                              <span className="text-[10px] font-mono text-ink-muted truncate">
                                {color.id}
                              </span>
                            </div>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-[10px] font-mono text-ink-muted">
                                {color.hex}
                              </span>
                              <span className="text-[9px] font-serif px-1 rounded bg-black/5 text-ink-muted">
                                {color.temperature || '中性'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ======================= Tab 2: 配色生成器 ======================= */}
          {currentTab === 'generator' && (
            <div className="flex-1 flex flex-col min-h-0 gap-2.5">
              {/* 生成模式选择器 */}
              <div className="shrink-0 flex items-center justify-between gap-1 flex-wrap">
                <div className="flex items-center gap-1 bg-ink/5 p-0.5 rounded-lg border border-paper-grid/40">
                  {PALETTE_METHODS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        setMethod(m.key);
                        void generatePalette(selectedColor?.id, m.key);
                      }}
                      className={`px-2 py-1 text-xs font-serif rounded-md transition-all ${
                        method === m.key
                          ? 'bg-paper text-ink font-bold shadow-xs'
                          : 'text-ink-muted hover:text-ink'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                      title={isLocked ? '有下级节点，不可更换算法' : m.desc}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => generatePalette(selectedColor?.id, method)}
                    disabled={generatorLoading || isLocked}
                    className="flex items-center gap-1 px-2.5 py-1 bg-paper border border-paper-grid/60 hover:border-accent/60 text-ink rounded-md text-xs font-serif shadow-xs hover:bg-ink/5 active:scale-[0.96] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title={isLocked ? '有下级节点，不可更换色板' : '换一组搭配'}
                  >
                    <RefreshCw className={`w-3 h-3 ${generatorLoading ? 'animate-spin' : ''}`} />
                    <span>换一组</span>
                  </button>
                  <button
                    type="button"
                    onClick={copyFullPalette}
                    className="p-1 rounded-md text-ink-muted hover:text-ink hover:bg-ink/5 transition-colors border border-paper-grid/40 active:scale-[0.96] cursor-pointer"
                    title="复制完整 5 色调色板"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 5 色调色盘看板（5 列纵向展示） */}
              <div className="flex-1 min-h-0 grid grid-cols-5 gap-1.5 rounded-xl overflow-hidden p-1 bg-ink/5 border border-paper-grid/50">
                {palette.map((color, index) => {
                  const textColor = getReadableTextColor(color.hex);
                  const suggestions = getSuggestionsForTile(color, method, colorCacheRef.current, items);

                  return (
                    <div
                      key={`${color.id}-${index}`}
                      className="group/tile relative flex flex-col justify-between p-2 rounded-lg transition-transform duration-200 hover:scale-[1.02] shadow-xs"
                      style={{ backgroundColor: color.hex, color: textColor }}
                    >
                      {/* 顶部序号 */}
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-bold opacity-75">
                          0{index + 1}
                        </span>
                      </div>

                      {/* 中间色值与色名 */}
                      <div className="flex flex-col my-auto text-center gap-0.5">
                        <span className="text-xs font-serif font-bold truncate tracking-wide">
                          {color.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(color.hex, color.name)}
                          className="text-[10px] font-mono opacity-80 hover:opacity-100 hover:underline cursor-pointer"
                          title="点击复制 HEX"
                        >
                          {color.hex}
                        </button>
                      </div>

                      {/* 底部推荐替换色点 */}
                      <div className="pt-2 flex items-center justify-center gap-1">
                        {suggestions.map((sug, sIdx) => (
                          <button
                            key={sIdx}
                            type="button"
                            disabled={isLocked}
                            onClick={() => void replaceSingleColor(index, sug)}
                            className="w-3.5 h-3.5 rounded-full border border-white/60 shadow-xs hover:scale-125 transition-transform disabled:opacity-30 disabled:hover:scale-100 disabled:cursor-not-allowed cursor-pointer"
                            style={{ backgroundColor: sug.hex }}
                            title={isLocked ? '有下级节点，不可替换单色' : `替换为: ${sug.name} (${sug.hex})`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 5 色方案概要 */}
              {palette.length > 0 && (
                <div className="shrink-0 flex flex-col p-2 rounded-lg bg-paper-grid/20 border border-paper-grid/40">
                  <span className="text-xs font-serif font-bold text-ink truncate">
                    当前基准：{selectedColor?.name || palette[0]?.name}
                  </span>
                  <span className="text-[11px] font-serif text-ink-muted truncate">
                    包含 {palette.map((p) => p.name).join('、')}
                  </span>
                </div>
              )}
            </div>
          )}


          {/* ======================= 底部已选状态栏 ======================= */}
          <div className="shrink-0 pt-1.5 border-t border-paper-grid/60 flex items-center justify-between gap-2">
            {selectedColor ? (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* 缩略图（可放大） */}
                <div
                  className="relative w-8 h-8 rounded-md overflow-hidden shrink-0 border border-paper-grid cursor-pointer"
                  style={{ backgroundColor: selectedColor.hex }}
                >
                  <SearchImageThumbnail
                    thumbUrl={selectedColor.thumb_url || ''}
                    previewUrl={selectedColor.full_image_url || selectedColor.thumb_url || ''}
                    alt={selectedColor.name}
                    className="!w-8 !h-8 !aspect-square"
                  />
                </div>

                {/* 文字信息 */}
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-serif font-bold text-ink truncate">
                      {selectedColor.name}
                    </span>
                    <span className="text-[10px] font-mono text-ink-muted">
                      {selectedColor.hex}
                    </span>
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-white/60"
                      style={{ backgroundColor: selectedColor.hex }}
                    />
                  </div>
                  {/* 5 色微型色条 */}
                  {palette.length > 0 && (
                    <div className="flex items-center gap-0.5 mt-0.5">
                      {palette.map((p, pIdx) => (
                        <span
                          key={pIdx}
                          className="w-3.5 h-1.5 rounded-xs"
                          style={{ backgroundColor: p.hex }}
                          title={`${p.name} (${p.hex})`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs font-serif text-ink-muted">
                <Palette className="w-3.5 h-3.5 text-ink-muted/60" />
                <span>请从上方选择一款传统色作为输出</span>
              </div>
            )}
          </div>
        </div>
    </CanvasNode>
  );
};

export const ColorSearchNode = memo(ColorSearchNodeInner);

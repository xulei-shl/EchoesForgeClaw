import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../../../config/database.js';
import { getAppSettingsMap } from '../../../repositories/index.js';
import { userSearchImageDir } from '../../../services/multimodal/image-service.js';
import { ImageGenerationError } from '../../../infrastructure/ai/errors.js';

/** 获取 Python Chinese Traditional Colors API base URL（优先系统设置，次选环境变量，最后默认 localhost:8103） */
function getColorsApiUrl(): string {
  const s = getAppSettingsMap(getDb());
  const configured = s['service.colors.base_url']?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return (process.env.COLORS_API ?? 'http://127.0.0.1:8103').replace(/\/+$/, '');
}

/** 动态查找 services/zhongguo-traditional-colors 真实路径 */
function findColorsDir(): string {
  const tryStart = (dir: string) => {
    let curr = dir;
    for (let i = 0; i < 7; i++) {
      const candidate = path.join(curr, 'services', 'zhongguo-traditional-colors');
      if (existsSync(path.join(candidate, 'docs', 'chinese-color-harmony.csv'))) return candidate;
      const parent = path.dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
    return '';
  };

  return tryStart(path.dirname(fileURLToPath(import.meta.url))) || tryStart(process.cwd()) || '';
}

/** 本地传统色数据目录 */
const BASE_DIR = findColorsDir();
const HARMONY_CSV = BASE_DIR ? path.join(BASE_DIR, 'docs', 'chinese-color-harmony.csv') : '';

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
  hsl: { h: number; s: number; l: number };
  rgb: { r: number; g: number; b: number };
  hue_category: string;
  temperature: string;
  full_image_url: string;
  thumb_url: string;
  preview_url: string;
  harmonies: {
    same: ColorHarmonyItem[];
    analogous: ColorHarmonyItem[];
    complementary: ColorHarmonyItem[];
    split_complementary: ColorHarmonyItem[];
    triadic: ColorHarmonyItem[];
    tetradic: ColorHarmonyItem[];
    temperature_contrast: ColorHarmonyItem[];
    lighter: ColorHarmonyItem[];
    darker: ColorHarmonyItem[];
    gray_tone: ColorHarmonyItem[];
    neutral: ColorHarmonyItem[];
    primary: string;
    secondary: ColorHarmonyItem[];
    accent: ColorHarmonyItem[];
    curated_plan: string;
    algorithm_note: string;
  };
}

let _localColors: ColorItem[] = [];
let _localColorById: Map<string, ColorItem> = new Map();
let _localCategories: string[] = [];
const _localTemperatures: string[] = ['暖', '冷', '中性'];

function hexToRgb(hexStr: string): { r: number; g: number; b: number } {
  let clean = hexStr.replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function parseRelationColors(rawStr: string): ColorHarmonyItem[] {
  if (!rawStr || !rawStr.trim()) return [];
  const items: ColorHarmonyItem[] = [];
  for (const part of rawStr.split('|')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d{1,3})[-_ ]?([^\s#]+)\s+(#[0-9a-fA-F]{3,6})/);
    if (match && match[1] && match[2] && match[3]) {
      items.push({
        id: match[1].padStart(3, '0'),
        name: match[2].trim(),
        hex: match[3].toUpperCase(),
      });
    } else {
      const tokens = trimmed.split(/\s+/);
      const cHex = tokens.find((t) => t.startsWith('#')) || '';
      items.push({
        id: tokens[0] ? tokens[0].padStart(3, '0') : '',
        name: trimmed,
        hex: cHex.toUpperCase(),
      });
    }
  }
  return items;
}

function parseCsvLines(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0] || '');
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rowValues = parseCsvLine(lines[i] || '');
    const obj: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      const col = header[j];
      if (col) {
        obj[col] = rowValues[j] ?? '';
      }
    }
    rows.push(obj);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let curr = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        curr += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(curr.trim());
      curr = '';
    } else {
      curr += ch;
    }
  }
  result.push(curr.trim());
  return result;
}

function calibrateCategory(name: string, hexVal: string, h: number, s: number, l: number, rawCat: string): string {
  if (s < 12 || l >= 92 || l <= 12) {
    if (name.includes('黄') && s >= 10) {
      // 浅黄色相保留
    } else {
      return '中性色';
    }
  }
  if (name.endsWith('绿') || name.endsWith('碧') || name.endsWith('翠') || name.includes('绿')) {
    return '绿色系';
  }
  if (name.endsWith('黄') || name.endsWith('金') || (name.includes('黄') && !name.includes('绿') && !name.includes('青') && !name.includes('蓝'))) {
    return '黄色系';
  }
  if (name.endsWith('红') || name.endsWith('朱') || name.endsWith('赤') || name.endsWith('茜') || name.endsWith('绯') || name.endsWith('丹') || name.endsWith('绛') || name.endsWith('殷') || name.endsWith('胭') || name.endsWith('彤')) {
    return '红色系';
  }
  if (name.endsWith('橙') || name.endsWith('橘') || name.endsWith('赭') || name.endsWith('褐') || name.endsWith('驼') || name.endsWith('栗') || name.endsWith('咖')) {
    return '橙色系';
  }
  if (name.endsWith('蓝') || name.endsWith('靛') || name.endsWith('绀')) {
    return '蓝色系';
  }
  if (name.endsWith('紫') || name.endsWith('黛') || name.endsWith('青莲')) {
    return '紫色系';
  }
  if (name.endsWith('青') || name.endsWith('苍') || name.endsWith('葱') || name.endsWith('湖')) {
    return '青色系';
  }
  if (name.endsWith('白') || name.endsWith('灰') || name.endsWith('黑') || name.endsWith('玄') || name.endsWith('墨') || name.endsWith('炭') || name.endsWith('银')) {
    return '中性色';
  }
  if (h >= 345 || h < 20) return '红色系';
  if (h >= 20 && h < 45) return '橙色系';
  if (h >= 45 && h < 65) return '黄色系';
  if (h >= 65 && h < 155) return '绿色系';
  if (h >= 155 && h < 195) return '青色系';
  if (h >= 195 && h < 255) return '蓝色系';
  if (h >= 255 && h < 345) return '紫色系';
  return rawCat || '中性色';
}

function calibrateTemperature(
  name: string,
  hexVal: string,
  h: number,
  s: number,
  l: number,
  hueCat: string,
  rawTemp: string
): string {
  if (
    hueCat === '中性色' ||
    name.endsWith('白') ||
    name.endsWith('灰') ||
    name.endsWith('黑') ||
    name.endsWith('银') ||
    name.endsWith('玄') ||
    name.endsWith('墨') ||
    name.endsWith('炭') ||
    name.endsWith('素') ||
    (s < 14 && !name.includes('黄') && !name.includes('红') && !name.includes('绿'))
  ) {
    return '中性';
  }
  if (hueCat === '黄色系' || hueCat === '橙色系') {
    return '暖';
  }
  if (hueCat === '红色系') {
    if (h >= 310 && h <= 340 && (name.includes('紫') || name.includes('藕'))) {
      return '冷';
    }
    return '暖';
  }
  if (hueCat === '蓝色系' || hueCat === '青色系' || hueCat === '紫色系') {
    return '冷';
  }
  if (hueCat === '绿色系') {
    if (h >= 60 && h <= 85 && (name.includes('嫩') || name.includes('黄') || name.includes('芽') || rawTemp === '暖')) {
      return '暖';
    }
    return '冷';
  }
  return rawTemp || '中性';
}

function loadLocalData(): void {
  if (!HARMONY_CSV || !existsSync(HARMONY_CSV)) {
    console.warn('[ColorSearch] Harmony CSV file not found at:', HARMONY_CSV);
    return;
  }

  // 加载传统色与搭配关系主数据
  try {
    const rawData = readFileSync(HARMONY_CSV, 'utf-8');
    const rows = parseCsvLines(rawData);
    const colors: ColorItem[] = [];
    const colorMap = new Map<string, ColorItem>();
    const catSet = new Set<string>();

    for (const row of rows) {
      const rawId = (row['编号'] || '').trim();
      if (!rawId) continue;
      const cid = rawId.padStart(3, '0');
      const name = (row['色名'] || '').trim();
      const hexVal = (row['HEX'] || '').trim().toUpperCase();
      const h = parseInt(row['H'] || '0', 10) || 0;
      const s = parseInt(row['S'] || '0', 10) || 0;
      const l = parseInt(row['L'] || '0', 10) || 0;
      const rawHueCat = (row['色相分类'] || '').trim();
      const hueCat = calibrateCategory(name, hexVal, h, s, l, rawHueCat);
      const rawTemp = (row['冷暖属性'] || '').trim();
      const temp = calibrateTemperature(name, hexVal, h, s, l, hueCat, rawTemp);

      if (hueCat) catSet.add(hueCat);

      const imgRel = `images/${cid}-${name}.png`;
      const thumbRel = `thumbnails/color-card-${cid}.jpg`;
      const fullImgUrl = `/static/colors/${imgRel}`;
      const thumbUrl = `/static/colors/${thumbRel}`;

      const item: ColorItem = {
        id: cid,
        name,
        hex: hexVal,
        h,
        s,
        l,
        hsl: { h, s, l },
        rgb: hexToRgb(hexVal),
        hue_category: hueCat,
        temperature: temp,
        full_image_url: fullImgUrl,
        thumb_url: thumbUrl,
        preview_url: fullImgUrl,
        harmonies: {
          same: parseRelationColors(row['同类色'] || ''),
          analogous: parseRelationColors(row['邻近色'] || ''),
          complementary: parseRelationColors(row['互补色'] || ''),
          split_complementary: parseRelationColors(row['分裂互补'] || ''),
          triadic: parseRelationColors(row['三角色'] || ''),
          tetradic: parseRelationColors(row['四角色'] || ''),
          temperature_contrast: parseRelationColors(row['冷暖对照'] || ''),
          lighter: parseRelationColors(row['明色搭配'] || ''),
          darker: parseRelationColors(row['暗色搭配'] || ''),
          gray_tone: parseRelationColors(row['灰调搭配'] || ''),
          neutral: parseRelationColors(row['中性色搭配'] || ''),
          primary: (row['主色'] || '').trim(),
          secondary: parseRelationColors(row['辅色'] || ''),
          accent: parseRelationColors(row['点缀色'] || ''),
          curated_plan: (row['主辅点缀方案'] || '').trim(),
          algorithm_note: (row['算法说明'] || '').trim(),
        },
      };

      colors.push(item);
      colorMap.set(cid, item);
    }

    _localColors = colors;
    _localColorById = colorMap;
    _localCategories = Array.from(catSet);
    console.info(`[ColorSearch] Loaded ${_localColors.length} traditional colors and ${_localCategories.length} categories from ${HARMONY_CSV}`);
  } catch (err) {
    console.error('Failed to load local harmony CSV:', err);
  }
}

// 启动时初次加载
loadLocalData();

function shuffleArray<T>(arr: T[]): T[] {
  const list = [...arr];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = list[i]!;
    list[i] = list[j]!;
    list[j] = temp;
  }
  return list;
}

function getCandidateIds(anchorItem: ColorItem, method: string): string[] {
  const h = anchorItem.harmonies || ({} as any);
  const same = shuffleArray((h.same || []).map((c: any) => c.id));
  const analogous = shuffleArray((h.analogous || []).map((c: any) => c.id));
  const comp = shuffleArray((h.complementary || []).map((c: any) => c.id));
  const split = shuffleArray((h.split_complementary || []).map((c: any) => c.id));
  const triadic = shuffleArray((h.triadic || []).map((c: any) => c.id));
  const tetradic = shuffleArray((h.tetradic || []).map((c: any) => c.id));
  const temp = shuffleArray((h.temperature_contrast || []).map((c: any) => c.id));
  const lighter = shuffleArray((h.lighter || []).map((c: any) => c.id));
  const darker = shuffleArray((h.darker || []).map((c: any) => c.id));
  const gray = shuffleArray((h.gray_tone || []).map((c: any) => c.id));
  const neutral = shuffleArray((h.neutral || []).map((c: any) => c.id));
  const accent = shuffleArray((h.accent || []).map((c: any) => c.id));

  if (method === 'analogous') {
    return shuffleArray([...same, ...analogous, ...lighter, ...darker]);
  }
  if (method === 'complementary') {
    return shuffleArray([...comp, ...split, ...neutral]);
  }
  if (method === 'triadic') {
    return shuffleArray([...triadic, ...tetradic, ...accent]);
  }
  if (method === 'neutral') {
    return shuffleArray([...neutral, ...gray, ...same]);
  }
  // auto 模式
  const res: string[] = [];
  if (same.length > 0 && same[0]) res.push(same[0]);
  if (analogous.length > 0 && analogous[0]) res.push(analogous[0]);
  if (neutral.length > 0 && neutral[0]) res.push(neutral[0]);
  if (accent.length > 0 && accent[0]) res.push(accent[0]);
  if (temp.length > 0 && temp[0]) res.push(temp[0]);
  if (darker.length > 0 && darker[0]) res.push(darker[0]);
  return shuffleArray(res.length > 0 ? res : [...same, ...analogous, ...comp, ...accent]);
}

function build5PaletteLocal(
  anchorId: string,
  method = 'auto',
  previousPalette?: ColorItem[],
  lockedState?: boolean[]
): ColorItem[] {
  if (_localColors.length === 0) loadLocalData();

  const padId = String(anchorId || '').trim().padStart(3, '0');
  let anchor = _localColorById.get(padId);
  if (!anchor && _localColors.length > 0) {
    const randomIdx = Math.floor(Math.random() * _localColors.length);
    anchor = _localColors[randomIdx];
  }
  if (!anchor) return [];

  const paletteSize = 5;
  const locked = lockedState && lockedState.length === paletteSize ? lockedState : [false, false, false, false, false];
  const lockedIds = new Set<string>();

  if (previousPalette) {
    for (let i = 0; i < paletteSize; i++) {
      const pColor = previousPalette[i];
      if (locked[i] && pColor && pColor.id) {
        lockedIds.add(pColor.id);
      }
    }
  }

  const candidates = getCandidateIds(anchor, method).filter((id) => _localColorById.has(id));
  const allIds = _localColors.map((c) => c.id).sort(() => Math.random() - 0.5);

  const sequence: string[] = [];
  const seen = new Set<string>();
  for (const id of [anchor.id, ...candidates, ...allIds]) {
    if (!seen.has(id) && !lockedIds.has(id) && _localColorById.has(id)) {
      seen.add(id);
      sequence.push(id);
    }
  }

  let cursor = 0;
  const result: ColorItem[] = [];
  for (let i = 0; i < paletteSize; i++) {
    const prevColor = previousPalette ? previousPalette[i] : undefined;
    if (locked[i] && prevColor) {
      result.push(prevColor);
    } else {
      const cid = cursor < sequence.length && sequence[cursor] ? sequence[cursor]! : anchor.id;
      cursor++;
      result.push(_localColorById.get(cid) || anchor);
    }
  }

  return result;
}

function searchLocal(
  category?: string | null,
  temperature?: string | null,
  query?: string | null,
  page = 1,
  perPage = 24,
  isRandom = false
) {
  if (_localColors.length === 0) loadLocalData();

  let results = [..._localColors];

  if (category && category.trim() && category !== '全部') {
    const targetCat = category.trim();
    results = results.filter((c) => c.hue_category === targetCat);
  }

  if (temperature && temperature.trim() && temperature !== '全部') {
    const targetTemp = temperature.trim();
    results = results.filter((c) => c.temperature === targetTemp);
  }

  if (query && query.trim()) {
    const rawQuery = query.trim().toLowerCase();
    const keywords = rawQuery.split(/\s+/);
    results = results.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const id = (c.id || '').toLowerCase();
      const hex = (c.hex || '').toLowerCase();
      const hue = (c.hue_category || '').toLowerCase();
      const temp = (c.temperature || '').toLowerCase();

      return keywords.every(
        (kw) =>
          name.includes(kw) ||
          id.includes(kw) ||
          hex.includes(kw) ||
          hue.includes(kw) ||
          temp.includes(kw)
      );
    });

    // 智能排序：色名完全匹配 > 色名开头匹配 > 色名包含 > 色系匹配
    results.sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aScore = aName === rawQuery ? 4 : aName.startsWith(rawQuery) ? 3 : aName.includes(rawQuery) ? 2 : 1;
      const bScore = bName === rawQuery ? 4 : bName.startsWith(rawQuery) ? 3 : bName.includes(rawQuery) ? 2 : 1;
      return bScore - aScore;
    });
  } else if (isRandom) {
    results = [...results].sort(() => Math.random() - 0.5);
  }

  const total = results.length;
  const start = (page - 1) * perPage;
  const end = start + perPage;
  const pagedItems = results.slice(start, end);

  return {
    items: pagedItems,
    total,
    page,
    per_page: perPage,
  };
}

export async function register(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/modules/bookplate/color-search/categories
   * 获取色系分类与冷暖分类
   */
  app.get(
    '/api/modules/bookplate/color-search/categories',
    { preHandler: app.authenticate },
    async (_request, _reply) => {
      try {
        const apiUrl = getColorsApiUrl();
        const resp = await fetch(`${apiUrl}/categories`, {
          signal: AbortSignal.timeout(2000),
        });
        if (resp.ok) {
          const data = (await resp.json()) as any;
          if (Array.isArray(data?.categories) && data.categories.length > 0) {
            return data;
          }
        }
      } catch {
        // 微服务未就绪，降级走本地
      }

      if (_localCategories.length === 0) loadLocalData();
      return {
        categories: _localCategories,
        temperatures: _localTemperatures,
      };
    }
  );

  /**
   * POST /api/modules/bookplate/color-search
   * 检索/分类筛选/随机获取传统色列表
   */
  app.post(
    '/api/modules/bookplate/color-search',
    { preHandler: app.authenticate },
    async (request, _reply) => {
      const payload = (request.body ?? {}) as {
        category?: string;
        temperature?: string;
        query?: string;
        page?: number;
        per_page?: number;
        random?: boolean;
      };

      try {
        const apiUrl = getColorsApiUrl();
        const resp = await fetch(`${apiUrl}/colors/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: payload.category ?? null,
            temperature: payload.temperature ?? null,
            query: payload.query ?? null,
            page: payload.page ?? 1,
            per_page: payload.per_page ?? 24,
            random: Boolean(payload.random),
          }),
          signal: AbortSignal.timeout(3000),
        });

        if (resp.ok) {
          return await resp.json();
        }
      } catch {
        // 微服务未启动，平滑降级走本地
      }

      return searchLocal(
        payload.category,
        payload.temperature,
        payload.query,
        payload.page ?? 1,
        payload.per_page ?? 24,
        Boolean(payload.random)
      );
    }
  );

  /**
   * GET /api/modules/bookplate/color-search/:id
   * 获取单款传统色详情（含搭配关系与场景建议）
   */
  app.get(
    '/api/modules/bookplate/color-search/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const apiUrl = getColorsApiUrl();
        const resp = await fetch(`${apiUrl}/colors/${encodeURIComponent(id)}`, {
          signal: AbortSignal.timeout(2000),
        });
        if (resp.ok) {
          return await resp.json();
        }
      } catch {
        // 微服务未启动，平滑降级走本地
      }

      if (_localColors.length === 0) loadLocalData();
      const padId = String(id || '').trim().padStart(3, '0');
      const target = _localColorById.get(padId) || _localColors.find((c) => c.name === id);
      if (!target) {
        return reply.status(404).send({ error: `Color ${id} not found` });
      }
      return target;
    }
  );

  /**
   * POST /api/modules/bookplate/color-search/palette
   * 5 色调色板生成
   */
  app.post(
    '/api/modules/bookplate/color-search/palette',
    { preHandler: app.authenticate },
    async (request, _reply) => {
      const payload = (request.body ?? {}) as {
        anchor_id?: string;
        method?: string;
        locked?: boolean[];
        previous_palette?: ColorItem[];
      };

      try {
        const apiUrl = getColorsApiUrl();
        const resp = await fetch(`${apiUrl}/colors/palette/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            anchor_id: payload.anchor_id ?? null,
            method: payload.method ?? 'auto',
            locked: payload.locked ?? null,
            previous_palette: payload.previous_palette ?? null,
          }),
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
          return await resp.json();
        }
      } catch {
        // 降级走本地算法
      }

      const palette = build5PaletteLocal(
        payload.anchor_id || '001',
        payload.method || 'auto',
        payload.previous_palette,
        payload.locked
      );

      return {
        anchor_id: payload.anchor_id || '001',
        method: payload.method || 'auto',
        palette,
      };
    }
  );

  /**
   * POST /api/modules/bookplate/color-search/save
   * 选中颜色/色板落盘与详情 Markdown 生成
   */
  app.post(
    '/api/modules/bookplate/color-search/save',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as {
        color: ColorItem;
        palette?: ColorItem[];
      };

      const color = payload.color;
      if (!color || !color.id) {
        return reply.status(400).send({ error: 'color object with id is required' });
      }

      try {
        const userId = request.authUser?.id ?? 1;
        const targetDir = userSearchImageDir(userId);
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true });
        }

        const cid = String(color.id).padStart(3, '0');
        const filename = `traditional-color-${cid}-${Date.now()}.png`;
        const localFilePath = path.join(targetDir, filename);

        // 优先从本地文件系统复制原图，没有时从微服务静态服务下载
        const localOriginImg = path.join(BASE_DIR, 'images', `${cid}-${color.name}.png`);
        let saved = false;

        if (existsSync(localOriginImg)) {
          try {
            copyFileSync(localOriginImg, localFilePath);
            saved = true;
          } catch (e) {
            console.warn('Failed to copy color origin image:', e);
          }
        }

        if (!saved) {
          const apiUrl = getColorsApiUrl();
          const fetchUrls = [
            `${apiUrl}/static/images/${cid}-${encodeURIComponent(color.name)}.png`,
            `${apiUrl}/static/thumbnails/color-card-${cid}.jpg`,
          ];
          for (const url of fetchUrls) {
            try {
              const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
              if (resp.ok) {
                const buf = Buffer.from(await resp.arrayBuffer());
                if (buf.length > 0) {
                  const { writeFileSync } = await import('node:fs');
                  writeFileSync(localFilePath, buf);
                  saved = true;
                  break;
                }
              }
            } catch {
              // try next
            }
          }
        }

        const imageUrl = `/static/search-images/${userId}/${filename}`;

        // 构造 Markdown 详情说明
        const palette = payload.palette && payload.palette.length > 0 ? payload.palette : [color];
        const paletteLines = palette
          .map(
            (p, idx) =>
              `- **色 ${String(idx + 1).padStart(2, '0')} · ${p.name}**：HEX \`${p.hex}\` | HSL \`${p.hsl?.h ?? p.h}°, ${p.hsl?.s ?? p.s}%, ${p.hsl?.l ?? p.l}%\` (${p.hue_category || ''} · ${p.temperature || ''})`
          )
          .join('\n');

        const harmonies = color.harmonies || ({} as any);
        const formatRelation = (items: ColorHarmonyItem[] = []) =>
          items.length > 0 ? items.map((i) => `${i.name} (\`${i.hex}\`)`).join('、') : '无';

        let markdown = `# 【中国传统色】${color.id} · ${color.name} (${color.hex})

> **基本属性**：${color.hue_category || '传统色'} | **色温**：${color.temperature || '中性'} | **HSL**：\`${color.h}°, ${color.s}%, ${color.l}%\` | **RGB**：\`${color.rgb?.r ?? 0}, ${color.rgb?.g ?? 0}, ${color.rgb?.b ?? 0}\`

---

### 🎨 5 色推荐调色板
${paletteLines}

---

### 📐 经典传统配色方案
- **主辅点缀方案**：${harmonies.curated_plan || '主色识别，辅色延展，点缀色提亮焦点。'}
- **同类色搭配**：${formatRelation(harmonies.same)}
- **邻近色搭配**：${formatRelation(harmonies.analogous)}
- **互补/分裂互补**：${formatRelation(harmonies.complementary)} | ${formatRelation(harmonies.split_complementary)}
- **冷暖对照**：${formatRelation(harmonies.temperature_contrast)}
- **深浅层级**：明色 ${formatRelation(harmonies.lighter)} | 暗色 ${formatRelation(harmonies.darker)}
- **降噪中性**：灰调 ${formatRelation(harmonies.gray_tone)} | 中性 ${formatRelation(harmonies.neutral)}
`;

        return {
          imageUrl: saved ? imageUrl : color.full_image_url || color.thumb_url,
          localFilePath: saved ? localFilePath : '',
          output: markdown,
          selectedColor: color,
          palette,
        };
      } catch (err) {
        console.error('Failed to save selected traditional color:', err);
        throw new ImageGenerationError(`保存传统色彩数据失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}

import type { Map as LeafletMap } from 'leaflet';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { markerIcons } from './markerIcons';
import { formatCoords } from './geocoder';

/**
 * 地图海报导出（从 map-to-poster `src/core/export.js` 移植并简化）：
 * - Leaflet 瓦片模式：把可见瓦片逐张抓取（fetch 为 blob 规避跨域）绘制到 canvas；
 * - MapLibre 艺术模式：把容器临时缩放到导出尺寸 → getCanvas().toDataURL() 截取；
 * - 文字覆盖层（城市名 / 国家 / 坐标 + 分隔线）直接绘制到 canvas（不引入 html2canvas）；
 * - 可选中心标记（SVG 图标投影绘制）。
 *
 * 返回 PNG data URL（调用方负责落盘 / 持久化）。
 */

/** 导出所需的地图编辑状态（由节点组件持有） */
export interface MapPosterState {
  renderMode: 'tile' | 'artistic';
  /** 瓦片主题 key（themes.ts） */
  theme: string;
  /** 艺术主题 key（artisticThemes.ts） */
  artisticTheme: string;
  lat: number;
  lon: number;
  zoom: number;
  cityName: string;
  countryName: string;
  showCoords: boolean;
  showMarker: boolean;
  markerIcon: string;
  markerSize: number;
  /** 标记点位（通常为单点 = 地图中心） */
  markers: { lat: number; lon: number }[];
  /** 标记颜色（主题 route/accent 色） */
  markerColor: string;
  /** 输出尺寸（px） */
  width: number;
  height: number;
  /** 文字覆盖层垂直位置（0~1，画布高度比例） */
  overlayY: number;
  overlaySize: 'small' | 'medium' | 'large';
}

export interface ExportOptions {
  map: LeafletMap;
  artisticMap: MaplibreMap | null;
  tileContainer: HTMLElement | null;
  artisticContainer: HTMLElement | null;
  state: MapPosterState;
  /** 瓦片背景色（输出底色；主题背景） */
  bgColor: string;
  /** 覆盖层文字颜色（主题 text 色） */
  textColor: string;
}

const IOS_MAX_CANVAS_PIXELS = 16777216;
const TEXT_SCALE_REFERENCE = 1080;
const OVERLAY_SIZE_MULTIPLIER: Record<string, number> = { small: 0.75, medium: 1, large: 1.35 };

/** Web 墨卡托投影：经纬度 → 瓦片像素坐标（与 export.js 一致） */
function project(lat: number, lon: number, scale: number) {
  const siny = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI);
  return {
    x: ((lon + 180) / 360) * scale,
    y: y * scale,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function fetchTileAsBlobURL(src: string): Promise<string | null> {
  try {
    const resp = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 把 SVG 图标（fill=currentColor）渲染到指定位置（导出标记用） */
function drawMarkerToCtx(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  iconType: string,
  markerSize: number
): Promise<void> {
  const baseSize = 40;
  const size = Math.round(baseSize * (markerSize || 1));
  const svgString = markerIcons[iconType] || markerIcons.pin;
  const svg = svgString
    .replace('currentColor', color)
    .replace('width="100"', `width="${size}"`)
    .replace('height="100"', `height="${size}"`);
  return new Promise((resolve) => {
    const img = new Image();
    let url: string;
    try {
      url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    } catch {
      url = 'data:image/svg+xml,' + encodeURIComponent(svg);
    }
    img.onload = () => {
      const anchorX = size / 2;
      const anchorY = iconType === 'pin' ? size : size / 2;
      ctx.drawImage(img, x - anchorX, y - anchorY, size, size);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = url;
  });
}

/** 抓取地图快照（不含覆盖层文字）：返回画布或 data URL */
async function captureMapSnapshot(
  opts: ExportOptions
): Promise<string | null> {
  const { map, artisticMap, tileContainer, artisticContainer, state } = opts;
  const isArtistic = state.renderMode === 'artistic';

  const canvas = document.createElement('canvas');
  canvas.width = state.width;
  canvas.height = state.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (isArtistic) {
    if (!artisticMap || !artisticContainer) return null;
    try {
      let mapDataURL: string | null = null;
      try {
        mapDataURL = artisticMap.getCanvas().toDataURL();
      } catch {
        /* noop */
      }
      if (mapDataURL) {
        const mapImg = await loadImage(mapDataURL);
        if (mapImg) ctx.drawImage(mapImg, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.drawImage(artisticMap.getCanvas(), 0, 0, canvas.width, canvas.height);
      }

      // 中心标记（艺术模式投影基准 2^zoom * 512，与 export.js 一致）
      if (state.showMarker && state.markers.length > 0) {
        const zoom = artisticMap.getZoom();
        const center = artisticMap.getCenter();
        const scaleMap = Math.pow(2, zoom) * 512;
        const centerPoint = project(center.lat, center.lng, scaleMap);
        for (const m of state.markers) {
          const mp = project(m.lat, m.lon, scaleMap);
          const x = canvas.width / 2 + (mp.x - centerPoint.x);
          const y = canvas.height / 2 + (mp.y - centerPoint.y);
          await drawMarkerToCtx(ctx, x, y, state.markerColor || '#EF4444', state.markerIcon, state.markerSize);
        }
      }
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.error('Failed to capture artistic map:', e);
    }
    return null;
  }

  // ---- Leaflet 瓦片模式 ----
  if (!tileContainer) return null;
  try {
    const tiles = Array.from(tileContainer.querySelectorAll('.leaflet-tile')) as HTMLImageElement[];
    const containerRect = tileContainer.getBoundingClientRect();
    const scaleFactor = state.width / Math.max(1, containerRect.width);

    const tileData = tiles
      .filter((tile) => tile.complete && tile.naturalWidth > 0)
      .map((tile) => {
        const tileRect = tile.getBoundingClientRect();
        return {
          src: tile.src,
          x: (tileRect.left - containerRect.left) * scaleFactor,
          y: (tileRect.top - containerRect.top) * scaleFactor,
          w: tileRect.width * scaleFactor,
          h: tileRect.height * scaleFactor,
        };
      });

    await Promise.all(
      tileData.map(async (td) => {
        let blobURL = await fetchTileAsBlobURL(td.src);
        if (!blobURL) blobURL = td.src;
        const img = await loadImage(blobURL);
        if (img) ctx.drawImage(img, td.x, td.y, td.w, td.h);
        if (blobURL.startsWith('blob:')) URL.revokeObjectURL(blobURL);
      })
    );

    // 中心标记（瓦片模式投影基准 2^zoom * 256，与 export.js 一致）
    if (state.showMarker) {
      const zoom = map.getZoom();
      const center = map.getCenter();
      const scaleMap = Math.pow(2, zoom) * 256;
      const centerPoint = project(center.lat, center.lng, scaleMap);
      for (const m of state.markers) {
        const mp = project(m.lat, m.lon, scaleMap);
        const x = canvas.width / 2 + (mp.x - centerPoint.x);
        const y = canvas.height / 2 + (mp.y - centerPoint.y);
        await drawMarkerToCtx(ctx, x, y, state.markerColor || '#EF4444', state.markerIcon, state.markerSize);
      }
    }

    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('Failed to capture leaflet map:', e);
  }
  return null;
}

/** 文字覆盖层布局参数（与 export.js BASE_OVERLAY_TEXT 同口径） */
function overlayTextConfig(width: number, height: number, size: string) {
  const shortestSide = Math.max(1, Math.min(width || TEXT_SCALE_REFERENCE, height || TEXT_SCALE_REFERENCE));
  const posterScale = shortestSide / TEXT_SCALE_REFERENCE;
  const sizeMultiplier = OVERLAY_SIZE_MULTIPLIER[size] || OVERLAY_SIZE_MULTIPLIER.medium;
  const scale = posterScale * sizeMultiplier;
  return {
    city: clamp(64 * scale, 28, 420),
    country: clamp(20 * scale, 10, 150),
    coords: clamp(16 * scale, 9, 120),
    gap: clamp(8 * scale, 4, 90),
    cityGap: clamp(40 * scale, 12, 280),
    dividerWidth: clamp(128 * scale, 72, 900),
    dividerHeight: clamp(1.5 * scale, 1, 12),
  };
}

/** 绘制文字覆盖层（城市名 / 分隔线 / 国家 / 坐标），垂直居中于 overlayY */
function drawTextOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: MapPosterState,
  textColor: string
) {
  const cfg = overlayTextConfig(width, height, state.overlaySize);
  const city = (state.cityName || '').trim();
  const country = (state.countryName || '').trim();
  const coords = state.showCoords ? formatCoords(state.lat, state.lon) : '';

  const cityFont = `600 ${cfg.city}px 'Playfair Display','Noto Serif SC',serif`;
  const countryFont = `500 ${cfg.country}px 'Outfit','Noto Sans SC',sans-serif`;
  const coordsFont = `400 ${cfg.coords}px 'Outfit','Noto Sans SC',sans-serif`;

  const cityH = city ? cfg.city * 1.12 : 0;
  const countryH = country ? cfg.country * 1.2 : 0;
  const coordsH = coords ? cfg.coords * 1.2 : 0;
  const hasSub = Boolean(country || coords);
  const dividerH = hasSub ? cfg.cityGap + cfg.dividerHeight : 0;
  const blockH = cityH + dividerH + (country ? cfg.gap + countryH : 0) + (coords ? cfg.gap + coordsH : 0);
  if (blockH <= 0) return;

  const overlayY = clamp(state.overlayY ?? 0.85, 0, 1);
  let y = height * overlayY - blockH / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = textColor;

  if (city) {
    ctx.font = cityFont;
    ctx.fillText(city.toUpperCase(), width / 2, y + cityH);
    y += cityH;
  }
  if (hasSub) {
    y += cfg.cityGap;
    ctx.fillRect(width / 2 - cfg.dividerWidth / 2, y, cfg.dividerWidth, cfg.dividerHeight);
    y += cfg.dividerHeight;
    if (country) {
      y += cfg.gap;
      ctx.font = countryFont;
      ctx.fillText(country, width / 2, y + countryH);
      y += countryH;
    }
    if (coords) {
      y += cfg.gap;
      ctx.font = coordsFont;
      ctx.fillText(coords, width / 2, y + coordsH);
      y += coordsH;
    }
  }
}

/**
 * 导出地图海报：返回 PNG data URL。
 * 需要确保 Leaflet 瓦片已加载（组件在 map 'load'/'idle' 后调用）、
 * MapLibre 样式已加载（artistic 模式下等待 idle 由内部处理）。
 */
export async function exportMapPoster(opts: ExportOptions): Promise<string> {
  const { state, bgColor, textColor } = opts;

  // 输出尺寸保护：超大尺寸（如 4K 海报）按像素上限等比缩放
  let outW = Math.max(1, state.width);
  let outH = Math.max(1, state.height);
  if (outW * outH > IOS_MAX_CANVAS_PIXELS) {
    const ratio = Math.sqrt(IOS_MAX_CANVAS_PIXELS / (outW * outH));
    outW = Math.floor(outW * ratio);
    outH = Math.floor(outH * ratio);
  }

  const snapshot = await captureMapSnapshot(opts);
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = outW;
  finalCanvas.height = outH;
  const ctx = finalCanvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');

  // 底色 + 地图快照（等比缩放铺满）
  ctx.fillStyle = bgColor || '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  if (snapshot) {
    const snapImg = await loadImage(snapshot);
    if (snapImg) ctx.drawImage(snapImg, 0, 0, outW, outH);
  }

  // 文字覆盖层
  drawTextOverlay(ctx, outW, outH, state, textColor || '#000000');

  // 底部小字归属（瓦片数据 © OpenStreetMap，遵循 OSM 使用政策）
  ctx.font = `${Math.max(9, Math.round(outW / 120))}px 'Outfit',sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = textColor || '#000000';
  const attribution = state.renderMode === 'tile' ? '© OpenStreetMap contributors' : '© OpenFreeMap';
  ctx.fillText(attribution, outW - 12, outH - 8);
  ctx.globalAlpha = 1;

  return finalCanvas.toDataURL('image/png', 1.0);
}

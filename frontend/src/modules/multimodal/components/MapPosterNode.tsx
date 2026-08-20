import React, { memo, useEffect, useState } from 'react';
import { ImageDown, Loader2, Map as MapIcon, MapPin, Search, X } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import api from '../../../platform/services/api';
import {
  MAP_POSTER_DEFAULTS,
  MAP_POSTER_DEFAULT_CITY,
  MAP_POSTER_DEFAULT_COUNTRY,
} from '../map/defaults';

/** maptoposter 主题列表（与 Python themes/ 目录对应） */
const MAPTOPoster_THEMES: SelectOption[] = [
  { label: 'Terracotta', value: 'terracotta' },
  { label: 'Noir', value: 'noir' },
  { label: 'Sunset', value: 'sunset' },
  { label: 'Warm Beige', value: 'warm_beige' },
  { label: 'Midnight Blue', value: 'midnight_blue' },
  { label: 'Blueprint', value: 'blueprint' },
  { label: 'Neon Cyberpunk', value: 'neon_cyberpunk' },
  { label: 'Japanese Ink', value: 'japanese_ink' },
  { label: 'Copper Patina', value: 'copper_patina' },
  { label: 'Emerald', value: 'emerald' },
  { label: 'Forest', value: 'forest' },
  { label: 'Ocean', value: 'ocean' },
  { label: 'Pastel Dream', value: 'pastel_dream' },
  { label: 'Autumn', value: 'autumn' },
  { label: 'Contrast Zones', value: 'contrast_zones' },
  { label: 'Monochrome Blue', value: 'monochrome_blue' },
  { label: 'Gradient Roads', value: 'gradient_roads' },
];

/** 输出尺寸预设（英寸，与 maptoposter -W/-H 对应） */
const SIZE_PRESETS: { name: string; width: number; height: number }[] = [
  { name: '竖版 A4 (12×16)', width: 12, height: 16 },
  { name: '方形 (12×12)', width: 12, height: 12 },
  { name: '横版 (16×12)', width: 16, height: 12 },
  { name: '竖版高清 (12×18)', width: 12, height: 18 },
  { name: 'Instagram (3.6×3.6)', width: 3.6, height: 3.6 },
  { name: '手机壁纸 (3.6×6.4)', width: 3.6, height: 6.4 },
  { name: 'HD壁纸 (6.4×3.6)', width: 6.4, height: 3.6 },
];

const SIZE_PRESET_OPTIONS: SelectOption[] = SIZE_PRESETS.map((s, i) => ({
  label: s.name,
  value: String(i),
}));

const DISTANCE_OPTIONS: SelectOption[] = [
  { label: '小 (6km)', value: '6000' },
  { label: '中 (12km)', value: '12000' },
  { label: '大 (18km)', value: '18000' },
  { label: '特大 (25km)', value: '25000' },
];

export interface MapPosterNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 已导出的地图海报（本地 URL），无则为空 */
  imageUrl?: string | null;
  error?: string | null;
  /** ---- 编辑器状态 ---- */
  theme?: string;
  sizeIndex?: number;
  distance?: number;
  cityName?: string;
  countryName?: string;
  lat?: number;
  lon?: number;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
  onUpdateEditor?: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  onExport?: (id: string, dataUrl: string) => Promise<void>;
}

const MapPosterNodeInner: React.FC<MapPosterNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  imageUrl = null,
  error = null,
  theme = MAP_POSTER_DEFAULTS.theme,
  sizeIndex = MAP_POSTER_DEFAULTS.sizeIndex,
  distance = MAP_POSTER_DEFAULTS.distance,
  cityName = MAP_POSTER_DEFAULTS.cityName,
  countryName = MAP_POSTER_DEFAULTS.countryName,
  lat = MAP_POSTER_DEFAULTS.lat,
  lon = MAP_POSTER_DEFAULTS.lon,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  onUpdateEditor,
  onExport,
}) => {
  const { showToast } = useFeedback();

  // ---- 地点搜索 ----
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [generating, setGenerating] = useState(false);

  const currentPreset = SIZE_PRESETS[sizeIndex] ?? SIZE_PRESETS[0];

  // ---- 地点搜索（防抖） ----
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`, {
        signal: controller.signal,
        headers: { 'Accept-Language': 'zh,en' },
      })
        .then((r) => r.json())
        .then((data) => {
          setResults(
            (data || []).map((item: any) => ({
              name: item.display_name,
              shortName: (item.display_name || '').split(',')[0] || q.toUpperCase(),
              lat: parseFloat(item.lat),
              lon: parseFloat(item.lon),
              country: item.address?.country || '',
            }))
          );
          setSearching(false);
        })
        .catch(() => setSearching(false));
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handlePickLocation = (r: any) => {
    setResults([]);
    setQuery(r.shortName);
    const city = (r.shortName || 'LOCATION').toUpperCase();
    const country = (r.country || '').toUpperCase();
    onUpdateEditor?.(id, { lat: r.lat, lon: r.lon, cityName: city, countryName: country }, true);
  };

  // ---- 生成海报 ----
  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const res: any = await api.post(
        '/modules/bookplate/map-poster/generate',
        {
          city: cityName || MAP_POSTER_DEFAULT_CITY,
          country: countryName || MAP_POSTER_DEFAULT_COUNTRY,
          theme,
          latitude: lat,
          longitude: lon,
          distance,
          width: currentPreset.width,
          height: currentPreset.height,
        },
        { timeout: 300000 }
      );
      const imageUrl = typeof res?.image_url === 'string' ? res.image_url : '';
      if (!imageUrl) throw new Error('生成海报失败：未返回图片');
      onExport?.(id, imageUrl);
      showToast('地图海报生成成功', { type: 'success' });
    } catch (err: any) {
      const msg = err?.isTimeout
        ? '生成超时，请缩小距离或稍后重试'
        : err?.detail || err?.message || '生成失败，请重试';
      showToast(msg, { type: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `map-poster-${Date.now()}.png`;
    a.click();
  };

  /** 离散编辑器字段变更 → 持久化 + 记撤销历史 */
  const edit = (patch: Record<string, any>) => onUpdateEditor?.(id, patch, true);

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '地图海报生成'}
      dotColor={NODE_COLORS.map_poster}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 460, height: 560 }}
      showLeftAnchor={false}
      showRightAnchor={true}
      footer={footer}
      actionBar={
        <NodeActionBar>
          {imageUrl && (
            <NodeActionBar.Download
              tooltip="下载地图海报"
              onClick={handleDownload}
            />
          )}
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 地点搜索 */}
        <div className="shrink-0 relative z-20">
          <div className="relative">
            <Search size={13} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索地点（Nominatim）"
              className="w-full h-9 rounded-md border border-dashed border-paper-grid bg-transparent pl-8 pr-7 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono"
            />
            {query && !searching && (
              <button
                type="button"
                onClick={() => { setQuery(''); setResults([]); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                title="清除"
              >
                <X size={13} strokeWidth={2} />
              </button>
            )}
            {searching && (
              <Loader2 size={13} strokeWidth={2} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint animate-spin" />
            )}
          </div>
          {results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-paper border border-dashed border-paper-grid rounded-md shadow-md z-30 max-h-44 overflow-y-auto custom-scrollbar">
              {results.map((r, i) => (
                <button
                  key={`${r.lat}-${r.lon}-${i}`}
                  type="button"
                  onClick={() => handlePickLocation(r)}
                  className="flex w-full text-left px-3 py-2 text-xs text-ink hover:bg-paper-grid/50 transition-colors border-b border-paper-grid/40 last:border-b-0"
                >
                  <MapPin size={12} strokeWidth={2} className="text-accent shrink-0 mr-2 mt-0.5" />
                  <span className="min-w-0 truncate">{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 主题 / 尺寸 / 距离 */}
        <div className="shrink-0 flex gap-1.5 relative z-10">
          <Select
            size="sm"
            value={theme}
            onChange={(val) => edit({ theme: val })}
            options={MAPTOPoster_THEMES}
            className="flex-1 min-w-0"
          />
          <Select
            size="sm"
            value={String(sizeIndex)}
            onChange={(val) => edit({ sizeIndex: Number(val) })}
            options={SIZE_PRESET_OPTIONS}
            className="w-36 shrink-0"
          />
        </div>

        {/* 距离选择 */}
        <div className="shrink-0 flex gap-1.5 relative z-[5]">
          <Select
            size="sm"
            value={String(distance)}
            onChange={(val) => edit({ distance: Number(val) })}
            options={DISTANCE_OPTIONS}
            className="flex-1"
          />
        </div>

        {/* 覆盖层文字 */}
        <div className="shrink-0 flex gap-1.5 relative z-[5]">
          <input
            value={cityName}
            onChange={(e) => edit({ cityName: e.target.value.toUpperCase() })}
            placeholder="城市名"
            className="h-8 flex-1 min-w-0 rounded-md border border-dashed border-paper-grid bg-transparent px-2 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono"
          />
          <input
            value={countryName}
            onChange={(e) => edit({ countryName: e.target.value.toUpperCase() })}
            placeholder="国家/地区"
            className="h-8 flex-1 min-w-0 rounded-md border border-dashed border-paper-grid bg-transparent px-2 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono"
          />
        </div>

        {/* 地图预览区域 */}
        <div className="relative flex-1 min-h-0 flex items-center justify-center p-2 rounded-md overflow-hidden border border-dashed border-paper-grid bg-paper/30 select-none">
          {imageUrl ? (
            <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
              <PhotoView src={imageUrl}>
                <img
                  src={imageUrl}
                  alt="地图海报"
                  className="max-w-full max-h-full object-contain rounded-sm shadow-2xl cursor-zoom-in hover:opacity-90 transition-opacity"
                />
              </PhotoView>
            </PhotoProvider>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 text-ink-faint">
              <MapIcon size={48} strokeWidth={1} className="opacity-30" />
              <p className="text-xs text-center leading-relaxed">
                选择地点和主题后<br />点击下方按钮生成海报
              </p>
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="shrink-0 px-2.5 py-1.5 rounded-md border border-error/20 bg-error/5 text-[11px] text-error break-words">
            {error}
          </div>
        )}

        {/* 底部操作：生成 + 已生成缩略图 */}
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 h-9 px-3 rounded-md bg-accent text-paper text-xs font-serif hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : <ImageDown size={14} strokeWidth={2} />}
            {generating ? '生成中…' : imageUrl ? '重新生成' : '生成地图海报'}
          </button>
          {imageUrl && (
            <span className="text-[10px] font-sans text-ink-faint flex items-center gap-1">
              <MapIcon size={11} strokeWidth={1.5} />
              点击图片可放大查看
            </span>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const MapPosterNode = memo(MapPosterNodeInner);
MapPosterNode.displayName = 'MapPosterNode';
export default MapPosterNode;

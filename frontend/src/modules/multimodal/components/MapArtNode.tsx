import React, { memo, useEffect, useState } from 'react';
import { ImageDown, Loader2, Map as MapIcon, MapPin, Search, X, Circle, Square } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import api from '../../../platform/services/api';
import { MAP_ART_DEFAULTS } from '../map/art-defaults';

const PRETTYMAPS_PRESETS: SelectOption[] = [
  { label: 'Default', value: 'default' },
  { label: 'Minimal', value: 'minimal' },
  { label: 'Macao', value: 'macao' },
  { label: 'Tijuca', value: 'tijuca' },
];

const RADIUS_OPTIONS: SelectOption[] = [
  { label: '0.5 km', value: '0.5' },
  { label: '0.75 km', value: '0.75' },
  { label: '1.0 km', value: '1.0' },
  { label: '1.25 km', value: '1.25' },
  { label: '1.5 km', value: '1.5' },
];

export interface MapArtNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  imageUrl?: string | null;
  error?: string | null;
  preset?: string;
  radius?: number;
  circle?: boolean;
  query?: string;
  lat?: number;
  lon?: number;
  cityName?: string;
  countryName?: string;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
  onUpdateEditor?: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  onExport?: (id: string, imageUrl: string) => Promise<void>;
}

const MapArtNodeInner: React.FC<MapArtNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  imageUrl = null,
  error = null,
  preset = MAP_ART_DEFAULTS.preset,
  radius = MAP_ART_DEFAULTS.radius,
  circle = MAP_ART_DEFAULTS.circle,
  query: queryText = '',
  lat = MAP_ART_DEFAULTS.lat,
  lon = MAP_ART_DEFAULTS.lon,
  cityName = MAP_ART_DEFAULTS.cityName,
  countryName: _countryName = MAP_ART_DEFAULTS.countryName,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  hasDownstream,
  onUpdateEditor,
  onExport,
}) => {
  const { showToast } = useFeedback();

  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const q = searchQuery.trim();
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
  }, [searchQuery]);

  const handlePickLocation = (r: any) => {
    setResults([]);
    setSearchQuery(r.shortName);
    const city = (r.shortName || 'LOCATION').toUpperCase();
    const country = (r.country || '').toUpperCase();
    onUpdateEditor?.(id, {
      lat: r.lat,
      lon: r.lon,
      query: r.name,
      cityName: city,
      countryName: country,
    }, true);
  };

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const res: any = await api.post(
        '/modules/bookplate/generate-map-art',
        {
          lat,
          lon,
          query: queryText || searchQuery || cityName,
          radius,
          circle,
          preset,
          figsize_width: 8.27,
          figsize_height: 8.27,
        },
        { timeout: 120000 }
      );
      const imageUrl = typeof res?.image_url === 'string' ? res.image_url : '';
      if (!imageUrl) throw new Error('生成艺术地图失败：未返回图片');
      onExport?.(id, imageUrl);
      showToast('艺术地图生成成功', { type: 'success' });
    } catch (err: any) {
      const msg = err?.isTimeout
        ? '生成超时，请缩小半径或稍后重试'
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
    a.download = `map-art-${Date.now()}.png`;
    a.click();
  };

  const edit = (patch: Record<string, any>) => onUpdateEditor?.(id, patch, true);

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '艺术地图生成'}
      dotColor={NODE_COLORS.map_art}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 460, height: 560 }}
      glowOverlay={generating ? <BeamGlow /> : undefined}
      showLeftAnchor={false}
      showRightAnchor={true}
      footer={footer}
      actionBar={
        <NodeActionBar>
          {imageUrl ? (
            <>
              <NodeActionBar.Retry
                onClick={handleGenerate}
                disabled={generating}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重新生成"
                tooltip="重新生成艺术地图"
                error={!!error}
              />
              <NodeActionBar.Download
                tooltip="下载艺术地图"
                onClick={handleDownload}
              />
            </>
          ) : (
            <NodeActionBar.Custom
              icon={
                generating ? (
                  <Loader2 size={16} className="animate-spin text-accent" />
                ) : (
                  <ImageDown size={16} strokeWidth={1.5} />
                )
              }
              tooltip="生成艺术地图"
              downstreamTooltip="有下级节点，不可生成"
              onClick={handleGenerate}
              disabled={generating}
              hasDownstream={hasDownstream}
            />
          )}
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        <div className="shrink-0 flex gap-1.5 relative z-30">
          <div className="relative flex-1 min-w-0">
            <Search size={13} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索地点（Nominatim）"
              className="w-full h-8 rounded-md border border-dashed border-paper-grid bg-transparent pl-8 pr-7 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono"
            />
            {searchQuery && !searching && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setResults([]); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 transition-colors"
                title="清除"
              >
                <X size={13} strokeWidth={2} />
              </button>
            )}
            {searching && (
              <Loader2 size={13} strokeWidth={2} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint animate-spin" />
            )}
            {results.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-paper border border-dashed border-paper-grid rounded-md shadow-lg z-40 max-h-48 overflow-y-auto custom-scrollbar">
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
          <input
            value={cityName}
            onChange={(e) => edit({ cityName: e.target.value.toUpperCase() })}
            placeholder="城市名"
            className="h-8 w-28 shrink-0 rounded-md border border-dashed border-paper-grid bg-transparent px-2.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono"
            title="地图显示名称"
          />
        </div>

        <div className="shrink-0 flex gap-1.5 relative z-20">
          <Select
            size="sm"
            value={preset}
            onChange={(val) => edit({ preset: val })}
            options={PRETTYMAPS_PRESETS}
            className="flex-1 min-w-0"
          />
          <Select
            size="sm"
            value={String(radius)}
            onChange={(val) => edit({ radius: Number(val) })}
            options={RADIUS_OPTIONS}
            className="w-28 shrink-0"
          />
          <button
            type="button"
            onClick={() => edit({ circle: !circle })}
            className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-md border border-dashed transition-colors ${
              circle
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-paper-grid text-ink-faint hover:border-accent/50 hover:text-accent'
            }`}
            title={circle ? '圆形边界' : '方形边界'}
          >
            {circle ? <Circle size={14} strokeWidth={1.75} /> : <Square size={14} strokeWidth={1.75} />}
          </button>
        </div>

        {error && (
          <div className="shrink-0 px-2.5 py-1.5 rounded-md border border-error/20 bg-error/5 text-[11px] text-error break-words">
            {error}
          </div>
        )}

        <div className="relative flex-1 min-h-0 flex items-center justify-center p-2 rounded-md overflow-hidden border border-dashed border-paper-grid bg-paper/30 select-none">
          {generating ? (
            <div className="flex flex-col items-center justify-center gap-3 text-accent">
              <div className="w-10 h-10 rounded-full border border-dashed border-accent/40 bg-accent/5 flex items-center justify-center">
                <Loader2 size={20} strokeWidth={1.75} className="animate-spin" />
              </div>
              <p className="text-xs font-serif">正在从 OSM 获取数据并渲染艺术地图…</p>
            </div>
          ) : imageUrl ? (
            <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
              <PhotoView src={imageUrl}>
                <img
                  src={imageUrl}
                  alt="艺术地图"
                  className="max-w-full max-h-full object-contain rounded-sm shadow-2xl cursor-zoom-in hover:opacity-90 transition-opacity"
                />
              </PhotoView>
            </PhotoProvider>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 text-ink-faint">
              <MapIcon size={48} strokeWidth={1} className="opacity-30" />
              <p className="text-xs text-center leading-relaxed font-serif text-ink-light">
                配置地点与预设后<br />
                <span className="text-[11px] font-sans text-ink-faint">点击右下角操作栏按钮生成艺术地图</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const MapArtNode = memo(MapArtNodeInner);
MapArtNode.displayName = 'MapArtNode';
export default MapArtNode;
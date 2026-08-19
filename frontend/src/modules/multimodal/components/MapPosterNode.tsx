import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import * as maplibregl from 'maplibre-gl';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';

// 显式配置 MapLibre GL 矢量瓦片 Worker（指向 public 静态资源，避免 Vite 开发环境下向 Worker 注入包含 DOM/Window 的客户端脚本导致 Worker 崩溃）
maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
import { ImageDown, Loader2, Map as MapIcon, MapPin, Search, X } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import { themes, DEFAULT_TILE_THEME } from '../map/themes';
import { artisticThemes, DEFAULT_ARTISTIC_THEME } from '../map/artisticThemes';
import { generateMapLibreStyle } from '../map/artisticStyle';
import { searchLocation, formatCoords, type GeocodeResult } from '../map/geocoder';
import { markerIcons } from '../map/markerIcons';
import { exportMapPoster, type MapPosterState } from '../map/exportImage';
import {
  MAP_POSTER_DEFAULTS,
  MAP_POSTER_DEFAULT_CITY,
  MAP_POSTER_DEFAULT_COUNTRY,
} from '../map/defaults';

/** 常用输出尺寸预设 */
const SIZE_PRESETS: { name: string; width: number; height: number }[] = [
  { name: '方形 1080×1080', width: 1080, height: 1080 },
  { name: '竖版 1080×1350', width: 1080, height: 1350 },
  { name: '横版 1200×628', width: 1200, height: 628 },
  { name: '高清横版 1920×1080', width: 1920, height: 1080 },
  { name: '竖版故事 1080×1920', width: 1080, height: 1920 },
];

const RENDER_MODE_OPTIONS: SelectOption[] = [
  { label: '瓦片', value: 'tile' },
  { label: '艺术', value: 'artistic' },
];

const SIZE_PRESET_OPTIONS: SelectOption[] = SIZE_PRESETS.map((s, i) => ({
  label: s.name,
  value: String(i),
}));

const OVERLAY_SIZES: SelectOption[] = [
  { label: '小', value: 'small' },
  { label: '中', value: 'medium' },
  { label: '大', value: 'large' },
];

/** 单点标记 SVG HTML（live 地图 + 导出共用；pin 底部锚点） */
function markerHtml(color: string, size = 30): string {
  const svg = markerIcons.pin
    .replace('currentColor', color)
    .replace('width="100"', `width="${size}"`)
    .replace('height="100"', `height="${size}"`);
  return `<div style="width:${size}px;height:${size}px;pointer-events:none">${svg}</div>`;
}

export interface MapPosterNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 已导出的地图海报（本地 URL），无则为空 */
  imageUrl?: string | null;
  error?: string | null;
  /** ---- 编辑器状态（受控：存于 node.data，与其它节点一致保持跨页持久化） ---- */
  renderMode?: 'tile' | 'artistic';
  tileTheme?: string;
  artisticTheme?: string;
  sizeIndex?: number;
  cityName?: string;
  countryName?: string;
  overlaySize?: 'small' | 'medium' | 'large';
  showMarker?: boolean;
  lat?: number;
  lon?: number;
  zoom?: number;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
  /**
   * 编辑器状态写入 node.data（持久化）。undoable=true 的离散编辑记撤销历史
   * （主题/尺寸/文字/地点选择）；false 仅持久化（平移/缩放，避免污染撤销栈）。
   */
  onUpdateEditor?: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  /** 导出：把 PNG data URL 交给页面落盘（保存到后端 + 记历史 + 写入 node.data.imageUrl） */
  onExport?: (id: string, dataUrl: string, editor: MapPosterState) => Promise<void>;
}

const MapPosterNodeInner: React.FC<MapPosterNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  imageUrl = null,
  error = null,
  renderMode = MAP_POSTER_DEFAULTS.renderMode,
  tileTheme = MAP_POSTER_DEFAULTS.tileTheme,
  artisticTheme = MAP_POSTER_DEFAULTS.artisticTheme,
  sizeIndex = MAP_POSTER_DEFAULTS.sizeIndex,
  cityName = MAP_POSTER_DEFAULTS.cityName,
  countryName = MAP_POSTER_DEFAULTS.countryName,
  overlaySize = MAP_POSTER_DEFAULTS.overlaySize,
  showMarker = MAP_POSTER_DEFAULTS.showMarker,
  lat = MAP_POSTER_DEFAULTS.lat,
  lon = MAP_POSTER_DEFAULTS.lon,
  zoom = MAP_POSTER_DEFAULTS.zoom,
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

  // ---- 地点搜索（仅 UI 临时态，不持久化；选中的地点写入 node.data） ----
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ---- 地图实例与当前视口 ----
  /** 最新 onUpdateEditor（ref 模式：地图事件回调在渲染间始终拿到最新实现，避免重建监听） */
  const onUpdateEditorRef = useRef(onUpdateEditor);
  onUpdateEditorRef.current = onUpdateEditor;
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageScale, setStageScale] = useState(0.25);
  const tileContainerRef = useRef<HTMLDivElement>(null);
  const artisticContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const artisticMapRef = useRef<maplibregl.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const leafletMarkerRef = useRef<L.Marker | null>(null);
  const artisticMarkerRef = useRef<maplibregl.Marker | null>(null);
  /** 当前实际视口（地图交互的唯一事实源；挂载时取自 node.data，交互后推送回 node.data） */
  const viewportRef = useRef({ lat, lon, zoom });
  /** 挂载时的初始视口（供只跑一次的初始化 effect 使用） */
  const initialViewRef = useRef({ lat, lon, zoom });
  /** 瓦片是否已加载完成（导出前等待用） */
  const tilesLoadedRef = useRef(false);
  /** 双向同步中（防 moveend 互触发死循环，与 map-to-poster isSyncing 同口径） */
  const syncingRef = useRef(false);
  /** 当前 MapLibre 已生效的主题 key */
  const currentArtisticThemeRef = useRef<string | null>(null);
  /** 待生效的 MapLibre 样式队列（防快速切换样式导致 setStyle 冲突） */
  const pendingArtisticStyleRef = useRef<{ style: any; themeKey: string } | null>(null);
  /** MapLibre 样式正在加载中 */
  const styleChangeInProgressRef = useRef(false);

  const updateMarkers = useCallback((v: { lat: number; lon: number }) => {
    leafletMarkerRef.current?.setLatLng([v.lat, v.lon]);
    artisticMarkerRef.current?.setLngLat([v.lon, v.lat]);
  }, []);

  /** 同步两套地图到同一视口（Leaflet zoom = MapLibre zoom + 1，与 map-to-poster 口径一致） */
  const setViewport = useCallback(
    (v: { lat: number; lon: number; zoom: number }) => {
      viewportRef.current = v;
      mapRef.current?.setView([v.lat, v.lon], v.zoom, { animate: false });
      artisticMapRef.current?.jumpTo({ center: [v.lon, v.lat], zoom: v.zoom - 1 });
      updateMarkers(v);
    },
    [updateMarkers]
  );

  /** 当前生效主题（按模式取色板） */
  const activeTheme = useMemo(() => {
    if (renderMode === 'artistic') return artisticThemes[artisticTheme] ?? artisticThemes[DEFAULT_ARTISTIC_THEME];
    return themes[tileTheme] ?? themes[DEFAULT_TILE_THEME];
  }, [renderMode, tileTheme, artisticTheme]);

  const currentPreset = SIZE_PRESETS[sizeIndex] ?? SIZE_PRESETS[0];

  // ---- 初始化地图（挂载一次；初始视口取自 node.data） ----
  useEffect(() => {
    const tileContainer = tileContainerRef.current;
    const artisticContainer = artisticContainerRef.current;
    if (!tileContainer || !artisticContainer) return;
    const initView = initialViewRef.current;

    // Leaflet 瓦片地图
    const map = L.map(tileContainer, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: 'center',
      touchZoom: 'center',
    }).setView([initView.lat, initView.lon], initView.zoom);
    // 挂载时用 node.data 中保存的主题初始化（tileTheme 为受控 prop，[] deps 闭包捕获首渲染值）
    const initTileTheme = themes[tileTheme] ? tileTheme : DEFAULT_TILE_THEME;
    const tileLayer = L.tileLayer(themes[initTileTheme].tileUrl, {
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(map);
    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    viewportRef.current = initView;

    const centerMarker = L.marker([initView.lat, initView.lon], {
      icon: L.divIcon({
        className: '',
        html: markerHtml(themes[initTileTheme].accent),
        iconSize: [30, 30],
        iconAnchor: [15, 30],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
    leafletMarkerRef.current = centerMarker;

    map.on('load', () => {
      tilesLoadedRef.current = true;
    });

    map.on('moveend', () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      const c = map.getCenter();
      const z = map.getZoom();
      const v = { lat: c.lat, lon: c.lng, zoom: z };
      viewportRef.current = v;
      artisticMapRef.current?.jumpTo({ center: [c.lng, c.lat], zoom: z - 1 });
      updateMarkers(v);
      // 平移/缩放：持久化到 node.data（切页保持），不记撤销历史
      onUpdateEditorRef.current?.(id, v, false);
      syncingRef.current = false;
    });

    // MapLibre 艺术地图（隐藏，仅 artistic 模式显示）
    try {
      const initArtisticKey = artisticThemes[artisticTheme] ? artisticTheme : DEFAULT_ARTISTIC_THEME;
      const initArtTheme = artisticThemes[initArtisticKey];
      currentArtisticThemeRef.current = initArtisticKey;
      styleChangeInProgressRef.current = true;

      // preserveDrawingBuffer：导出时 getCanvas().toDataURL() 必需（类型未收录，运行时有效）
      const amap = new maplibregl.Map({
        container: artisticContainer,
        style: generateMapLibreStyle(initArtTheme),
        center: [initView.lon, initView.lat],
        zoom: initView.zoom - 1,
        interactive: true,
        attributionControl: false,
        preserveDrawingBuffer: true,
      } as maplibregl.MapOptions);
      amap.scrollZoom.setWheelZoomRate(1);
      amap.scrollZoom.setZoomRate(1 / 600);

      amap.on('error', (e) => {
        console.error('[MapLibre Error]', e);
      });

      amap.on('style.load', () => {
        if (pendingArtisticStyleRef.current) {
          const next = pendingArtisticStyleRef.current;
          pendingArtisticStyleRef.current = null;
          currentArtisticThemeRef.current = next.themeKey;
          try {
            amap.setStyle(next.style);
          } catch {
            styleChangeInProgressRef.current = false;
          }
        } else {
          styleChangeInProgressRef.current = false;
        }
      });

      amap.on('moveend', () => {
        if (syncingRef.current) return;
        syncingRef.current = true;
        const c = amap.getCenter();
        const z = amap.getZoom();
        const v = { lat: c.lat, lon: c.lng, zoom: z + 1 };
        viewportRef.current = v;
        mapRef.current?.setView([c.lat, c.lng], z + 1, { animate: false });
        updateMarkers(v);
        onUpdateEditorRef.current?.(id, v, false);
        syncingRef.current = false;
      });
      const mEl = document.createElement('div');
      mEl.innerHTML = markerHtml(initArtTheme.text);
      artisticMarkerRef.current = new maplibregl.Marker({ element: mEl, anchor: 'bottom' })
        .setLngLat([initView.lon, initView.lat])
        .addTo(amap);
      artisticMapRef.current = amap;
    } catch (err) {
      console.error('Failed to initialize artistic map (MapLibre GL):', err);
    }

    // 节点尺寸变化时让地图重算布局
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      artisticMapRef.current?.resize();
    });
    ro.observe(tileContainer);

    return () => {
      ro.disconnect();
      map.remove();
      artisticMapRef.current?.remove();
      mapRef.current = null;
      artisticMapRef.current = null;
      tileLayerRef.current = null;
      leafletMarkerRef.current = null;
      artisticMarkerRef.current = null;
    };
    // 仅挂载时初始化一次（初始视口经 initialViewRef 读取，其余依赖均为稳定 ref）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 主题切换 ----
  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return;
    tileLayerRef.current.setUrl(themes[tileTheme]?.tileUrl ?? themes[DEFAULT_TILE_THEME].tileUrl);
    leafletMarkerRef.current?.setIcon(
      L.divIcon({
        className: '',
        html: markerHtml(themes[tileTheme]?.accent ?? themes[DEFAULT_TILE_THEME].accent),
        iconSize: [30, 30],
        iconAnchor: [15, 30],
      })
    );
  }, [tileTheme]);

  useEffect(() => {
    const amap = artisticMapRef.current;
    if (!amap) return;
    const targetKey = artisticThemes[artisticTheme] ? artisticTheme : DEFAULT_ARTISTIC_THEME;
    const theme = artisticThemes[targetKey];

    // 同步 Marker 颜色
    if (artisticMarkerRef.current) {
      const el = artisticMarkerRef.current.getElement();
      if (el) el.innerHTML = markerHtml(theme.text);
    }

    if (currentArtisticThemeRef.current === targetKey) return;

    const style = generateMapLibreStyle(theme);
    if (styleChangeInProgressRef.current) {
      pendingArtisticStyleRef.current = { style, themeKey: targetKey };
      return;
    }

    styleChangeInProgressRef.current = true;
    currentArtisticThemeRef.current = targetKey;
    try {
      amap.setStyle(style);
    } catch {
      pendingArtisticStyleRef.current = { style, themeKey: targetKey };
    }
  }, [artisticTheme]);

  // ---- 模式切换：显示/隐藏对应地图容器 ----
  useEffect(() => {
    if (renderMode === 'tile') {
      mapRef.current?.invalidateSize({ animate: false });
    } else {
      // 延迟到下一帧再 resize + 强制重绘：
      // opacity:0 期间 WebGL 渲染循环持续运行，切换时 canvas 内容已就绪，
      // resize 保证 canvas 尺寸与容器一致，triggerRepaint 确保一次完整渲染帧。
      requestAnimationFrame(() => {
        artisticMapRef.current?.resize();
        artisticMapRef.current?.triggerRepaint();
      });
    }
  }, [renderMode]);

  // ---- 舞台缩放：监听外部舞台大小，动态计算 scale 使高分辨率画框适配视口 ----
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateScale = () => {
      const w = stage.clientWidth - 16;
      const h = stage.clientHeight - 16;
      if (w <= 0 || h <= 0) return;
      const s = Math.min(w / currentPreset.width, h / currentPreset.height, 1);
      setStageScale(s);
    };
    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [currentPreset.width, currentPreset.height]);

  // ---- 尺寸预设或缩放变化：刷新地图视口以填充新的真实像素尺寸 ----
  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize({ animate: false });
      artisticMapRef.current?.resize();
    }, 60);
    return () => clearTimeout(timer);
  }, [sizeIndex, stageScale]);

  // ---- 外部恢复（撤销/重做/历史恢复/切页回来）：node.data 视口与本地不一致时跳转 ----
  useEffect(() => {
    const v = viewportRef.current;
    if (Math.abs(v.lat - lat) > 1e-6 || Math.abs(v.lon - lon) > 1e-6 || v.zoom !== zoom) {
      setViewport({ lat, lon, zoom });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, zoom]);

  // ---- 地点搜索（防抖；仅 UI 临时态） ----
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
      searchLocation(q, { signal: controller.signal }).then((r) => {
        setResults(r);
        setSearching(false);
      });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handlePickLocation = (r: GeocodeResult) => {
    setResults([]);
    setQuery(r.shortName);
    const city = (r.shortName || r.name.split(',')[0] || 'LOCATION').toUpperCase();
    const country = (r.country || '').toUpperCase();
    // 地点选择 = 离散编辑：跳转视口 + 一次性持久化（记撤销历史）
    setViewport({ lat: r.lat, lon: r.lon, zoom: 12 });
    onUpdateEditorRef.current?.(
      id,
      { lat: r.lat, lon: r.lon, zoom: 12, cityName: city, countryName: country },
      true
    );
  };

  // ---- 导出 ----
  const handleExport = async () => {
    if (exporting) return;
    if (!mapRef.current) return;
    // 瓦片模式：等待瓦片加载完成再截取（3s 兜底，避免网络慢时卡死）
    if (renderMode === 'tile' && !tilesLoadedRef.current) {
      await new Promise<void>((resolve) => {
        mapRef.current?.once('load', () => resolve());
        setTimeout(resolve, 3000);
      });
    }
    // 艺术模式：等待 MapLibre 矢量瓦片渲染完毕（3s 兜底）
    if (renderMode === 'artistic' && artisticMapRef.current) {
      await new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };
        try {
          artisticMapRef.current?.once('idle', done);
        } catch {
          done();
          return;
        }
        setTimeout(done, 3000);
      });
    }
    const v = viewportRef.current;
    const preset = SIZE_PRESETS[sizeIndex] ?? SIZE_PRESETS[0];
    const theme = activeTheme as any;
    const markerColor =
      renderMode === 'artistic'
        ? theme?.text || '#EF4444'
        : theme?.accent || '#EF4444';
    const editorState: MapPosterState = {
      renderMode,
      theme: tileTheme,
      artisticTheme,
      lat: v.lat,
      lon: v.lon,
      zoom: v.zoom,
      cityName: cityName || MAP_POSTER_DEFAULT_CITY,
      countryName: countryName || MAP_POSTER_DEFAULT_COUNTRY,
      showCoords: true,
      showMarker,
      markerIcon: 'pin',
      markerSize: 1,
      markers: [{ lat: v.lat, lon: v.lon }],
      markerColor,
      width: preset.width,
      height: preset.height,
      overlayY: 0.85,
      overlaySize,
    };
    setExporting(true);
    try {
      const dataUrl = await exportMapPoster({
        map: mapRef.current,
        artisticMap: artisticMapRef.current,
        tileContainer: tileContainerRef.current,
        artisticContainer: artisticContainerRef.current,
        state: editorState,
        bgColor: theme?.background ?? theme?.bg ?? '#ffffff',
        textColor: theme?.textColor ?? theme?.text ?? '#000000',
      });
      await onExport?.(id, dataUrl, editorState);
      showToast('地图海报已导出并保存到历史记录', { type: 'success' });
    } catch (err: any) {
      console.error('Export map poster failed:', err);
      showToast(err?.message || '导出失败，请重试', { type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `map-poster-${Date.now()}.png`;
    a.click();
  };

  /** 离散编辑器字段变更（主题/模式/尺寸/文字/标记） → 持久化 + 记撤销历史 */
  const edit = (patch: Record<string, any>) => onUpdateEditorRef.current?.(id, patch, true);

  const themeOptions = useMemo(() => {
    if (renderMode === 'artistic') {
      return Object.entries(artisticThemes).map(([key, t]) => ({ label: t.name, value: key, title: t.description }));
    }
    return Object.entries(themes).map(([key, t]) => ({ label: t.name, value: key, title: t.description }));
  }, [renderMode]);

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
                onClick={() => {
                  setQuery('');
                  setResults([]);
                }}
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

        {/* 模式 / 主题 / 尺寸 */}
        <div className="shrink-0 flex gap-1.5 relative z-10">
          <Select
            size="sm"
            value={renderMode}
            onChange={(val) => edit({ renderMode: val as 'tile' | 'artistic' })}
            options={RENDER_MODE_OPTIONS}
            className="w-20 shrink-0"
          />
          <Select
            size="sm"
            value={renderMode === 'artistic' ? artisticTheme : tileTheme}
            onChange={(val) => {
              if (renderMode === 'artistic') edit({ artisticTheme: val });
              else edit({ tileTheme: val });
            }}
            options={themeOptions}
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
          <Select
            size="sm"
            value={overlaySize}
            onChange={(val) => edit({ overlaySize: val as 'small' | 'medium' | 'large' })}
            options={OVERLAY_SIZES}
            className="w-16 shrink-0"
          />
        </div>

        {/* 地图区域：海报舞台 + 真实高分辨率画框（通过 transform scale 适配视口） */}
        <div
          ref={stageRef}
          className="relative flex-1 min-h-0 flex items-center justify-center p-2 rounded-md overflow-hidden border border-dashed border-paper-grid bg-paper/30 select-none"
        >
          <div
            className="relative shadow-2xl rounded-sm overflow-hidden flex-shrink-0 origin-center transition-transform duration-100"
            style={{
              width: `${currentPreset.width}px`,
              height: `${currentPreset.height}px`,
              transform: `scale(${stageScale})`,
              backgroundColor: (activeTheme as any)?.background ?? (activeTheme as any)?.bg ?? '#ffffff',
            }}
          >
            {/* 瓦片地图容器（1080/1920 高清原生渲染） */}
            <div
              ref={tileContainerRef}
              className="absolute inset-0 z-0"
              style={{
                opacity: renderMode === 'tile' ? 1 : 0,
                pointerEvents: renderMode === 'tile' ? 'auto' : 'none',
              }}
            />
            {/* 艺术地图容器（1080/1920 高清原生渲染） */}
            <div
              ref={artisticContainerRef}
              className="absolute inset-0 z-0"
              style={{
                opacity: renderMode === 'artistic' ? 1 : 0,
                pointerEvents: renderMode === 'artistic' ? 'auto' : 'none',
              }}
            />

            {/* 实时文字覆盖层预览（真实海报字号，随 transform scale 自动等比缩放） */}
            <div
              className="absolute inset-x-0 bottom-[8%] flex flex-col items-center justify-center text-center pointer-events-none z-10 px-8 select-none"
              style={{ color: (activeTheme as any)?.textColor ?? (activeTheme as any)?.text ?? '#000000' }}
            >
              {cityName && (
                <h2 className="font-serif font-bold uppercase tracking-[0.2em] text-5xl md:text-6xl truncate max-w-[90%] drop-shadow-sm leading-tight">
                  {cityName}
                </h2>
              )}
              {(cityName || countryName) && (
                <div
                  className="my-3 w-32 h-[2px] opacity-70"
                  style={{ backgroundColor: (activeTheme as any)?.textColor ?? (activeTheme as any)?.text ?? '#000000' }}
                />
              )}
              {countryName && (
                <p className="font-sans font-medium uppercase tracking-[0.25em] text-xl opacity-90 truncate max-w-[90%] leading-tight">
                  {countryName}
                </p>
              )}
              <p className="font-mono text-base tracking-wider opacity-75 mt-2 leading-tight">
                {formatCoords(lat, lon)}
              </p>
            </div>

            {/* 标记开关（右上角浮层，按物理尺寸设置，在 scale 下与 UI 比例自然） */}
            <button
              type="button"
              onClick={() => edit({ showMarker: !showMarker })}
              title={showMarker ? '导出时显示中心标记' : '导出时隐藏中心标记'}
              className={`absolute top-6 right-6 z-20 w-12 h-12 rounded-xl border flex items-center justify-center transition-colors shadow-md ${
                showMarker
                  ? 'border-accent/50 bg-accent/20 text-accent'
                  : 'border-paper-grid bg-paper/80 text-ink-faint hover:text-ink'
              }`}
            >
              <MapPin size={24} strokeWidth={2} />
            </button>

            {/* 右下角归属角标预览 */}
            <div
              className="absolute bottom-4 right-6 text-sm opacity-35 pointer-events-none font-sans"
              style={{ color: (activeTheme as any)?.textColor ?? (activeTheme as any)?.text ?? '#000000' }}
            >
              {renderMode === 'tile' ? '© OpenStreetMap contributors' : '© OpenFreeMap'}
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="shrink-0 px-2.5 py-1.5 rounded-md border border-error/20 bg-error/5 text-[11px] text-error break-words">
            {error}
          </div>
        )}

        {/* 底部操作：导出 + 已导出缩略图 */}
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 h-9 px-3 rounded-md bg-accent text-paper text-xs font-serif hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : <ImageDown size={14} strokeWidth={2} />}
            {exporting ? '导出中…' : imageUrl ? '重新导出' : '导出地图海报'}
          </button>
          {imageUrl ? (
            <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
              <PhotoView src={imageUrl}>
                <Tooltip content="点击查看已导出的海报">
                  <img
                    src={imageUrl}
                    alt="地图海报"
                    className="h-10 w-10 rounded-md border border-paper-grid object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                  />
                </Tooltip>
              </PhotoView>
            </PhotoProvider>
          ) : (
            <span className="text-[10px] font-sans text-ink-faint flex items-center gap-1">
              <MapIcon size={11} strokeWidth={1.5} />
              导出后可作为图片供下游节点使用
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

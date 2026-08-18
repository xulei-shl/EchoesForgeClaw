import { DEFAULT_TILE_THEME } from './themes';
import { DEFAULT_ARTISTIC_THEME } from './artisticThemes';

/** 默认中心：北京（覆盖层文字默认值同步） */
export const MAP_POSTER_DEFAULT_CENTER = { lat: 39.9042, lon: 116.4074, zoom: 11 };
export const MAP_POSTER_DEFAULT_CITY = 'BEIJING';
export const MAP_POSTER_DEFAULT_COUNTRY = 'CHINA';

/**
 * 地图海报节点编辑器默认值（种子数据与受控 props 兜底共用）。
 * 编辑器状态全部写入 node.data（与其它节点一致：切换页面 / 刷新后仍保持），
 * 离散操作（主题/尺寸/文字/地点）记撤销历史，平移缩放仅持久化不记历史。
 */
export const MAP_POSTER_DEFAULTS = {
  renderMode: 'tile' as const,
  tileTheme: DEFAULT_TILE_THEME,
  artisticTheme: DEFAULT_ARTISTIC_THEME,
  sizeIndex: 0,
  cityName: MAP_POSTER_DEFAULT_CITY,
  countryName: MAP_POSTER_DEFAULT_COUNTRY,
  overlaySize: 'medium' as const,
  showMarker: true,
  lat: MAP_POSTER_DEFAULT_CENTER.lat,
  lon: MAP_POSTER_DEFAULT_CENTER.lon,
  zoom: MAP_POSTER_DEFAULT_CENTER.zoom,
};

export type MapPosterDefaults = typeof MAP_POSTER_DEFAULTS;

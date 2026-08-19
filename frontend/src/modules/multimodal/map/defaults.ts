/** 默认中心：北京（覆盖层文字默认值同步） */
export const MAP_POSTER_DEFAULT_CENTER = { lat: 39.9042, lon: 116.4074 };
export const MAP_POSTER_DEFAULT_CITY = 'BEIJING';
export const MAP_POSTER_DEFAULT_COUNTRY = 'CHINA';

/**
 * 地图海报节点编辑器默认值。
 * 编辑器状态全部写入 node.data（与其它节点一致：切换页面/刷新后仍保持），
 * 离散操作（主题/尺寸/文字/地点）记撤销历史。
 */
export const MAP_POSTER_DEFAULTS = {
  theme: 'terracotta',
  sizeIndex: 0,
  distance: 18000,
  cityName: MAP_POSTER_DEFAULT_CITY,
  countryName: MAP_POSTER_DEFAULT_COUNTRY,
  lat: MAP_POSTER_DEFAULT_CENTER.lat,
  lon: MAP_POSTER_DEFAULT_CENTER.lon,
};

export type MapPosterDefaults = typeof MAP_POSTER_DEFAULTS;

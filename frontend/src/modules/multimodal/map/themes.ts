/** Leaflet 瓦片主题（从 map-to-poster `src/core/themes.js` 移植，去掉了路线相关配色） */
export interface TileTheme {
  name: string;
  tileUrl: string;
  background: string;
  textColor: string;
  accent: string;
  overlayBg: string;
  description: string;
}

export const themes: Record<string, TileTheme> = {
  standard: {
    name: 'Classic Street',
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    background: '#ffffff',
    textColor: '#000000',
    accent: '#3b82f6',
    overlayBg: 'rgba(255, 255, 255, 0.8)',
    description: 'The classic OpenStreetMap look that everyone knows.',
  },
  dark: {
    name: 'Midnight Dark',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    background: '#111111',
    textColor: '#ffffff',
    accent: '#818cf8',
    overlayBg: 'rgba(17, 17, 17, 0.85)',
    description: 'Sleek and professional dark map for a premium feel.',
  },
  minimal: {
    name: 'Minimal White',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    background: '#ffffff',
    textColor: '#000000',
    accent: '#6366f1',
    overlayBg: 'rgba(255, 255, 255, 0.8)',
    description: 'Clean, elegant, and light. Perfect for modern spaces.',
  },
  voyager: {
    name: 'Modern Voyager',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    background: '#ffffff',
    textColor: '#1e293b',
    accent: '#6366f1',
    overlayBg: 'rgba(255, 255, 255, 0.85)',
    description: 'Beautifully colored map with clear terrain and roads.',
  },
  satellite: {
    name: 'Satellite View',
    tileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    background: '#000000',
    textColor: '#ffffff',
    accent: '#10b981',
    overlayBg: 'rgba(0, 0, 0, 0.6)',
    description: 'High-resolution satellite imagery from above.',
  },
};

/** 默认瓦片主题 key */
export const DEFAULT_TILE_THEME = 'minimal';

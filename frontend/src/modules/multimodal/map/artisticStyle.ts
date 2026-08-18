import type { StyleSpecification } from 'maplibre-gl';
import type { ArtisticTheme } from './artisticThemes';

/**
 * 由艺术主题色板生成 MapLibre GL 样式（从 map-to-poster `src/map/artistic-style.js` 移植，
 * 去掉了路线图层与路线 source——多模态工具首版不做路径规划）。
 */
export function generateMapLibreStyle(theme: ArtisticTheme): StyleSpecification {
  return {
    version: 8,
    name: theme.name,
    sources: {
      openfreemap: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': theme.bg },
      },
      {
        id: 'water',
        source: 'openfreemap',
        'source-layer': 'water',
        type: 'fill',
        paint: { 'fill-color': theme.water },
      },
      {
        id: 'park',
        source: 'openfreemap',
        'source-layer': 'park',
        type: 'fill',
        paint: { 'fill-color': theme.parks },
      },
      {
        id: 'road-default',
        source: 'openfreemap',
        'source-layer': 'transportation',
        type: 'line',
        filter: ['!', ['match', ['get', 'class'], ['motorway', 'primary', 'secondary', 'tertiary', 'residential'], true, false]],
        paint: { 'line-color': theme.road_default, 'line-width': 0.5 },
      },
      {
        id: 'road-residential',
        source: 'openfreemap',
        'source-layer': 'transportation',
        type: 'line',
        filter: ['==', ['get', 'class'], 'residential'],
        paint: { 'line-color': theme.road_residential, 'line-width': 0.5 },
      },
      {
        id: 'road-tertiary',
        source: 'openfreemap',
        'source-layer': 'transportation',
        type: 'line',
        filter: ['==', ['get', 'class'], 'tertiary'],
        paint: { 'line-color': theme.road_tertiary, 'line-width': 0.8 },
      },
      {
        id: 'road-secondary',
        source: 'openfreemap',
        'source-layer': 'transportation',
        type: 'line',
        filter: ['==', ['get', 'class'], 'secondary'],
        paint: { 'line-color': theme.road_secondary, 'line-width': 1.0 },
      },
      {
        id: 'road-primary',
        source: 'openfreemap',
        'source-layer': 'transportation',
        type: 'line',
        filter: ['==', ['get', 'class'], 'primary'],
        paint: { 'line-color': theme.road_primary, 'line-width': 1.5 },
      },
      {
        id: 'road-motorway',
        source: 'openfreemap',
        'source-layer': 'transportation',
        type: 'line',
        filter: ['==', ['get', 'class'], 'motorway'],
        paint: { 'line-color': theme.road_motorway, 'line-width': 2.0 },
      },
    ],
  };
}

/** Nominatim 地理编码（从 map-to-poster `src/map/geocoder.js` 移植） */

export interface GeocodeResult {
  name: string;
  lat: number;
  lon: number;
  shortName: string;
  country: string;
}

/** 搜索地点（Nominatim 公共 API；AbortError 静默返回空数组） */
export async function searchLocation(
  query: string,
  opts: { limit?: number; signal?: AbortSignal } = {}
): Promise<GeocodeResult[]> {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const { limit = 15, signal } = opts;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=${limit}&addressdetails=1`;
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    const data = await response.json();
    return data.map((item: any) => ({
      name: item.display_name,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      shortName: item.name || (item.display_name && item.display_name.split(',')[0]) || item.display_name,
      country: item.address ? item.address.country : '',
    }));
  } catch (error) {
    if (error && (error as any).name === 'AbortError') return [];
    console.error('Geocoding error:', error);
    return [];
  }
}

/** 坐标 → 文本（如 "6.2088° S, 106.8456° E"） */
export function formatCoords(lat: number, lon: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

export async function fetchOSRMRoute(points) {
	try {
		const coordsStr = points.map(p => `${p[1]},${p[0]}`).join(';');
		const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
		const response = await fetch(url);
		const data = await response.json();
		if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
			return data.routes[0].geometry.coordinates;
		}
	} catch (e) {
		console.error('Failed to fetch route:', e);
	}
	return points.map(p => [p[1], p[0]]);
}

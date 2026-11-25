/**
 * Links that open Google Maps (the app on a phone, the website on a PC).
 * Free, no account or API key needed.
 */

/** Show this spot on Google Maps. */
export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/** Get directions to this spot from where you are now. */
export function googleNavigateUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

export interface RoutePoint {
  lat: number;
  lon: number;
}

/**
 * Open a trip in Google Maps as a route from A to B that passes through up to 8
 * points of the real path, so Google's road route follows where you really went.
 * Google draws ITS road between those points: close to your real path, not exact.
 * (Google allows 9 waypoints when the link opens the Google Maps app; we use 8.)
 */
export function googleRouteUrl(
  from: RoutePoint,
  to: RoutePoint,
  via: RoutePoint[],
  mode: 'driving' | 'walking' | 'two-wheeler' = 'driving'
): string {
  const ll = (p: RoutePoint) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  let url = `https://www.google.com/maps/dir/?api=1&origin=${ll(from)}&destination=${ll(to)}&travelmode=${mode}`;
  const wp = via.slice(0, 8).map(ll).join('|');
  if (wp) url += `&waypoints=${encodeURIComponent(wp)}`;
  return url;
}

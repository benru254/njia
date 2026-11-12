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

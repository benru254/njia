/**
 * Reads a GPX file (from Njia, GPSLogger, OpenTracks, OsmAnd ...) in the browser.
 * Only track points that have a time are used, because without time there is
 * no speed, no stops and no replay.
 */
import { RawPoint } from '../../src/core/types';

function childNumber(el: Element, names: string[]): number | null {
  // Looks at any depth and ignores XML namespaces (speed may sit inside <extensions>).
  const all = el.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (names.indexOf(all[i].localName) >= 0) {
      const v = parseFloat(all[i].textContent || '');
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

export function parseGpx(text: string): { name: string | null; points: RawPoint[] } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('This GPX file is damaged and cannot be read.');
  }
  const nodes = doc.getElementsByTagNameNS('*', 'trkpt');
  const points: RawPoint[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const lat = parseFloat(el.getAttribute('lat') || '');
    const lon = parseFloat(el.getAttribute('lon') || '');
    const timeEl = el.getElementsByTagNameNS('*', 'time')[0];
    const t = timeEl ? Date.parse(timeEl.textContent || '') : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t)) continue;
    points.push({
      t,
      lat,
      lon,
      acc: childNumber(el, ['accuracy']),
      alt: childNumber(el, ['ele']),
      spd: childNumber(el, ['speed']),
      hdg: childNumber(el, ['course', 'bearing']),
    });
  }
  if (!points.length) {
    throw new Error('No timed track points found in this GPX file.');
  }
  const nameEl = doc.getElementsByTagNameNS('*', 'name')[0];
  return { name: nameEl ? (nameEl.textContent || '').trim() || null : null, points };
}

/**
 * The background job that receives GPS points from Android, even when the
 * screen is off or another app is open, and saves them straight to the database.
 *
 * IMPORTANT: this file must be imported at the very top of index.ts, so the
 * job is registered every time the app's code starts (including in the background).
 */
import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { RawPoint } from '../core/types';
import { getActiveTripId, insertPoints } from '../data/trips';

export const LOCATION_TASK = 'njia-location-updates';

const num = (n: number | null | undefined): number | null =>
  n == null || !Number.isFinite(n) ? null : n;

export function toRawPoint(loc: LocationObject): RawPoint {
  const c = loc.coords;
  return {
    t: Math.round(loc.timestamp),
    lat: c.latitude,
    lon: c.longitude,
    acc: num(c.accuracy),
    alt: num(c.altitude),
    // Negative means "unknown" on some phones.
    spd: c.speed != null && c.speed >= 0 ? num(c.speed) : null,
    hdg: c.heading != null && c.heading >= 0 ? num(c.heading) : null,
  };
}

TaskManager.defineTask<{ locations?: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[njia] location task error:', error.message);
    return;
  }
  const locations = data?.locations;
  if (!locations || !locations.length) return;
  try {
    const tripId = await getActiveTripId();
    if (tripId == null) return; // not recording
    await insertPoints(tripId, locations.map(toRawPoint));
  } catch (err) {
    console.warn('[njia] could not save points:', err);
  }
});

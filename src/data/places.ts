/** Places you named. One record per real place, used by every recording. */
import { PLACE_RADIUS_M, nearestPlace } from '../core/segment';
import { Place } from '../core/types';
import { getDb } from './db';

export async function listPlaces(): Promise<Place[]> {
  const db = await getDb();
  return db.getAllAsync<Place>('SELECT id, name, lat, lon, radius_m AS radiusM FROM places ORDER BY name COLLATE NOCASE');
}

/**
 * Name a place. If the spot is inside a place you already named, that place is
 * renamed instead of making a second one (same rule as the viewer uses).
 */
export async function savePlace(name: string, lat: number, lon: number): Promise<void> {
  const clean = name.trim().slice(0, 40);
  if (!clean) return;
  const db = await getDb();
  const existing = nearestPlace(await listPlaces(), lat, lon, 0);
  if (existing) {
    await db.runAsync('UPDATE places SET name = ? WHERE id = ?', [clean, existing.id]);
  } else {
    await db.runAsync('INSERT INTO places (name, lat, lon, radius_m, created_at) VALUES (?, ?, ?, ?, ?)', [
      clean,
      lat,
      lon,
      PLACE_RADIUS_M,
      Date.now(),
    ]);
  }
}

export async function deletePlace(id: number | string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM places WHERE id = ?', [id]);
}

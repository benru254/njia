/** Saving and loading trips and their GPS points. */
import { analyze } from '../core/analyze';
import { distanceM } from '../core/geo';
import { Analysis, RawPoint } from '../core/types';
import { getDb, getMeta, setMeta } from './db';

export interface TripRow {
  id: number;
  started_at: number;
  ended_at: number | null;
  name: string | null;
  point_count: number;
  distance_m: number;
  moving_s: number | null;
  stopped_s: number | null;
  stop_count: number | null;
  max_speed: number | null;
  last_lat: number | null;
  last_lon: number | null;
  last_time: number | null;
  last_speed: number | null;
  last_accuracy: number | null;
  anchor_lat: number | null;
  anchor_lon: number | null;
}

const ACTIVE_KEY = 'active_trip';

export async function getActiveTripId(): Promise<number | null> {
  const v = await getMeta(ACTIVE_KEY);
  const id = v == null ? NaN : Number(v);
  return Number.isFinite(id) ? id : null;
}

export async function createTrip(): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync('INSERT INTO trips (started_at) VALUES (?)', [Date.now()]);
  const id = res.lastInsertRowId;
  await setMeta(ACTIVE_KEY, String(id));
  return id;
}

export async function clearActiveTrip(): Promise<void> {
  await setMeta(ACTIVE_KEY, null);
}

// Writes are done one batch at a time, in order, so the running distance stays correct
// even if the phone delivers two batches of GPS points almost together.
let writeQueue: Promise<unknown> = Promise.resolve();

/** Save a batch of new GPS points and update the trip's live numbers. */
export function insertPoints(tripId: number, pts: RawPoint[]): Promise<void> {
  const job = writeQueue.then(() => doInsert(tripId, pts));
  writeQueue = job.catch(() => undefined);
  return job;
}

async function doInsert(tripId: number, pts: RawPoint[]): Promise<void> {
  const valid = pts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.t));
  if (!valid.length) return;
  const db = await getDb();
  const trip = await db.getFirstAsync<TripRow>('SELECT * FROM trips WHERE id = ?', [tripId]);
  if (!trip) return;

  // Save in chunks (SQLite limits how many values one command may carry).
  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100);
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',');
    const values: (number | null)[] = [];
    for (const p of chunk) values.push(tripId, p.t, p.lat, p.lon, p.acc, p.alt, p.spd, p.hdg);
    await db.runAsync(`INSERT INTO points (trip_id, t, lat, lon, acc, alt, spd, hdg) VALUES ${placeholders}`, values);
  }

  // Live distance: only count a step once we have clearly moved away from the
  // last counted spot. This stops GPS wobble from adding fake distance.
  let dist = trip.distance_m;
  let aLat = trip.anchor_lat;
  let aLon = trip.anchor_lon;
  for (const p of valid) {
    if (p.acc != null && p.acc > 50) continue;
    if (aLat == null || aLon == null) {
      aLat = p.lat;
      aLon = p.lon;
      continue;
    }
    const d = distanceM(aLat, aLon, p.lat, p.lon);
    if (d >= Math.max(10, p.acc ?? 0)) {
      dist += d;
      aLat = p.lat;
      aLon = p.lon;
    }
  }
  const last = valid[valid.length - 1];
  await db.runAsync(
    `UPDATE trips SET point_count = point_count + ?, distance_m = ?, anchor_lat = ?, anchor_lon = ?,
       last_lat = ?, last_lon = ?, last_time = ?, last_speed = ?, last_accuracy = ? WHERE id = ?`,
    [valid.length, dist, aLat, aLon, last.lat, last.lon, last.t, last.spd, last.acc, tripId]
  );
}

export async function getTrip(id: number): Promise<TripRow | null> {
  const db = await getDb();
  return db.getFirstAsync<TripRow>('SELECT * FROM trips WHERE id = ?', [id]);
}

export async function listTrips(): Promise<TripRow[]> {
  const db = await getDb();
  return db.getAllAsync<TripRow>('SELECT * FROM trips ORDER BY started_at DESC');
}

export async function getPoints(tripId: number): Promise<RawPoint[]> {
  const db = await getDb();
  return db.getAllAsync<RawPoint>(
    'SELECT t, lat, lon, acc, alt, spd, hdg FROM points WHERE trip_id = ? ORDER BY t ASC',
    [tripId]
  );
}

/** Delete a whole recording, with its trips and corrections. */
export async function deleteTrip(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM points WHERE trip_id = ?', [id]);
  await db.runAsync('DELETE FROM legs WHERE trip_id = ?', [id]);
  await db.runAsync('DELETE FROM edits WHERE trip_id = ?', [id]);
  await db.runAsync('DELETE FROM modes WHERE trip_id = ?', [id]);
  await db.runAsync('DELETE FROM trips WHERE id = ?', [id]);
}

/**
 * Close a trip: work out the final, properly filtered numbers and store them.
 * Returns null (and removes the trip) if it never got a single GPS point.
 */
export async function finishTrip(id: number): Promise<{ trip: TripRow; analysis: Analysis } | null> {
  await writeQueue; // let any batch that is still being saved finish first
  const db = await getDb();
  const points = await getPoints(id);
  if (!points.length) {
    await deleteTrip(id);
    return null;
  }
  const analysis = analyze(points);
  const s = analysis.stats;
  await db.runAsync(
    `UPDATE trips SET ended_at = ?, distance_m = ?, moving_s = ?, stopped_s = ?, stop_count = ?, max_speed = ? WHERE id = ?`,
    [points[points.length - 1].t, s.distanceM, s.movingS, s.stoppedS, analysis.stops.length, s.maxSpeed, id]
  );
  const trip = await getTrip(id);
  return trip ? { trip, analysis } : null;
}

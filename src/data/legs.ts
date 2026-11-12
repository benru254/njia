/**
 * The list of separate trips (A -> B) shown on the home screen.
 *
 * They are worked out from the GPS points with the same code the viewer uses,
 * then kept in the "legs" table so the list opens instantly. Whenever something
 * that affects them changes (a correction, a named place, a setting), they are
 * worked out again.
 */
import { analyze } from '../core/analyze';
import { HOLD_ANALYZE, Segmentation, resolveMode, segment } from '../core/segment';
import { Edit, ModeOverride, Place, RawPoint, TripSettings } from '../core/types';
import { getDb, getMeta, setMeta } from './db';
import { getEdits, getModes } from './edits';
import { listPlaces } from './places';
import { getSettings } from './settings';
import { getPoints, listTrips } from './trips';

/** Bump this when the trip-splitting rules change, so old lists are redone once. */
export const LEGS_VERSION = '1';

export interface LegRow {
  trip_id: number;
  idx: number;
  depart_t: number;
  arrive_t: number;
  from_letter: string;
  from_name: string | null;
  to_letter: string;
  to_name: string | null;
  from_lat: number | null;
  from_lon: number | null;
  to_lat: number | null;
  to_lon: number | null;
  distance_m: number;
  duration_s: number;
  moving_s: number;
  pause_count: number;
  pause_s: number;
  traffic_s: number;
  max_speed: number;
  /** A TravelMode, or 'still' when the recording never left one place. */
  mode: string;
}

export interface Loaded {
  points: RawPoint[];
  places: Place[];
  edits: Edit[];
  modes: ModeOverride[];
  settings: TripSettings;
}

export async function loadInputs(tripId: number): Promise<Loaded> {
  const [points, places, edits, modes, settings] = await Promise.all([
    getPoints(tripId),
    listPlaces(),
    getEdits(tripId),
    getModes(tripId),
    getSettings(),
  ]);
  return { points, places, edits, modes, settings };
}

export function segmentInputs(x: Loaded): Segmentation {
  return segment(analyze(x.points, HOLD_ANALYZE), x.places, x.edits, { destMinS: x.settings.destMinS });
}

function rowsFor(tripId: number, x: Loaded): LegRow[] {
  if (!x.points.length) return [];
  const seg = segmentInputs(x);
  if (!seg.legs.length) {
    // Never left one place: still list it, so the recording can be found and deleted.
    const e = seg.endpoints[0];
    const first = x.points[0];
    const last = x.points[x.points.length - 1];
    return [
      {
        trip_id: tripId,
        idx: 0,
        depart_t: first.t,
        arrive_t: last.t,
        from_letter: 'A',
        from_name: e?.place?.name ?? null,
        to_letter: 'A',
        to_name: e?.place?.name ?? null,
        from_lat: e?.lat ?? first.lat,
        from_lon: e?.lon ?? first.lon,
        to_lat: e?.lat ?? first.lat,
        to_lon: e?.lon ?? first.lon,
        distance_m: 0,
        duration_s: (last.t - first.t) / 1000,
        moving_s: 0,
        pause_count: 0,
        pause_s: 0,
        traffic_s: 0,
        max_speed: 0,
        mode: 'still',
      },
    ];
  }
  return seg.legs.map((l, i) => ({
    trip_id: tripId,
    idx: i,
    depart_t: l.departT,
    arrive_t: l.arriveT,
    from_letter: l.from.letter,
    from_name: l.from.place?.name ?? null,
    to_letter: l.to.letter,
    to_name: l.to.place?.name ?? null,
    from_lat: l.from.lat,
    from_lon: l.from.lon,
    to_lat: l.to.lat,
    to_lon: l.to.lon,
    distance_m: l.distanceM,
    duration_s: l.durationS,
    moving_s: l.movingS,
    pause_count: l.pauseCount + l.trafficCount,
    pause_s: l.pauseS,
    traffic_s: l.trafficS,
    max_speed: l.maxSpeed,
    mode: resolveMode(l, x.modes, x.settings.vehicle),
  }));
}

const COLS = [
  'trip_id', 'idx', 'depart_t', 'arrive_t', 'from_letter', 'from_name', 'to_letter', 'to_name',
  'from_lat', 'from_lon', 'to_lat', 'to_lon', 'distance_m', 'duration_s', 'moving_s',
  'pause_count', 'pause_s', 'traffic_s', 'max_speed', 'mode',
] as const;

/** Work out the trips of one recording again and store them. */
export async function rebuildLegs(tripId: number): Promise<void> {
  const rows = rowsFor(tripId, await loadInputs(tripId));
  const db = await getDb();
  await db.runAsync('DELETE FROM legs WHERE trip_id = ?', [tripId]);
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40);
    const values: (string | number | null)[] = [];
    for (const r of chunk) for (const c of COLS) values.push(r[c]);
    await db.runAsync(
      `INSERT OR REPLACE INTO legs (${COLS.join(', ')}) VALUES ${chunk
        .map(() => `(${COLS.map(() => '?').join(',')})`)
        .join(',')}`,
      values
    );
  }
}

/** Work out every recording again (after a setting or a named place changes). */
export async function rebuildAllLegs(onProgress?: (done: number, total: number) => void): Promise<void> {
  const trips = await listTrips();
  for (let i = 0; i < trips.length; i++) {
    await rebuildLegs(trips[i].id);
    onProgress?.(i + 1, trips.length);
  }
}

/** Run once after an app update that changed the rules (also fills the list for older recordings). */
export async function ensureLegsUpToDate(): Promise<void> {
  if ((await getMeta('legs_version')) === LEGS_VERSION) return;
  await rebuildAllLegs();
  await setMeta('legs_version', LEGS_VERSION);
}

export async function listLegs(): Promise<LegRow[]> {
  const db = await getDb();
  return db.getAllAsync<LegRow>('SELECT * FROM legs ORDER BY depart_t DESC, idx DESC');
}

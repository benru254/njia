/**
 * Moves GPS points from the native recorder's own file into the app's database.
 *
 * The recorder (modules/njia-tracker) writes every point to its own small file
 * the moment it arrives, even when the app is closed. When the app opens (and
 * every few seconds while it is open) this moves them here:
 *
 *   Always on -> one recording per day, made automatically
 *   Manual    -> the recording you started with "Start recording"
 *
 * Safe to interrupt: each batch is saved here first, and only then removed from
 * the recorder's file. If the phone dies in between, the batch is imported again
 * and duplicates are ignored (unique index on trip + time).
 */
import { tracker, BufferRow, NjiaTracker } from '../../modules/njia-tracker';
import { getDb, getMeta, setMeta } from './db';
import { rebuildLegs } from './legs';
import { getRecordMode } from './mode';
import { SavePoint, dayTrip, finishTrip, getActiveTripId, insertPoints, openPastDays, setActiveTrip } from './trips';

const BATCH = 2000;
const LAST_KEY = 'buffer_last_id';

const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
/** Local calendar day of a time, e.g. "2026-11-25". */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const toPoint = (r: BufferRow): SavePoint => ({
  t: Math.round(r[1]),
  lat: r[2],
  lon: r[3],
  acc: r[4],
  alt: r[5],
  spd: r[6] != null && r[6] >= 0 ? r[6] : null,
  hdg: r[7] != null && r[7] >= 0 ? r[7] : null,
  src: r[8],
});

let running: Promise<number> | null = null;

/** Import everything waiting. Returns how many points were imported. Only one import runs at a time. */
export function importBuffer(onProgress?: (done: number) => void): Promise<number> {
  if (!NjiaTracker) return Promise.resolve(0);
  if (!running) {
    running = doImport(onProgress).finally(() => {
      running = null;
    });
  }
  return running;
}

async function doImport(onProgress?: (done: number) => void): Promise<number> {
  const t = tracker();
  let lastId = Number(await getMeta(LAST_KEY)) || 0;
  if (lastId > 0) await t.deletePointsUpTo(lastId); // finish a clean-up an earlier crash interrupted
  const mode = await getRecordMode();
  const touched = new Set<number>();
  let total = 0;

  for (;;) {
    const rows = await t.readPoints(lastId, BATCH);
    if (!rows.length) break;
    const pts = rows.map(toPoint);

    if (mode === 'always') {
      // Group by day: every day gets its own recording.
      const byDay = new Map<string, SavePoint[]>();
      for (const p of pts) {
        const k = dayKey(p.t);
        const list = byDay.get(k);
        if (list) list.push(p);
        else byDay.set(k, [p]);
      }
      for (const [day, list] of byDay) {
        const trip = await dayTrip(day, list[0].t);
        await insertPoints(trip.id, list);
        touched.add(trip.id);
      }
    } else {
      const active = await getActiveTripId();
      if (active != null) {
        await insertPoints(active, pts);
        touched.add(active);
      }
      // No recording open: these points belong to nothing (left over after Stop). Drop them.
    }

    lastId = rows[rows.length - 1][0];
    await setMeta(LAST_KEY, String(lastId));
    await t.deletePointsUpTo(lastId);
    total += rows.length;
    onProgress?.(total);
    if (rows.length < BATCH) break;
  }

  if (mode === 'always') await closePastDays();
  return total;
}

/**
 * Always on: close the recordings of days that are over (final totals, cut into
 * trips) and mark today's recording as the live one.
 */
export async function closePastDays(): Promise<void> {
  const today = dayKey(Date.now());
  for (const trip of await openPastDays(today)) {
    const done = await finishTrip(trip.id);
    if (done) await rebuildLegs(trip.id);
  }
  const todayTrip = await findDayTrip(today);
  if (todayTrip != null) await setActiveTrip(todayTrip);
}

async function findDayTrip(day: string): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM trips WHERE auto_day = ? ORDER BY id LIMIT 1', [day]);
  return row?.id ?? null;
}

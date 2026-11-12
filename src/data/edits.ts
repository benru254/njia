/**
 * Your corrections for one recording: split / join, and how each trip was travelled.
 * The viewer works out the new full list; here we simply store it.
 */
import { Edit, ModeOverride, TRAVEL_MODES } from '../core/types';
import { getDb } from './db';

export async function getEdits(tripId: number): Promise<Edit[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Edit>('SELECT t, kind FROM edits WHERE trip_id = ? ORDER BY id', [tripId]);
  return rows.filter((r) => r.kind === 'split' || r.kind === 'join');
}

export async function saveEdits(tripId: number, edits: Edit[]): Promise<void> {
  const db = await getDb();
  const valid = edits.filter((e) => Number.isFinite(e.t) && (e.kind === 'split' || e.kind === 'join'));
  await db.runAsync('DELETE FROM edits WHERE trip_id = ?', [tripId]);
  if (!valid.length) return;
  const values: (number | string)[] = [];
  for (const e of valid) values.push(tripId, Math.round(e.t), e.kind);
  await db.runAsync(`INSERT INTO edits (trip_id, t, kind) VALUES ${valid.map(() => '(?,?,?)').join(',')}`, values);
}

export async function getModes(tripId: number): Promise<ModeOverride[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ModeOverride>('SELECT t, mode FROM modes WHERE trip_id = ? ORDER BY id', [tripId]);
  return rows.filter((r) => TRAVEL_MODES.includes(r.mode));
}

export async function saveModes(tripId: number, modes: ModeOverride[]): Promise<void> {
  const db = await getDb();
  const valid = modes.filter((m) => Number.isFinite(m.t) && TRAVEL_MODES.includes(m.mode));
  await db.runAsync('DELETE FROM modes WHERE trip_id = ?', [tripId]);
  if (!valid.length) return;
  const values: (number | string)[] = [];
  for (const m of valid) values.push(tripId, Math.round(m.t), m.mode);
  await db.runAsync(`INSERT INTO modes (trip_id, t, mode) VALUES ${valid.map(() => '(?,?,?)').join(',')}`, values);
}

/**
 * The on-phone database (SQLite). Everything is stored on the phone first;
 * no internet is ever needed to record or view a trip.
 *
 * Words used in the code:
 *   - "trips" table = one RECORDING (Start to Stop). It may last a whole day.
 *   - "legs" table  = the separate TRIPS (A -> B, B -> C) cut from a recording.
 *
 * Rules for changing the tables (so existing trips are never lost):
 *   - only ADD tables or columns, never delete or rename
 *   - new tables: CREATE TABLE IF NOT EXISTS
 *   - new columns: ensureColumn(...)
 */
import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function ensureColumn(db: SQLite.SQLiteDatabase, table: string, column: string, definition: string) {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('njia.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      name TEXT,
      point_count INTEGER NOT NULL DEFAULT 0,
      distance_m REAL NOT NULL DEFAULT 0,
      moving_s REAL,
      stopped_s REAL,
      stop_count INTEGER,
      max_speed REAL,
      last_lat REAL,
      last_lon REAL,
      last_time INTEGER,
      last_speed REAL,
      last_accuracy REAL,
      anchor_lat REAL,
      anchor_lon REAL
    );

    CREATE TABLE IF NOT EXISTS points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      t INTEGER NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      acc REAL,
      alt REAL,
      spd REAL,
      hdg REAL
    );
    CREATE INDEX IF NOT EXISTS idx_points_trip_t ON points (trip_id, t);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );

    -- Places you named (shop, customer, home). Shared by all recordings.
    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      radius_m REAL NOT NULL DEFAULT 60,
      created_at INTEGER NOT NULL
    );

    -- Your one-tap corrections (split / join) for each recording.
    CREATE TABLE IF NOT EXISTS edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      t INTEGER NOT NULL,
      kind TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edits_trip ON edits (trip_id);

    -- "This trip was by car" choices.
    CREATE TABLE IF NOT EXISTS modes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      t INTEGER NOT NULL,
      mode TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_modes_trip ON modes (trip_id);

    -- The trips (A -> B) cut from each recording. Worked out from the points,
    -- places and corrections above, so it can always be rebuilt.
    CREATE TABLE IF NOT EXISTS legs (
      trip_id INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      depart_t INTEGER NOT NULL,
      arrive_t INTEGER NOT NULL,
      from_letter TEXT NOT NULL,
      from_name TEXT,
      to_letter TEXT NOT NULL,
      to_name TEXT,
      from_lat REAL,
      from_lon REAL,
      to_lat REAL,
      to_lon REAL,
      distance_m REAL NOT NULL DEFAULT 0,
      duration_s REAL NOT NULL DEFAULT 0,
      moving_s REAL NOT NULL DEFAULT 0,
      pause_count INTEGER NOT NULL DEFAULT 0,
      pause_s REAL NOT NULL DEFAULT 0,
      traffic_s REAL NOT NULL DEFAULT 0,
      max_speed REAL NOT NULL DEFAULT 0,
      mode TEXT NOT NULL,
      PRIMARY KEY (trip_id, idx)
    );
    CREATE INDEX IF NOT EXISTS idx_legs_depart ON legs (depart_t);
  `);
  // Reserved for the next part (Wi-Fi upload): remembers what was already sent.
  await ensureColumn(db, 'trips', 'synced_at', 'INTEGER');
  return db;
}

/** Get the (single, shared) database connection. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = open().catch((err) => {
      dbPromise = null; // allow another try next time
      throw err;
    });
  }
  return dbPromise;
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string | null): Promise<void> {
  const db = await getDb();
  if (value == null) await db.runAsync('DELETE FROM meta WHERE key = ?', [key]);
  else await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
}

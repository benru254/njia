package expo.modules.njiatracker

import android.content.ContentValues
import android.content.Context
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.location.Location

/**
 * The recorder's own small database file ("njia-buffer.db").
 *
 * Every GPS point is written here the moment it arrives, and each write is
 * flushed to storage (synchronous = FULL), so a dead battery or a phone that
 * switches off loses at most the point being written at that instant.
 *
 * The app moves the points into its main database when you open it.
 * Only this class ever opens this file (one SQLite library per file = no corruption).
 */
class PointStore private constructor(context: Context) :
  SQLiteOpenHelper(context, "njia-buffer.db", null, 1) {

  companion object {
    /** A normal GPS reading. */
    const val SRC_GPS = 0
    // 1 and 2 were used by version 1.0.3 (GPS-off battery saving, removed). Do not reuse.

    @Volatile private var instance: PointStore? = null

    fun get(context: Context): PointStore =
      instance ?: synchronized(this) {
        instance ?: PointStore(context.applicationContext).also { instance = it }
      }
  }

  init {
    setWriteAheadLoggingEnabled(true)
  }

  override fun onConfigure(db: SQLiteDatabase) {
    db.rawQuery("PRAGMA synchronous = FULL", null).use { it.moveToFirst() }
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      "CREATE TABLE points (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, " +
        "acc REAL, alt REAL, spd REAL, hdg REAL, src INTEGER NOT NULL DEFAULT 0)"
    )
    db.execSQL(
      "CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT)"
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    // Version 1 only so far. Future changes must only ADD, never drop.
  }

  @Synchronized
  fun insert(loc: Location, src: Int) {
    val v = ContentValues()
    v.put("t", loc.time)
    v.put("lat", loc.latitude)
    v.put("lon", loc.longitude)
    if (loc.hasAccuracy()) v.put("acc", loc.accuracy.toDouble())
    if (loc.hasAltitude()) v.put("alt", loc.altitude)
    if (loc.hasSpeed()) v.put("spd", loc.speed.toDouble())
    if (loc.hasBearing()) v.put("hdg", loc.bearing.toDouble())
    v.put("src", src)
    safeInsert("points", v)
  }

  @Synchronized
  fun event(kind: String, detail: String?) {
    val v = ContentValues()
    v.put("t", System.currentTimeMillis())
    v.put("kind", kind)
    v.put("detail", detail)
    safeInsert("events", v)
    try {
      // Keep only the last 300 events.
      writableDatabase.execSQL("DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - 300")
    } catch (e: Exception) {
      // not important
    }
  }

  private fun safeInsert(table: String, v: ContentValues) {
    try {
      writableDatabase.insert(table, null, v)
    } catch (e: Exception) {
      android.util.Log.e("NjiaTracker", "write failed: ${e.message}")
    }
  }

  /** Points after a given id, oldest first. Each row: id, t, lat, lon, acc, alt, spd, hdg, src. */
  @Synchronized
  fun read(afterId: Long, limit: Int): List<List<Double?>> {
    val out = ArrayList<List<Double?>>()
    readableDatabase.rawQuery(
      "SELECT id, t, lat, lon, acc, alt, spd, hdg, src FROM points WHERE id > ? ORDER BY id LIMIT ?",
      arrayOf(afterId.toString(), limit.toString())
    ).use { c ->
      while (c.moveToNext()) {
        val row = ArrayList<Double?>(9)
        for (i in 0 until 9) row.add(if (c.isNull(i)) null else c.getDouble(i))
        out.add(row)
      }
    }
    return out
  }

  @Synchronized
  fun deleteUpTo(id: Long): Int {
    return try {
      writableDatabase.delete("points", "id <= ?", arrayOf(id.toString()))
    } catch (e: Exception) {
      0
    }
  }

  @Synchronized
  fun count(): Long = try {
    DatabaseUtils.queryNumEntries(readableDatabase, "points")
  } catch (e: Exception) {
    -1
  }

  @Synchronized
  fun events(limit: Int): List<Map<String, Any?>> {
    val out = ArrayList<Map<String, Any?>>()
    readableDatabase.rawQuery(
      "SELECT t, kind, detail FROM events ORDER BY id DESC LIMIT ?",
      arrayOf(limit.toString())
    ).use { c ->
      while (c.moveToNext()) {
        out.add(
          mapOf(
            "t" to c.getLong(0).toDouble(),
            "kind" to c.getString(1),
            "detail" to (if (c.isNull(2)) null else c.getString(2))
          )
        )
      }
    }
    return out
  }
}

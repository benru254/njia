package expo.modules.njiatracker

import android.content.Context
import android.location.Location
import org.json.JSONArray

/**
 * The recorder's settings, kept in Android's SharedPreferences so the recorder
 * can read them on its own after a phone restart (without the app screen).
 */
class TrackerPrefs(context: Context) {
  private val p = context.applicationContext.getSharedPreferences("njia-tracker", Context.MODE_PRIVATE)

  /** True while recording is switched on (manual recording or Always on). */
  var enabled: Boolean
    get() = p.getBoolean("enabled", false)
    set(v) {
      p.edit().putBoolean("enabled", v).commit()
    }

  /** Time between GPS points while moving. */
  val intervalMs: Long get() = p.getLong("intervalMs", 3_000L).coerceIn(1_000L, 60_000L)

  /** No movement for this long: switch GPS off and save battery. */
  val stillAfterMs: Long get() = p.getLong("stillAfterMs", 180_000L).coerceIn(60_000L, 900_000L)

  /** Same, but at a place you named (home, office): save battery sooner. */
  val stillAfterPlaceMs: Long get() = p.getLong("stillAfterPlaceMs", 90_000L).coerceIn(30_000L, 900_000L)

  /** While still: how often to check (with Wi-Fi / mobile network, not GPS) whether you left. */
  val stillCheckMs: Long get() = p.getLong("stillCheckMs", 60_000L).coerceIn(15_000L, 600_000L)

  /** Save settings sent from the app. Numbers arrive from JavaScript as Double. */
  fun update(config: Map<String, Any?>) {
    val e = p.edit()
    for (key in listOf("intervalMs", "stillAfterMs", "stillAfterPlaceMs", "stillCheckMs")) {
      (config[key] as? Number)?.let { e.putLong(key, it.toLong()) }
    }
    (config["places"] as? List<*>)?.let { list ->
      val arr = JSONArray()
      for (item in list) {
        val m = item as? Map<*, *> ?: continue
        val lat = (m["lat"] as? Number)?.toDouble() ?: continue
        val lon = (m["lon"] as? Number)?.toDouble() ?: continue
        val r = (m["radiusM"] as? Number)?.toDouble() ?: 60.0
        arr.put(JSONArray().put(lat).put(lon).put(r))
      }
      e.putString("places", arr.toString())
      cachedPlaces = null
    }
    e.commit()
  }

  /** Is this spot inside a place you named? */
  fun nearPlace(lat: Double, lon: Double): Boolean {
    val places = cachedPlaces ?: parsePlaces().also { cachedPlaces = it }
    val out = FloatArray(1)
    for (pl in places) {
      Location.distanceBetween(lat, lon, pl[0], pl[1], out)
      if (out[0] <= pl[2]) return true
    }
    return false
  }

  private fun parsePlaces(): List<DoubleArray> {
    return try {
      val arr = JSONArray(p.getString("places", "[]"))
      (0 until arr.length()).map { i ->
        val a = arr.getJSONArray(i)
        doubleArrayOf(a.getDouble(0), a.getDouble(1), a.getDouble(2))
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  companion object {
    @Volatile private var cachedPlaces: List<DoubleArray>? = null
  }
}

package expo.modules.njiatracker

import android.content.Context

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

  /** Time between GPS points. */
  val intervalMs: Long get() = p.getLong("intervalMs", 3_000L).coerceIn(1_000L, 60_000L)

  /** Save settings sent from the app. Numbers arrive from JavaScript as Double. */
  fun update(config: Map<String, Any?>) {
    (config["intervalMs"] as? Number)?.let { p.edit().putLong("intervalMs", it.toLong()).commit() }
  }
}

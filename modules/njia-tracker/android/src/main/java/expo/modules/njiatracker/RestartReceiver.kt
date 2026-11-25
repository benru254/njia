package expo.modules.njiatracker

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock

/**
 * Starts the recorder again:
 *   - after the phone restarts (battery died, switched off, battery pulled out)
 *   - after the app is updated
 *   - every 15 minutes, if some phone battery manager stopped it ("watchdog")
 *
 * Only does anything while recording is switched on.
 */
class RestartReceiver : BroadcastReceiver() {

  companion object {
    const val ACTION_WATCHDOG = "expo.modules.njiatracker.WATCHDOG"
    private const val WATCHDOG_MS = 15 * 60 * 1000L

    private fun watchdogIntent(context: Context): PendingIntent {
      val i = Intent(context, RestartReceiver::class.java).setAction(ACTION_WATCHDOG)
      return PendingIntent.getBroadcast(context, 1, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun scheduleWatchdog(context: Context) {
      val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      am.setInexactRepeating(
        AlarmManager.ELAPSED_REALTIME_WAKEUP,
        SystemClock.elapsedRealtime() + WATCHDOG_MS,
        WATCHDOG_MS,
        watchdogIntent(context)
      )
    }

    fun cancelWatchdog(context: Context) {
      val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      am.cancel(watchdogIntent(context))
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    val prefs = TrackerPrefs(context)
    if (!prefs.enabled) return
    scheduleWatchdog(context)
    if (TrackerService.running) return
    val why = when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, "android.intent.action.QUICKBOOT_POWERON", "com.htc.intent.action.QUICKBOOT_POWERON" ->
        "phone restarted"
      Intent.ACTION_MY_PACKAGE_REPLACED -> "app updated"
      ACTION_WATCHDOG -> "watchdog: recorder had been stopped"
      else -> "restart"
    }
    try {
      TrackerService.start(context, why)
    } catch (e: Exception) {
      PointStore.get(context).event(
        "error",
        "could not restart ($why): ${e.javaClass.simpleName}. Remove battery limits for Njia in Setup."
      )
    }
  }
}

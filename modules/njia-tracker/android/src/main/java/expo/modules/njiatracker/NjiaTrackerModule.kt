package expo.modules.njiatracker

import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** What the app (JavaScript) can ask the recorder to do. */
class NjiaTrackerModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "The app is not ready yet" }.applicationContext

  override fun definition() = ModuleDefinition {
    Name("NjiaTracker")

    /** Save settings: intervalMs. */
    Function("configure") { config: Map<String, Any?> ->
      TrackerPrefs(context).update(config)
    }

    /** Switch recording on (also after a restart, until stop() is called). */
    Function("start") { why: String ->
      val ctx = context
      TrackerPrefs(ctx).enabled = true
      RestartReceiver.scheduleWatchdog(ctx)
      TrackerService.start(ctx, why)
    }

    /** Switch recording off. Points already recorded stay in the buffer until imported. */
    Function("stop") {
      val ctx = context
      TrackerPrefs(ctx).enabled = false
      RestartReceiver.cancelWatchdog(ctx)
      ctx.stopService(Intent(ctx, TrackerService::class.java))
    }

    Function("getStatus") {
      mapOf(
        "enabled" to TrackerPrefs(context).enabled,
        "running" to TrackerService.running,
        "startedAt" to TrackerService.startedAt.toDouble(),
        "lastFixT" to TrackerService.lastFixT.toDouble(),
        "lastFixAcc" to TrackerService.lastFixAcc.toDouble()
      )
    }

    /** Recorded points after `afterId`, oldest first: [id, t, lat, lon, acc, alt, spd, hdg, src]. */
    AsyncFunction("readPoints") { afterId: Double, limit: Int ->
      PointStore.get(context).read(afterId.toLong(), limit)
    }

    /** Forget points that the app has safely moved into its own database. */
    AsyncFunction("deletePointsUpTo") { id: Double ->
      PointStore.get(context).deleteUpTo(id.toLong())
    }

    AsyncFunction("pendingCount") {
      PointStore.get(context).count().toDouble()
    }

    /** The recorder's diary (started, still, moving, restarted, errors), newest first. */
    AsyncFunction("getEvents") { limit: Int ->
      PointStore.get(context).events(limit)
    }
  }
}

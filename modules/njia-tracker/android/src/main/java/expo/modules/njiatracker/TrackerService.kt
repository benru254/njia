package expo.modules.njiatracker

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * The recorder. Runs as an Android "foreground service", which is what lets an
 * app keep using GPS with the screen off. It works without the app screen and
 * restarts after a phone restart.
 *
 * GPS stays ON at full accuracy the whole time it is recording, moving or not:
 * accurate data comes first, battery second. (Version 1.0.3 switched GPS off when
 * you were still; that caused straight-line jumps, so it was removed in 1.0.4.)
 */
class TrackerService : Service() {

  companion object {
    const val ACTION_RELOAD = "expo.modules.njiatracker.RELOAD"
    const val EXTRA_WHY = "why"
    private const val CHANNEL_ID = "njia-recording"
    private const val NOTIFICATION_ID = 4711

    // Read by the app screen (same process) to show the status.
    @Volatile var running = false
    @Volatile var startedAt: Long = 0L
    @Volatile var lastFixT: Long = 0L
    @Volatile var lastFixAcc: Float = -1f

    fun hasLocationPermission(context: Context): Boolean =
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED

    /** Start (or refresh) the recorder. Throws if Android does not allow it right now. */
    fun start(context: Context, why: String) {
      val i = Intent(context, TrackerService::class.java).putExtra(EXTRA_WHY, why)
      if (running) i.action = ACTION_RELOAD
      ContextCompat.startForegroundService(context, i)
    }
  }

  private lateinit var prefs: TrackerPrefs
  private lateinit var store: PointStore
  private lateinit var fused: FusedLocationProviderClient
  private lateinit var thread: HandlerThread
  private lateinit var handler: Handler

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      for (loc in result.locations) onLocation(loc)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    prefs = TrackerPrefs(this)
    store = PointStore.get(this)
    fused = LocationServices.getFusedLocationProviderClient(this)
    thread = HandlerThread("njia-recorder").also { it.start() }
    handler = Handler(thread.looper)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Android requires the notification within a few seconds of every start.
    if (!promote()) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (!prefs.enabled || !hasLocationPermission(this)) {
      if (!hasLocationPermission(this)) store.event("error", "location permission is missing")
      stopSelf()
      return START_NOT_STICKY
    }
    val why = intent?.getStringExtra(EXTRA_WHY) ?: "restarted by Android"
    val reload = intent?.action == ACTION_RELOAD
    handler.post {
      if (!running) {
        running = true
        startedAt = System.currentTimeMillis()
        store.event("start", why)
      } else if (reload) {
        store.event("settings", why)
      }
      requestGps()
    }
    // If Android kills the recorder to free memory, it starts it again by itself.
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    handler.removeCallbacksAndMessages(null)
    try {
      fused.removeLocationUpdates(callback)
    } catch (e: Exception) {
      // already stopped
    }
    store.event("stop", if (prefs.enabled) "stopped by Android" else "switched off")
    thread.quitSafely()
    super.onDestroy()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping the app away from recent apps must NOT stop recording.
    store.event("info", "app swiped away, recording continues")
  }

  /** Full-accuracy GPS, one point every `intervalMs`, all the time. */
  @SuppressLint("MissingPermission")
  private fun requestGps() {
    val ms = prefs.intervalMs
    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, ms)
      .setMinUpdateIntervalMillis(ms)
      .setMinUpdateDistanceMeters(0f)
      .setMaxUpdateDelayMillis(0)
      .setWaitForAccurateLocation(false)
      .build()
    try {
      fused.removeLocationUpdates(callback)
      fused.requestLocationUpdates(request, callback, thread.looper)
    } catch (e: SecurityException) {
      store.event("error", "location permission was removed")
    } catch (e: Exception) {
      store.event("error", "location request failed: ${e.message}")
    }
    updateNotification()
  }

  private fun onLocation(loc: Location) {
    lastFixT = loc.time
    lastFixAcc = if (loc.hasAccuracy()) loc.accuracy else -1f
    store.insert(loc, PointStore.SRC_GPS)
  }

  // ---------------------------------------------------------------- notification

  private fun promote(): Boolean {
    return try {
      val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
      true
    } catch (e: Exception) {
      store.event("error", "Android did not allow recording to start: ${e.javaClass.simpleName}")
      false
    }
  }

  private fun updateNotification() {
    try {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.notify(NOTIFICATION_ID, buildNotification())
    } catch (e: Exception) {
      // Notifications are turned off: that is fine, recording continues.
    }
  }

  private fun buildNotification(): Notification {
    ensureChannel()
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.njia_notification)
      .setContentTitle("Njia is recording")
      .setContentText("GPS on")
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      val pi = PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      builder.setContentIntent(pi)
    }
    return builder.build()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) == null) {
      val ch = NotificationChannel(CHANNEL_ID, "Recording in the background", NotificationManager.IMPORTANCE_MIN)
      ch.description = "Shown while Njia records. You can turn it off; recording continues."
      ch.setShowBadge(false)
      nm.createNotificationChannel(ch)
    }
  }
}

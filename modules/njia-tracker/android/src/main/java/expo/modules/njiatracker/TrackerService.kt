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
import android.hardware.Sensor
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.SystemClock
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
 * app keep using GPS with the screen off. It works without the app screen,
 * restarts after a phone restart, and has two power modes:
 *
 *   MOVING  GPS on, a point every few seconds.
 *   STILL   GPS off. A cheap Wi-Fi / mobile-network position every minute checks
 *           you have not left, and the phone's "significant motion" sensor
 *           (a hardware chip that uses almost no power) wakes GPS the moment you move.
 *
 * You are STILL after 3 minutes without moving more than 30 m
 * (1.5 minutes at a place you named, such as home or the office).
 */
class TrackerService : Service() {

  companion object {
    const val ACTION_RELOAD = "expo.modules.njiatracker.RELOAD"
    const val EXTRA_WHY = "why"
    private const val CHANNEL_ID = "njia-recording"
    private const val NOTIFICATION_ID = 4711

    const val MODE_MOVING = "moving"
    const val MODE_STILL = "still"

    /** A fix this accurate (metres) is trusted to decide if you moved. */
    private const val GOOD_ACC_M = 25f
    /** Moving less than this (metres) does not count as moving. */
    private const val STILL_RADIUS_M = 30f
    /** In STILL mode, a low-power fix this far away (or 2x its accuracy) means you left. */
    private const val WAKE_DIST_M = 120f
    private const val TICK_MS = 15_000L

    // Read by the app screen (same process) to show the status.
    @Volatile var running = false
    @Volatile var mode: String = MODE_MOVING
    @Volatile var modeSince: Long = 0L
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
  private var sensorManager: SensorManager? = null
  private var motionSensor: Sensor? = null
  private var motionArmed = false

  /** Where you were last seen standing (a trusted fix). */
  private var anchor: Location? = null
  /** When we last saw you really move (elapsed-realtime clock, not affected by clock changes). */
  private var lastMoveElapsed = 0L

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      for (loc in result.locations) onLocation(loc)
    }
  }

  private val motionListener = object : TriggerEventListener() {
    override fun onTrigger(event: TriggerEvent?) {
      motionArmed = false
      handler.post {
        if (mode == MODE_STILL) {
          // We were still right up to now: close the stay, then wake GPS.
          anchor?.let { store.insertStill(it, System.currentTimeMillis()) }
          enterMoving("motion sensor")
        }
      }
    }
  }

  private val tick = object : Runnable {
    override fun run() {
      checkStill()
      handler.postDelayed(this, TICK_MS)
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
    sensorManager = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    motionSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)
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
        mode = MODE_MOVING
        modeSince = System.currentTimeMillis()
        lastMoveElapsed = SystemClock.elapsedRealtime()
        store.event("start", why)
        handler.removeCallbacks(tick)
        handler.postDelayed(tick, TICK_MS)
      } else if (reload) {
        store.event("settings", why)
      }
      applyMode()
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
    disarmMotion()
    store.event("stop", if (prefs.enabled) "stopped by Android" else "switched off")
    thread.quitSafely()
    super.onDestroy()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping the app away from recent apps must NOT stop recording.
    store.event("info", "app swiped away, recording continues")
  }

  // ---------------------------------------------------------------- power modes

  @SuppressLint("MissingPermission")
  private fun applyMode() {
    val request = if (mode == MODE_MOVING) {
      val ms = prefs.intervalMs
      LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, ms)
        .setMinUpdateIntervalMillis(ms)
        .build()
    } else {
      val ms = prefs.stillCheckMs
      LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, ms)
        .setMinUpdateIntervalMillis(ms / 2)
        .build()
    }
    try {
      fused.removeLocationUpdates(callback)
      fused.requestLocationUpdates(request, callback, thread.looper)
    } catch (e: SecurityException) {
      store.event("error", "location permission was removed")
    } catch (e: Exception) {
      store.event("error", "location request failed: ${e.message}")
    }
    if (mode == MODE_STILL) armMotion() else disarmMotion()
    updateNotification()
  }

  private fun onLocation(loc: Location) {
    lastFixT = loc.time
    lastFixAcc = if (loc.hasAccuracy()) loc.accuracy else -1f
    val acc = if (loc.hasAccuracy()) loc.accuracy else Float.MAX_VALUE

    if (mode == MODE_MOVING) {
      store.insert(loc, PointStore.SRC_GPS)
      if (acc <= GOOD_ACC_M) {
        val a = anchor
        val moved = a == null || a.distanceTo(loc) > STILL_RADIUS_M || (loc.hasSpeed() && loc.speed > 2f)
        if (moved) {
          anchor = loc
          lastMoveElapsed = SystemClock.elapsedRealtime()
        }
      }
      return
    }

    // STILL: GPS is off, this is a cheap Wi-Fi / mobile-network position.
    val a = anchor
    if (a == null) {
      if (acc <= 100f) anchor = loc
      store.insert(loc, PointStore.SRC_GPS)
      return
    }
    val d = a.distanceTo(loc)
    val moved = (acc <= 200f && d > maxOf(WAKE_DIST_M, acc * 2f)) ||
      (loc.hasSpeed() && loc.speed > 4f && acc <= 50f)
    if (moved) {
      store.insertStill(a, System.currentTimeMillis() - 1_000L)
      store.insert(loc, PointStore.SRC_WAKE)
      enterMoving("moved about ${d.toInt()} m")
    } else {
      store.insertStill(a, System.currentTimeMillis())
    }
  }

  /** Called every 15 s: has there been no real movement for long enough to switch GPS off? */
  private fun checkStill() {
    if (mode != MODE_MOVING) return
    val a = anchor
    val limit = if (a != null && prefs.nearPlace(a.latitude, a.longitude)) prefs.stillAfterPlaceMs else prefs.stillAfterMs
    if (SystemClock.elapsedRealtime() - lastMoveElapsed >= limit) enterStill()
  }

  private fun enterStill() {
    mode = MODE_STILL
    modeSince = System.currentTimeMillis()
    val a = anchor
    if (a != null) store.insertStill(a, System.currentTimeMillis())
    store.event("still", if (a != null) "GPS off, saving battery" else "GPS off (no GPS fix here)")
    applyMode()
  }

  private fun enterMoving(why: String) {
    mode = MODE_MOVING
    modeSince = System.currentTimeMillis()
    lastMoveElapsed = SystemClock.elapsedRealtime()
    store.event("moving", "GPS on: $why")
    applyMode()
  }

  private fun armMotion() {
    val s = motionSensor ?: return
    if (!motionArmed) motionArmed = sensorManager?.requestTriggerSensor(motionListener, s) == true
  }

  private fun disarmMotion() {
    val s = motionSensor ?: return
    if (motionArmed) {
      sensorManager?.cancelTriggerSensor(motionListener, s)
      motionArmed = false
    }
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
    val text = if (mode == MODE_STILL) "Still · GPS off, saving battery" else "Moving · GPS on"
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.njia_notification)
      .setContentTitle("Njia is recording")
      .setContentText(text)
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

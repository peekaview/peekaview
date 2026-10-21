package de.limtec.peekaview

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.hardware.display.DisplayManager
import android.util.DisplayMetrics
import android.view.Display
import java.util.concurrent.CopyOnWriteArraySet

/**
 * The running share of this phone's screen: a foreground service (Android requires one for screen
 * capture) that owns the [Host] – capture, connections, join requests – also while the app is in
 * the background. A join request shows up as a notification with sound.
 */
class HostService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Freigabe läuft", NotificationManager.IMPORTANCE_LOW))
        manager.createNotificationChannel(NotificationChannel(CHANNEL_REQUESTS, "Beitrittsanfragen", NotificationManager.IMPORTANCE_HIGH))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // first the notification, then the capture (Android's order for media projection)
        val notification = running()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(ID, notification)
        }
        if (host != null) return START_NOT_STICKY
        val data = intent?.let { if (Build.VERSION.SDK_INT >= 33) it.getParcelableExtra(EXTRA_DATA, Intent::class.java) else @Suppress("DEPRECATION") it.getParcelableExtra(EXTRA_DATA) }
        if (data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val (width, height) = screenSize()
        try {
            host = Host(
                context = applicationContext,
                name = intent.getStringExtra(EXTRA_NAME) ?: "Android",
                projectionData = data,
                width = width,
                height = height,
                onChange = ::changed,
                onEnded = { stopSelf() },
            ).also { it.start() }
        } catch (e: Exception) {
            lastError = e.message ?: e.toString()
            stopSelf()
        }
        changed()
        return START_NOT_STICKY
    }

    // turned: the capture follows
    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        val (width, height) = screenSize()
        host?.resize(width, height)
    }

    /** The whole screen in pixels, with status and navigation bar. */
    private fun screenSize(): Pair<Int, Int> {
        val display = getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION") display.getRealMetrics(metrics)
        return metrics.widthPixels to metrics.heightPixels
    }

    override fun onDestroy() {
        host?.stop()
        host = null
        getSystemService(NotificationManager::class.java).cancel(ID_REQUEST)
        changed()
        super.onDestroy()
    }

    private var announced = emptySet<String>()

    private fun changed() {
        // a new join request: a notification that rings
        val requests = host?.requests().orEmpty()
        val fresh = requests.filter { it.peer !in announced }
        announced = requests.map { it.peer }.toSet()
        val manager = getSystemService(NotificationManager::class.java)
        if (fresh.isNotEmpty()) {
            manager.notify(
                ID_REQUEST,
                Notification.Builder(this, CHANNEL_REQUESTS)
                    .setSmallIcon(R.drawable.ic_launcher_foreground)
                    .setContentTitle("${fresh.first().name.ifBlank { "Gast" }} möchte zusehen")
                    .setContentText("Tippen, um zuzulassen oder abzulehnen")
                    .setContentIntent(openShare())
                    .setAutoCancel(true)
                    .build(),
            )
        } else if (requests.isEmpty()) {
            manager.cancel(ID_REQUEST)
        }
        for (l in listeners) l()
    }

    private fun openShare(): PendingIntent =
        PendingIntent.getActivity(this, 0, Intent(this, ShareActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun running(): Notification =
        Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("PeekaView – Bildschirm wird geteilt")
            .setContentText("Tippen für Link, Zuschauer und Beenden")
            .setContentIntent(openShare())
            .setOngoing(true)
            .build()

    companion object {
        const val EXTRA_DATA = "data"
        const val EXTRA_NAME = "name"
        private const val CHANNEL = "share"
        private const val CHANNEL_REQUESTS = "requests"
        private const val ID = 1
        private const val ID_REQUEST = 2

        @Volatile
        var host: Host? = null
            private set

        @Volatile
        var lastError: String? = null

        /** UI listeners (the share screen): called on every change. */
        val listeners = CopyOnWriteArraySet<() -> Unit>()
    }
}

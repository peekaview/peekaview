package de.limtec.peekaview

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Explicitly activated readiness, separate from the screen-sharing foreground service. */
class ShellHelperService : Service() {
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private var stopped = false
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            stopService(Intent(this, HostService::class.java))
            stopSelf()
            return START_NOT_STICKY
        }
        if (started) return START_NOT_STICKY
        started = true
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Fernsteuerung bereit", NotificationManager.IMPORTANCE_LOW))
        val notification = notice("Shell-Helfer wird gestartet …")
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(ID, notification)
        val requestedPort = intent?.getIntExtra("port", 0) ?: 0
        worker.execute {
            try {
                val port = if (requestedPort == 0) AdbDiscovery.connectionPort(this) else requestedPort
                val helper = ShellHelper.start(this, port)
                synchronized(ShellHelperService::class.java) {
                    if (stopped) { helper.close(); return@execute }
                    link = helper
                    Prefs.rememberAdb(this, port)
                    pending.complete(helper)
                }
                manager.notify(ID, notice("Bereit – WLAN-Debugging ist ausgeschaltet. Der Bildschirm wird nur während einer Freigabe geteilt."))
                changed()
            } catch (e: Exception) {
                pending.completeExceptionally(e)
                android.util.Log.e("shell", "Helfer konnte nicht starten", e)
                stopSelf()
            }
        }
        worker.scheduleWithFixedDelay({
            val helper = link ?: return@scheduleWithFixedDelay
            try { helper.ping() }
            catch (e: Exception) {
                HostService.lastError = "Die Fernsteuerung wurde beendet. Tippe auf „Freigabe starten“, um die Verbindung erneut einzurichten."
                stopService(Intent(this, HostService::class.java))
                stopSelf()
            }
        }, 10, 10, TimeUnit.SECONDS)
        return START_NOT_STICKY
    }

    private fun notice(text: String): Notification {
        val open = PendingIntent.getActivity(this, ID, Intent(this, ShareActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, ID, Intent(this, ShellHelperService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("PeekaView – Fernsteuerung bereit").setContentText(text).setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, "Helfer beenden", stop).build()).build()
    }

    override fun onDestroy() {
        stopService(Intent(this, HostService::class.java))
        synchronized(ShellHelperService::class.java) {
            stopped = true
            link?.close(); link = null
            pending.completeExceptionally(IllegalStateException("Shell-Helfer beendet."))
            started = false
        }
        worker.shutdownNow()
        stopForeground(STOP_FOREGROUND_REMOVE)
        changed()
        super.onDestroy()
    }

    companion object {
        const val STOP = "de.limtec.peekaview.SHELL_HELPER_STOP"
        private const val CHANNEL = "shell_helper"
        private const val ID = 90_002
        private var started = false
        private var pending = CompletableFuture<ShellHelper>()
        @Volatile var link: ShellHelper? = null
            private set
        val listeners = CopyOnWriteArraySet<() -> Unit>()
        private fun changed() { for (listener in listeners) listener() }
        /** Main-thread start; the returned future may only be awaited on a worker thread. */
        @Synchronized fun activate(context: Context, port: Int = 0): CompletableFuture<ShellHelper> {
            link?.let { return CompletableFuture.completedFuture(it) }
            val notifications = context.getSystemService(NotificationManager::class.java)
            check(notifications.areNotificationsEnabled() && notifications.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE) {
                "Erlaube PeekaView-Benachrichtigungen und den Kanal „Fernsteuerung bereit“, damit der aktive Helfer sichtbar bleibt und beendet werden kann."
            }
            if (pending.isDone) pending = CompletableFuture()
            ContextCompat.startForegroundService(context, Intent(context, ShellHelperService::class.java).putExtra("port", port))
            return pending
        }
    }
}

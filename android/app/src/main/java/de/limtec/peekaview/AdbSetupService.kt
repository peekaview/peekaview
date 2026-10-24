package de.limtec.peekaview

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors

/** User-started pairing assistant; inline notification input keeps Android's code dialog open. */
class AdbSetupService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var discovery: AdbDiscovery
    private var running = false
    private var busy = false
    private var pairPort = 0
    private var connectPort = 0
    private var paired = false
    @Volatile private var client: LocalAdb? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "ADB-Einrichtung", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            change("idle", "Einrichtung beendet. Du kannst sie jederzeit erneut starten.")
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == PAIR) {
            if (!running) { stopSelf(); return START_NOT_STICKY }
            val code = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(CODE)?.toString()?.trim().orEmpty()
            pair(code, intent.getIntExtra(PORT, 0))
            return START_NOT_STICKY
        }
        if (running) return START_NOT_STICKY
        if (!notificationsAllowed(this)) {
            change("error", "Benachrichtigungen und den Kanal „ADB-Einrichtung“ erlauben, um den Kopplungscode einzugeben.")
            stopSelf()
            return START_NOT_STICKY
        }
        running = true
        paired = Prefs.adbPaired(this)
        active = true
        phase = "searching"
        message = "„Debugging über WLAN“ einschalten und Netzwerkabfrage bestätigen. Schon eingeschaltet? Kurz aus- und wieder einschalten."
        val notice = notification()
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(ID, notice)
        discovery = AdbDiscovery(this, ::portChanged) { problem -> change("error", problem); stopSelf() }
        discovery.start()
        main.postDelayed({
            if (running) {
                change("error", "Einrichtung nach fünf Minuten beendet. WLAN und „Debugging über WLAN“ prüfen, dann erneut starten.")
                stopSelf()
            }
        }, 300_000)
        changed()
        return START_NOT_STICKY
    }

    private fun portChanged(kind: String, port: Int) {
        if (!running) return
        if (kind == AdbDiscovery.PAIRING) pairPort = port else connectPort = port
        if (busy) return
        if (kind == AdbDiscovery.CONNECT && port > 0 && (pairPort == 0 || paired)) checkConnection()
        else waiting()
    }

    private fun waiting(problem: String? = null) {
        if (connectPort == 0 && pairPort == 0 && problem == null) {
            change("searching", "„Debugging über WLAN“ einschalten und Netzwerkabfrage bestätigen. Schon eingeschaltet? Kurz aus- und wieder einschalten.")
            return
        }
        change(if (pairPort > 0) "code" else "pair", problem ?: if (pairPort > 0)
            "Android-Code-Dialog offen lassen. Benachrichtigungen herunterziehen und bei PeekaView auf „Code eingeben“ tippen."
        else "In „Debugging über WLAN“ auf „Gerät über einen Kopplungscode koppeln“ tippen.")
    }

    private fun checkConnection() {
        if (connectPort == 0 || busy) return
        val port = connectPort
        busy = true
        change("checking", "Gespeicherte Kopplung wird geprüft …")
        work({ it.verifyLocal(port) }) { problem ->
            busy = false
            if (port != connectPort) { if (connectPort > 0) checkConnection() else waiting(); return@work }
            if (problem == null) {
                Prefs.rememberAdb(this, port)
                busy = true
                change("activating", "Fernsteuerung wird aktiviert …")
                val activation = try { ShellHelperService.activate(this, port) }
                catch (e: Exception) {
                    busy = false
                    change("error", e.message ?: "Fernsteuerung konnte nicht aktiviert werden.")
                    stopSelf()
                    return@work
                }
                activation.whenComplete { _, error -> main.post {
                    if (!running) return@post
                    busy = false
                    change(if (error == null) "ready" else "error", error?.message ?: "Fernsteuerung ist bereit.")
                    stopSelf()
                } }
            } else waiting("„Gerät über einen Kopplungscode koppeln“ öffnen. Code in der PeekaView-Benachrichtigung eingeben.")
        }
    }

    private fun pair(code: String, expectedPort: Int) {
        if (!running || busy) return
        if (pairPort == 0 || pairPort != expectedPort) {
            waiting("Der Code-Dialog wurde geschlossen oder erneuert. Öffne „Gerät über einen Kopplungscode koppeln“ erneut und verwende den neuen Code.")
            return
        }
        if (!Regex("[0-9]{6}").matches(code)) {
            waiting("Bitte die sechs Ziffern aus dem offenen Android-Code-Dialog eingeben.")
            return
        }
        busy = true
        val port = pairPort
        change("pairing", "Kopplung läuft. Android-Code-Dialog noch offen lassen …")
        work({ it.pairLocal(port, code) }) { problem ->
            busy = false
            if (problem != null) waiting("Code nicht akzeptiert. Code-Dialog offen lassen oder neu öffnen und den aktuellen sechsstelligen Code senden.")
            else {
                Prefs.markAdbPaired(this)
                paired = true
                if (connectPort > 0) checkConnection()
                else change("searching", "Gekoppelt. WLAN-Debugging eingeschaltet lassen …")
            }
        }
    }

    private fun work(action: (LocalAdb) -> Unit, done: (String?) -> Unit) {
        worker.execute {
            val problem = try {
                LocalAdb().use { adb ->
                    client = adb
                    try { action(adb) } finally { client = null }
                }
                null
            } catch (e: Exception) { e.message ?: e.javaClass.simpleName }
            main.post { if (running) done(problem) }
        }
    }

    private fun change(next: String, text: String) {
        phase = next
        message = text
        changed()
        if (running) getSystemService(NotificationManager::class.java).notify(ID, notification())
    }

    private fun changed() { for (listener in listeners) listener() }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(this, ID, Intent(this, ShareActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, ID + 1, Intent(this, AdbSetupService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
        val builder = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(if (phase == "code") "PeekaView – Kopplungscode eingeben" else "PeekaView – ADB einrichten")
            .setContentText(message).setStyle(Notification.BigTextStyle().bigText(message))
            .setContentIntent(open).setOnlyAlertOnce(true).setOngoing(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
        if (phase == "code" && pairPort > 0 && !busy) {
            val reply = PendingIntent.getService(this, ID + 2,
                Intent(this, AdbSetupService::class.java).setAction(PAIR).putExtra(PORT, pairPort),
                PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val action = Notification.Action.Builder(null, "Code eingeben", reply)
                .addRemoteInput(RemoteInput.Builder(CODE).setLabel("Sechsstelliger Kopplungscode").build())
                .setAllowGeneratedReplies(false)
            if (Build.VERSION.SDK_INT >= 31) action.setAuthenticationRequired(true)
            builder.addAction(action.build())
        }
        builder.addAction(Notification.Action.Builder(null, "Beenden", stop).build())
        return builder.build()
    }

    override fun onDestroy() {
        running = false
        if (phase == "activating") stopService(Intent(this, ShellHelperService::class.java))
        active = false
        main.removeCallbacksAndMessages(null)
        if (::discovery.isInitialized) discovery.close()
        client?.closeLocal()
        worker.shutdownNow()
        stopForeground(STOP_FOREGROUND_REMOVE)
        if (phase !in listOf("ready", "error")) {
            phase = "idle"
            message = "Einrichtung beendet. Du kannst sie jederzeit erneut starten."
        }
        changed()
        super.onDestroy()
    }

    companion object {
        const val STOP = "de.limtec.peekaview.ADB_SETUP_STOP"
        private const val PAIR = "de.limtec.peekaview.ADB_SETUP_PAIR"
        private const val PORT = "pair_port"
        private const val CODE = "pair_code"
        private const val CHANNEL = "adb_setup"
        private const val ID = 90_001
        @Volatile var active = false
            private set
        @Volatile private var phase = "idle"
        @Volatile private var message = "Handy einmalig koppeln."
        val listeners = CopyOnWriteArraySet<() -> Unit>()
        fun notificationsAllowed(context: android.content.Context): Boolean {
            val manager = context.getSystemService(NotificationManager::class.java)
            return manager.areNotificationsEnabled() && manager.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
        }
        fun state() = JSONObject().put("active", active).put("phase", phase).put("message", message)
    }
}

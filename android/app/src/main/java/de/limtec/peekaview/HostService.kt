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
    @Volatile private var armed = false
    private var publishedRoomStream = ""
    private var roomMonitor: java.util.concurrent.ScheduledFuture<*>? = null
    private var stopping = false
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance=this
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Freigabe läuft", NotificationManager.IMPORTANCE_LOW))
        manager.createNotificationChannel(NotificationChannel(CHANNEL_REQUESTS, "Beitrittsanfragen", NotificationManager.IMPORTANCE_HIGH))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // "Zulassen" / "Ablehnen" in a join request's notification
        if (intent?.action == ACTION_ADMIT) {
            intent.getStringExtra(EXTRA_PEER)?.let { host?.admit(it, intent.getBooleanExtra(EXTRA_ALLOW, false)) }
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_STOP) {
            if(host==null){armed=false;RoomCalls.disableAccess(this);stopSelf()}else stopCurrent()
            return START_NOT_STICKY
        }
        if(intent?.getBooleanExtra(EXTRA_ARM,false)==true){
            armed=true
            if(host==null) foreground(true)
            return START_NOT_STICKY
        }
        if (host != null) return START_NOT_STICKY
        val shell = intent?.getBooleanExtra(EXTRA_SHELL, false) == true
        foreground(shell)
        try {beginCapture(checkNotNull(intent))}
        catch(e:Exception){lastError=e.message ?: e.toString();stopCurrent()}
        return START_NOT_STICKY
    }

    private fun foreground(shell:Boolean) {
        // first the notification, then the capture (Android's order for media projection)
        val notification = running()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(ID, notification, if (shell && Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else if (shell) 0 else ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(ID, notification)
        }
    }
    private fun beginCapture(intent:Intent) {
        check(host==null){"Es läuft bereits eine Freigabe."}
        val shell=intent.getBooleanExtra(EXTRA_SHELL,false)
        val data = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_DATA, Intent::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_DATA)
        if (data == null && !shell) {
            stopSelf()
            error("Bildschirmfreigabe wurde nicht erlaubt.")
        }
        val (width, height) = screenSize()
            lateinit var capture:Host
            capture = Host(
                context = applicationContext,
                name = intent.getStringExtra(EXTRA_NAME) ?: "Android",
                projectionData = data,
                shellMode = shell,
                fixedCall = intent.getStringExtra("fixed_call"),
                automaticRoom = intent.getStringExtra("fixed_access_room"),
                width = width,
                height = height,
                onChange = ::changed,
                onEnded = { error ->
                    if (error != null) lastError = error
                    android.os.Handler(mainLooper).post { if(host===capture) stopCurrent() }
                },
            )
            host=capture
            capture.start()
            host?.takeIf{it.fixedCall!=null}?.let{roomMonitor=RoomCalls.monitor(this,it)}
        if(intent.hasExtra("fixed_access_room")) host?.setMode("control")
        getSystemService(NotificationManager::class.java).notify(ID,running())
        changed()
    }
    private fun stopCurrent() {
        clearCapture {
            if(instance===this){if(armed) foreground(true) else stopSelf()}
        }
    }
    private fun clearCapture(onStopped:()->Unit = {}) {
        if(stopping)return
        stopping=true
        roomMonitor?.cancel(false);roomMonitor=null
        val current=host
        current?.let{
            current.fixedCall?.let{if(current.link.isNotEmpty())RoomCalls.publish(this,it,null,current.link.substringAfter('#'));if(current.automaticRoom!=null)RoomCalls.endAutomatic(this,it)}
        }
        // A new share may use the helper only after the old capture has released it.
        val released=current?.stop() ?: java.util.concurrent.CompletableFuture.completedFuture(Unit)
        released.whenComplete{_,problem->android.os.Handler(mainLooper).post{
            if(host===current)host=null
            stopping=false;publishedRoomStream=""
            if(problem!=null)lastError=problem.message ?: "Die Freigabe konnte nicht vollständig beendet werden."
            val manager=getSystemService(NotificationManager::class.java)
            for(id in announced.values)manager.cancel(id)
            announced.clear();changed();onStopped()
        }}
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
        if(instance===this)instance=null
        clearCapture()
        super.onDestroy()
    }

    // join requests with a notification of their own: peer → notification id
    private val announced = HashMap<String, Int>()

    private fun changed() {
        host?.let{current -> current.fixedCall?.let{call ->
            if(current.link.isNotEmpty() && current.link!=publishedRoomStream){
                publishedRoomStream=current.link
                RoomCalls.publish(this,call,current.link.substringAfter('#'))
            }
        }}
        // every join request: a notification that rings, to let in or turn away right there
        val requests = host?.requests().orEmpty()
        val manager = getSystemService(NotificationManager::class.java)
        for (r in requests.filter { it.peer !in announced }) {
            val id = ID_REQUEST + (r.peer.hashCode() and 0xffff)
            announced[r.peer] = id
            manager.notify(
                id,
                Notification.Builder(this, CHANNEL_REQUESTS)
                    .setSmallIcon(R.drawable.ic_launcher_foreground)
                    .setContentTitle("${r.name.ifBlank { "Gast" }} möchte zusehen")
                    .setContentText("Zulassen oder ablehnen")
                    .setContentIntent(openShare())
                    .addAction(Notification.Action.Builder(null, "Ablehnen", admit(r.peer, false, id)).build())
                    .addAction(Notification.Action.Builder(null, "Zulassen", admit(r.peer, true, id + 1)).build())
                    .build(),
            )
        }
        // decided (here, in the app or by timeout): the notification goes
        for (peer in announced.keys.filter { p -> requests.none { it.peer == p } }) {
            manager.cancel(announced.remove(peer)!!)
        }
        for (l in listeners) l()
    }

    private fun admit(peer: String, allow: Boolean, code: Int): PendingIntent =
        PendingIntent.getService(
            this,
            code,
            Intent(this, HostService::class.java).setAction(ACTION_ADMIT).putExtra(EXTRA_PEER, peer).putExtra(EXTRA_ALLOW, allow),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun openShare(): PendingIntent =
        PendingIntent.getActivity(this, 0, Intent(this, ShareActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun running(): Notification =
        Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(if(host==null && armed) "PeekaView – Unbeaufsichtigter Zugriff bereit" else "PeekaView – Bildschirm wird geteilt")
            .setContentText(if(host==null && armed) "Nur ausgewählte Bildschirme und Anwendungen" else "Tippen für Link, Zuschauer und Beenden")
            .setContentIntent(openShare())
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, if(host==null && armed) "Deaktivieren" else "Beenden", PendingIntent.getService(this, 1,
                Intent(this, HostService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)).build())
            // a group of its own: Android would fold the join requests into it, and their
            // buttons would only show after unfolding
            .setGroup("share")
            .build()

    companion object {
        const val EXTRA_DATA = "data"
        const val EXTRA_NAME = "name"
        const val EXTRA_SHELL = "shell"
        const val EXTRA_ARM = "arm_access"
        @Volatile private var instance:HostService?=null
        fun isArmed()=instance?.armed==true
        fun stopCapture(){instance?.let{s->android.os.Handler(s.mainLooper).post{s.stopCurrent()}}}
        fun disarm(){instance?.let{s->android.os.Handler(s.mainLooper).post{s.armed=false;if(host==null)s.stopSelf()}}}
        fun startAutomatic(call:String,room:String):java.util.concurrent.CompletableFuture<Unit>{
            val result=java.util.concurrent.CompletableFuture<Unit>()
            val service=instance
            if(service==null || !service.armed){result.completeExceptionally(IllegalStateException("Unbeaufsichtigter Zugriff ist nicht bereit."));return result}
            android.os.Handler(service.mainLooper).post{
                if(result.isDone)return@post
                try{
                    check(service.armed && RoomCalls.access(service,room)!=null){"Zugriff wurde deaktiviert."}
                    service.beginCapture(Intent().putExtra(EXTRA_SHELL,true).putExtra("fixed_call",call).putExtra("fixed_access_room",room))
                    if(host?.accessCurrent()!=true){service.stopCurrent();error("Die Zugriffsauswahl wurde inzwischen geändert.")}
                    result.complete(Unit)
                }catch(e:Exception){
                    if(host?.fixedCall==call && host?.automaticRoom==room)service.stopCurrent()
                    lastError=e.message;result.completeExceptionally(e)
                }
            }
            return result
        }
        private const val ACTION_STOP = "de.limtec.peekaview.STOP"
        private const val ACTION_ADMIT = "de.limtec.peekaview.ADMIT"
        private const val EXTRA_PEER = "peer"
        private const val EXTRA_ALLOW = "allow"
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

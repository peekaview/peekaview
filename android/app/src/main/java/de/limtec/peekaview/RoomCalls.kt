package de.limtec.peekaview

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object RoomCalls {
    private val http = OkHttpClient.Builder().callTimeout(12,TimeUnit.SECONDS).followRedirects(false).build()
    private val work = Executors.newSingleThreadScheduledExecutor()
    private fun prefs(context:Context) = context.getSharedPreferences("fixed_rooms",Context.MODE_PRIVATE)
    fun access(context:Context,room:String):JSONObject? = JSONObject(prefs(context).getString("access","{}")!!).optJSONObject(room)?.takeIf{it.optBoolean("enabled")}
    fun anyAccess(context:Context):Boolean {
        val all=JSONObject(prefs(context).getString("access","{}")!!)
        return all.keys().asSequence().any{all.getJSONObject(it).optBoolean("enabled")}
    }
    fun accessOptions(context:Context,room:String):String = bridgeResult {
        check(ShellHelperService.link!=null){"Aktiviere zuerst den Shell-Helfer unter „Handy fernsteuern“."}
        val selected=access(context,room)
        JSONObject().put("screens",JSONArray().put(JSONObject().put("id","screen").put("name","Handybildschirm")))
            .put("apps",JSONArray(PhoneApps.installed(context).filter{it.shareable}.map{it.json()}))
            .put("selection",selected ?: JSONObject().put("screens",JSONArray()).put("apps",JSONArray()))
    }
    @Synchronized fun configureAccess(context:Context,room:String,value:String):String = bridgeResult {
        require(room.matches(Regex("[0-9a-f]{16}"))){"Ungültige Gruppe"}
        val selection=JSONObject(value)
        if(selection.getBoolean("enabled")){
            check(ShellHelperService.link!=null){"Aktiviere zuerst den Shell-Helfer."}
            check(AdbSetupService.notificationsAllowed(context)){"Erlaube zuerst PeekaView-Benachrichtigungen für Hintergrundanrufe."}
            val screens=selection.getJSONArray("screens")
            require(screens.length()<=1 && (screens.length()==0 || screens.getString(0)=="screen")){"Ungültiger Bildschirm"}
            val apps=selection.getJSONArray("apps");val ids=(0 until apps.length()).map{apps.getString(it)}.toSet()
            require(screens.length()>0 || ids.isNotEmpty()){"Wähle den Bildschirm oder mindestens eine Anwendung."}
            PhoneApps.selection(context,ids,screens.length()==0)
            request(context,"rooms/access",JSONObject().put("room",room).put("unattended",true))
        }
        val all=JSONObject(prefs(context).getString("access","{}")!!);all.put(room,selection)
        check(prefs(context).edit().putString("access",all.toString()).commit()){"Zugriffsauswahl konnte nicht gespeichert werden."}
        if(!selection.getBoolean("enabled")) request(context,"rooms/access",JSONObject().put("room",room).put("unattended",false))
        HostService.host?.takeIf{it.automaticRoom==room}?.fixedCall?.let{leave(context,it)}
        if(anyAccess(context)){
            ContextCompat.startForegroundService(context,Intent(context,HostService::class.java).putExtra(HostService.EXTRA_ARM,true))
            enable(context)
        }else HostService.disarm()
        JSONObject().put("ok",true)
    }
    fun bridgeResult(block:()->JSONObject):String = try{block().toString()}catch(e:Exception){JSONObject().put("error",e.message ?: "Zugriff konnte nicht eingerichtet werden.").toString()}
    @Synchronized fun disableAccess(context:Context){
        val all=JSONObject(prefs(context).getString("access","{}")!!)
        val rooms=all.keys().asSequence().toList()
        for(room in rooms)all.getJSONObject(room).put("enabled",false)
        check(prefs(context).edit().putString("access",all.toString()).commit()){"Zugriff konnte nicht deaktiviert werden."}
        for(room in rooms)work.execute{try{request(context,"rooms/access",JSONObject().put("room",room).put("unattended",false))}catch(e:Exception){android.util.Log.e("PeekaView","Zugriff deaktivieren: ${e.message}")}}
    }
    @Synchronized fun configure(context:Context,session:String) {
        if(session=="null"){clear(context);return}
        val data=JSONObject(session)
        val api=android.net.Uri.parse(data.getString("api"))
        require(api.scheme=="https" && api.host!=null && api.userInfo==null && api.query==null && api.fragment==null && data.getString("token").length==43){"Ungültiger Raumdienst"}
        prefs(context).edit().putString("session",session).apply()
    }
    @Synchronized private fun clear(context:Context,expected:String?=null) {
        if(expected!=null && prefs(context).getString("session",null)!=expected)return
        val saved=prefs(context).edit().clear().commit()
        HostService.host?.fixedCall?.let{leave(context,it)}
        HostService.disarm()
        context.stopService(Intent(context,RoomCallsService::class.java))
        check(saved){"Abmeldung konnte nicht gespeichert werden."}
    }
    fun request(context:Context,action:String,body:JSONObject?=null):JSONObject {
        val session=prefs(context).getString("session",null) ?: error("Raumdienst nicht verbunden")
        val config=JSONObject(session)
        val url=android.net.Uri.parse(config.getString("api")).buildUpon().appendQueryParameter("action",action).build().toString()
        val builder=Request.Builder().url(url).header("Authorization","Bearer ${config.getString("token")}")
        if(body!=null) builder.post(body.toString().toRequestBody("application/json".toMediaType()))
        http.newCall(builder.build()).execute().use { response ->
            val text=response.body?.string() ?: error("Raumdienst ohne Antwort")
            val data=JSONObject(text)
            if(response.code==401)clear(context,session)
            check(response.isSuccessful){data.optString("error","Raumdienst-Anfrage fehlgeschlagen")}
            return data
        }
    }
    fun publish(context:Context,call:String,stream:String?,previous:String?=null) = work.execute {
        try {request(context,"calls/stream",JSONObject().put("call",call).put("stream",stream ?: JSONObject.NULL).put("previous",previous ?: JSONObject.NULL))}
        catch(e:Exception){
            android.util.Log.e("PeekaView","Freigabe konnte nicht im Raum aktualisiert werden",e)
            if(stream!=null){HostService.lastError=e.message;leave(context,call)}
        }
    }
    fun monitor(context:Context,host:Host)=work.scheduleWithFixedDelay({
        val call=host.fixedCall ?: return@scheduleWithFixedDelay
        if(HostService.host!==host) return@scheduleWithFixedDelay
        try{
            val calls=request(context,"state").getJSONArray("calls")
            val joined=(0 until calls.length()).map{calls.getJSONObject(it)}.firstOrNull{it.getString("id")==call && it.getString("status")=="joined"}
            if(joined==null || (host.automaticRoom!=null && (!joined.optBoolean("unattended_allowed") || !host.accessCurrent()))) leave(context,call)
            else{request(context,"calls/heartbeat",JSONObject().put("call",call));val peers=joined.getJSONArray("participants");host.allowRoomMembers((0 until peers.length()).map{peers.getJSONObject(it).getString("id")}.toSet())}
        }catch(e:Exception){android.util.Log.e("PeekaView","Raum-Verbindung: ${e.message}")}
    },0,4,TimeUnit.SECONDS)
    fun enable(context:Context) {
        prefs(context).edit().putBoolean("enabled",true).apply()
        ContextCompat.startForegroundService(context,Intent(context,RoomCallsService::class.java))
    }
    fun restore(context:Context) {
        if(prefs(context).getBoolean("enabled",false)) enable(context)
        if(anyAccess(context) && ShellHelperService.link!=null) ContextCompat.startForegroundService(context,Intent(context,HostService::class.java).putExtra(HostService.EXTRA_ARM,true))
    }
    fun disable(context:Context) {prefs(context).edit().putBoolean("enabled",false).apply()}
    fun leave(context:Context,call:String) {
        if(HostService.host?.fixedCall==call) HostService.stopCapture()
    }
    fun endAutomatic(context:Context,call:String) = work.execute {
        try{request(context,"calls/leave",JSONObject().put("call",call))}catch(e:Exception){android.util.Log.e("PeekaView","Anruf beenden: ${e.message}")}
    }
    fun open(context:Context,call:String) {
        require(call.isEmpty() || call.matches(Regex("[0-9a-f]{16}")))
        context.startActivity(Intent(context,MainActivity::class.java).putExtra("fixed_call",call))
    }
}

/** Explicitly enabled reachability: Android does not keep a hidden activity alive for calls. */
class RoomCallsService:Service() {
    private val work=Executors.newSingleThreadScheduledExecutor()
    private val seen=mutableSetOf<String>()
    private val ringingNotices=mutableSetOf<Int>()
    private val pendingNotices=java.util.concurrent.ConcurrentHashMap.newKeySet<Int>()
    private lateinit var notifications:NotificationManager
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onCreate(){
        super.onCreate()
        notifications=getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel("room-calls","PeekaView-Anrufe",NotificationManager.IMPORTANCE_HIGH))
        notifications.createNotificationChannel(NotificationChannel("room-reachable","PeekaView erreichbar",NotificationManager.IMPORTANCE_LOW))
        val open=PendingIntent.getActivity(this,710,Intent(this,MainActivity::class.java).putExtra("fixed_call",""),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop=PendingIntent.getService(this,711,Intent(this,RoomCallsService::class.java).setAction("stop"),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification=Notification.Builder(this,"room-reachable").setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle("PeekaView ist für Anrufe erreichbar").setContentIntent(open).setOngoing(true)
            .addAction(Notification.Action.Builder(null,"Ausschalten",stop).build()).build()
        if(Build.VERSION.SDK_INT>=34) startForeground(710,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(710,notification)
        work.scheduleWithFixedDelay({poll()},0,6,TimeUnit.SECONDS)
    }
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        if(intent?.action=="stop"){RoomCalls.disable(this);stopSelf();return START_NOT_STICKY}
        return START_STICKY
    }
    private fun poll(){
        try {
            val state=RoomCalls.request(this,"state")
            val calls=state.getJSONArray("calls")
            val active=mutableSetOf<String>()
            val requests=mutableSetOf<Int>()
            val ringing=mutableSetOf<Int>()
            for(i in 0 until calls.length()){
                val call=calls.getJSONObject(i);val id=call.getString("id")
                if(call.getString("status")=="requested")seen.add("waiting:$id")
                if(call.getString("status")=="ringing")ringing.add(id.hashCode())
                if(call.getString("status")=="ringing" && id !in seen){
                    val room=call.getString("room")
                    if(call.optBoolean("unattended_allowed") && RoomCalls.access(this,room)!=null){
                        if(!HostService.isArmed() || HostService.host!=null)continue
                        check(ShellHelperService.link!=null){"Der Shell-Helfer ist nicht mehr aktiv."}
                        RoomCalls.request(this,"calls/auto-join",JSONObject().put("call",id))
                        val start=HostService.startAutomatic(id,room)
                        try{start.get(15,TimeUnit.SECONDS)}
                        catch(e:Exception){start.cancel(false);RoomCalls.endAutomatic(this,id);throw e}
                        seen.add(id)
                        active+=id
                        continue
                    }
                    seen.add(id)
                    val intent=Intent(this,MainActivity::class.java).putExtra("fixed_call",id)
                    val open=PendingIntent.getActivity(this,id.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                    val n=Notification.Builder(this,"room-calls").setSmallIcon(android.R.drawable.sym_call_incoming)
                        .setContentTitle("${call.getString("caller_name")} ruft an").setContentText(call.getString("name"))
                        .setCategory(Notification.CATEGORY_CALL).setContentIntent(open).setAutoCancel(true).setTimeoutAfter(45_000).build()
                    notifications.notify(id.hashCode(),n)
                }
                if(call.getString("status")=="joined"){
                    active+=id;notifications.cancel(id.hashCode())
                    if(seen.remove("waiting:$id")){
                        val notice="joined:$id".hashCode()
                        val open=PendingIntent.getActivity(this,notice,Intent(this,MainActivity::class.java).putExtra("fixed_call",id),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                        notifications.notify(notice,Notification.Builder(this,"room-calls").setSmallIcon(android.R.drawable.sym_call_incoming)
                            .setContentTitle("Du kannst teilnehmen").setContentText(call.getString("name"))
                            .setContentIntent(open).setAutoCancel(true).setTimeoutAfter(45_000).build())
                    }
                    val pending=call.optJSONArray("requests") ?: JSONArray()
                    for(j in 0 until pending.length()){
                        val person=pending.getJSONObject(j);val key="request:$id:${person.getString("id")}";val notice=key.hashCode()
                        requests+=notice
                        if(seen.add(key)){
                            val intent=Intent(this,MainActivity::class.java).putExtra("fixed_call",id)
                            val open=PendingIntent.getActivity(this,notice,intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                            notifications.notify(notice,Notification.Builder(this,"room-calls").setSmallIcon(android.R.drawable.sym_call_incoming)
                                .setContentTitle("${person.getString("person_name")} möchte teilnehmen")
                                .setContentText("Zum Gespräch in „${call.getString("name")}“ zulassen?")
                                .setContentIntent(open).setAutoCancel(true).setTimeoutAfter(300_000).build())
                        }
                    }
                    val host=HostService.host
                    if(host?.fixedCall==id){
                        val members=call.getJSONArray("participants")
                        host.allowRoomMembers((0 until members.length()).map{members.getJSONObject(it).getString("id")}.toSet())
                    }
                }
            }
            for(notice in ringingNotices-ringing)notifications.cancel(notice)
            ringingNotices.clear();ringingNotices.addAll(ringing)
            for(notice in pendingNotices-requests)notifications.cancel(notice)
            pendingNotices.clear();pendingNotices.addAll(requests)
            HostService.host?.fixedCall?.takeIf{it !in active}?.let{RoomCalls.leave(this,it)}
        } catch(e:Exception){android.util.Log.e("PeekaView","Raumanrufe: ${e.message}")}
    }
    override fun onDestroy(){work.shutdownNow();for(notice in ringingNotices)notifications.cancel(notice);for(notice in pendingNotices)notifications.cancel(notice);super.onDestroy()}
}

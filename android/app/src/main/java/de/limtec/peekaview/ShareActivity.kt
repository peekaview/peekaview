package de.limtec.peekaview

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.provider.Settings
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.core.content.FileProvider
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import org.json.JSONArray
import org.json.JSONObject

/**
 * Sharing this phone's screen: name, start (Android asks for the screen capture), then the link,
 * what viewers may do, who watches and the join requests. The share itself runs in [HostService].
 */
class ShareActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var starting = false
    private var preparing = false
    private var error: String? = null
    private var pendingName = "Android"
    private var pendingStart = false
    private var pendingPort = 0
    private var helperRequested = false
    private var adbSettingsOpen = false
    private val adbSettings = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { adbSettingsOpen=false }
    private var startGeneration = 0
    private val setupHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var fixedCall: String? = null
    private var openedFixedCall: String? = null
    private val askRoomNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if(granted) RoomCalls.enable(this)
    }

    private val capture = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if(!starting)return@registerForActivityResult
        val data = result.data
        if (result.resultCode != RESULT_OK || data == null) {
            starting = false
            error = "Ohne Bildschirmaufnahme geht es nicht."
            update()
            return@registerForActivityResult
        }
        val service = Intent(this, HostService::class.java)
            .putExtra(HostService.EXTRA_DATA, data)
            .putExtra(HostService.EXTRA_NAME, pendingName)
            .putExtra("fixed_call",fixedCall)
        ContextCompat.startForegroundService(this, service)
    }

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { if(starting)askCapture() }
    private val askSetupNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if(!pendingStart)return@registerForActivityResult
        if (granted) beginAdbSetup() else {
            pendingStart=false;starting=false;helperRequested=false
            error = "Erlaube PeekaView Benachrichtigungen, damit du den Kopplungscode direkt beim geöffneten Android-Dialog eingeben kannst."
            update()
        }
    }

    // shared clipboard: files from the phone
    private val pickFiles = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val host = HostService.host ?: return@registerForActivityResult
        for (uri in uris) {
            var name = "Datei"
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) name = c.getString(0) ?: name }
            val mime = contentResolver.getType(uri) ?: "application/octet-stream"
            val preview = if (mime.startsWith("image/")) imagePreview(uri) else null
            host.clipAdd(name, mime, null, preview) { out -> contentResolver.openInputStream(uri)?.use { it.copyTo(out) } }
        }
    }

    /** A small JPEG of a picture for the list (≤ 48 KB, as the desktop sends them). */
    private fun imagePreview(uri: android.net.Uri): String? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= 240 && bounds.outHeight / (sample * 2) >= 240) sample *= 2
        val bitmap = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return null
        val scale = minOf(1.0, 240.0 / maxOf(bitmap.width, bitmap.height))
        val small = Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true)
        val out = java.io.ByteArrayOutputStream()
        small.compress(Bitmap.CompressFormat.JPEG, 70, out)
        if (out.size() > 48_000) null else "data:image/jpeg;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
    }.getOrNull()

    /** A clipboard item as a file other apps can read (with its real name). */
    private fun shareable(id: String): Pair<android.net.Uri, String>? {
        val item = HostService.host?.clipItems()?.firstOrNull { it.id == id } ?: return null
        val dir = java.io.File(cacheDir, "share/$id").apply { mkdirs() }
        val file = java.io.File(dir, item.name.replace('/', '_'))
        if (!file.exists()) item.file.copyTo(file, true)
        return FileProvider.getUriForFile(this, "de.limtec.peekaview.files", file) to item.mime
    }

    private val listener: () -> Unit = { runOnUiThread {
        starting = false; update()
        val current=HostService.host
        if(current?.fixedCall!=null && current.link.isNotEmpty() && openedFixedCall!=current.fixedCall){
            openedFixedCall=current.fixedCall
            RoomCalls.open(this,current.fixedCall)
        }
    } }
    private val adbListener: () -> Unit = { runOnUiThread {
        if(pendingStart && ShellHelperService.link!=null){closeAdbSettings();continueShare()}
        else if(pendingStart && pendingPort==0 && !AdbSetupService.active && AdbSetupService.state().optString("phase") in listOf("idle","error")){
            pendingStart=false;starting=false;helperRequested=false
            error=if(AdbSetupService.state().optString("phase")=="error")AdbSetupService.state().optString("message") else null
        }
        update()
    } }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        fixedCall=if(savedInstanceState?.containsKey("pending_call")==true)savedInstanceState.getString("pending_call") else intent.getStringExtra("fixed_call")
        pendingName=savedInstanceState?.getString("pending_name") ?: "Android"
        pendingPort=savedInstanceState?.getInt("pending_port") ?: 0
        pendingStart=savedInstanceState?.getBoolean("pending_share") == true && HostService.host==null
        adbSettingsOpen=savedInstanceState?.getBoolean("adb_settings_open") == true
        RoomCalls.restore(this)
        web = WebView(this)
        // edge to edge (Android 15): the page sits between status and navigation bar
        val frame = android.widget.FrameLayout(this).apply { addView(web) }
        setContentView(frame)
        ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        val assets = Assets.loader(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = request.url.host != Assets.HOST
        }
        web.addJavascriptInterface(Bridge(), "PeekaViewHost")
        web.loadUrl("${Assets.UI}share.html")
        HostService.listeners += listener
        AdbSetupService.listeners += adbListener
        ShellHelperService.listeners += adbListener
        // The lifecycle reaches RESUMED after Android's onResume/onPostResume callbacks.
        lifecycle.addObserver(LifecycleEventObserver { _,event ->
            if(event==Lifecycle.Event.ON_RESUME && pendingStart){
                if(!Prefs.shellMode(this) || ShellHelperService.link!=null)continueShare()
                else if(!AdbSetupService.active)prepareHelper()
                update()
            }
        })
        if(pendingStart && ShellHelperService.link!=null)closeAdbSettings()
    }

    override fun onResume() {
        super.onResume()
        // e.g. back from the accessibility or overlay settings
        HostService.host?.showOverlay()
        update()
    }

    override fun onSaveInstanceState(outState:Bundle){
        outState.putBoolean("pending_share",pendingStart)
        outState.putString("pending_name",pendingName)
        outState.putString("pending_call",fixedCall)
        outState.putInt("pending_port",pendingPort)
        outState.putBoolean("adb_settings_open",adbSettingsOpen)
        super.onSaveInstanceState(outState)
    }

    override fun onNewIntent(intent:Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if(pendingStart && !intent.hasExtra("fixed_call")){continueShare();return}
        cancelStart()
        fixedCall=intent.getStringExtra("fixed_call")
        openedFixedCall=null
        web.evaluateJavascript("window.pvShareInCall && window.pvShareInCall()", null)
    }

    override fun onDestroy() {
        setupHandler.removeCallbacksAndMessages(null)
        if(isFinishing)cancelStart()
        HostService.listeners -= listener
        AdbSetupService.listeners -= adbListener
        ShellHelperService.listeners -= adbListener
        super.onDestroy()
    }

    private fun askCapture() {
        if (Prefs.shellMode(this)) {
            ContextCompat.startForegroundService(this, Intent(this, HostService::class.java)
                .putExtra(HostService.EXTRA_SHELL, true).putExtra(HostService.EXTRA_NAME, pendingName)
                .putExtra("fixed_call",fixedCall))
            return
        }
        val projection = getSystemService(MediaProjectionManager::class.java)
        capture.launch(projection.createScreenCaptureIntent())
    }

    private fun state(): String {
        val host = HostService.host
        val o = JSONObject()
            .put("sharing", host != null)
            .put("fixedCall", host?.fixedCall ?: fixedCall ?: JSONObject.NULL)
            .put("starting", starting || preparing || pendingStart)
            .put("error", error ?: HostService.lastError)
            .put("controlEnabled", ControlService.enabled(this))
            .put("shell", host?.shellMode ?: Prefs.shellMode(this))
            .put("shellSupported", Build.VERSION.SDK_INT >= 30)
            .put("appSharingSupported", Build.VERSION.SDK_INT >= 34)
            .put("appsOnly", host?.appsOnly ?: Prefs.appsOnly(this))
            .put("appVisible", host?.appVisible ?: true)
            .put("adbSetup", AdbSetupService.state())
            .put("adbPaired", Prefs.adbPaired(this))
            .put("helperReady", ShellHelperService.link != null)
            .put("notificationsAllowed", AdbSetupService.notificationsAllowed(this))
            .put("overlayAllowed", Overlay.allowed(this))
        if (host != null) {
            o.put("link", host.link).put("mode", host.mode)
            o.put("viewers", JSONArray(host.viewers().map { JSONObject().put("name", it.name).put("color", it.color) }))
            o.put("requests", JSONArray(host.requests().map { JSONObject().put("peer", it.peer).put("name", it.name).put("color", it.color) }))
            o.put("clip", JSONArray(host.clipItems().reversed().map { it.meta().put("by", host.nameOf(it.from)).put("preview", it.preview ?: JSONObject.NULL) }))
        }
        return o.toString()
    }

    private fun update() {
        if (::web.isInitialized) web.evaluateJavascript("window.pvHostUpdate && window.pvHostUpdate(${state()})", null)
    }

    private fun toast(text: String) = android.widget.Toast.makeText(this, text, android.widget.Toast.LENGTH_SHORT).show()

    private fun beginAdbSetup() {
        if(!pendingStart)return
        error = null
        if(pendingPort>0){
            val generation=startGeneration
            try {
                ShellHelperService.activate(this,pendingPort).whenComplete{_,problem->runOnUiThread{
                    if(isDestroyed || generation!=startGeneration || !pendingStart)return@runOnUiThread
                    if(problem!=null){pendingStart=false;starting=false;helperRequested=false;error=problem.cause?.message ?: problem.message}
                    else continueShare()
                    update()
                }}
            }catch(e:Exception){pendingStart=false;starting=false;helperRequested=false;error=e.message;update()}
            return
        }
        ContextCompat.startForegroundService(this, Intent(this, AdbSetupService::class.java))
        update()
        val generation=startGeneration
        setupHandler.postDelayed({
            if(!isDestroyed && lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED) && generation==startGeneration && pendingStart && ShellHelperService.link==null &&
                AdbSetupService.state().optString("phase") in listOf("searching","pair","code"))openAdbSettings()
        },2000)
    }

    private fun prepareHelper(){
        if(ShellHelperService.link!=null){continueShare();return}
        if(helperRequested)return
        helperRequested=true
        if(Build.VERSION.SDK_INT>=33 && ContextCompat.checkSelfPermission(this,Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED){
            askSetupNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }else beginAdbSetup()
    }

    private fun continueShare(){
        if(!pendingStart || !lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED))return
        if(Prefs.shellMode(this) && ShellHelperService.link==null)return
        if(HostService.host!=null){pendingStart=false;starting=false;helperRequested=false;error="Es läuft bereits eine Freigabe.";update();return}
        pendingStart=false
        helperRequested=false
        starting=true
        HostService.lastError=null
        update()
        if(Build.VERSION.SDK_INT>=33 && ContextCompat.checkSelfPermission(this,Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED){
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }else askCapture()
    }

    private fun cancelStart(){
        if(starting && HostService.host==null)stopService(Intent(this,HostService::class.java))
        if(pendingStart && pendingPort>0 && ShellHelperService.link==null)stopService(Intent(this,ShellHelperService::class.java))
        startGeneration++
        pendingStart=false;starting=false;preparing=false;helperRequested=false;adbSettingsOpen=false
        setupHandler.removeCallbacksAndMessages(null)
        stopService(Intent(this,AdbSetupService::class.java))
    }

    private fun openAdbSettings() {
        if(adbSettingsOpen)return
        // Android 17 redacts DEVELOPMENT_SETTINGS_ENABLED to 0 for third-party apps.
        // Open the public settings action; an actual discovered endpoint confirms the setup.
        try {
            adbSettingsOpen=true
            adbSettings.launch(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))
        }
        catch (_: android.content.ActivityNotFoundException) {
            adbSettingsOpen=false
            error = "Öffne Androids Einstellungen selbst: „Über das Telefon“ zum Aktivieren der Entwickleroptionen, danach „System“ → „Entwickleroptionen“ → „Debugging über WLAN“."
            update()
        }
    }

    private fun closeAdbSettings(){
        if(!adbSettingsOpen || isDestroyed || isFinishing)return
        adbSettingsOpen=false
        // Return through our own task so nested Settings pages close along with their parent.
        startActivity(Intent(this,ShareActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }

    private fun clipShareNow(id: String) {
        val (uri, mime) = shareable(id) ?: return
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Teilen"))
    }

    inner class Bridge {
        @JavascriptInterface fun configureRooms(session:String) = RoomCalls.configure(this@ShareActivity,session)
        @JavascriptInterface fun roomAccessOptions(room:String):String = RoomCalls.accessOptions(this@ShareActivity,room)
        @JavascriptInterface fun configureRoomAccess(room:String,selection:String):String = RoomCalls.configureAccess(this@ShareActivity,room,selection)
        @JavascriptInterface fun rooms(call:String) = runOnUiThread {RoomCalls.open(this@ShareActivity,call)}
        @JavascriptInterface fun shareInCall(call:String) = runOnUiThread {
            require(call.matches(Regex("[0-9a-f]{16}")))
            startActivity(Intent(this@ShareActivity,ShareActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT).putExtra("fixed_call",call))
        }
        @JavascriptInterface fun shareViaLink() = runOnUiThread { fixedCall=null; update() }
        @JavascriptInterface fun enableRoomCalls() = runOnUiThread {
            if(Build.VERSION.SDK_INT>=33 && ContextCompat.checkSelfPermission(this@ShareActivity,Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED) askRoomNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            else RoomCalls.enable(this@ShareActivity)
        }
        @JavascriptInterface fun leaveRoom(call:String) = RoomCalls.leave(this@ShareActivity,call)
        @JavascriptInterface
        fun state(): String = this@ShareActivity.state()

        @JavascriptInterface
        fun keepLink(): Boolean = Prefs.keepLink(this@ShareActivity)

        @JavascriptInterface
        fun hasPin(): Boolean = Prefs.pin(this@ShareActivity) != null

        @JavascriptInterface
        fun shellSettings(): String = JSONObject().put("enabled", Prefs.shellMode(this@ShareActivity))
            .put("port", Prefs.adbPort(this@ShareActivity)).put("appsOnly", Prefs.appsOnly(this@ShareActivity)).put("apps", PhoneApps.choices(this@ShareActivity)).toString()

        @JavascriptInterface
        fun pair(port: Int, code: String) {
            Thread {
                val problem = try {
                    LocalAdb().use { it.pairLocal(port, code) }
                    Prefs.markAdbPaired(this@ShareActivity)
                    null
                } catch (e: Exception) {
                    "Kopplung fehlgeschlagen: ${e.message}"
                }
                runOnUiThread {
                    web.evaluateJavascript("window.pvPairResult(${JSONObject.quote(problem ?: "")})", null)
                }
            }.start()
        }

        @JavascriptInterface
        fun debuggingSettings() = runOnUiThread { openAdbSettings() }

        @JavascriptInterface
        fun deviceInfoSettings() = runOnUiThread { startActivity(Intent(Settings.ACTION_DEVICE_INFO_SETTINGS)) }

        @JavascriptInterface
        fun adbSetupStop() = runOnUiThread { cancelStart();error=null;update() }

        @JavascriptInterface
        fun notificationSettings() = runOnUiThread {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        }

        @JavascriptInterface
        fun setSharedApps(only: Boolean, apps: String) {
            fun result(problem: String?) = runOnUiThread {
                if (!isFinishing) {
                    web.evaluateJavascript("window.pvAppsResult(${JSONObject.quote(problem ?: "")})", null)
                    update()
                }
            }
            Thread {
                try {
                    val json = JSONArray(apps)
                    val ids = (0 until json.length()).map { json.getString(it) }.toSet()
                    val selected = PhoneApps.selection(this@ShareActivity, ids, only)
                    val current = HostService.host
                    if (current != null) current.setApps(selected, only, ::result)
                    else { Prefs.setAppSelection(this@ShareActivity, ids, only); result(null) }
                } catch (e: Exception) { result(e.message ?: "App-Auswahl konnte nicht geändert werden.") }
            }.start()
        }

        /** Prepare one share; the same action continues after Android's setup step. */
        @JavascriptInterface
        fun start(name: String, keep: Boolean, usePin: Boolean, pin: String, shell: Boolean, port: Int, apps: String, appsOnly: Boolean) = runOnUiThread {
            if(starting || preparing || pendingStart || HostService.host!=null)return@runOnUiThread
            val generation=++startGeneration
            val call=fixedCall
            preparing=true;helperRequested=false;error=null;HostService.lastError=null;update()
            Thread {
                val problem=try {
                    val selected=JSONArray(apps)
                    val allowed=(0 until selected.length()).map{selected.getString(it)}.toSet()
                    require(!appsOnly || shell){"Wähle „Handy fernsteuern“, um nur ausgewählte Apps zu zeigen."}
                    PhoneApps.selection(this@ShareActivity,allowed,appsOnly)
                    Prefs.setShell(this@ShareActivity,shell,port,allowed)
                    Prefs.setAppSelection(this@ShareActivity,allowed,appsOnly)
                    if(call==null){
                        when {
                            !usePin->Prefs.setPin(this@ShareActivity,null)
                            pin.isNotBlank()->Prefs.setPin(this@ShareActivity,pin)
                            Prefs.pin(this@ShareActivity)==null->error("Bitte eine PIN eingeben.")
                        }
                        Prefs.setKeepLink(this@ShareActivity,keep)
                    }
                    null
                }catch(e:Exception){e.message ?: "Die Freigabe konnte nicht vorbereitet werden."}
                runOnUiThread {
                    if(isDestroyed || generation!=startGeneration)return@runOnUiThread
                    preparing=false;starting=false
                    if(problem!=null){error=problem;update();return@runOnUiThread}
                    pendingName=name.take(32).ifBlank{"Android"}
                    pendingPort=port;pendingStart=true
                    if(shell)prepareHelper() else continueShare()
                    update()
                }
            }.start()
        }

        @JavascriptInterface
        fun stop() = runOnUiThread { HostService.stopCapture() }

        @JavascriptInterface
        fun admit(peer: String, allow: Boolean) {
            HostService.host?.admit(peer, allow)
        }

        @JavascriptInterface
        fun setMode(mode: String) {
            HostService.host?.setMode(mode)
        }

        @JavascriptInterface
        fun copyLink() = runOnUiThread {
            val link = HostService.host?.link ?: return@runOnUiThread
            getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("PeekaView", link))
        }

        @JavascriptInterface
        fun sendLink() = runOnUiThread {
            val link = HostService.host?.link ?: return@runOnUiThread
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link), "Link senden"))
        }

        /** Shared clipboard: the text in the phone's clipboard. */
        @JavascriptInterface
        fun clipPaste() = runOnUiThread {
            val text = getSystemService(ClipboardManager::class.java).primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this@ShareActivity)?.toString()
            if (text.isNullOrEmpty()) return@runOnUiThread toast("Die Zwischenablage des Handys ist leer.")
            HostService.host?.clipAdd("Text", "text/plain", text.take(600), null) { it.write(text.toByteArray()) }
        }

        @JavascriptInterface
        fun clipFile() = runOnUiThread { pickFiles.launch(arrayOf("*/*")) }

        /** Into the phone's clipboard: text as text, everything else as a file. */
        @JavascriptInterface
        fun clipCopy(id: String) = runOnUiThread {
            val item = HostService.host?.clipItems()?.firstOrNull { it.id == id } ?: return@runOnUiThread
            val clipboard = getSystemService(ClipboardManager::class.java)
            if (item.mime.startsWith("text/") && item.size < 1_000_000) {
                clipboard.setPrimaryClip(ClipData.newPlainText(item.name, item.file.readText()))
            } else {
                val (uri, _) = shareable(id) ?: return@runOnUiThread
                clipboard.setPrimaryClip(ClipData.newUri(contentResolver, item.name, uri))
            }
            toast("In die Zwischenablage kopiert")
        }

        /** Into the phone's downloads. */
        @JavascriptInterface
        fun clipSave(id: String) = runOnUiThread {
            val item = HostService.host?.clipItems()?.firstOrNull { it.id == id } ?: return@runOnUiThread
            if (Build.VERSION.SDK_INT < 29) return@runOnUiThread clipShareNow(id)
            val values = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, item.name)
                put(android.provider.MediaStore.Downloads.MIME_TYPE, item.mime)
            }
            val uri = contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return@runOnUiThread
            contentResolver.openOutputStream(uri)?.use { out -> item.file.inputStream().use { it.copyTo(out) } }
            toast("In „Downloads“ gespeichert")
        }

        @JavascriptInterface
        fun clipShare(id: String) = runOnUiThread { clipShareNow(id) }

        @JavascriptInterface
        fun clipRemove(id: String) {
            HostService.host?.clipRemove(id)
        }

        /** Watching a share instead: the viewer's start page with the rooms joined before. */
        @JavascriptInterface
        fun watch() = runOnUiThread { startActivity(Intent(this@ShareActivity, MainActivity::class.java)) }

        /** "Über anderen Apps einblenden" for viewers' pointers and drawings on the phone. */
        @JavascriptInterface
        fun overlaySettings() = runOnUiThread {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:$packageName")))
        }

        @JavascriptInterface
        fun controlSettings() = runOnUiThread {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
    }
}

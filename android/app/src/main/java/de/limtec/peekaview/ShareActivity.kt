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
import org.json.JSONArray
import org.json.JSONObject

/**
 * Sharing this phone's screen: name, start (Android asks for the screen capture), then the link,
 * what viewers may do, who watches and the join requests. The share itself runs in [HostService].
 */
class ShareActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var starting = false
    private var error: String? = null
    private var pendingName = "Android"

    private val capture = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
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
        ContextCompat.startForegroundService(this, service)
    }

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { askCapture() }

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

    private val listener: () -> Unit = { runOnUiThread { starting = false; update() } }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        Nsite.listeners += listener
        // the viewer site for this phone's share links, kept up to date over Nostr
        if (Prefs.site(this).isEmpty()) Nsite.publishIfNeeded(this)
    }

    override fun onResume() {
        super.onResume()
        // e.g. back from the accessibility or overlay settings
        HostService.host?.showOverlay()
        update()
    }

    override fun onDestroy() {
        HostService.listeners -= listener
        Nsite.listeners -= listener
        super.onDestroy()
    }

    private fun askCapture() {
        val projection = getSystemService(MediaProjectionManager::class.java)
        capture.launch(projection.createScreenCaptureIntent())
    }

    private fun state(): String {
        val host = HostService.host
        val o = JSONObject()
            .put("sharing", host != null)
            .put("starting", starting)
            .put("error", error ?: HostService.lastError)
            .put("controlEnabled", ControlService.enabled(this))
            .put("overlayAllowed", Overlay.allowed(this))
            .put("nsite", JSONObject().put("url", Nsite.url(this)).put("state", Nsite.state.name.lowercase()).put("error", Nsite.error))
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

    private fun clipShareNow(id: String) {
        val (uri, mime) = shareable(id) ?: return
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Teilen"))
    }

    inner class Bridge {
        @JavascriptInterface
        fun state(): String = this@ShareActivity.state()

        @JavascriptInterface
        fun site(): String = Prefs.site(this@ShareActivity)

        @JavascriptInterface
        fun keepLink(): Boolean = Prefs.keepLink(this@ShareActivity)

        @JavascriptInterface
        fun hasPin(): Boolean = Prefs.pin(this@ShareActivity) != null

        /** `usePin`: with the PIN (`pin` new, or empty = keep the one set). */
        @JavascriptInterface
        fun start(name: String, site: String, keep: Boolean, usePin: Boolean, pin: String) {
            runOnUiThread {
                starting = true
                error = null
                update()
            }
            // the PIN's key takes a moment (PBKDF2) – not on the UI thread
            Thread {
                val problem = try {
                    Prefs.setSite(this@ShareActivity, site)
                    when {
                        !usePin -> Prefs.setPin(this@ShareActivity, null)
                        pin.isNotBlank() -> Prefs.setPin(this@ShareActivity, pin)
                        Prefs.pin(this@ShareActivity) == null -> throw IllegalArgumentException("Bitte eine PIN eingeben.")
                    }
                    null
                } catch (e: IllegalArgumentException) {
                    e.message
                }
                runOnUiThread { begin(name, site, keep, problem) }
            }.start()
        }

        private fun begin(name: String, site: String, keep: Boolean, problem: String?) {
            if (problem != null) {
                starting = false
                error = problem
                update()
                return
            }
            Prefs.setKeepLink(this@ShareActivity, keep)
            pendingName = name.take(32).ifBlank { "Android" }
            // the phone's own viewer site over Nostr – or, with an own website, not anymore
            if (site.isBlank()) Nsite.publishIfNeeded(this@ShareActivity) else Nsite.unpublish(this@ShareActivity)
            starting = true
            error = null
            HostService.lastError = null
            update()
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this@ShareActivity, Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                askCapture()
            }
        }

        @JavascriptInterface
        fun stop() = runOnUiThread { stopService(Intent(this@ShareActivity, HostService::class.java)) }

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

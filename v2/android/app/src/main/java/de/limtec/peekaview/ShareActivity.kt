package de.limtec.peekaview

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
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
        }
        return o.toString()
    }

    private fun update() {
        if (::web.isInitialized) web.evaluateJavascript("window.pvHostUpdate && window.pvHostUpdate(${state()})", null)
    }

    inner class Bridge {
        @JavascriptInterface
        fun state(): String = this@ShareActivity.state()

        @JavascriptInterface
        fun site(): String = Prefs.site(this@ShareActivity)

        @JavascriptInterface
        fun start(name: String, site: String) = runOnUiThread {
            pendingName = name.take(32).ifBlank { "Android" }
            try {
                Prefs.setSite(this@ShareActivity, site)
            } catch (e: IllegalArgumentException) {
                error = e.message
                update()
                return@runOnUiThread
            }
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

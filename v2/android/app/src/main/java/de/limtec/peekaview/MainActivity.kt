package de.limtec.peekaview

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Watching: the viewer website, bundled with the app (the same viewer as in browsers and the
 * desktop app). Room links (`peekaview://join?room=…`, sent by the website when the app is
 * installed) open here; the start page lists the rooms joined before and starts a share of this
 * phone's screen.
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var pendingPermission: PermissionRequest? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val askMicrophone = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        if (granted) request.grant(request.resources) else request.deny()
    }

    private val pickFiles = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        fileCallback?.onReceiveValue(uris.toTypedArray())
        fileCallback = null
    }

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
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val assets = Assets.loader(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            // only the bundled pages – anything else goes to the browser
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == Assets.HOST) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // voice chat: the microphone, after Android's own permission
            override fun onPermissionRequest(request: PermissionRequest) {
                if (request.origin.host != Assets.HOST) return request.deny()
                if (!request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) return request.deny()
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                } else {
                    pendingPermission = request
                    askMicrophone.launch(Manifest.permission.RECORD_AUDIO)
                }
            }

            // shared clipboard: files from the phone
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                pickFiles.launch(arrayOf("*/*"))
                return true
            }
        }
        web.addJavascriptInterface(Bridge(), "PeekaViewApp")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState == null) open(intent) else web.restoreState(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        open(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    /** The start page, or a room from a link. */
    private fun open(intent: Intent?) {
        val room = intent?.data?.takeIf { it.scheme == "peekaview" && it.host == "join" }?.getQueryParameter("room")?.takeIf(::valid)
        // "app=1": joins right away when the name is known, never sends the link on to the app
        val url = "${Assets.ROOT}index.html?app=1" + (room?.let { "#$it" } ?: "")
        web.loadUrl(url)
    }

    private fun valid(room: String) = room.length in 1..200 && room.all { it.isLetterOrDigit() || it in "-_." }

    /** For the bundled pages only (no other page is ever loaded). */
    inner class Bridge {
        /** Shares this phone's screen. */
        @JavascriptInterface
        fun share() {
            runOnUiThread { startActivity(Intent(this@MainActivity, ShareActivity::class.java)) }
        }
    }
}

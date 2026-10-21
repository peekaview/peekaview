package de.limtec.peekaview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * Viewers' pointers and drawings on the phone itself: a transparent layer above all apps that
 * lets every touch through. Needs "Über anderen Apps einblenden" (asked for in the share screen).
 * The layer is part of the screen capture, so viewers see the drawings in the picture, too.
 */
class Overlay(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    private var ready = false
    private val pending = mutableListOf<String>()

    /** Shows the layer if allowed. */
    @SuppressLint("SetJavaScriptEnabled")
    fun show() = main.post {
        if (web != null || !allowed(context)) return@post
        val assets = Assets.loader(context)
        val view = WebView(context).apply {
            setBackgroundColor(Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)

                override fun onPageFinished(view: WebView, url: String) {
                    ready = true
                    for (m in pending) view.evaluateJavascript("window.pv && window.pv($m)", null)
                    pending.clear()
                }
            }
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        )
        if (Build.VERSION.SDK_INT >= 28) params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        // Android 12+: touches pass through only if the layer is not too opaque
        if (Build.VERSION.SDK_INT >= 31) params.alpha = 0.8f
        runCatching { context.getSystemService(WindowManager::class.java).addView(view, params) }.onSuccess {
            web = view
            view.loadUrl("${Assets.UI}overlay.html")
        }
    }

    fun hide() = main.post {
        web?.let { runCatching { context.getSystemService(WindowManager::class.java).removeView(it) }; it.destroy() }
        web = null
        ready = false
        pending.clear()
    }

    /** A message for the annotations (pointer, drawing, participants, state). */
    fun handle(message: JSONObject) {
        val json = message.toString()
        main.post {
            val view = web ?: return@post
            if (ready) view.evaluateJavascript("window.pv && window.pv($json)", null) else pending += json
        }
    }

    companion object {
        fun allowed(context: Context) = Settings.canDrawOverlays(context)
    }
}

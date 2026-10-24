package de.limtec.peekaview

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader

/**
 * The bundled pages under a secure https origin (WebRTC, the microphone and Web Crypto need
 * one): https://appassets.androidplatform.net/assets/… serves the app's assets.
 */
object Assets {
    const val HOST = "appassets.androidplatform.net"
    const val ROOT = "https://$HOST/assets/web/"
    const val UI = "https://$HOST/assets/ui/"

    fun loader(context: Context): WebViewAssetLoader =
        WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/") { path -> serve(context, path) }
            .build()

    // JavaScript modules must come with a JavaScript type (also .mjs, which Android does not know)
    private val types = mapOf(
        "html" to "text/html",
        "js" to "text/javascript",
        "mjs" to "text/javascript",
        "css" to "text/css",
        "json" to "application/json",
        "webmanifest" to "application/manifest+json",
        "svg" to "image/svg+xml",
        "png" to "image/png",
        "wasm" to "application/wasm",
    )

    private fun serve(context: Context, path: String): WebResourceResponse? {
        if (path.contains("..")) return null
        return runCatching {
            val stream = context.assets.open(path)
            val type = types[path.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"
            WebResourceResponse(type, if (type.startsWith("text") || type.endsWith("json")) "utf-8" else null, stream)
        }.getOrNull()
    }
}

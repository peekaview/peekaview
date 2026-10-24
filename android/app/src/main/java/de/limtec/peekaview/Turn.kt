package de.limtec.peekaview

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.PeerConnection
import java.util.concurrent.TimeUnit

/**
 * TURN from PeekaView's service (`?action=turn`): short-lived credentials derived from the coturn
 * secret that only the service knows – nobody sets up a TURN server, and no secret is in the app.
 * The presenter hands them to its viewers inside the end-to-end encrypted signaling.
 */
object Turn {
    const val SERVICE = "https://peekaview.devxpert.de/api.php"
    val STUN = listOf("stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478")
    /** fetched credentials serve shares that start within an hour (they stay valid much longer) */
    private const val FRESH_MS = 3_600_000L
    private val http = OkHttpClient.Builder().callTimeout(4, TimeUnit.SECONDS).followRedirects(false).build()
    @Volatile private var cached: Pair<Long, JSONArray>? = null

    /** TURN entries ({urls, username, credential}), or null when the service has none / is unreachable. Blocks. */
    fun fromService(): JSONArray? {
        cached?.let { (at, servers) -> if (System.currentTimeMillis() - at < FRESH_MS) return servers }
        return runCatching {
            val request = Request.Builder().url("$SERVICE?action=turn").post("{}".toRequestBody("application/json".toMediaType())).build()
            http.newCall(request).execute().use { response ->
                if (response.code != 200) return null
                val all = JSONObject(response.body?.string() ?: return null).optJSONArray("iceServers") ?: return null
                val servers = JSONArray()
                for (i in 0 until all.length()) {
                    val s = all.optJSONObject(i) ?: continue
                    if (s.optJSONArray("urls") != null && s.optString("username").isNotEmpty() && s.optString("credential").isNotEmpty()) servers.put(s)
                }
                if (servers.length() == 0) null else servers.also { cached = System.currentTimeMillis() to it }
            }
        }.getOrNull()
    }

    /** STUN plus these TURN entries, for the viewers (JSON) and for our own connections. */
    fun iceJson(turn: JSONArray?): JSONArray {
        val list = JSONArray().put(JSONObject().put("urls", JSONArray(STUN)))
        if (turn != null) for (i in 0 until turn.length()) list.put(turn.getJSONObject(i))
        return list
    }

    fun iceServers(turn: JSONArray?): List<PeerConnection.IceServer> {
        val list = mutableListOf(PeerConnection.IceServer.builder(STUN).createIceServer())
        if (turn != null) for (i in 0 until turn.length()) {
            val s = turn.getJSONObject(i)
            val urls = s.getJSONArray("urls").let { a -> (0 until a.length()).map { a.getString(it) } }
            list += PeerConnection.IceServer.builder(urls).setUsername(s.getString("username")).setPassword(s.getString("credential")).createIceServer()
        }
        return list
    }
}

package de.limtec.peekaview

import android.util.Base64
import fr.acinq.secp256k1.Secp256k1
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Signaling over Nostr relays, as the desktop app (p2p/signal.rs) and the viewer (web/signal.js):
 * ephemeral events (kind 25050) tagged with a topic derived from the room secret, the JSON
 * message AES-256-GCM encrypted with a key derived from it, every event signed with the room's
 * presenter key (viewers check it against the key in the link).
 */
class Signaling(
    private val secret: String,
    private val signingKey: ByteArray,
    relays: List<String>,
    private val onMessage: (JSONObject) -> Unit,
) {
    private val topic = hex(sha256("peekaview/topic/v1:$secret".toByteArray()))
    private val key = SecretKeySpec(sha256("peekaview/key/v1:$secret".toByteArray()), "AES")
    val publicKey: ByteArray = Nostr.publicKey(signingKey)
    private val publicHex = hex(publicKey)
    private val subscription = "pv-${topic.take(8)}"

    private val http = Nostr.http
    private val sockets = ConcurrentHashMap<String, WebSocket>()
    private val seen = LinkedHashSet<String>()
    // frames of the last seconds, sent again to relays that (re)connect
    private val recent = ArrayDeque<Pair<Long, String>>()
    private val timers = Executors.newSingleThreadScheduledExecutor()
    @Volatile private var closed = false

    init {
        for (relay in relays) connect(relay, 1)
    }

    fun send(message: JSONObject) {
        val frame = JSONArray().put("EVENT").put(event(message.toString())).toString()
        synchronized(recent) {
            val now = System.currentTimeMillis()
            while (recent.isNotEmpty() && now - recent.first().first > 10_000) recent.removeFirst()
            recent.addLast(now to frame)
        }
        for (ws in sockets.values) ws.send(frame)
    }

    fun close() {
        closed = true
        for (ws in sockets.values) {
            ws.send(JSONArray().put("CLOSE").put(subscription).toString())
            ws.close(1000, null)
        }
        sockets.clear()
        timers.shutdownNow()
    }

    private fun connect(relay: String, backoff: Long) {
        if (closed) return
        http.newWebSocket(Request.Builder().url(relay).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                sockets[relay] = webSocket
                val filter = JSONObject().put("kinds", JSONArray().put(KIND)).put("#t", JSONArray().put(topic)).put("since", System.currentTimeMillis() / 1000 - 10)
                webSocket.send(JSONArray().put("REQ").put(subscription).put(filter).toString())
                // what was sent while this relay was away
                val now = System.currentTimeMillis()
                synchronized(recent) { recent.filter { now - it.first < 10_000 }.map { it.second } }.forEach { webSocket.send(it) }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching { receive(text) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = retry(webSocket)

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = retry(webSocket)

            private fun retry(webSocket: WebSocket) {
                sockets.remove(relay, webSocket)
                if (closed) return
                runCatching { timers.schedule({ connect(relay, (backoff * 2).coerceAtMost(30)) }, backoff, TimeUnit.SECONDS) }
            }
        })
    }

    private fun receive(text: String) {
        val frame = JSONArray(text)
        if (frame.optString(0) != "EVENT") return
        val event = frame.getJSONObject(2)
        if (event.optString("pubkey") == publicHex) return
        val id = event.optString("id")
        synchronized(seen) {
            if (!seen.add(id)) return
            if (seen.size > 2000) repeat(1000) { seen.remove(seen.first()) }
        }
        if (Math.abs(System.currentTimeMillis() / 1000 - event.optLong("created_at")) > 120) return
        val raw = Base64.decode(event.optString("content"), Base64.DEFAULT)
        if (raw.size < 13) return
        // not this room's key: not for us
        val plain = runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, raw, 0, 12))
            cipher.doFinal(raw, 12, raw.size - 12)
        }.getOrNull() ?: return
        onMessage(JSONObject(String(plain)))
    }

    private fun event(json: String): JSONObject {
        val iv = ByteArray(12).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        val content = Base64.encodeToString(iv + cipher.doFinal(json.toByteArray()), Base64.NO_WRAP)
        return Nostr.sign(signingKey, KIND, listOf(listOf("t", topic)), content)
    }

    companion object {
        const val KIND = 25050
        val DEFAULT_RELAYS = listOf("wss://nos.lol", "wss://relay.primal.net", "wss://relay.snort.social", "wss://nostr.mom", "wss://relay.damus.io")
        private val random = SecureRandom()

        fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)
        fun hex(data: ByteArray) = data.joinToString("") { "%02x".format(it) }
        fun b64url(data: ByteArray): String = Base64.encodeToString(data, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

        /** A new room secret: 16 random bytes, base64url. */
        fun newSecret(): String = b64url(ByteArray(16).also { random.nextBytes(it) })

        /** A new presenter key (secp256k1). */
        fun newSigningKey(): ByteArray {
            while (true) {
                val key = ByteArray(32).also { random.nextBytes(it) }
                if (Secp256k1.secKeyVerify(key)) return key
            }
        }

        fun randomId(bytes: Int = 9): String = b64url(ByteArray(bytes).also { random.nextBytes(it) })
    }
}

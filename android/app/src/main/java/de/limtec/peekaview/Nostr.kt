package de.limtec.peekaview

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Nostr events and signatures for signaling. */
object Nostr {
    private val random = SecureRandom()
    val http: OkHttpClient = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()

    fun publicKey(secret: ByteArray): ByteArray = Schnorr.publicKey(secret)

    /** A signed event (NIP-01): tags are lists of strings. */
    fun sign(secret: ByteArray, kind: Int, tags: List<List<String>>, content: String, createdAt: Long = System.currentTimeMillis() / 1000): JSONObject {
        val pubkey = Signaling.hex(publicKey(secret))
        val serialized = "[0,${str(pubkey)},$createdAt,$kind,${tags.joinToString(",", "[", "]") { t -> t.joinToString(",", "[", "]") { str(it) } }},${str(content)}]"
        val id = Signaling.sha256(serialized.toByteArray())
        val sig = Schnorr.sign(id, secret, ByteArray(32).also { random.nextBytes(it) })
        return JSONObject()
            .put("id", Signaling.hex(id))
            .put("pubkey", pubkey)
            .put("created_at", createdAt)
            .put("kind", kind)
            .put("tags", JSONArray(tags.map { JSONArray(it) }))
            .put("content", content)
            .put("sig", Signaling.hex(sig))
    }

    /** The sender of a received event: its pubkey, when id and signature fit it (NIP-01). */
    fun verifiedSender(event: JSONObject): String? {
        val pubkey = event.optString("pubkey")
        val tags = event.optJSONArray("tags") ?: return null
        val tagList = (0 until tags.length()).map { i -> tags.getJSONArray(i).let { t -> (0 until t.length()).map { t.getString(it) } } }
        val serialized = "[0,${str(pubkey)},${event.optLong("created_at")},${event.optInt("kind")},${tagList.joinToString(",", "[", "]") { t -> t.joinToString(",", "[", "]") { str(it) } }},${str(event.optString("content"))}]"
        val id = Signaling.sha256(serialized.toByteArray())
        if (Signaling.hex(id) != event.optString("id")) return null
        val key = Signaling.unhex(pubkey) ?: return null
        val sig = Signaling.unhex(event.optString("sig")) ?: return null
        return if (Schnorr.verify(id, key, sig)) pubkey else null
    }

    /** A JSON string exactly as JSON.stringify writes it (the event id depends on it). */
    fun str(s: String): String {
        val out = StringBuilder("\"")
        for (c in s) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                '\b' -> out.append("\\b")
                '\u000c' -> out.append("\\f")
                else -> if (c < ' ') out.append("\\u%04x".format(c.code)) else out.append(c)
            }
        }
        return out.append('"').toString()
    }

    /** Sends events to a relay; true if it accepted all of them. */
    fun publish(relay: String, events: List<JSONObject>): Boolean {
        val done = CountDownLatch(1)
        var accepted = 0
        val socket = http.newWebSocket(Request.Builder().url(relay).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                for (e in events) webSocket.send(JSONArray().put("EVENT").put(e).toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val v = runCatching { JSONArray(text) }.getOrNull() ?: return
                if (v.optString(0) == "OK" && v.optBoolean(2)) {
                    synchronized(this) { accepted++ }
                    if (accepted >= events.size) done.countDown()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = done.countDown()
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = done.countDown()
        })
        done.await(10, TimeUnit.SECONDS)
        socket.close(1000, null)
        return accepted >= events.size
    }

    // ------------------------------------------------------------ bech32 (npub)

    private const val CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

    private fun polymod(values: List<Int>): Int {
        val gen = intArrayOf(0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3)
        var chk = 1
        for (v in values) {
            val top = chk ushr 25
            chk = ((chk and 0x1ffffff) shl 5) xor v
            for (i in 0 until 5) if ((top ushr i) and 1 == 1) chk = chk xor gen[i]
        }
        return chk
    }

    fun npub(pubkey: ByteArray): String {
        val five = mutableListOf<Int>()
        var acc = 0
        var bits = 0
        for (b in pubkey) {
            acc = (acc shl 8) or (b.toInt() and 0xff)
            bits += 8
            while (bits >= 5) {
                bits -= 5
                five += (acc ushr bits) and 31
            }
        }
        if (bits > 0) five += (acc shl (5 - bits)) and 31
        val hrp = "npub"
        val values = hrp.map { it.code ushr 5 } + 0 + hrp.map { it.code and 31 } + five + List(6) { 0 }
        val pm = polymod(values) xor 1
        val checksum = (0 until 6).map { (pm ushr (5 * (5 - it))) and 31 }
        return hrp + "1" + (five + checksum).joinToString("") { CHARSET[it].toString() }
    }
}

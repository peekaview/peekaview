package de.limtec.peekaview

import android.content.Context
import android.util.Base64
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors

/**
 * The viewer website, served over Nostr – as the desktop app does it (nsite.rs): the phone
 * publishes the bundled viewer site as an nsite (NIP-5A) under a key of its own. The files go to
 * public Blossom servers (content-addressed by SHA-256), a signed manifest (kind 15128) maps every
 * path to its hash, plus the server list (kind 10063) and relay list (kind 10002) so gateways
 * find everything. Links then point to `https://<npub>.nsite.lol/#…`.
 *
 * Published again when the bundled site changed or a week has passed; files of earlier versions
 * are deleted from the Blossom servers afterwards.
 */
object Nsite {
    private const val TAG = "nsite"
    private val FILES = listOf(
        "index.html", "viewer.js", "signal.js", "annotate.js", "icons.js", "voice.js", "clipboard.js", "windows.js",
        "vendor/noble-schnorr.js", "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs",
    )
    private val BLOSSOM = listOf("https://blossom.primal.net", "https://nostr.download", "https://blossom.band")
    // where gateways look up a user's relay and server lists
    private val LOOKUP_RELAYS = listOf("wss://purplepag.es", "wss://user.kindpag.es")
    private const val GATEWAY = "nsite.lol"
    private const val REPUBLISH_SECONDS = 7L * 24 * 3600

    enum class State { IDLE, PUBLISHING, OK, ERROR }

    @Volatile var state = State.IDLE
        private set
    @Volatile var error: String? = null
        private set
    val listeners = CopyOnWriteArraySet<() -> Unit>()

    private val worker = Executors.newSingleThreadExecutor()

    private fun prefs(context: Context) = context.getSharedPreferences("nsite", Context.MODE_PRIVATE)

    /** This installation's site key (made on first use). */
    private fun key(context: Context): ByteArray {
        val p = prefs(context)
        p.getString("key", null)?.let { hex -> return ByteArray(32) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() } }
        val key = Signaling.newSigningKey()
        p.edit().putString("key", Signaling.hex(key)).apply()
        return key
    }

    /** Address of the viewer site on Nostr. */
    fun url(context: Context): String = "https://${Nostr.npub(Nostr.publicKey(key(context)))}.$GATEWAY"

    private class File(val path: String, val bytes: ByteArray, val mime: String) {
        val sha: String = Signaling.hex(Signaling.sha256(bytes))
    }

    private fun files(context: Context): List<File> = FILES.map { name ->
        val bytes = context.assets.open("web/$name").use { it.readBytes() }
        val mime = when (name.substringAfterLast('.')) {
            "html" -> "text/html"
            "js", "mjs" -> "text/javascript"
            else -> "application/octet-stream"
        }
        File("/$name", bytes, mime)
    }

    /** NIP-5A aggregate hash: sorted "<sha256> <path>\n" lines. */
    private fun aggregate(files: List<File>): String =
        Signaling.hex(Signaling.sha256(files.map { "${it.sha} ${it.path}\n" }.sorted().joinToString("").toByteArray()))

    /**
     * Are all files still on the servers they went to? Blobs are content-addressed: another
     * installation with the same files (e.g. the desktop app) deleting its copies may take ours, too.
     */
    private fun complete(context: Context, files: List<File>): Boolean {
        val servers = JSONObject(prefs(context).getString("blobs", null) ?: "{}").keys().asSequence().toList()
        return servers.isNotEmpty() && servers.all { server ->
            files.all { f -> runCatching { Nostr.http.newCall(Request.Builder().url("$server/${f.sha}").head().build()).execute().use { it.isSuccessful } }.getOrDefault(false) }
        }
    }

    /** Publishes the viewer site if it changed (or a week has passed) – in the background. */
    fun publishIfNeeded(context: Context, force: Boolean = false) {
        val app = context.applicationContext
        worker.execute {
            try {
                val files = files(app)
                val hash = aggregate(files)
                val p = prefs(app)
                val now = System.currentTimeMillis() / 1000
                val fresh = p.getString("hash", null) == hash && now - p.getLong("published", 0) < REPUBLISH_SECONDS
                if (fresh && !force && complete(app, files)) return@execute set(State.OK, null)
                set(State.PUBLISHING, null)
                val servers = publish(app, files, hash)
                // files of earlier versions are no longer needed
                val shas = files.map { it.sha }
                val blobs = deleteExcept(app, shas, servers)
                for (server in servers) {
                    val list = blobs.optJSONArray(server) ?: JSONArray().also { blobs.put(server, it) }
                    val have = (0 until list.length()).map { list.getString(it) }.toSet()
                    for (sha in shas) if (sha !in have) list.put(sha)
                }
                p.edit().putString("hash", hash).putLong("published", now).putString("blobs", blobs.toString()).apply()
                set(State.OK, null)
            } catch (e: Exception) {
                Log.w(TAG, "publish failed", e)
                set(State.ERROR, e.message ?: e.toString())
            }
        }
    }

    /**
     * Takes the site down (an own viewer website is set): all files off the servers, the manifest
     * deleted (NIP-09).
     */
    fun unpublish(context: Context) {
        val app = context.applicationContext
        worker.execute {
            val p = prefs(app)
            if (p.getLong("published", 0) == 0L && p.getString("blobs", "{}") == "{}") return@execute
            val secret = key(app)
            val left = deleteExcept(app, emptyList(), emptyList())
            // files of the bundled site may be up from a publish that did not record them
            runCatching { for (server in BLOSSOM) for (f in files(app)) deleteBlob(server, f.sha, secret) }
            val pubkey = Signaling.hex(Nostr.publicKey(secret))
            val deletion = Nostr.sign(secret, 5, listOf(listOf("a", "15128:$pubkey:"), listOf("k", "15128")), "PeekaView viewer site taken down")
            for (r in (Prefs.relays(app) + LOOKUP_RELAYS).distinct()) runCatching { Nostr.publish(r, listOf(deletion)) }
            p.edit().remove("hash").remove("published").putString("blobs", left.toString()).apply()
            Log.i(TAG, "taken down")
            set(State.IDLE, null)
        }
    }

    private fun set(s: State, e: String?) {
        state = s
        error = e
        for (l in listeners) l()
    }

    private fun publish(context: Context, files: List<File>, hash: String): List<String> {
        val secret = key(context)
        val servers = mutableListOf<String>()
        val errors = mutableListOf<String>()
        for (server in BLOSSOM) {
            try {
                for (f in files) upload(server, f, secret)
                servers += server
            } catch (e: Exception) {
                errors += e.message ?: e.toString()
            }
        }
        if (servers.isEmpty()) error("Kein Blossom-Server nahm die Dateien an (${errors.joinToString("; ")})")
        val relays = Prefs.relays(context)
        val manifest = files.map { listOf("path", it.path, it.sha) } +
            servers.map { listOf("server", it) } +
            listOf(listOf("x", hash, "aggregate"), listOf("title", "PeekaView"), listOf("description", "Bildschirmfreigabe ansehen – peer-to-peer, ohne eigenen Server"))
        val events = listOf(
            Nostr.sign(secret, 10002, relays.map { listOf("r", it) }, ""),
            Nostr.sign(secret, 10063, servers.map { listOf("server", it) }, ""),
            Nostr.sign(secret, 15128, manifest, ""),
        )
        val targets = (relays + LOOKUP_RELAYS).distinct()
        val pool = Executors.newFixedThreadPool(targets.size)
        val accepted = targets.map { r -> pool.submit<Boolean> { Nostr.publish(r, events) } }.count { runCatching { it.get() }.getOrDefault(false) }
        pool.shutdown()
        if (accepted == 0) error("Kein Relay nahm die Seite an")
        Log.i(TAG, "published to ${servers.size} servers (${servers.joinToString()}), $accepted relays" + if (errors.isEmpty()) "" else " – refused: ${errors.joinToString("; ")}")
        return servers
    }

    /** BUD-11 authorization: a signed kind 24242 event, base64 (url-safe, or standard for older servers). */
    private fun auth(secret: ByteArray, verb: String, sha: String, content: String, urlSafe: Boolean): String {
        val event = Nostr.sign(secret, 24242, listOf(listOf("t", verb), listOf("x", sha), listOf("expiration", (System.currentTimeMillis() / 1000 + 600).toString())), content)
        val flags = if (urlSafe) Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP else Base64.NO_WRAP
        return "Nostr " + Base64.encodeToString(event.toString().toByteArray(), flags)
    }

    /** Uploads one blob unless the server has it already (BUD-01 HEAD, BUD-02 PUT /upload). */
    private fun upload(server: String, file: File, secret: ByteArray) {
        val head = Request.Builder().url("$server/${file.sha}").head().build()
        if (runCatching { Nostr.http.newCall(head).execute().use { it.isSuccessful } }.getOrDefault(false)) return
        var last: String? = null
        // BUD-11 says base64url, some servers (e.g. Primal) only take standard base64
        for (urlSafe in listOf(true, false)) {
            val request = Request.Builder()
                .url("$server/upload")
                .header("Authorization", auth(secret, "upload", file.sha, "Upload ${file.path.trimStart('/')}", urlSafe))
                .header("X-SHA-256", file.sha)
                .put(file.bytes.toRequestBody(file.mime.toMediaType()))
                .build()
            Nostr.http.newCall(request).execute().use { r ->
                if (r.isSuccessful) return
                last = "$server: ${r.code} ${r.header("x-reason").orEmpty()}"
            }
        }
        error(last ?: server)
    }

    private fun deleteBlob(server: String, sha: String, secret: ByteArray): Boolean = listOf(true, false).any { urlSafe ->
        val request = Request.Builder().url("$server/$sha").header("Authorization", auth(secret, "delete", sha, "Delete old PeekaView file", urlSafe)).delete().build()
        // gone already counts as done
        runCatching { Nostr.http.newCall(request).execute().use { it.isSuccessful || it.code == 404 } }.getOrDefault(false)
    }

    /** Blobs we have on servers ({server: [sha256 …]}) – deletes those not in `keep`; returns what is left. */
    private fun deleteExcept(context: Context, keep: List<String>, keepServers: List<String>): JSONObject {
        val secret = key(context)
        val blobs = JSONObject(prefs(context).getString("blobs", null) ?: "{}")
        val left = JSONObject()
        for (server in blobs.keys()) {
            val remaining = JSONArray()
            val list = blobs.getJSONArray(server)
            for (i in 0 until list.length()) {
                val sha = list.getString(i)
                val stillUsed = server in keepServers && sha in keep
                if (stillUsed || !deleteBlob(server, sha, secret)) remaining.put(sha)
            }
            if (remaining.length() > 0) left.put(server, remaining)
        }
        return left
    }
}

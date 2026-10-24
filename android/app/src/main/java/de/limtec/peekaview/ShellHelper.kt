package de.limtec.peekaview

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.io.Closeable
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetAddress
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket

/** The app owns the TLS listener; only its bootstrapped shell process knows the capability. */
class ShellHelper private constructor(context: Context) : Closeable {
    private val apkPath = context.applicationInfo.sourceDir
    private val identity = LocalAdb()
    private val token = ByteArray(32).also { SecureRandom().nextBytes(it) }
    internal val port: Int get() = listener.localPort
    private val listener = (identity.serverTls().serverSocketFactory.createServerSocket(0, 4, InetAddress.getByName("127.0.0.1")) as SSLServerSocket).apply {
        enabledProtocols = arrayOf("TLSv1.3")
        soTimeout = 20_000
    }
    private val stopped = AtomicBoolean(false)
    val isClosed: Boolean get() = stopped.get()
    @Volatile private var accepting: SSLSocket? = null
    @Volatile private var manager: SSLSocket? = null
    @Volatile private var capture: Streams? = null
    private lateinit var input: DataInputStream
    private lateinit var output: DataOutputStream

    private fun bootstrap(adbPort: Int) {
        val path = "/data/local/tmp/peekaview-bootstrap-${UUID.randomUUID()}.json"
        val config = JSONObject().put("port", port).put("token", Base64.encodeToString(token, Base64.NO_WRAP))
            .put("certificate", Base64.encodeToString(identity.certificatePin(), Base64.NO_WRAP))
            .put("apk", apkPath).put("version", BuildConfig.SCRCPY_VERSION)
        identity.push(adbPort, path, config.toString().toByteArray())
        // All credentials are in a shell-owned 0600 file, never in argv, logs or shared storage.
        fun quote(s: String) = "'" + s.replace("'", "'\\''") + "'"
        val command = "CLASSPATH=${quote(apkPath)} nohup setsid app_process / --nice-name=peekaview-helper " +
            "de.limtec.peekaview.shell.ShellHelperMain ${quote(path)} </dev/null >/dev/null 2>&1"
        try {
            // Keep the launch transport until the child has detached and authenticated.
            // Backgrounding the shell with '&' races PTY teardown against nohup/setsid.
            identity.openLocal(adbPort, "shell:$command")
            manager = accept(0, 0).apply { soTimeout = 20_000 }
            input = DataInputStream(manager!!.inputStream)
            output = DataOutputStream(manager!!.outputStream)
            ping()
            identity.openLocal(adbPort, "shell:rm -f -- ${quote(path)}").use { it.reader.readBytes() }
            identity.closeLocal()
            output.writeInt(4); output.flush()
            check(input.readUTF().isEmpty()) { "WLAN-Debugging konnte nicht ausgeschaltet werden." }
            ping()
        } finally {
            // Includes the launch stream. The manager/capture connections are ordinary local TLS.
            identity.closeLocal()
        }
    }

    private fun accept(kind: Int, id: Int): SSLSocket {
        val deadline = System.nanoTime() + 20_000_000_000L
        while (!stopped.get() && System.nanoTime() < deadline) {
            val socket = listener.accept() as SSLSocket
            accepting = socket
            try {
                socket.soTimeout = 2000
                socket.startHandshake()
                val header = DataInputStream(socket.inputStream)
                val supplied = ByteArray(token.size).also { header.readFully(it) }
                if (!MessageDigest.isEqual(token, supplied)) continue
                check(header.readInt() == kind && header.readInt() == id) { "Ungültiger Helfer-Kanal." }
                socket.soTimeout = 0
                accepting = null
                return socket
            } catch (e: java.io.IOException) {
                if (stopped.get()) throw e
            } finally {
                if (accepting === socket) { socket.close(); accepting = null }
            }
        }
        error("Der lokale Shell-Helfer hat sich nicht verbunden. Bitte erneut starten.")
    }

    @Synchronized fun ping(): Int {
        check(!stopped.get()) { "Shell-Helfer beendet. Bitte erneut aktivieren." }
        output.writeInt(0); output.flush()
        return input.readInt().also { check(it > 0) }
    }

    @Synchronized fun startCapture(apps: List<PhoneApps.App>? = null, generation: Long = 1): Streams {
        check(capture == null) { "Eine Fernsteuerung läuft bereits." }
        val id = SecureRandom().nextInt(Int.MAX_VALUE)
        output.writeInt(if (apps == null) 1 else 6); output.writeInt(id)
        if (apps != null) { output.writeLong(generation); output.writeUTF(org.json.JSONArray(apps.map { it.captureJson() }).toString()) }
        output.flush()
        val problem = input.readUTF()
        check(problem.isEmpty()) { problem }
        val video = accept(1, id)
        try {
            val control = accept(2, id)
            return Streams(video, control).also { capture = it }
        } catch (e: Exception) { video.close(); throw e }
    }

    @Synchronized fun updateApps(generation: Long, apps: List<PhoneApps.App>) {
        check(capture != null) { "Keine Freigabe aktiv." }
        output.writeInt(7); output.writeLong(generation)
        output.writeUTF(org.json.JSONArray(apps.map { it.captureJson() }).toString()); output.flush()
        val problem = input.readUTF()
        check(problem.isEmpty()) { problem }
    }

    @Synchronized fun paste() {
        output.writeInt(5); output.flush()
        val problem = input.readUTF()
        check(problem.isEmpty()) { problem }
    }

    @Synchronized fun stopCapture(streams: Streams) {
        if (capture !== streams) return
        capture = null
        try { streams.close() }
        finally {
            if (!stopped.get()) {
                output.writeInt(2); output.flush()
                val problem = input.readUTF()
                check(problem.isEmpty()) { problem }
            }
        }
    }

    override fun close() {
        if (!stopped.compareAndSet(false, true)) return
        // Closing the manager terminates the detached broker and its capture, also on app death.
        runCatching { accepting?.close() }
        runCatching { listener.close() }
        runCatching { capture?.close() }
        runCatching { manager?.close() }
        identity.closeLocal()
        token.fill(0)
    }

    class Streams(val video: SSLSocket, val control: SSLSocket) : Closeable {
        override fun close() { try { video.close() } finally { control.close() } }
    }

    companion object {
        fun start(context: Context, port: Int): ShellHelper {
            val helper = ShellHelper(context.applicationContext)
            try { helper.bootstrap(port); return helper }
            catch (e: Exception) { helper.close(); throw e }
        }
    }
}

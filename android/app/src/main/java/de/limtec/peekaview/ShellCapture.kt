package de.limtec.peekaview

import android.content.Context
import android.media.MediaCodec
import android.media.MediaFormat
import android.view.KeyEvent
import android.view.Surface
import org.webrtc.CapturerObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.ThreadUtils
import org.webrtc.VideoCapturer
import java.io.DataInputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.SSLSocket

/** Mirrors display 0 with the official scrcpy shell server. No app is moved to another display. */
class ShellCapture(
    private val helper: ShellHelper,
    private val onFormat: () -> Unit,
    private val onError: (String) -> Unit,
    private val appsOnly: Boolean = false,
    initialApps: List<PhoneApps.App> = emptyList(),
) : VideoCapturer {
    private lateinit var textures: SurfaceTextureHelper
    private lateinit var observer: CapturerObserver
    private val stopped = AtomicBoolean(false)
    private val writers = Executors.newSingleThreadExecutor()
    private val deadline = Executors.newSingleThreadScheduledExecutor()
    private val streams = AtomicReference<ShellHelper.Streams?>()
    @Volatile private var control: SSLSocket? = null
    private var reader: Thread? = null
    @Volatile var videoWidth = 0
        private set
    @Volatile var videoHeight = 0
        private set
    private val policyLock = Any()
    private var generation = 1L
    @Volatile private var sharedApps = initialApps
    @Volatile var appVisible = !appsOnly
        private set
    private var clipboardSequence = 0L
    private var lastX = 0.5
    private var lastY = 0.5

    override fun initialize(helper: SurfaceTextureHelper, context: Context, observer: CapturerObserver) {
        textures = helper
        this.observer = observer
    }

    override fun startCapture(width: Int, height: Int, framerate: Int) {
        val timeout = deadline.schedule({ fail("Der lokale Shell-Helfer antwortet nicht. Helfer beenden und erneut aktivieren.") }, 30, TimeUnit.SECONDS)
        reader = Thread({
            var decoder: Decoder? = null
            var surface: Surface? = null
            try {
                val channels = synchronized(policyLock) {
                    helper.startCapture(if (appsOnly) sharedApps else null, generation).also { streams.set(it) }
                }
                if (stopped.get()) { closeConnections(); return@Thread }
                control = channels.control
                val input = DataInputStream(channels.video.inputStream)
                val magic = input.readInt()
                if (appsOnly) {
                    check(magic == AppCaptureProtocol.MAGIC) { "Der Helfer unterstützt keine App-Freigabe. Bitte erneut aktivieren." }
                    observer.onCapturerStarted(true)
                    while (!stopped.get()) {
                        val packet = AppCaptureProtocol.read(input)
                        val current = synchronized(policyLock) { packet.generation == generation }
                        if (!current) continue
                        val bitmap = android.graphics.BitmapFactory.decodeByteArray(packet.bytes, 0, packet.bytes.size)
                            ?: error("App-Bild konnte nicht gelesen werden.")
                        try {
                            check(bitmap.width == packet.width && bitmap.height == packet.height) { "App-Bildformat stimmt nicht überein." }
                            val rgba = java.nio.ByteBuffer.allocateDirect(bitmap.byteCount)
                            bitmap.copyPixelsToBuffer(rgba); rgba.rewind()
                            val yuv = org.webrtc.JavaI420Buffer.allocate(packet.width, packet.height)
                            try {
                                org.webrtc.YuvHelper.ABGRToI420(rgba, bitmap.rowBytes, yuv.dataY, yuv.strideY, yuv.dataU, yuv.strideU, yuv.dataV, yuv.strideV, packet.width, packet.height)
                                synchronized(policyLock) {
                                    if (packet.generation == generation) {
                                        val changed = videoWidth != packet.width || videoHeight != packet.height || appVisible != packet.visible
                                        videoWidth = packet.width; videoHeight = packet.height; appVisible = packet.visible
                                        val frame = org.webrtc.VideoFrame(yuv, 0, packet.timestamp)
                                        observer.onFrameCaptured(frame)
                                        timeout.cancel(false)
                                        if (changed) onFormat()
                                    }
                                }
                            } finally { yuv.release() }
                        } finally { bitmap.recycle() }
                    }
                    return@Thread
                }
                check(magic == 0x68323634) { "Der Shell-Helfer liefert kein H.264." }
                ThreadUtils.invokeAtFrontUninterruptibly(textures.handler) {
                    observer.onCapturerStarted(true)
                    textures.startListening {
                        timeout.cancel(false)
                        observer.onFrameCaptured(it)
                    }
                }
                surface = Surface(textures.surfaceTexture)
                while (!stopped.get()) {
                    when (val packet = ScrcpyProtocol.readPacket(input)) {
                        is ScrcpyProtocol.Packet.Session -> {
                            val previous = decoder
                            decoder = null
                            previous?.close()
                            videoWidth = packet.width
                            videoHeight = packet.height
                            ThreadUtils.invokeAtFrontUninterruptibly(textures.handler) {
                                textures.setTextureSize(packet.width, packet.height)
                            }
                            decoder = Decoder(packet.width, packet.height, surface)
                            onFormat()
                        }
                        is ScrcpyProtocol.Packet.Frame -> {
                            val d = checkNotNull(decoder) { "Videopaket vor der Bildschirmgröße." }
                            d.feed(packet)
                        }
                    }
                }
            } catch (e: Exception) {
                fail("Lokale Fernsteuerung fehlgeschlagen: ${e.message}")
            } finally {
                timeout.cancel(false)
                try {
                    decoder?.close()
                } catch (e: Exception) {
                    fail("Videodecoder konnte nicht beendet werden: ${e.message}")
                } finally {
                    surface?.release()
                    closeConnections()
                }
            }
        }, "shell-video").also { it.start() }
    }

    private fun fail(message: String) {
        if (stopped.compareAndSet(false, true)) {
            android.util.Log.e("shell", message)
            closeConnections()
            if (!helper.isClosed) onError(message)
        }
    }

    private fun closeConnections() {
        control = null
        streams.getAndSet(null)?.let { channels -> runCatching { helper.stopCapture(channels) } }
    }

    override fun stopCapture() {
        stopped.set(true)
        closeConnections()
        writers.shutdownNow()
        deadline.shutdownNow()
        reader?.takeIf { it !== Thread.currentThread() }?.join()
        ThreadUtils.invokeAtFrontUninterruptibly(textures.handler) {
            textures.stopListening()
            observer.onCapturerStopped()
        }
    }

    // scrcpy follows physical rotation itself; it must never resize the actual phone display.
    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {}
    override fun dispose() {}
    override fun isScreencast() = true

    fun updateApps(apps: List<PhoneApps.App>) {
        check(appsOnly) { "Keine App-Freigabe aktiv." }
        synchronized(policyLock) {
            appVisible = false
            ++generation
            sharedApps = apps
            // Also handles edits before the first capture channel has been opened.
            if (streams.get() != null) helper.updateApps(generation, apps)
        }
    }

    fun refresh() { if (!appsOnly) write(byteArrayOf(17)) }

    fun touch(action: Int, x: Double, y: Double) {
        lastX = x
        lastY = y
        if (videoWidth > 0 && videoHeight > 0) write(ScrcpyProtocol.touch(action, x, y, videoWidth, videoHeight))
    }

    fun cancel() {
        if (videoWidth > 0 && videoHeight > 0) {
            // CANCEL releases Android's gesture; UP also clears scrcpy's internal pointer slot.
            write(ScrcpyProtocol.touch(3, lastX, lastY, videoWidth, videoHeight) + ScrcpyProtocol.touch(1, lastX, lastY, videoWidth, videoHeight))
        }
    }

    fun scroll(x: Double, y: Double, dx: Double, dy: Double) {
        if (videoWidth > 0 && videoHeight > 0) write(ScrcpyProtocol.scroll(x, y, videoWidth, videoHeight, dx, dy))
    }

    fun nav(action: String) {
        val code = when (action) {
            "back" -> KeyEvent.KEYCODE_BACK
            "home" -> KeyEvent.KEYCODE_HOME
            "recents" -> KeyEvent.KEYCODE_APP_SWITCH
            else -> return
        }
        press(code)
    }

    fun key(name: String, cmd: Boolean, shift: Boolean, alt: Boolean) {
        val code = when (name) {
            "Enter" -> KeyEvent.KEYCODE_ENTER
            "Backspace" -> KeyEvent.KEYCODE_DEL
            "Delete" -> KeyEvent.KEYCODE_FORWARD_DEL
            "Tab" -> KeyEvent.KEYCODE_TAB
            "Escape", "BrowserBack" -> KeyEvent.KEYCODE_BACK
            "Home" -> KeyEvent.KEYCODE_MOVE_HOME
            "End" -> KeyEvent.KEYCODE_MOVE_END
            "ArrowLeft" -> KeyEvent.KEYCODE_DPAD_LEFT
            "ArrowRight" -> KeyEvent.KEYCODE_DPAD_RIGHT
            "ArrowUp" -> KeyEvent.KEYCODE_DPAD_UP
            "ArrowDown" -> KeyEvent.KEYCODE_DPAD_DOWN
            "PageUp" -> KeyEvent.KEYCODE_PAGE_UP
            "PageDown" -> KeyEvent.KEYCODE_PAGE_DOWN
            else -> if ((cmd || alt) && name.length == 1 && name[0] in 'a'..'z') KeyEvent.KEYCODE_A + (name[0] - 'a') else null
        }
        if (code != null) {
            val meta = (if (cmd) KeyEvent.META_CTRL_ON else 0) or (if (shift) KeyEvent.META_SHIFT_ON else 0) or (if (alt) KeyEvent.META_ALT_ON else 0)
            press(code, meta)
        } else if (!cmd && !alt && name.length == 1) {
            text(if (shift) name.uppercase() else name)
        }
    }

    private fun press(code: Int, meta: Int = 0) = write(ScrcpyProtocol.key(0, code, meta) + ScrcpyProtocol.key(1, code, meta))
    fun text(text: String) = enqueue { channel ->
        val sequence = ++clipboardSequence
        channel.outputStream.apply { write(ScrcpyProtocol.clipboard(text, sequence)); flush() }
        // Clipboard mutation and Android input dispatch are separate queues. Wait for both;
        // otherwise a fast paste/backspace (or the next character) can overtake the paste.
        channel.soTimeout = 10_000
        try {
            val reply = DataInputStream(channel.inputStream)
            check(reply.readUnsignedByte() == 1 && reply.readLong() == sequence) { "Clipboard-Bestätigung fehlt." }
        } finally { channel.soTimeout = 0 }
        helper.paste()
    }
    fun launch(packageName: String) = write(ScrcpyProtocol.launch(packageName))

    private fun write(bytes: ByteArray) = enqueue { channel ->
        channel.outputStream.apply { write(bytes); flush() }
    }

    private fun enqueue(action: (SSLSocket) -> Unit) {
        if (stopped.get() || control == null) return
        writers.execute {
            val channel = control ?: return@execute
            try { action(channel) }
            catch (e: Exception) { fail("Eingabe an den Shell-Helfer fehlgeschlagen: ${e.message}") }
        }
    }

    /** Decode into WebRTC's existing texture; its encoder fans the screen out to viewers. */
    private inner class Decoder(width: Int, height: Int, surface: Surface) : AutoCloseable {
        private val codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        @Volatile private var live = true
        private val output: Thread

        init {
            try {
                codec.configure(MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height), surface, null, 0)
                codec.start()
            } catch (e: Exception) {
                codec.release()
                throw e
            }
            output = Thread({
                try {
                    val info = MediaCodec.BufferInfo()
                    while (live && !stopped.get()) {
                        val index = codec.dequeueOutputBuffer(info, 10_000)
                        if (index >= 0) codec.releaseOutputBuffer(index, true)
                    }
                } catch (e: Exception) {
                    fail("Videodekodierung fehlgeschlagen: ${e.message}")
                }
            }, "shell-decode").also { it.start() }
        }

        fun feed(frame: ScrcpyProtocol.Packet.Frame) {
            while (!stopped.get()) {
                val index = codec.dequeueInputBuffer(10_000)
                if (index < 0) continue
                val buffer = checkNotNull(codec.getInputBuffer(index))
                check(buffer.capacity() >= frame.bytes.size) { "Videopaket überschreitet Decoder-Puffer." }
                buffer.clear()
                buffer.put(frame.bytes)
                codec.queueInputBuffer(index, 0, frame.bytes.size, frame.pts, if (frame.config) MediaCodec.BUFFER_FLAG_CODEC_CONFIG else 0)
                return
            }
        }

        override fun close() {
            live = false
            output.join()
            try { codec.stop() } finally { codec.release() }
        }
    }
}

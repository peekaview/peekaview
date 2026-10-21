package de.limtec.peekaview

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Sharing this phone's screen with the protocol of the desktop app (p2p/hub.rs): Nostr signaling,
 * join requests, one WebRTC connection per viewer with the screen as video track "w0" and the
 * "pv" data channel (state, participants, pointers, drawings, remote control).
 */
class Host(
    private val context: Context,
    private val name: String,
    projectionData: Intent,
    private var width: Int,
    private var height: Int,
    private val onChange: () -> Unit,
    private val onEnded: () -> Unit,
) {
    data class Viewer(val name: String, val color: String)
    data class Request(val peer: String, val name: String, val color: String)

    private class Peer(val id: Int, val peer: String, val name: String, val color: String, val pc: PeerConnection) {
        var dc: DataChannel? = null
        var files: DataChannel? = null
        var connected = false
        var answered = false
        val pending = mutableListOf<IceCandidate>()
        val invited = System.currentTimeMillis()
        var connectedAt = 0L
        var voice = false
        // remote control: the button being held
        var holding = false
    }

    // everything runs on one thread: signaling, WebRTC callbacks, UI calls
    private val exec = Executors.newSingleThreadScheduledExecutor()
    private val secret = Signaling.newSecret()
    private val signingKey = Signaling.newSigningKey()
    private lateinit var signaling: Signaling
    private val site = Prefs.site(context)
    var link: String = ""
        private set
    @Volatile var mode: String = "view"
        private set

    private val viewers = LinkedHashMap<String, Peer>()
    private val requests = LinkedHashMap<String, Pair<Request, Long>>()
    private val admitted = HashSet<String>()
    private val denied = HashSet<String>()
    private var nextId = 1

    private val egl = Rtc.egl(context)
    private val factory = Rtc.factory(context)
    private val capturer: ScreenCapturerAndroid
    private val source: VideoSource
    private val track: VideoTrack
    private val textures: SurfaceTextureHelper
    private val ice = listOf(PeerConnection.IceServer.builder(listOf("stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478")).createIceServer())
    private val iceJson = JSONArray().put(JSONObject().put("urls", JSONArray().put("stun:stun.l.google.com:19302").put("stun:stun.cloudflare.com:3478")))

    init {
        capturer = ScreenCapturerAndroid(projectionData, object : MediaProjection.Callback() {
            // the user stopped the capture (system UI)
            override fun onStop() {
                onEnded()
            }
        })
        textures = SurfaceTextureHelper.create("capture", egl.eglBaseContext)
        source = factory.createVideoSource(true)
        capturer.initialize(textures, context, source.capturerObserver)
        track = factory.createVideoTrack("w0", source)
    }

    fun start() {
        val (w, h) = captureSize()
        capturer.startCapture(w, h, 30)
        signaling = Signaling(secret, signingKey, Prefs.relays(context)) { msg -> exec.execute { signal(msg) } }
        val room = "$secret.${Signaling.b64url(signaling.publicKey)}"
        // the configured viewer website, or the one this phone publishes over Nostr
        link = "${site.ifEmpty { Nsite.url(context) }}/#$room"
        // presence beacon: viewers waiting for this room say hello right away
        exec.scheduleWithFixedDelay({ signaling.send(JSONObject().put("type", "host")) }, 0, 15, TimeUnit.SECONDS)
        exec.scheduleWithFixedDelay(::sweep, 3, 3, TimeUnit.SECONDS)
        exec.execute(::changed)
    }

    fun stop() {
        exec.execute {
            for (v in viewers.values) {
                send(v, JSONObject().put("t", "end"))
                v.pc.close()
            }
            viewers.clear()
            runCatching { signaling.send(JSONObject().put("type", "bye").put("from", "host")) }
            exec.schedule({
                runCatching { signaling.close() }
                runCatching { capturer.stopCapture() }
                capturer.dispose()
                source.dispose()
                textures.dispose()
                exec.shutdown()
            }, 300, TimeUnit.MILLISECONDS)
        }
    }

    /** The screen turned (or changed size). */
    fun resize(w: Int, h: Int) = exec.execute {
        if (w == width && h == height) return@execute
        width = w
        height = h
        val (cw, ch) = captureSize()
        capturer.changeCaptureFormat(cw, ch, 30)
        broadcast(state())
    }

    // at most 1600 pixels on the long side: sharp enough, light on the network
    private fun captureSize(): Pair<Int, Int> {
        val scale = minOf(1.0, 1600.0 / maxOf(width, height))
        return Pair((width * scale).toInt() / 2 * 2, (height * scale).toInt() / 2 * 2)
    }

    // ------------------------------------------------------------ for the UI

    // what the UI shows, copied on every change (the UI never waits for the host's thread)
    @Volatile private var viewerList = emptyList<Viewer>()
    @Volatile private var requestList = emptyList<Request>()

    fun viewers(): List<Viewer> = viewerList

    fun requests(): List<Request> = requestList

    private fun changed() {
        viewerList = viewers.values.filter { it.connected }.map { Viewer(it.name, it.color) }
        requestList = requests.values.map { it.first }
        onChange()
    }

    fun admit(peer: String, allow: Boolean) = exec.execute {
        val request = requests.remove(peer) ?: return@execute
        if (allow) {
            admitted += peer
            invite(peer, request.first.name, request.first.color)
        } else {
            denied += peer
            signaling.send(JSONObject().put("type", "denied").put("from", "host").put("to", peer))
        }
        changed()
    }

    fun setMode(m: String) = exec.execute {
        if (m !in listOf("view", "draw", "control") || m == mode) return@execute
        mode = m
        if (m != "control") for (v in viewers.values) release(v)
        broadcast(state())
        changed()
    }

    // ------------------------------------------------------------ signaling

    private fun signal(msg: JSONObject) {
        val from = msg.optString("from")
        if (from.isEmpty() || from.length > 64 || from == "host") return
        when (msg.optString("type")) {
            "hello" -> hello(from, msg)
            "answer" -> viewers[from]?.let { v ->
                val sdp = msg.optJSONObject("sdp") ?: return
                v.pc.setRemoteDescription(Done { exec.execute { v.answered = true; v.pending.forEach(v.pc::addIceCandidate); v.pending.clear() } }, SessionDescription(SessionDescription.Type.ANSWER, sdp.optString("sdp")))
            }
            "candidate" -> viewers[from]?.let { v ->
                val c = msg.optJSONObject("candidate") ?: return
                val candidate = IceCandidate(c.optString("sdpMid"), c.optInt("sdpMLineIndex"), c.optString("candidate"))
                if (v.answered) v.pc.addIceCandidate(candidate) else v.pending += candidate
            }
            "bye" -> viewers[from]?.let { remove(it) }
            // a start page asks whether this room is online
            "ping" -> signaling.send(
                JSONObject().put("type", "pong").put("from", "host").put("to", from)
                    .put("who", "$name@${Build.MODEL}").put("name", name).put("room", JSONObject.NULL)
                    .put("permanent", false).put("sharing", true).put("pin", false).put("remote", false),
            )
        }
    }

    private fun hello(peer: String, msg: JSONObject) {
        val known = viewers[peer]
        if (known != null) {
            // a viewer that reloaded (or whose connection never came about) gets a new invitation
            val now = System.currentTimeMillis()
            val stale = (known.connected && now - known.connectedAt > 5000) || (!known.connected && now - known.invited > 10_000)
            if (!stale) return
            remove(known)
        }
        val name = msg.optString("name").filter { !it.isISOControl() }.trim().take(32).ifEmpty { "Gast" }
        val color = msg.optString("color").takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) }?.lowercase() ?: ""
        when (peer) {
            in admitted -> invite(peer, name, color)
            in denied -> signaling.send(JSONObject().put("type", "denied").put("from", "host").put("to", peer))
            else -> {
                // nobody watches without the presenter's OK
                val isNew = peer !in requests
                requests[peer] = Request(peer, name, color) to System.currentTimeMillis()
                signaling.send(JSONObject().put("type", "waiting").put("from", "host").put("to", peer))
                if (isNew) changed()
            }
        }
    }

    // requests without a repeated hello for a while are gone
    private fun sweep() {
        val now = System.currentTimeMillis()
        if (requests.values.removeIf { now - it.second > 25_000 }) changed()
    }

    // ------------------------------------------------------------ connections

    private fun invite(peer: String, name: String, helloColor: String) {
        if (viewers.size >= 12) return
        val id = nextId++
        val color = helloColor.ifEmpty { COLORS[(id - 1) % COLORS.size] }
        val config = PeerConnection.RTCConfiguration(ice).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        lateinit var v: Peer
        val pc = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) = exec.execute {
                signaling.send(
                    JSONObject().put("type", "candidate").put("from", "host").put("to", peer).put("id", id)
                        .put("candidate", JSONObject().put("candidate", candidate.sdp).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex)),
                )
            }

            override fun onConnectionChange(state: PeerConnection.PeerConnectionState) = exec.execute {
                when (state) {
                    PeerConnection.PeerConnectionState.CONNECTED -> {
                        v.connected = true
                        v.connectedAt = System.currentTimeMillis()
                        changed()
                    }
                    PeerConnection.PeerConnectionState.FAILED, PeerConnection.PeerConnectionState.CLOSED -> if (viewers[peer] === v) remove(v)
                    else -> {}
                }
            }

            override fun onSignalingChange(state: PeerConnection.SignalingState) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
            override fun onAddStream(stream: MediaStream) {}
            override fun onRemoveStream(stream: MediaStream) {}
            override fun onDataChannel(channel: DataChannel) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {}
        }) ?: return
        v = Peer(id, peer, name, color, pc)
        viewers[peer] = v
        // the screen as slot 0 ("w0": the viewer finds the window by the stream id)
        pc.addTrack(track, listOf("w0"))
        v.dc = pc.createDataChannel("pv", DataChannel.Init().apply { ordered = true }).also { dc ->
            dc.registerObserver(object : DataChannel.Observer {
                override fun onStateChange() = exec.execute { if (dc.state() == DataChannel.State.OPEN) opened(v) }
                override fun onMessage(buffer: DataChannel.Buffer) {
                    if (buffer.binary || buffer.data.remaining() > 65_536) return
                    val text = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }.toString(Charsets.UTF_8)
                    exec.execute { runCatching { message(v, JSONObject(text)) } }
                }
                override fun onBufferedAmountChange(previous: Long) {}
            })
        }
        // the shared clipboard is not offered by a phone; the channel exists for the viewer
        v.files = pc.createDataChannel("pvfile", DataChannel.Init().apply { ordered = true })
        pc.createOffer(Created { offer ->
            pc.setLocalDescription(Done { exec.execute {
                signaling.send(
                    JSONObject().put("type", "offer").put("from", "host").put("to", peer)
                        .put("sdp", JSONObject().put("type", "offer").put("sdp", offer.description))
                        .put("ice", iceJson).put("id", id).put("name", name).put("color", color),
                )
            } }, offer)
        }, MediaConstraints())
    }

    private fun remove(v: Peer) {
        viewers.remove(v.peer)
        release(v)
        runCatching { v.pc.close() }
        broadcast(JSONObject().put("t", "left").put("id", v.id))
        broadcast(peers())
        changed()
    }

    private fun opened(v: Peer) {
        send(v, JSONObject().put("t", "welcome").put("id", v.id).put("name", v.name).put("color", v.color).put("ice", iceJson))
        send(v, state())
        broadcast(peers())
        send(v, JSONObject().put("t", "clip").put("items", JSONArray()))
        changed()
    }

    private fun send(v: Peer, msg: JSONObject) {
        val dc = v.dc ?: return
        if (dc.state() != DataChannel.State.OPEN) return
        dc.send(DataChannel.Buffer(ByteBuffer.wrap(msg.toString().toByteArray()), false))
    }

    private fun broadcast(msg: JSONObject, except: Peer? = null) {
        for (v in viewers.values) if (v !== except) send(v, msg)
    }

    private fun state(): JSONObject {
        val (cw, ch) = captureSize()
        val title = Build.MODEL ?: "Android"
        val rect = JSONObject().put("x", 0).put("y", 0).put("w", width).put("h", height)
        return JSONObject()
            .put("t", "state").put("mode", mode)
            .put(
                "windows",
                JSONArray().put(
                    JSONObject().put("w", 0).put("kind", "screen").put("title", title).put("app", "Android")
                        .put("pw", cw).put("ph", ch).put("paused", false).put("reachable", true).put("z", 0).put("rect", rect),
                ),
            )
            .put("screens", JSONArray().put(JSONObject(rect.toString())))
            .put("kind", "screen").put("title", title)
            .put("paused", false).put("reachable", true).put("recording", false)
            .put("remote", false).put("apps", JSONArray()).put("resize", false).put("locked", false)
    }

    private fun peers(): JSONObject {
        val list = JSONArray().put(JSONObject().put("id", 0).put("name", name).put("color", "#ffffff").put("host", true).put("voice", false))
        for (v in viewers.values.sortedBy { it.id }) if (v.connected) list.put(JSONObject().put("id", v.id).put("name", v.name).put("color", v.color).put("voice", v.voice))
        return JSONObject().put("t", "peers").put("list", list)
    }

    // ------------------------------------------------------------ messages of a viewer

    private fun message(v: Peer, msg: JSONObject) {
        msg.put("from", v.id)
        when (msg.optString("t")) {
            // pointers and drawings go to the others (not while viewers only watch)
            "ptr" -> {
                if (mode != "view") broadcast(msg, v)
                if (mode == "control" && v.holding) control { it.move(x(msg), y(msg)) }
            }
            "ping", "draw", "clear", "hide" -> if (mode != "view") broadcast(msg, v)
            "level" -> broadcast(msg.put("v", msg.optDouble("v", 0.0).coerceIn(0.0, 1.0)), v)
            "voice" -> {
                v.voice = msg.optBoolean("on")
                broadcast(peers())
            }
            // voice chat between viewers: the phone passes it on (it does not talk itself)
            "rtc" -> viewers.values.firstOrNull { it.id == msg.optInt("to", -1) }?.let { send(it, msg) }
            "mouse" -> if (mode == "control") {
                when (msg.optString("a")) {
                    "down" -> { v.holding = true; control { it.down(x(msg), y(msg)) } }
                    "up" -> { v.holding = false; control { it.up(x(msg), y(msg)) } }
                }
            }
            "wheel" -> if (mode == "control") control {
                it.scroll(x(msg), y(msg), msg.optDouble("dx").toFloat().coerceIn(-20f, 20f) * 60, msg.optDouble("dy").toFloat().coerceIn(-20f, 20f) * 60)
            }
            "key" -> if (mode == "control") control { it.key(msg.optString("key")) }
        }
    }

    private fun release(v: Peer) {
        if (v.holding) {
            v.holding = false
            control { it.up(width / 2f, height / 2f) }
        }
    }

    // remote control through the accessibility service (switched on by the user)
    private fun control(action: (ControlService) -> Unit) {
        val service = ControlService.instance ?: return
        android.os.Handler(android.os.Looper.getMainLooper()).post { action(service) }
    }

    private fun x(msg: JSONObject) = (msg.optDouble("x", 0.5).takeIf { !it.isNaN() } ?: 0.5).coerceIn(0.0, 1.0).toFloat() * (width - 1)
    private fun y(msg: JSONObject) = (msg.optDouble("y", 0.5).takeIf { !it.isNaN() } ?: 0.5).coerceIn(0.0, 1.0).toFloat() * (height - 1)

    /** An offer was created. */
    private class Created(private val done: (SessionDescription) -> Unit) : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) = done(sdp)
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String?) {}
        override fun onSetFailure(error: String?) {}
    }

    /** A description was set. */
    private class Done(private val done: () -> Unit) : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) {}
        override fun onSetSuccess() = done()
        override fun onCreateFailure(error: String?) {}
        override fun onSetFailure(error: String?) {}
    }

    /**
     * WebRTC's factory lives as long as the app: disposing it while its network monitor still
     * reports changes crashes libwebrtc.
     */
    private object Rtc {
        private var egl: EglBase? = null
        private var factory: PeerConnectionFactory? = null

        @Synchronized fun egl(context: Context): EglBase = egl ?: EglBase.create().also { egl = it }

        @Synchronized fun factory(context: Context): PeerConnectionFactory = factory ?: run {
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context.applicationContext).createInitializationOptions())
            val base = egl(context).eglBaseContext
            PeerConnectionFactory.builder()
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(base, true, true))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(base))
                .createPeerConnectionFactory()
                .also { factory = it }
        }
    }

    companion object {
        private val COLORS = listOf("#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#8b5cf6", "#d946ef", "#ec4899")
    }
}

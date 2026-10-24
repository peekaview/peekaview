package de.limtec.peekaview

import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.H264EncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.RtpParameters
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.VideoCapturer
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
    projectionData: Intent?,
    val shellMode: Boolean,
    val fixedCall: String? = null,
    val automaticRoom: String? = null,
    private var width: Int,
    private var height: Int,
    private val onChange: () -> Unit,
    private val onEnded: (String?) -> Unit,
) {
    data class Viewer(val name: String, val color: String)
    data class Request(val peer: String, val name: String, val color: String, val device: String = "")

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
        // shared clipboard: the upload in progress, downloads one after the other, previews sent
        var upload: ClipStore.Item? = null
        val downloads = java.util.concurrent.Executors.newSingleThreadExecutor()
        val previews = HashSet<String>()
    }

    // everything runs on one thread: signaling, WebRTC callbacks, UI calls
    private val exec = Executors.newSingleThreadScheduledExecutor()
    private val stopped = java.util.concurrent.CompletableFuture<Unit>()
    private val stopping = java.util.concurrent.atomic.AtomicBoolean(false)
    // a new room – or the last one again ("Raumlink beibehalten")
    private val room = if(fixedCall==null) Prefs.room(context) else Signaling.newSecret() to Signaling.newSigningKey()
    private val secret = room.first
    private val signingKey = room.second
    private lateinit var signaling: Signaling
    var link: String = ""
        private set
    @Volatile var mode: String = "view"
        private set

    private val viewers = LinkedHashMap<String, Peer>()
    // viewers' pointers and drawings on the phone itself
    private val overlay = Overlay(context)
    private val annotations = setOf("peers", "left", "state", "ptr", "ping", "draw", "clear", "hide", "level")
    private val requests = LinkedHashMap<String, Pair<Request, Long>>()
    private val admitted = HashSet<String>()
    // a call over contacts: the members' devices (a viewer's id is its key, so it names its
    // device; only call members get this stream's secret)
    private val memberDevices = HashSet<String>()
    private val denied = HashSet<String>()
    private var nextId = 1

    private val egl = Rtc.egl(context)
    private val factory = Rtc.factory(context)
    private var capturer: VideoCapturer
    private var shell: ShellCapture?
    private val accessSelection = automaticRoom?.let{checkNotNull(RoomCalls.access(context,it)){"Unbeaufsichtigter Zugriff wurde deaktiviert."}}
    @Volatile private var apps = if(accessSelection!=null){
        val ids=accessSelection.getJSONArray("apps")
        PhoneApps.selection(context,(0 until ids.length()).map{ids.getString(it)}.toSet(),accessSelection.getJSONArray("screens").length()==0)
    }else if (shellMode) PhoneApps.allowed(context) else emptyList()
    @Volatile var appsOnly = if(accessSelection!=null) accessSelection.getJSONArray("screens").length()==0 else shellMode && Prefs.appsOnly(context)
        private set
    fun selectedApps() = apps.map { it.id }.toSet()
    fun accessCurrent():Boolean {
        val room=automaticRoom ?: return true
        val current=RoomCalls.access(context,room) ?: return false
        fun ids(value:JSONObject,key:String):Set<String>{val a=value.getJSONArray(key);return (0 until a.length()).map{a.getString(it)}.toSet()}
        return ids(current,"apps")==ids(checkNotNull(accessSelection),"apps") && ids(current,"screens")==ids(accessSelection,"screens")
    }
    val appVisible: Boolean get() = shell?.appVisible ?: true
    private var controller: Peer? = null
    private val source: VideoSource
    private val track: VideoTrack
    private val textures: SurfaceTextureHelper
    private val ice = listOf(PeerConnection.IceServer.builder(listOf("stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478")).createIceServer())
    private val iceJson = JSONArray().put(JSONObject().put("urls", JSONArray().put("stun:stun.l.google.com:19302").put("stun:stun.cloudflare.com:3478")))

    init {
        // the user (or the system) stopped the capture
        shell = if (shellMode) ShellCapture(checkNotNull(ShellHelperService.link) { "Shell-Helfer ist nicht aktiv. Bitte erneut aktivieren." }, { post { broadcast(state()); changed() } }, onEnded, appsOnly, apps) else null
        capturer = shell ?: ScreenCapture(requireNotNull(projectionData)) { onEnded(null) }
        textures = SurfaceTextureHelper.create("capture", egl.eglBaseContext)
        source = factory.createVideoSource(true)
        capturer.initialize(textures, context, source.capturerObserver)
        track = factory.createVideoTrack("w0", source)
    }

    fun start() {
        val (w, h) = captureSize()
        capturer.startCapture(w, h, 30)
        signaling = Signaling(secret, signingKey, Prefs.relays(context)) { msg -> post { signal(msg) } }
        val room = "$secret.${Signaling.b64url(signaling.publicKey)}"
        link = "${Prefs.VIEWER_SITE}/#$room"
        // presence beacon: viewers waiting for this room say hello right away
        exec.scheduleWithFixedDelay({ signaling.send(JSONObject().put("type", "host")) }, 0, 15, TimeUnit.SECONDS)
        exec.scheduleWithFixedDelay(::sweep, 3, 3, TimeUnit.SECONDS)
        overlay.show()
        post(::changed)
    }

    fun stop(): java.util.concurrent.CompletableFuture<Unit> {
        if(stopping.getAndSet(true))return stopped
        post {
            for (v in viewers.values) {
                release(v)
                v.downloads.shutdownNow()
                send(v, JSONObject().put("t", "end"))
                v.pc.close()
            }
            viewers.clear()
            runCatching { signaling.send(JSONObject().put("type", "bye").put("from", "host")) }
            overlay.hide()
            clip.clear()
            exec.schedule({
                try {
                    runCatching { signaling.close() }
                    capturer.stopCapture()
                    capturer.dispose()
                    source.dispose()
                    textures.dispose()
                    stopped.complete(Unit)
                }catch(e:Exception){stopped.completeExceptionally(e)}
                finally{exec.shutdown()}
            }, 300, TimeUnit.MILLISECONDS)
        }
        return stopped
    }

    /** The screen turned (or changed size). */
    fun resize(w: Int, h: Int) = post {
        if (w == width && h == height) return@post
        width = w
        height = h
        val (cw, ch) = captureSize()
        capturer.changeCaptureFormat(cw, ch, 30)
        broadcast(state())
    }

    private var refreshed = 0L

    /**
     * Fresh pictures now (a viewer joined or lost one): Android's screen capture only delivers a
     * frame when something changes – a resize back and forth makes it deliver two.
     */
    private fun refresh() {
        val shell = shell
        val now = System.currentTimeMillis()
        if (now - refreshed < 1000) return
        refreshed = now
        if (shell != null) {
            shell.refresh()
            return
        }
        val (cw, ch) = captureSize()
        capturer.changeCaptureFormat(cw, ch - 2, 30)
        runCatching { exec.schedule({ capturer.changeCaptureFormat(cw, ch, 30) }, 150, TimeUnit.MILLISECONDS) }
    }

    // at most 1600 pixels on the long side: sharp enough, light on the network
    private fun captureSize(): Pair<Int, Int> {
        val shell = shell
        if (shell != null && shell.videoWidth > 0 && shell.videoHeight > 0) return shell.videoWidth to shell.videoHeight
        val scale = minOf(1.0, 1600.0 / maxOf(width, height))
        return Pair((width * scale).toInt() / 2 * 2, (height * scale).toInt() / 2 * 2)
    }

    // ------------------------------------------------------------ for the UI

    // what the UI shows, copied on every change (the UI never waits for the host's thread)
    @Volatile private var viewerList = emptyList<Viewer>()
    @Volatile private var requestList = emptyList<Request>()

    fun viewers(): List<Viewer> = viewerList

    fun requests(): List<Request> = requestList

    /** Runs on the host's thread – quietly not at all once the share has ended (WebRTC's callbacks
     *  may still come; an exception there would abort libwebrtc). */
    private fun post(block: () -> Unit) {
        runCatching { exec.execute(block) }
    }

    private fun changed() {
        viewerList = viewers.values.filter { it.connected }.map { Viewer(it.name, it.color) }
        requestList = requests.values.map { it.first }
        onChange()
    }

    fun admit(peer: String, allow: Boolean) = post {
        val request = requests.remove(peer) ?: return@post
        if (allow) {
            admitted += peer
            invite(peer, request.first.name, request.first.color)
        } else {
            denied += peer
            signaling.send(JSONObject().put("type", "denied").put("from", "host").put("to", peer))
        }
        changed()
    }

    fun allowRoomMembers(peers:Set<String>) = post {
        if(fixedCall!=null) {
            memberDevices.addAll(peers)
            for((peer,request) in requests.toList()) if(request.first.device in peers) admit(peer,true)
        }
    }

    fun setMode(m: String) = post {
        if (m !in listOf("view", "draw", "control") || m == mode) return@post
        mode = m
        if (m != "control") for (v in viewers.values) release(v)
        broadcast(state())
        changed()
    }

    /** Replace only the capture source; room, peers, tracks and admissions stay intact. */
    fun setApps(selected: List<PhoneApps.App>, only: Boolean, done: (String?) -> Unit) {
        try {
            exec.execute {
                try {
                    check(shellMode) { "App-Auswahl benötigt den Shell-Helfer." }
                    if(automaticRoom!=null){
                        val policy=checkNotNull(RoomCalls.access(context,automaticRoom)){"Unbeaufsichtigter Zugriff wurde deaktiviert."}
                        val allowed=policy.getJSONArray("apps");val ids=(0 until allowed.length()).map{allowed.getString(it)}.toSet()
                        require(selected.all{it.id in ids} && (only || policy.getJSONArray("screens").length()>0)){"Diese Auswahl ist für unbeaufsichtigten Zugriff nicht freigegeben."}
                    }
                    for (viewer in viewers.values) release(viewer)
                    if (only != appsOnly) {
                        capturer.stopCapture()
                        capturer.dispose()
                        val replacement = ShellCapture(checkNotNull(ShellHelperService.link),
                            { post { broadcast(state()); changed() } }, onEnded, only, selected)
                        shell = replacement
                        capturer = replacement
                        replacement.initialize(textures, context, source.capturerObserver)
                        val (w, h) = captureSize()
                        replacement.startCapture(w, h, 30)
                    } else if (only) checkNotNull(shell).updateApps(selected)
                    apps = selected
                    appsOnly = only
                    Prefs.setAppSelection(context, selected.map { it.id }.toSet(), only)
                    broadcast(state())
                    changed()
                    done(null)
                } catch (e: Exception) {
                    done(e.message ?: "App-Auswahl konnte nicht geändert werden.")
                    onEnded(e.message)
                }
            }
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            done("Die Freigabe wurde bereits beendet.")
        }
    }

    // ------------------------------------------------------------ signaling

    private fun signal(msg: JSONObject) {
        val from = msg.optString("from")
        if (from.isEmpty() || from.length > 64 || from == "host") return
        when (msg.optString("type")) {
            "hello" -> hello(from, msg)
            "answer" -> viewers[from]?.let { v ->
                val sdp = msg.optJSONObject("sdp") ?: return
                v.pc.setRemoteDescription(Done { post { v.answered = true; v.pending.forEach(v.pc::addIceCandidate); v.pending.clear() } }, SessionDescription(SessionDescription.Type.ANSWER, sdp.optString("sdp")))
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
                    .put("permanent", false).put("sharing", true).put("pin", pin != null).put("remote", false),
            )
            // the room's PIN instead of waiting for the presenter's OK
            "pin" -> if (msg.optString("to") == "host") pinAnswer(from, msg.optString("response"))
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
        val device = msg.optString("device")
        if (device.isNotEmpty() && device in memberDevices) admitted += peer
        when (peer) {
            in admitted -> invite(peer, name, color)
            in denied -> signaling.send(JSONObject().put("type", "denied").put("from", "host").put("to", peer))
            else -> {
                // nobody watches without the presenter's OK
                val isNew = peer !in requests
                requests[peer] = Request(peer, name, color, device) to System.currentTimeMillis()
                val waiting = JSONObject().put("type", "waiting").put("from", "host").put("to", peer)
                // with a PIN: a challenge (PBKDF2 key, HMAC of a one-time nonce – the PIN never travels)
                pin?.let { waiting.put("pin", Pin.challenge(it, nonces.getOrPut(peer) { Signaling.randomId() })) }
                signaling.send(waiting)
                if (isNew) changed()
            }
        }
    }

    // the room's PIN (salt, PBKDF2 key) – set in the share screen
    private val pin = if(fixedCall==null) Prefs.pin(context) else null
    private val nonces = HashMap<String, String>()
    private val tries = HashMap<String, Int>()

    /** A viewer answered the PIN challenge: let in, or try again (5 tries, then turned away). */
    private fun pinAnswer(peer: String, response: String) {
        val pin = pin ?: return signaling.send(JSONObject().put("type", "pin-wrong").put("from", "host").put("to", peer).put("locked", true))
        val request = requests[peer]?.first
        if (request != null && Pin.verify(pin, nonces[peer], response)) {
            requests.remove(peer)
            nonces.remove(peer)
            admitted += peer
            invite(peer, request.name, request.color)
            changed()
            return
        }
        val left = (Pin.TRIES - (tries[peer] ?: 0) - 1).coerceAtLeast(0)
        tries[peer] = Pin.TRIES - left
        // a new challenge for the next try (the viewer says hello again to get it)
        nonces.remove(peer)
        signaling.send(JSONObject().put("type", "pin-wrong").put("from", "host").put("to", peer).put("left", left))
        if (left == 0) {
            requests.remove(peer)
            denied += peer
            changed()
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
        val config = PeerConnection.RTCConfiguration(ice).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            // Publish new network paths when Wi-Fi changes, without restarting the shell helper.
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        lateinit var v: Peer
        val pc = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) = post {
                signaling.send(
                    JSONObject().put("type", "candidate").put("from", "host").put("to", peer).put("id", id)
                        .put("candidate", JSONObject().put("candidate", candidate.sdp).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex)),
                )
            }

            override fun onConnectionChange(state: PeerConnection.PeerConnectionState) = post {
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
        val sender = pc.addTrack(track, listOf("w0"))
        // H.264 – every phone encodes it in hardware (VP8 would be software: slow)
        pc.transceivers.firstOrNull { it.sender == sender }?.let { t ->
            val codecs = factory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO).codecs
            val h264 = codecs.filter { it.name.equals("H264", true) }
            if (h264.isNotEmpty()) t.setCodecPreferences(h264 + codecs.filter { !it.name.equals("H264", true) && it.name !in listOf("VP8", "VP9", "AV1") })
        }
        // enough bits for a sharp screen; under pressure fewer frames *and* fewer pixels, not a
        // picture that freezes
        sender.parameters = sender.parameters.apply {
            degradationPreference = RtpParameters.DegradationPreference.BALANCED
            for (e in encodings) {
                e.maxBitrateBps = 6_000_000
                e.minBitrateBps = 300_000
                e.maxFramerate = 30
            }
        }
        v.dc = pc.createDataChannel("pv", DataChannel.Init().apply { ordered = true }).also { dc ->
            dc.registerObserver(object : DataChannel.Observer {
                override fun onStateChange() = post { if (dc.state() == DataChannel.State.OPEN) opened(v) }
                override fun onMessage(buffer: DataChannel.Buffer) {
                    if (buffer.binary || buffer.data.remaining() > 65_536) return
                    val text = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }.toString(Charsets.UTF_8)
                    post {
                        runCatching { message(v, JSONObject(text)) }.onFailure { error ->
                            send(v, JSONObject().put("t", "control-error").put("error", error.message ?: "Die Eingabe ist fehlgeschlagen."))
                        }
                    }
                }
                override fun onBufferedAmountChange(previous: Long) {}
            })
        }
        // the shared clipboard's files
        v.files = pc.createDataChannel("pvfile", DataChannel.Init().apply { ordered = true }).also { dc ->
            dc.registerObserver(object : DataChannel.Observer {
                override fun onStateChange() {}
                override fun onBufferedAmountChange(previous: Long) {}
                override fun onMessage(buffer: DataChannel.Buffer) {
                    val bytes = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }
                    if (buffer.binary) post { fileChunk(v, bytes) } else post { runCatching { fileMessage(v, JSONObject(String(bytes))) } }
                }
            })
        }
        pc.createOffer(Created { offer ->
            pc.setLocalDescription(Done { post {
                signaling.send(
                    JSONObject().put("type", "offer").put("from", "host").put("to", peer)
                        .put("sdp", JSONObject().put("type", "offer").put("sdp", offer.description))
                        .put("ice", iceJson).put("id", id).put("name", name).put("color", color),
                )
            } }, offer)
        }, MediaConstraints())
    }

    // ------------------------------------------------------------ shared clipboard

    private val clip = ClipStore(context)
    private var progressAt = 0L

    private fun clipList() = JSONObject().put("t", "clip").put("items", JSONArray(clip.all().filter { it.complete }.map { it.meta() }))

    private fun sendPreviews(v: Peer) {
        for (item in clip.all()) {
            val preview = item.preview ?: continue
            if (item.complete && v.previews.add(item.id)) send(v, JSONObject().put("t", "clip-preview").put("id", item.id).put("preview", preview))
        }
    }

    /** The clipboard changed: everybody gets the list (and new previews), the phone's screen too. */
    private fun announceClip() {
        broadcast(clipList())
        for (v in viewers.values) sendPreviews(v)
        changed()
    }

    private fun sendFile(v: Peer, msg: JSONObject) {
        val dc = v.files ?: return
        if (dc.state() == DataChannel.State.OPEN) dc.send(DataChannel.Buffer(ByteBuffer.wrap(msg.toString().toByteArray()), false))
    }

    private fun fileMessage(v: Peer, msg: JSONObject) {
        when (msg.optString("t")) {
            // an upload: the item, then its bytes
            "put" -> {
                val id = msg.optString("id")
                try {
                    val item = clip.add(
                        id, msg.optString("name"), msg.optString("mime"), msg.optLong("size"), v.id,
                        msg.optString("text").ifEmpty { null }, msg.optBoolean("hidden"), msg.optString("preview").ifEmpty { null },
                    )
                    v.upload = item
                    if (item.complete) uploaded(v, item)
                } catch (e: Exception) {
                    sendFile(v, JSONObject().put("t", "error").put("id", id).put("error", e.message ?: "Fehler"))
                }
            }
            // a download, one after the other, without flooding the connection
            "get" -> {
                val id = msg.optString("id")
                val req = msg.optInt("req")
                v.downloads.execute { serve(v, id, req) }
            }
        }
    }

    private fun fileChunk(v: Peer, bytes: ByteArray) {
        val item = v.upload ?: return
        try {
            clip.write(item, bytes)
        } catch (e: Exception) {
            v.upload = null
            clip.remove(item.id, 0)
            sendFile(v, JSONObject().put("t", "error").put("id", item.id).put("error", e.message ?: "Fehler"))
            return
        }
        val now = System.currentTimeMillis()
        if (now - progressAt > 250) {
            progressAt = now
            broadcast(JSONObject().put("t", "clip-progress").put("id", item.id).put("received", item.received))
        }
        if (item.complete) uploaded(v, item)
    }

    private fun uploaded(v: Peer, item: ClipStore.Item) {
        v.upload = null
        sendFile(v, JSONObject().put("t", "stored").put("id", item.id))
        if (!item.hidden) announceClip()
    }

    private fun serve(v: Peer, id: String, req: Int) {
        val dc = v.files ?: return
        val item = clip.get(id)?.takeIf { it.complete }
        if (item == null) return sendFile(v, JSONObject().put("t", "error").put("id", id).put("req", req).put("error", "nicht mehr vorhanden"))
        sendFile(v, JSONObject().put("t", "data").put("id", id).put("req", req).put("size", item.size))
        item.file.inputStream().use { input ->
            val buffer = ByteArray(ClipStore.CHUNK)
            while (true) {
                val n = input.read(buffer)
                if (n <= 0) break
                while (dc.state() == DataChannel.State.OPEN && dc.bufferedAmount() > 4L * 1024 * 1024) Thread.sleep(10)
                if (dc.state() != DataChannel.State.OPEN) return
                dc.send(DataChannel.Buffer(ByteBuffer.wrap(buffer.copyOf(n)), true))
            }
        }
        sendFile(v, JSONObject().put("t", "end").put("id", id).put("req", req))
    }

    // ------------------------------------------------------------ the phone's own clipboard actions

    /** Items for the share screen. */
    fun clipItems(): List<ClipStore.Item> = clip.all().filter { it.complete }

    /** The phone puts something in (text from its clipboard, a file). */
    fun clipAdd(name: String, mime: String, text: String?, preview: String?, read: (java.io.OutputStream) -> Unit) = post {
        val tmp = java.io.File.createTempFile("clip", null, context.cacheDir)
        try {
            tmp.outputStream().use(read)
            val item = clip.add(Signaling.randomId(), name, mime, tmp.length(), 0, text, false, preview)
            tmp.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buffer)
                    if (n <= 0) break
                    clip.write(item, buffer.copyOf(n))
                }
            }
            announceClip()
        } catch (e: Exception) {
            android.util.Log.w("clip", "add failed", e)
        } finally {
            tmp.delete()
        }
    }

    fun clipRemove(id: String) = post { if (clip.remove(id, 0)) announceClip() }

    /** A participant's name (for "von …" in the list). */
    fun nameOf(id: Int): String = if (id == 0) name else viewers.values.firstOrNull { it.id == id }?.name ?: "Gast"

    private fun remove(v: Peer) {
        viewers.remove(v.peer)
        v.downloads.shutdownNow()
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
        send(v, clipList())
        sendPreviews(v)
        changed()
        refresh()
    }

    private fun send(v: Peer, msg: JSONObject) {
        val dc = v.dc ?: return
        if (dc.state() != DataChannel.State.OPEN) return
        dc.send(DataChannel.Buffer(ByteBuffer.wrap(msg.toString().toByteArray()), false))
    }

    private fun broadcast(msg: JSONObject, except: Peer? = null) {
        for (v in viewers.values) if (v !== except) send(v, msg)
        if (msg.optString("t") in annotations) overlay.handle(msg)
    }

    /** "Über anderen Apps einblenden" was allowed meanwhile: the layer comes up. */
    fun showOverlay() {
        overlay.show()
        post { overlay.handle(peers()) }
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
                    // nav: viewers get the phone's back / home / recents buttons
                    JSONObject().put("w", 0).put("kind", "screen").put("title", title).put("app", "Android").put("nav", true)
                        .put("pw", cw).put("ph", ch).put("paused", false).put("reachable", true).put("z", 0).put("rect", rect),
                ),
            )
            .put("screens", JSONArray().put(JSONObject(rect.toString())))
            .put("kind", "screen").put("title", title)
            .put("paused", false).put("reachable", true).put("recording", false)
            .put("remote", shellMode).put("apps", JSONArray(if (mode == "control") apps.map { it.json() } else emptyList<JSONObject>()))
            .put("resize", false).put("locked", false)
    }

    private fun peers(): JSONObject {
        val list = JSONArray().put(JSONObject().put("id", 0).put("name", name).put("color", "#ffffff").put("host", true).put("voice", false))
        for (v in viewers.values.sortedBy { it.id }) if (v.connected) list.put(JSONObject().put("id", v.id).put("name", v.name).put("color", v.color).put("voice", v.voice))
        return JSONObject().put("t", "peers").put("list", list)
    }

    // ------------------------------------------------------------ messages of a viewer

    private fun message(v: Peer, msg: JSONObject) {
        val shell = shell
        // Do not blindly type or tap while no approved app is visible.
        if (appsOnly && shell?.appVisible != true && msg.optString("t") in setOf("mouse", "ptr", "wheel", "key", "text", "paste")) {
            controller?.let(::release)
            return
        }
        msg.put("from", v.id)
        when (msg.optString("t")) {
            // pointers and drawings go to the others (not while viewers only watch)
            "ptr" -> {
                if (mode != "view") broadcast(msg, v)
                if (mode == "control" && v.holding) pointer(v, 2, msg)
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
                    "down" -> pointer(v, 0, msg)
                    "up" -> pointer(v, 1, msg)
                }
            }
            "wheel" -> if (mode == "control") {
                if (shell != null) shell.scroll(msg.optDouble("x", 0.5), msg.optDouble("y", 0.5), msg.optDouble("dx"), msg.optDouble("dy"))
                else control { it.scroll(x(msg), y(msg), msg.optDouble("dx").toFloat().coerceIn(-20f, 20f) * 60, msg.optDouble("dy").toFloat().coerceIn(-20f, 20f) * 60) }
            }
            "key" -> if (mode == "control") {
                if (shell != null) shell.key(msg.optString("key"), msg.optBoolean("cmd"), msg.optBoolean("shift"), msg.optBoolean("alt"))
                else control { it.key(msg.optString("key")) }
            }
            "text" -> if (mode == "control") shell?.text(msg.optString("s"))
            "paste" -> if (mode == "control" && shell != null) {
                if (msg.has("textItem")) {
                    val item = requireNotNull(clip.get(msg.getString("textItem"))) { "Text ist nicht mehr vorhanden." }
                    require(item.complete && item.mime.startsWith("text/") && item.size <= 262_130) { "Ungültiger oder zu langer Text in der Zwischenablage." }
                    shell.text(item.file.readText())
                } else {
                    require(msg.has("text") && !msg.has("items")) { "In Android-Apps kann hier nur Text eingefügt werden. Für Dateien die gemeinsame Zwischenablage verwenden." }
                    shell.text(msg.getString("text"))
                }
            }
            "nav" -> if (mode == "control") {
                if (shell != null) shell.nav(msg.optString("a")) else control { it.nav(msg.optString("a")) }
            }
            "launch" -> if (mode == "control") {
                val app = msg.optString("app")
                if (apps.none { it.id == app }) send(v, JSONObject().put("t", "launch-error").put("error", "Diese App wird nicht als Startknopf angeboten."))
                else if (context.packageManager.getLaunchIntentForPackage(app) == null) send(v, JSONObject().put("t", "launch-error").put("error", "Diese App ist nicht mehr startbar."))
                else shell?.launch(app)
            }
            "keyframe" -> refresh()
            "clip-del" -> if (clip.remove(msg.optString("id"), v.id)) announceClip()
        }
    }

    private fun release(v: Peer) {
        if (v.holding) {
            v.holding = false
            controller = null
            shell?.let { it.cancel() } ?: control { it.up(width / 2f, height / 2f) }
        }
    }

    private fun pointer(v: Peer, action: Int, msg: JSONObject) {
        val shell = shell
        if (action == 0) {
            if (controller != null) return
            controller = v
            v.holding = true
        } else if (controller !== v) return
        if (shell != null) shell.touch(action, msg.optDouble("x", 0.5), msg.optDouble("y", 0.5))
        else control {
            when (action) {
                0 -> it.down(x(msg), y(msg))
                1 -> it.up(x(msg), y(msg))
                2 -> it.move(x(msg), y(msg))
            }
        }
        if (action == 1) {
            v.holding = false
            controller = null
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
                .setVideoEncoderFactory(H264EncoderFactory(base))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(base))
                .createPeerConnectionFactory()
                .also { factory = it }
        }
    }

    companion object {
        private val COLORS = listOf("#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#8b5cf6", "#d946ef", "#ec4899")
    }
}

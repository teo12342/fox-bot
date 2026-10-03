package app.foxbot

import android.content.Context
import android.app.Application
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.*
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class RemoteClient(private val context: Application, private val state: (String) -> Unit, private val receive: (JSONObject) -> Unit) {
    private val identity = DeviceIdentity()
    private val prefs = context.getSharedPreferences("fox-pairing", Context.MODE_PRIVATE)
    private val client = OkHttpClient.Builder().pingInterval(20, java.util.concurrent.TimeUnit.SECONDS).build()
    private var deviceId = prefs.getString("deviceId", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("deviceId", it).apply() }
    private var offer: PairingOffer? = null
    private var socket: WebSocket? = null
    private var peer: PeerConnection? = null
    private var channel: DataChannel? = null
    private var sessionId = ""
    private var sequence = 0L
    private val seen = ConcurrentHashMap<String, Long>()
    private val fragments = ConcurrentHashMap<String, MutableList<String>>()
    private val sender = java.util.concurrent.Executors.newSingleThreadExecutor()
    val egl = EglBase.create()
    var videoTrack: VideoTrack? = null
        private set
    var videoWidth = 16
        private set
    var videoHeight = 9
        private set
    private val factory: PeerConnectionFactory
    val connected: Boolean get() = channel?.state() == DataChannel.State.OPEN
    val verification: String get() = offer?.let { Protocol.verificationCode(it.hostId, it.publicKey, deviceId, identity.publicKey) } ?: ""
    init {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
        factory = PeerConnectionFactory.builder().setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext)).createPeerConnectionFactory()
    }
    fun pair(raw: String) { offer = PairingOffer.parse(raw); connect() }
    fun reconnect() {
        val raw = prefs.getString("host", null) ?: return state("Scan the PC pairing code first")
        val j = JSONObject(raw)
        offer = PairingOffer(j.getString("hostId"), j.getString("endpoint"), "", 0, j.getString("publicKey"))
        connect()
    }
    fun forget() { disconnect(); deviceId = UUID.randomUUID().toString(); prefs.edit().remove("host").putString("deviceId", deviceId).apply(); offer = null; state("Device disconnected. Revoke the previous device on the PC to remove its authorization.") }
    fun disconnect() { channel?.close(); channel = null; peer?.close(); peer = null; socket?.close(1000, "disconnect"); socket = null; videoTrack = null }
    private fun connect() {
        disconnect(); seen.clear(); sequence = 0; state("Connecting to your PC…")
        socket = client.newWebSocket(Request.Builder().url(offer!!.endpoint).build(), object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) { runCatching { handle(JSONObject(text)) }.onFailure { state("Connection rejected: ${it.message}") } }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { state("PC offline or relay unavailable: ${t.message}") }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { state("Disconnected: $reason") }
        })
    }
    private fun send(j: JSONObject) { check(socket?.send(j.toString()) == true) { "Relay disconnected" } }
    private fun handle(j: JSONObject) {
        val host = offer ?: return
        when (j.optString("type")) {
            "challenge" -> {
                val nonce = j.getString("nonce")
                send(JSONObject().put("type", "register").put("id", deviceId).put("hostId", host.hostId).put("publicKey", identity.publicKey).put("nonce", nonce)
                    .put("signature", identity.sign(Protocol.array(1, "register", deviceId, host.hostId, nonce))))
            }
            "registered" -> if (host.secret.isNotEmpty()) {
                check(host.expiresAt > System.currentTimeMillis()) { "Pairing code expired" }
                send(JSONObject().put("type", "pair").put("hostId", host.hostId).put("secret", host.secret).put("name", android.os.Build.MODEL))
                state("Compare $verification on the PC and approve this device")
            } else send(JSONObject().put("type", "turn"))
            "pair_approved" -> {
                check(j.getString("hostId") == host.hostId && j.getString("publicKey") == host.publicKey) { "Host identity changed" }
                prefs.edit().putString("host", JSONObject().put("hostId", host.hostId).put("endpoint", host.endpoint).put("publicKey", host.publicKey).toString()).apply()
                offer = host.copy(secret = "")
                send(JSONObject().put("type", "turn"))
            }
            "turn" -> startPeer(j.optJSONArray("iceServers") ?: JSONArray())
            "signal" -> handleSignal(j)
            "pair_rejected" -> state("PC rejected pairing")
            "pair_expired" -> state("Pairing code expired. Scan a new code.")
            "error" -> state("Relay rejected request: ${j.optString("code")}")
            "revoked" -> { disconnect(); prefs.edit().remove("host").apply(); state("The PC revoked this device") }
        }
    }
    @Synchronized private fun signal(kind: String, payload: String) {
        val host = offer ?: return
        val seq = ++sequence
        send(JSONObject().put("type", "signal").put("to", host.hostId).put("sessionId", sessionId).put("seq", seq).put("kind", kind).put("payload", payload)
            .put("signature", identity.sign(Protocol.array(1, "signal", deviceId, host.hostId, sessionId, seq, kind, payload))))
    }
    private val pendingIce = mutableListOf<IceCandidate>()
    private fun handleSignal(j: JSONObject) {
        val host = offer ?: return
        check(j.getString("from") == host.hostId && j.getString("to") == deviceId && j.getString("publicKey") == host.publicKey && j.getString("sessionId") == sessionId) { "Unknown signal identity" }
        val seq = j.getLong("seq"); val kind = j.getString("kind"); val payload = j.getString("payload")
        check(identity.verify(host.publicKey, Protocol.array(1, "signal", host.hostId, deviceId, sessionId, seq, kind, payload), j.getString("signature"))) { "Invalid signal signature" }
        check(seq > (seen[sessionId] ?: 0)) { "Replayed signal" }; seen[sessionId] = seq
        when (kind) {
            "answer" -> peer?.setRemoteDescription(object : SdpAdapter() { override fun onSetSuccess() { synchronized(pendingIce) { pendingIce.forEach { peer?.addIceCandidate(it) }; pendingIce.clear() } } }, SessionDescription(SessionDescription.Type.ANSWER, payload))
            "ice" -> {
                val iceJson = JSONObject(payload); val ice = IceCandidate(iceJson.optString("sdpMid"), iceJson.getInt("sdpMLineIndex"), iceJson.getString("candidate"))
                synchronized(pendingIce) { if (peer?.remoteDescription == null) pendingIce.add(ice) else peer?.addIceCandidate(ice) }
            }
        }
    }
    private fun startPeer(servers: JSONArray) {
        peer?.close(); pendingIce.clear(); sessionId = UUID.randomUUID().toString(); sequence = 0
        val negotiation = sessionId
        val iceServers = (0 until servers.length()).map { i ->
            val server = servers.getJSONObject(i); val urls = server.optJSONArray("urls")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: listOf(server.getString("urls"))
            PeerConnection.IceServer.builder(urls).setUsername(server.optString("username")).setPassword(server.optString("credential")).createIceServer()
        }
        val config = PeerConnection.RTCConfiguration(iceServers).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        peer = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onSignalingChange(s: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState?) { if (s == PeerConnection.IceConnectionState.FAILED || s == PeerConnection.IceConnectionState.DISCONNECTED) state("PC connection interrupted; reconnect when ready") }
            override fun onIceConnectionReceivingChange(b: Boolean) {}
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidate(c: IceCandidate) { if(sessionId == negotiation) signal("ice", JSONObject().put("candidate", c.sdp).put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex).toString()) }
            override fun onIceCandidatesRemoved(c: Array<out IceCandidate>?) {}
            override fun onAddStream(s: MediaStream?) {}
            override fun onRemoveStream(s: MediaStream?) {}
            override fun onDataChannel(c: DataChannel?) { if (c?.label() == "fox-rpc") bindChannel(c) }
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                videoTrack = receiver?.track() as? VideoTrack
                videoTrack?.addSink { frame -> if(frame.rotatedWidth != videoWidth || frame.rotatedHeight != videoHeight) { videoWidth = frame.rotatedWidth; videoHeight = frame.rotatedHeight; state("Connected · computer ${videoWidth}×${videoHeight}") } }
                if(videoTrack != null) state("Connected · computer stream available")
            }
        }) ?: error("Cannot create WebRTC connection")
        bindChannel(peer!!.createDataChannel("fox-rpc", DataChannel.Init()))
        peer!!.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY))
        peer!!.createOffer(object : SdpAdapter() {
            override fun onCreateSuccess(sdp: SessionDescription) { if(sessionId == negotiation) peer?.setLocalDescription(object : SdpAdapter() { override fun onSetSuccess() { if(sessionId == negotiation) signal("offer", sdp.description) } }, sdp) }
        }, MediaConstraints())
    }
    private fun bindChannel(c: DataChannel) {
        channel = c
        c.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) {}
            override fun onStateChange() { if(channel == c) { if (c.state() == DataChannel.State.OPEN) { state("Connected · all tasks run on your PC"); command("snapshot", JSONObject()) } else state("PC disconnected · drafts retained") } }
            override fun onMessage(buffer: DataChannel.Buffer) { if (!buffer.binary) { val bytes = ByteArray(buffer.data.remaining()); buffer.data.get(bytes); runCatching {
                check(bytes.size <= 128 * 1024) { "Oversized frame" }
                val frame = JSONObject(String(bytes, Charsets.UTF_8))
                if(frame.optString("type") == "fragment") {
                    val id = frame.getString("id"); val index = frame.getInt("index"); val total = frame.getInt("total"); val data = frame.getString("data")
                    check(total in 1..2048 && data.length <= 16384) { "Invalid fragment bounds" }
                    check(fragments.size < 8 || fragments.containsKey(id)) { "Too many pending transfers" }
                    val parts = fragments.getOrPut(id) { mutableListOf() }
                    check(index == parts.size) { "Out-of-order transfer" }; parts.add(data)
                    if(parts.size == total) { fragments.remove(id); receive(JSONObject(parts.joinToString(""))) }
                } else receive(frame)
            }.onFailure { fragments.clear(); state("Invalid host response: ${it.message}") } } }
        })
    }
    fun command(type: String, payload: JSONObject): String {
        check(connected) { "Reconnect to your PC before changing state" }
        val command = Protocol.command(type, payload)
        val text = JSONObject().put("type", "command").put("command", command).toString()
        check(text.length <= 32 * 1024 * 1024) { "Transfer is too large" }
        val target = channel!!
        sender.execute {
            runCatching {
                val transferId = UUID.randomUUID().toString()
                val chunks = buildList {
                    var start = 0
                    while(start < text.length) { var end = minOf(start + 16384, text.length); if(end < text.length && text[end - 1].isHighSurrogate()) end--; add(text.substring(start, end)); start = end }
                }
                chunks.forEachIndexed { index, data ->
                    val frame = if(chunks.size == 1) text else JSONObject().put("type", "fragment").put("id", transferId).put("index", index).put("total", chunks.size).put("data", data).toString()
                    val deadline = System.currentTimeMillis() + 30000
                    while(target.bufferedAmount() > 256 * 1024 && target.state() == DataChannel.State.OPEN && System.currentTimeMillis() < deadline) Thread.sleep(20)
                    check(target.state() == DataChannel.State.OPEN && target.send(DataChannel.Buffer(ByteBuffer.wrap(frame.toByteArray()), false))) { "PC transfer failed" }
                }
            }.onFailure { state("Transfer failed: ${it.message}") }
        }
        return command.getString("id")
    }
    open class SdpAdapter : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String?) {}
        override fun onSetFailure(error: String?) {}
    }
}


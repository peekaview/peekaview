package de.limtec.peekaview

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi
import java.io.Closeable
import java.net.NetworkInterface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Discover only this phone's advertised ADB endpoints. Connections still use 127.0.0.1. */
class AdbDiscovery(context: Context, private val onPort: (String, Int) -> Unit, private val onError: (String) -> Unit) : Closeable {
    private val nsd = context.getSystemService(NsdManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private var active = false
    private val discoveries = mutableListOf<NsdManager.DiscoveryListener>()
    private val ports = mutableMapOf<String, Pair<String, Int>>()
    private val callbacks = mutableMapOf<String, NsdManager.ServiceInfoCallback>()
    private val pending = ArrayDeque<Pair<String, NsdServiceInfo>>()
    private val found = mutableSetOf<String>()
    private var resolving = false

    fun start() = main.post {
        if (active) return@post
        active = true
        for (kind in listOf(CONNECT, PAIRING)) {
            val listener = object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(type: String) { main.post { if (!active) runCatching { nsd.stopServiceDiscovery(this) } } }
                override fun onDiscoveryStopped(type: String) {}
                override fun onStartDiscoveryFailed(type: String, error: Int) { main.post {
                    if (active) onError("Automatische ADB-Erkennung konnte nicht starten ($error). Bitte Einrichtung erneut starten.")
                } }
                override fun onStopDiscoveryFailed(type: String, error: Int) {}
                override fun onServiceFound(info: NsdServiceInfo) { main.post {
                    val key = key(kind, info)
                    if (active && found.add(key)) {
                        if (Build.VERSION.SDK_INT >= 34) track(kind, info) else {
                            pending.addLast(kind to info)
                            resolveNext()
                        }
                    }
                } }
                override fun onServiceLost(info: NsdServiceInfo) { main.post { lost(key(kind, info)) } }
            }
            discoveries.add(listener)
            try {
                nsd.discoverServices(kind, NsdManager.PROTOCOL_DNS_SD, listener)
            } catch (e: Exception) {
                onError("Automatische ADB-Erkennung ist nicht verfügbar: ${e.message}")
            }
        }
    }

    private fun key(kind: String, info: NsdServiceInfo) = "$kind/${info.serviceName}"

    private fun resolved(kind: String, info: NsdServiceInfo) {
        val key = key(kind, info)
        if (!active || key !in found) return
        val addresses = if (Build.VERSION.SDK_INT >= 34) info.hostAddresses else @Suppress("DEPRECATION") listOfNotNull(info.host)
        val local = addresses.any { address -> runCatching { NetworkInterface.getByInetAddress(address) != null }.getOrDefault(false) }
        if (!local || info.port !in 1..65535) return
        if (ports.put(key, kind to info.port) != (kind to info.port)) onPort(kind, info.port)
    }

    @RequiresApi(34)
    private fun track(kind: String, info: NsdServiceInfo) {
        val key = key(kind, info)
        val callback = object : NsdManager.ServiceInfoCallback {
            override fun onServiceUpdated(updated: NsdServiceInfo) = resolved(kind, updated)
            override fun onServiceLost() = lost(key)
            override fun onServiceInfoCallbackUnregistered() {}
            override fun onServiceInfoCallbackRegistrationFailed(error: Int) { callbacks.remove(key) }
        }
        callbacks[key] = callback
        nsd.registerServiceInfoCallback(info, { main.post(it) }, callback)
    }

    // Android 11–13 only expose one-shot resolution. Serialize it to avoid ALREADY_ACTIVE.
    @Suppress("DEPRECATION")
    private fun resolveNext() {
        if (!active || resolving || pending.isEmpty()) return
        val (kind, info) = pending.removeFirst()
        if (key(kind, info) !in found) return resolveNext()
        resolving = true
        nsd.resolveService(info, object : NsdManager.ResolveListener {
            override fun onResolveFailed(service: NsdServiceInfo, error: Int) { main.post { resolving = false; resolveNext() } }
            override fun onServiceResolved(service: NsdServiceInfo) { main.post { resolved(kind, service); resolving = false; resolveNext() } }
        })
    }

    private fun lost(key: String) {
        found.remove(key)
        if (Build.VERSION.SDK_INT >= 34) callbacks.remove(key)?.let { runCatching { nsd.unregisterServiceInfoCallback(it) } }
        ports.remove(key)?.let { (kind, _) -> onPort(kind, 0) }
    }

    override fun close() { main.post {
        active = false
        for (listener in discoveries) runCatching { nsd.stopServiceDiscovery(listener) }
        discoveries.clear()
        if (Build.VERSION.SDK_INT >= 34) for (callback in callbacks.values) runCatching { nsd.unregisterServiceInfoCallback(callback) }
        callbacks.clear()
        ports.clear()
        found.clear()
        pending.clear()
    } }

    companion object {
        const val CONNECT = "_adb-tls-connect._tcp."
        const val PAIRING = "_adb-tls-pairing._tcp."

        /** Resolve afresh before every share, so changed ports never require user input. Worker only. */
        fun connectionPort(context: Context, timeoutSeconds: Long = 15): Int {
            val ready = CountDownLatch(1)
            val port = AtomicInteger()
            val problem = AtomicReference<String>()
            AdbDiscovery(context, { kind, value ->
                if (kind == CONNECT && value > 0) { port.set(value); ready.countDown() }
            }, { problem.set(it); ready.countDown() }).use { discovery ->
                discovery.start()
                check(ready.await(timeoutSeconds, TimeUnit.SECONDS)) { "Dieses Handy wurde nicht gefunden. Verbinde es mit WLAN und schalte „Debugging über WLAN“ ein. Tippe danach erneut auf Freigabe starten." }
                problem.get()?.let { throw IllegalStateException(it) }
                return port.get().also { check(it in 1..65535) { "Kein aktueller ADB-Verbindungsport gefunden. Bitte erneut suchen." } }
            }
        }
    }
}

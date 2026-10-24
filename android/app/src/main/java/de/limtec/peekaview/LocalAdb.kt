package de.limtec.peekaview

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import io.github.muntashirakon.adb.AbsAdbConnectionManager
import java.io.DataInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.cert.Certificate
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.security.Principal
import java.util.Date
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicBoolean
import java.net.Socket
import javax.net.ssl.SSLContext
import javax.net.ssl.X509ExtendedKeyManager
import javax.net.ssl.X509TrustManager
import org.conscrypt.Conscrypt
import javax.security.auth.x500.X500Principal

/** Only this phone's adbd, over authenticated wireless debugging. Keys never leave KeyStore. */
class LocalAdb : AbsAdbConnectionManager() {
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val channels = CopyOnWriteArraySet<AdbChannel>()
    private val closed = AtomicBoolean(false)
    private val identity = object : X509ExtendedKeyManager() {
        override fun getClientAliases(type: String?, issuers: Array<out Principal>?) = arrayOf(ALIAS)
        override fun chooseClientAlias(types: Array<out String>?, issuers: Array<out Principal>?, socket: Socket?) = ALIAS
        override fun getServerAliases(type: String?, issuers: Array<out Principal>?) = if (type == "RSA") arrayOf(ALIAS) else null
        override fun chooseServerAlias(type: String?, issuers: Array<out Principal>?, socket: Socket?) = getServerAliases(type, issuers)?.first()
        override fun chooseEngineServerAlias(type: String?, issuers: Array<out Principal>?, engine: javax.net.ssl.SSLEngine?) = getServerAliases(type, issuers)?.first()
        override fun getCertificateChain(alias: String?) = arrayOf(certificate as X509Certificate)
        override fun getPrivateKey(alias: String?) = this@LocalAdb.privateKey
    }
    fun certificatePin(): ByteArray = java.security.MessageDigest.getInstance("SHA-256").digest(certificate.encoded)

    fun serverTls(): SSLContext = SSLContext.getInstance("TLSv1.3", Conscrypt.newProvider()).apply {
        init(arrayOf(identity), null, null)
    }
    private val tls by lazy {
        SSLContext.getInstance("TLSv1.3", Conscrypt.newProvider()).apply {
            init(arrayOf(identity), arrayOf(object : X509TrustManager {
                // adbd has a self-signed certificate. This transport accepts only loopback;
                // adbd authenticates our client key registered by the pairing-code exchange.
                override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
                    require(chain.size == 1) { "Ungültiges lokales ADB-Zertifikat." }
                    chain[0].checkValidity()
                    chain[0].verify(chain[0].publicKey)
                }
                override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                    throw CertificateException("PeekaView ist kein ADB-TLS-Server.")
                }
                override fun getAcceptedIssuers() = emptyArray<X509Certificate>()
            }), null)
        }
    }

    init {
        check(Build.VERSION.SDK_INT >= 30) { "Lokale ADB-Kopplung benötigt Android 11 oder neuer." }
        synchronized(LocalAdb::class.java) {
            if (!store.containsAlias(ALIAS)) {
                KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore").apply {
                    initialize(
                        KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                            .setKeySize(2048)
                            .setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
                            .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1, KeyProperties.SIGNATURE_PADDING_RSA_PSS)
                            // Conscrypt applies TLS's PSS padding itself, then calls RSA/NoPadding
                            // with the opaque KeyStore key (CryptoUpcalls.rsaSignDigestWithPrivateKey).
                            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                            .setCertificateSubject(X500Principal("CN=PeekaView"))
                            .setCertificateNotAfter(Date(4_102_444_800_000L))
                            .build(),
                    )
                    generateKeyPair()
                }
            }
        }
        setApi(Build.VERSION.SDK_INT)
        setHostAddress("127.0.0.1")
    }

    override fun getPrivateKey(): PrivateKey = store.getKey(ALIAS, null) as PrivateKey
    override fun getCertificate(): Certificate = store.getCertificate(ALIAS)
    override fun getDeviceName() = "PeekaView"

    fun pairLocal(port: Int, code: String) {
        require(port in 1..65535) { "Bitte einen gültigen Kopplungsport eingeben." }
        require(Regex("[0-9]{6}").matches(code)) { "Der Kopplungscode hat sechs Ziffern." }
        check(pair(port, code)) { "ADB-Kopplung fehlgeschlagen." }
    }

    fun verifyLocal(port: Int) {
        openLocal(port, "shell:echo peekaview-ready").use { channel ->
            val reply = channel.reader.readBytes().toString(Charsets.UTF_8).trim()
            check(reply == "peekaview-ready") { "Lokale ADB-Verbindung wurde nicht bestätigt. Bitte erneut koppeln." }
        }
    }

    fun openLocal(port: Int, destination: String, readTimeout: Int = 15_000): AdbChannel {
        require(port in 1..65535) { "Bitte den Verbindungsport aus „Debugging über WLAN“ eingeben." }
        val channel = AdbChannel { channels.remove(it) }
        channels.add(channel)
        try {
            check(!closed.get()) { "ADB-Freigabe beendet." }
            channel.open(port, destination, tls, readTimeout)
            return channel
        } catch (e: Exception) {
            channel.close()
            throw e
        }
    }

    fun closeLocal() {
        closed.set(true)
        for (channel in channels) runCatching { channel.close() }
    }

    // This client owns its channels; the paired KeyStore identity must survive closing it.
    override fun close() = closeLocal()

    /** ADB sync SEND; bootstrap data is shell-owned and never placed in a command line. */
    fun push(port: Int, path: String, bytes: ByteArray) {
        openLocal(port, "sync:").use { stream ->
            val output = stream.writer
            val input = DataInputStream(stream.reader)
            fun packet(id: String, value: Int, bytes: ByteArray? = null) {
                output.write(id.toByteArray(Charsets.US_ASCII))
                output.write(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value).array())
                if (bytes != null) output.write(bytes)
                output.flush()
            }
            val name = "$path,33152".toByteArray() // regular file, 0600; bootstrap credentials stay shell-only
            packet("SEND", name.size, name)
            for (offset in bytes.indices step (64 * 1024)) {
                val data = bytes.copyOfRange(offset, minOf(bytes.size, offset + 64 * 1024))
                packet("DATA", data.size, data)
            }
            packet("DONE", (System.currentTimeMillis() / 1000).toInt())
            val id = ByteArray(4).also(input::readFully).toString(Charsets.US_ASCII)
            val size = Integer.reverseBytes(input.readInt())
            check(id == "OKAY" && size == 0) { "Der Shell-Helfer konnte nicht übertragen werden ($id)." }
        }
    }

    companion object {
        private const val ALIAS = "peekaview-adb"
    }
}

package de.limtec.peekaview

import java.io.Closeable
import java.io.DataInputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket

/**
 * One TLS ADB connection per stream. A single caller reads its acknowledgements synchronously;
 * video, controls and logs cannot race each other's OPEN/OKAY notifications.
 * LibADB 3.1.1's AdbConnection.open() waits after sending OPEN without checking a predicate;
 * on loopback the notification may arrive before that wait. Avoid its multiplexed transport.
 * Framing: https://github.com/MuntashirAkon/libadb-android/blob/3.1.1/libadb/src/main/java/io/github/muntashirakon/adb/AdbProtocol.java
 */
class AdbChannel(private val onClose: (AdbChannel) -> Unit) : Closeable {
    private val raw = Socket()
    @Volatile private var socket: Socket = raw
    private lateinit var input: DataInputStream
    private lateinit var output: OutputStream
    private var remote = 0
    private var maxData = AdbWire.MAX_PAYLOAD_V3
    private var version = AdbWire.A_VERSION_SKIP_CHECKSUM
    private val pending = ArrayDeque<ByteArray>()
    private var data = ByteArray(0)
    private var offset = 0

    class NotReady : IOException("Der lokale Shell-Helfer lauscht noch nicht.")

    fun open(port: Int, destination: String, tls: SSLContext, readTimeout: Int) {
        raw.connect(InetSocketAddress("127.0.0.1", port), 5000)
        raw.tcpNoDelay = true
        raw.soTimeout = 15_000
        input = DataInputStream(raw.getInputStream())
        output = raw.getOutputStream()
        send(AdbWire.generateConnect())
        check(packet().command == AdbWire.A_STLS) { "ADB benötigt eine lokale WLAN-Kopplung mit TLS." }
        send(AdbWire.generateStls())
        val secure = tls.socketFactory.createSocket(raw, "127.0.0.1", port, true) as SSLSocket
        socket = secure
        secure.useClientMode = true
        secure.startHandshake()
        input = DataInputStream(secure.inputStream)
        output = secure.outputStream
        val connected = packet()
        check(connected.command == AdbWire.A_CNXN) { "Lokale ADB-Kopplung wurde nicht akzeptiert." }
        version = connected.arg0
        require(connected.arg1 in 4096..AdbWire.MAX_PAYLOAD_V3) { "Ungültige ADB-Paketgröße." }
        maxData = connected.arg1
        send(AdbWire.generateOpen(1, destination))
        val opened = packet()
        if (opened.command == AdbWire.A_CLSE) throw NotReady()
        check(opened.command == AdbWire.A_OKAY && opened.arg1 == 1) { "ADB-Stream wurde nicht bestätigt." }
        remote = opened.arg0
        socket.soTimeout = readTimeout
    }

    val reader: InputStream = object : InputStream() {
        override fun read(): Int {
            val byte = ByteArray(1)
            return if (read(byte, 0, 1) < 0) -1 else byte[0].toInt() and 255
        }

        override fun read(bytes: ByteArray, start: Int, length: Int): Int {
            if (length == 0) return 0
            while (offset == data.size) {
                if (pending.isNotEmpty()) data = pending.removeFirst()
                else {
                    val msg = packet()
                    if (msg.command == AdbWire.A_CLSE) return -1
                    check(msg.command == AdbWire.A_WRTE && msg.arg1 == 1 && msg.arg0 == remote) { "Unerwartetes ADB-Datenpaket." }
                    send(AdbWire.generateReady(1, remote))
                    data = msg.bytes
                }
                offset = 0
            }
            val count = minOf(length, data.size - offset)
            data.copyInto(bytes, start, offset, offset + count)
            offset += count
            return count
        }
    }

    val writer: OutputStream = object : OutputStream() {
        override fun write(value: Int) = write(byteArrayOf(value.toByte()))
        override fun write(bytes: ByteArray, start: Int, length: Int) {
            var position = start
            val end = start + length
            while (position < end) {
                val count = minOf(maxData, end - position)
                send(AdbWire.generateWrite(1, remote, bytes, position, count))
                while (true) {
                    val msg = packet()
                    check(msg.arg1 == 1 && msg.arg0 == remote) { "Ungültige ADB-Stream-ID." }
                    when (msg.command) {
                        AdbWire.A_OKAY -> break
                        AdbWire.A_WRTE -> {
                            pending.addLast(msg.bytes)
                            send(AdbWire.generateReady(1, remote))
                        }
                        AdbWire.A_CLSE -> throw EOFException("ADB-Stream wurde geschlossen.")
                        else -> error("Unerwartete ADB-Schreibbestätigung.")
                    }
                }
                position += count
            }
        }
    }

    private fun packet() = AdbWire.read(input, maxData, version)

    private fun send(bytes: ByteArray) {
        output.write(bytes)
        output.flush()
    }

    override fun close() {
        try { socket.close() } finally { raw.close(); onClose(this) }
    }
}

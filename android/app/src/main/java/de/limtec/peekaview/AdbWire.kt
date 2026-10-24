package de.limtec.peekaview

import java.io.DataInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Android's documented ADB framing, independent of the pairing library's asynchronous streams. */
object AdbWire {
    const val A_CNXN = 0x4e584e43
    const val A_STLS = 0x534c5453
    const val A_OPEN = 0x4e45504f
    const val A_OKAY = 0x59414b4f
    const val A_WRTE = 0x45545257
    const val A_CLSE = 0x45534c43
    const val A_VERSION_SKIP_CHECKSUM = 0x01000001
    const val MAX_PAYLOAD_V3 = 1024 * 1024

    data class Packet(val command: Int, val arg0: Int, val arg1: Int, val bytes: ByteArray)

    fun read(input: DataInputStream, maxData: Int, version: Int): Packet {
        fun number() = Integer.reverseBytes(input.readInt())
        val command = number()
        val arg0 = number()
        val arg1 = number()
        val length = number()
        val checksum = number()
        check(number() == command.inv()) { "Beschädigter ADB-Paketkopf." }
        require(length in 0..maxData) { "Ungültige ADB-Paketlänge." }
        val bytes = ByteArray(length).also(input::readFully)
        if (version < A_VERSION_SKIP_CHECKSUM) {
            check(bytes.sumOf { it.toInt() and 255 } == checksum) { "Beschädigte ADB-Nutzdaten." }
        }
        return Packet(command, arg0, arg1, bytes)
    }

    fun encode(command: Int, arg0: Int, arg1: Int, bytes: ByteArray = ByteArray(0)): ByteArray =
        ByteBuffer.allocate(24 + bytes.size).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(command).putInt(arg0).putInt(arg1).putInt(bytes.size)
            .putInt(bytes.sumOf { it.toInt() and 255 }).putInt(command.inv()).put(bytes).array()

    fun generateConnect() = encode(A_CNXN, A_VERSION_SKIP_CHECKSUM, MAX_PAYLOAD_V3, "host::\u0000".toByteArray())
    fun generateStls() = encode(A_STLS, 0x01000000, 0)
    fun generateOpen(local: Int, destination: String) = encode(A_OPEN, local, 0, "$destination\u0000".toByteArray(Charsets.UTF_8))
    fun generateReady(local: Int, remote: Int) = encode(A_OKAY, local, remote)
    fun generateWrite(local: Int, remote: Int, bytes: ByteArray, offset: Int, length: Int) = encode(A_WRTE, local, remote, bytes.copyOfRange(offset, offset + length))
}

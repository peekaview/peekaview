package de.limtec.peekaview

import java.io.DataInputStream
import java.nio.ByteBuffer

/** scrcpy 5.0.1 wire format; see upstream app/src/control_msg.c and device/Streamer.java. */
object ScrcpyProtocol {
    sealed interface Packet {
        data class Session(val width: Int, val height: Int) : Packet
        data class Frame(val bytes: ByteArray, val pts: Long, val config: Boolean) : Packet
    }

    fun readPacket(input: DataInputStream): Packet {
        val header = input.readLong()
        val size = input.readInt()
        if (header < 0) {
            val width = header.toInt()
            require(width in 1..16384 && size in 1..16384) { "Ungültige Bildschirmgröße vom Shell-Helfer." }
            return Packet.Session(width, size)
        }
        require(size in 1..16_777_216) { "Ungültige Videopaketgröße vom Shell-Helfer." }
        return Packet.Frame(ByteArray(size).also(input::readFully), header and ((1L shl 61) - 1), header and (1L shl 62) != 0L)
    }

    fun touch(action: Int, x: Double, y: Double, width: Int, height: Int): ByteArray = ByteBuffer.allocate(32)
        .put(2).put(action.toByte()).putLong(-2) // generic finger
        .putInt(coordinate(x, width)).putInt(coordinate(y, height))
        .putShort(width.toShort()).putShort(height.toShort())
        .putShort(if (action == 1 || action == 3) 0 else 0xffff.toShort())
        .putInt(0).putInt(0).array()

    fun scroll(x: Double, y: Double, width: Int, height: Int, dx: Double, dy: Double): ByteArray = ByteBuffer.allocate(21)
        .put(3).putInt(coordinate(x, width)).putInt(coordinate(y, height))
        .putShort(width.toShort()).putShort(height.toShort())
        .putShort(scrollValue(-dx)).putShort(scrollValue(-dy)).putInt(0).array()

    private fun coordinate(value: Double, size: Int) = ((if (value.isFinite()) value else 0.5).coerceIn(0.0, 1.0) * (size - 1)).toInt()
    private fun scrollValue(value: Double) = ((if (value.isFinite()) value else 0.0).coerceIn(-16.0, 16.0) * 2048).toInt().coerceIn(-32768, 32767).toShort()

    fun key(action: Int, code: Int, meta: Int = 0): ByteArray = ByteBuffer.allocate(14)
        .put(0).put(action.toByte()).putInt(code).putInt(0).putInt(meta).array()

    /** Clipboard + paste supports Unicode, including characters unavailable as Android keycodes. */
    fun clipboard(text: String, sequence: Long): ByteArray {
        require(sequence > 0) { "Eine Clipboard-Bestätigung braucht eine Sequenznummer." }
        val bytes = text.toByteArray(Charsets.UTF_8)
        require(bytes.size <= 262_130) { "Der Text ist zu lang (höchstens 262130 UTF-8-Bytes)." }
        return ByteBuffer.allocate(14 + bytes.size).put(9).putLong(sequence).put(0).putInt(bytes.size).put(bytes).array()
    }

    fun launch(packageName: String): ByteArray {
        require(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+").matches(packageName)) { "Ungültiger Paketname." }
        val bytes = packageName.toByteArray(Charsets.UTF_8)
        require(bytes.size <= 255)
        return ByteBuffer.allocate(2 + bytes.size).put(16).put(bytes.size.toByte()).put(bytes).array()
    }
}

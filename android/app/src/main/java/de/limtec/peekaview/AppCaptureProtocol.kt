package de.limtec.peekaview

import java.io.DataInputStream

/** Independent, revision-tagged images: no previous selection's pixels can become a reference frame. */
object AppCaptureProtocol {
    const val MAGIC = 0x706a7067
    data class Frame(val generation: Long, val width: Int, val height: Int, val visible: Boolean, val timestamp: Long, val bytes: ByteArray)
    fun read(input: DataInputStream): Frame {
        val generation = input.readLong()
        val width = input.readInt()
        val height = input.readInt()
        require(generation > 0 && width in 2..1600 && height in 2..1600) { "Ungültiges App-Bildformat." }
        val visible = input.readBoolean()
        val timestamp = input.readLong()
        val length = input.readInt()
        require(length in 1..8_388_608) { "Ungültige App-Bildgröße." }
        return Frame(generation, width, height, visible, timestamp, ByteArray(length).also(input::readFully))
    }
}

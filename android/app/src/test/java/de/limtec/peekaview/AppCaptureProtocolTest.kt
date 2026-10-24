package de.limtec.peekaview

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import org.junit.Assert.*
import org.junit.Test

class AppCaptureProtocolTest {
    private fun packet(generation: Long = 2, width: Int = 800, length: Int = 3) = ByteArrayOutputStream().apply {
        DataOutputStream(this).apply {
            writeLong(generation); writeInt(width); writeInt(1600); writeBoolean(false); writeLong(123456)
            writeInt(length); write(byteArrayOf(1, 2, 3))
        }
    }.toByteArray()
    @Test fun frameCarriesSelectionRevisionAndBlackoutState() {
        val frame = AppCaptureProtocol.read(DataInputStream(ByteArrayInputStream(packet())))
        assertEquals(2, frame.generation)
        assertFalse(frame.visible)
        assertEquals(800, frame.width)
        assertEquals(1600, frame.height)
        assertArrayEquals(byteArrayOf(1, 2, 3), frame.bytes)
    }
    @Test fun rejectsInvalidRevisionDimensionsAndOversizedImages() {
        for (bytes in listOf(packet(generation = 0), packet(width = 1601), packet(length = 8_388_609))) {
            assertThrows(IllegalArgumentException::class.java) { AppCaptureProtocol.read(DataInputStream(ByteArrayInputStream(bytes))) }
        }
    }
    @Test fun truncatedImageFailsInsteadOfReusingAnEarlierFrame() {
        val bytes = packet().dropLast(1).toByteArray()
        assertThrows(java.io.EOFException::class.java) { AppCaptureProtocol.read(DataInputStream(ByteArrayInputStream(bytes))) }
    }
}

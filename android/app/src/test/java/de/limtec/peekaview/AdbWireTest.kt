package de.limtec.peekaview

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.DataInputStream
import java.io.EOFException

class AdbWireTest {
    private fun hex(value: String) = value.replace(" ", "").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private fun read(bytes: ByteArray, version: Int = AdbWire.A_VERSION_SKIP_CHECKSUM) =
        AdbWire.read(DataInputStream(ByteArrayInputStream(bytes)), 1024, version)

    @Test fun opensNullTerminatedServicesWithLittleEndianHeaders() {
        assertArrayEquals(hex("4f50454e 01000000 00000000 06000000 f7010000 b0afbab1 73796e633a00"), AdbWire.generateOpen(1, "sync:"))
        assertArrayEquals(hex("53544c53 00000001 00000000 00000000 00000000 acab b3ac"), AdbWire.generateStls())
    }

    @Test fun readsAcknowledgementFixture() {
        val packet = read(hex("4f4b4159 07000000 01000000 00000000 00000000 b0b4bea6"))
        assertEquals(AdbWire.A_OKAY, packet.command)
        assertEquals(7, packet.arg0)
        assertEquals(1, packet.arg1)
        assertTrue(packet.bytes.isEmpty())
    }

    @Test fun rejectsDamagedHeadersOversizedPayloadsAndTruncation() {
        assertThrows(IllegalStateException::class.java) { read(ByteArray(24)) }
        val oversized = AdbWire.encode(AdbWire.A_WRTE, 1, 2, ByteArray(2048))
        assertThrows(IllegalArgumentException::class.java) { read(oversized) }
        val packet = AdbWire.encode(AdbWire.A_WRTE, 1, 2, hex("aabb"))
        assertThrows(EOFException::class.java) { read(packet.copyOf(packet.size - 1)) }
        packet[24] = 0
        assertThrows(IllegalStateException::class.java) { read(packet, 0x01000000) }
    }
}

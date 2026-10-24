package de.limtec.peekaview

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.DataInputStream
import java.io.EOFException

class ScrcpyProtocolTest {
    private fun hex(value: String) = value.replace(" ", "").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private fun input(value: String) = DataInputStream(ByteArrayInputStream(hex(value)))

    @Test fun readsRotationSessionsAndFrameFlags() {
        assertEquals(ScrcpyProtocol.Packet.Session(720, 1600), ScrcpyProtocol.readPacket(input("80000000 000002d0 00000640")))
        assertEquals(ScrcpyProtocol.Packet.Session(1600, 720), ScrcpyProtocol.readPacket(input("80000001 00000640 000002d0")))
        val config = ScrcpyProtocol.readPacket(input("4000000000000000 00000004 00000001")) as ScrcpyProtocol.Packet.Frame
        assertTrue(config.config)
        assertArrayEquals(hex("00000001"), config.bytes)
        val frame = ScrcpyProtocol.readPacket(input("200000000000007b 00000002 aabb")) as ScrcpyProtocol.Packet.Frame
        assertEquals(123L, frame.pts)
        assertFalse(frame.config)
        assertArrayEquals(hex("aabb"), frame.bytes)
    }

    @Test fun rejectsCorruptAndTruncatedVideo() {
        assertThrows(IllegalArgumentException::class.java) { ScrcpyProtocol.readPacket(input("80000000 00000000 00000640")) }
        assertThrows(IllegalArgumentException::class.java) { ScrcpyProtocol.readPacket(input("0000000000000000 7fffffff")) }
        assertThrows(EOFException::class.java) { ScrcpyProtocol.readPacket(input("0000000000000000 00000003 aabb")) }
    }

    @Test fun serializesTouchAgainstVideoSizeAndReleasesPressure() {
        assertArrayEquals(hex("02 00 fffffffffffffffe 0000021b 00000257 0438 0960 ffff 00000000 00000000"), ScrcpyProtocol.touch(0, 0.5, 0.25, 1080, 2400))
        val up = ScrcpyProtocol.touch(1, 2.0, -1.0, 1080, 2400)
        assertArrayEquals(hex("02 01 fffffffffffffffe 00000437 00000000 0438 0960 0000 00000000 00000000"), up)
    }

    @Test fun clipboardRequiresAckAndUsesUtf8ByteLength() {
        assertArrayEquals(hex("09 0000000000000001 00 00000006 c3a4f09f9880"), ScrcpyProtocol.clipboard("ä😀", 1))
        assertThrows(IllegalArgumentException::class.java) { ScrcpyProtocol.clipboard("ä".repeat(131_066), 2) }
        assertThrows(IllegalArgumentException::class.java) { ScrcpyProtocol.clipboard("test", 0) }
    }

    @Test fun appStartHasNoShellInterpolationOrDisplayCreation() {
        assertArrayEquals(hex("10 12 636f6d2e6578616d706c652e746573746572"), ScrcpyProtocol.launch("com.example.tester"))
        assertThrows(IllegalArgumentException::class.java) { ScrcpyProtocol.launch("com.app;reboot") }
        assertThrows(IllegalArgumentException::class.java) { ScrcpyProtocol.launch("+com.example.app") }
    }

    @Test fun scrollAndKeyMessagesMatchWireFormat() {
        assertArrayEquals(hex("03 00000000 00000000 0438 0960 f800 1000 00000000"), ScrcpyProtocol.scroll(0.0, 0.0, 1080, 2400, 1.0, -2.0))
        assertArrayEquals(hex("00 00 00000043 00000000 00001000"), ScrcpyProtocol.key(0, 67, 4096))
    }
}

package de.limtec.peekaview

import java.math.BigInteger
import java.security.MessageDigest

/**
 * BIP340 Schnorr signatures on secp256k1 – all Nostr needs (x-only public keys, signing,
 * verifying). Plain Kotlin: no native library (which Android's 16 KB page size check would have
 * to accept). Signing and verifying take a few milliseconds.
 */
object Schnorr {
    private val P = BigInteger("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F", 16)
    private val N = BigInteger("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141", 16)
    private val G = Point(
        BigInteger("79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798", 16),
        BigInteger("483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8", 16),
    )
    private val TWO = BigInteger.valueOf(2)
    private val THREE = BigInteger.valueOf(3)

    private data class Point(val x: BigInteger, val y: BigInteger)

    private fun add(a: Point?, b: Point?): Point? {
        if (a == null) return b
        if (b == null) return a
        if (a.x == b.x && a.y != b.y) return null
        val lambda = if (a == b) {
            THREE.multiply(a.x).multiply(a.x).multiply(TWO.multiply(a.y).modInverse(P)).mod(P)
        } else {
            b.y.subtract(a.y).multiply(b.x.subtract(a.x).modInverse(P)).mod(P)
        }
        val x = lambda.multiply(lambda).subtract(a.x).subtract(b.x).mod(P)
        return Point(x, lambda.multiply(a.x.subtract(x)).subtract(a.y).mod(P))
    }

    private fun multiply(k: BigInteger, base: Point = G): Point? {
        var result: Point? = null
        var addend: Point? = base
        for (i in 0 until k.bitLength()) {
            if (k.testBit(i)) result = add(result, addend)
            addend = add(addend, addend)
        }
        return result
    }

    /** The point with this x and an even y, if there is one. */
    private fun liftX(x: BigInteger): Point? {
        if (x >= P) return null
        val c = x.modPow(THREE, P).add(BigInteger.valueOf(7)).mod(P)
        val y = c.modPow(P.add(BigInteger.ONE).shiftRight(2), P)
        if (y.modPow(TWO, P) != c) return null
        return Point(x, if (y.testBit(0)) P.subtract(y) else y)
    }

    private fun bytes32(v: BigInteger): ByteArray {
        val raw = v.toByteArray()
        return when {
            raw.size == 32 -> raw
            raw.size > 32 -> raw.copyOfRange(raw.size - 32, raw.size)
            else -> ByteArray(32 - raw.size) + raw
        }
    }

    private fun int(b: ByteArray) = BigInteger(1, b)

    private fun taggedHash(tag: String, vararg parts: ByteArray): ByteArray {
        val sha = MessageDigest.getInstance("SHA-256")
        val t = sha.digest(tag.toByteArray())
        sha.update(t)
        sha.update(t)
        for (p in parts) sha.update(p)
        return sha.digest()
    }

    /** A usable secret key: 0 < key < n. */
    fun validKey(secret: ByteArray) = secret.size == 32 && int(secret).let { it.signum() > 0 && it < N }

    /** The x-only public key (32 bytes). */
    fun publicKey(secret: ByteArray): ByteArray = bytes32(multiply(int(secret))!!.x)

    /** Signature (64 bytes) of a 32-byte message, `aux`: 32 random bytes. */
    fun sign(message: ByteArray, secret: ByteArray, aux: ByteArray): ByteArray {
        require(validKey(secret) && message.size == 32 && aux.size == 32)
        val d0 = int(secret)
        val p = multiply(d0)!!
        val d = if (p.y.testBit(0)) N.subtract(d0) else d0
        val px = bytes32(p.x)
        val t = bytes32(d).zip(taggedHash("BIP0340/aux", aux)) { a, b -> (a.toInt() xor b.toInt()).toByte() }.toByteArray()
        val k0 = int(taggedHash("BIP0340/nonce", t, px, message)).mod(N)
        require(k0.signum() != 0)
        val r = multiply(k0)!!
        val k = if (r.y.testBit(0)) N.subtract(k0) else k0
        val rx = bytes32(r.x)
        val e = int(taggedHash("BIP0340/challenge", rx, px, message)).mod(N)
        return rx + bytes32(k.add(e.multiply(d)).mod(N))
    }

    /** Whether `signature` (64 bytes) is `publicKey`'s (x-only, 32 bytes) for a 32-byte message. */
    fun verify(message: ByteArray, publicKey: ByteArray, signature: ByteArray): Boolean {
        if (message.size != 32 || publicKey.size != 32 || signature.size != 64) return false
        val p = liftX(int(publicKey)) ?: return false
        val rx = signature.copyOfRange(0, 32)
        val r = int(rx)
        val s = int(signature.copyOfRange(32, 64))
        if (r >= P || s >= N) return false
        val e = int(taggedHash("BIP0340/challenge", rx, publicKey, message)).mod(N)
        val point = add(multiply(s), multiply(N.subtract(e), p)) ?: return false
        return !point.y.testBit(0) && point.x == r
    }
}

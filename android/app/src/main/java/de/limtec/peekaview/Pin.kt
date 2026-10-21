package de.limtec.peekaview

import android.util.Base64
import org.json.JSONObject
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * The room PIN as on the desktop (admission.rs): viewers get a challenge – salt, rounds and a
 * one-time nonce – and answer with HMAC-SHA256(PBKDF2(PIN), nonce); the PIN never travels.
 */
object Pin {
    /** The challenge for a waiting viewer. */
    fun challenge(pin: Pair<ByteArray, ByteArray>, nonce: String): JSONObject =
        JSONObject().put("salt", Base64.encodeToString(pin.first, Base64.NO_WRAP)).put("rounds", Prefs.PIN_ROUNDS).put("nonce", nonce)

    /** Does the viewer's answer (hex) fit the nonce? Constant-time comparison. */
    fun verify(pin: Pair<ByteArray, ByteArray>, nonce: String?, response: String): Boolean {
        if (nonce == null || response.length != 64) return false
        val given = runCatching { ByteArray(32) { response.substring(it * 2, it * 2 + 2).toInt(16).toByte() } }.getOrNull() ?: return false
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(pin.second, "HmacSHA256")) }
        return MessageDigest.isEqual(mac.doFinal(nonce.toByteArray()), given)
    }

    const val TRIES = 5
}

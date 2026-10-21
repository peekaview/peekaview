package de.limtec.peekaview

import android.content.Context

/** What a share of this phone needs to remember: the viewer website and the Nostr relays. */
object Prefs {
    private fun prefs(context: Context) = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    /** An own viewer website for links; empty: the one this phone publishes over Nostr (nsite). */
    fun site(context: Context): String = prefs(context).getString("site", "")!!.trim().trimEnd('/')

    fun setSite(context: Context, site: String) {
        val clean = site.trim().trimEnd('/')
        require(clean.isEmpty() || clean.startsWith("https://") || clean.startsWith("http://")) { "Die Zuschauer-Website muss mit https:// beginnen." }
        prefs(context).edit().putString("site", clean).apply()
    }

    /** "Raumlink beibehalten": every share uses the room (secret and presenter key) of the last one. */
    fun keepLink(context: Context) = prefs(context).getBoolean("keep_link", false)

    fun setKeepLink(context: Context, keep: Boolean) = prefs(context).edit().putBoolean("keep_link", keep).apply()

    /** The room for the next share: the kept one, or a new one (kept for next time). */
    fun room(context: Context): Pair<String, ByteArray> {
        val p = prefs(context)
        val secret = p.getString("room_secret", null)
        val key = p.getString("room_key", null)?.takeIf { it.length == 64 }?.let { hex -> ByteArray(32) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() } }
        if (keepLink(context) && secret != null && key != null && Schnorr.validKey(key)) return secret to key
        val room = Signaling.newSecret() to Signaling.newSigningKey()
        p.edit().putString("room_secret", room.first).putString("room_key", Signaling.hex(room.second)).apply()
        return room
    }

    fun relays(context: Context): List<String> =
        prefs(context).getString("relays", null)?.split(Regex("\\s+"))?.filter { it.startsWith("wss://") }?.takeIf { it.isNotEmpty() }
            ?: Signaling.DEFAULT_RELAYS
}

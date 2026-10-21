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

    fun relays(context: Context): List<String> =
        prefs(context).getString("relays", null)?.split(Regex("\\s+"))?.filter { it.startsWith("wss://") }?.takeIf { it.isNotEmpty() }
            ?: Signaling.DEFAULT_RELAYS
}

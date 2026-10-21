package de.limtec.peekaview

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * The shared clipboard of a phone's share, as on the desktop (clip.rs): items people put in –
 * files, pictures, text – kept in the app's cache until the share ends. Items are announced as
 * `{t:"clip", items:[…]}`; their bytes travel over the "pvfile" channel.
 */
class ClipStore(context: Context) {
    class Item(
        val id: String,
        val name: String,
        val mime: String,
        val size: Long,
        /** participant who put it in (0 = the phone) */
        val from: Int,
        val text: String?,
        val hidden: Boolean,
        var preview: String?,
        var received: Long,
        val file: File,
        val at: Long = System.currentTimeMillis(),
    ) {
        fun meta(): JSONObject = JSONObject()
            .put("id", id).put("name", name).put("mime", mime).put("size", size).put("from", from)
            .put("at", at).put("received", received)
            .apply { if (text != null) put("text", text) }

        val complete get() = received >= size
    }

    private val dir = File(context.cacheDir, "clip").apply { deleteRecursively(); mkdirs() }
    private val items = LinkedHashMap<String, Item>()

    fun all(): List<Item> = synchronized(items) { items.values.filter { !it.hidden } }

    fun get(id: String): Item? = synchronized(items) { items[id] }

    /** A new item; its bytes follow (`write`). Limits as on the desktop: 100 MiB each, 1 GiB, 60 items. */
    fun add(id: String, name: String, mime: String, size: Long, from: Int, text: String?, hidden: Boolean, preview: String?): Item {
        require(Regex("^[A-Za-z0-9_-]{1,32}$").matches(id)) { "ungültige Kennung" }
        require(size in 0..MAX_ITEM) { "Höchstens 100 MB pro Element" }
        synchronized(items) {
            items.remove(id)?.file?.delete()
            while (items.size >= MAX_ITEMS || items.values.sumOf { it.size } + size > MAX_TOTAL) {
                // pasted (hidden) items first, then the oldest
                val drop = items.values.firstOrNull { it.hidden } ?: items.values.first()
                items.remove(drop.id)?.file?.delete()
            }
            val item = Item(id, name.take(200).ifBlank { "Datei" }, mime.take(100).ifBlank { "application/octet-stream" }, size, from,
                text?.take(600), hidden, preview?.takeIf { it.length <= 64_000 && it.startsWith("data:image/") }, 0, File(dir, id))
            item.file.delete()
            items[id] = item
            return item
        }
    }

    fun write(item: Item, chunk: ByteArray) {
        if (item.received + chunk.size > item.size) error("zu viele Daten")
        FileOutputStream(item.file, true).use { it.write(chunk) }
        item.received += chunk.size
    }

    /** Removes an item – its owner, or the phone, may. */
    fun remove(id: String, by: Int): Boolean = synchronized(items) {
        val item = items[id] ?: return false
        if (by != 0 && item.from != by) return false
        items.remove(id)
        item.file.delete()
        true
    }

    fun clear() = synchronized(items) {
        items.clear()
        dir.deleteRecursively()
    }

    companion object {
        const val CHUNK = 16 * 1024
        private const val MAX_ITEM = 100L * 1024 * 1024
        private const val MAX_TOTAL = 1024L * 1024 * 1024
        private const val MAX_ITEMS = 60
    }
}

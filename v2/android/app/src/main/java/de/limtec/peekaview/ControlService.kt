package de.limtec.peekaview

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent

/**
 * Remote control of this phone: viewers' clicks and drags become taps and swipes. Android only
 * lets an accessibility service do that – the user switches it on once in the system settings;
 * it acts only while a share runs with "Steuern" allowed.
 */
class ControlService : AccessibilityService() {
    override fun onServiceConnected() {
        instance = this
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    // the path of the button being held: (x, y) in screen pixels with the time
    private val path = mutableListOf<Triple<Float, Float, Long>>()

    fun down(x: Float, y: Float) {
        path.clear()
        path += Triple(x, y, SystemClock.uptimeMillis())
    }

    fun move(x: Float, y: Float) {
        if (path.isNotEmpty() && path.size < 400) path += Triple(x, y, SystemClock.uptimeMillis())
    }

    /** Released: a tap, a long press or a swipe along the path. */
    fun up(x: Float, y: Float) {
        if (path.isEmpty()) return
        path += Triple(x, y, SystemClock.uptimeMillis())
        val stroke = Path().apply {
            moveTo(path.first().first, path.first().second)
            for ((px, py, _) in path.drop(1)) lineTo(px, py)
        }
        val duration = (path.last().third - path.first().third).coerceIn(40, 10_000)
        path.clear()
        dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(stroke, 0, duration)).build(), null, null)
    }

    /** Mouse wheel: a short swipe the other way round (content follows the finger). */
    fun scroll(x: Float, y: Float, dx: Float, dy: Float) {
        val stroke = Path().apply {
            moveTo(x, y)
            lineTo(x - dx.coerceIn(-600f, 600f), y - dy.coerceIn(-600f, 600f))
        }
        dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(stroke, 0, 120)).build(), null, null)
    }

    /** Keys with a meaning on a phone: Escape = back, Home = home screen. */
    fun key(name: String) {
        when (name) {
            "Escape", "BrowserBack" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "Home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "F3" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
        }
    }

    companion object {
        @Volatile
        var instance: ControlService? = null
            private set

        /** Switched on in the accessibility settings? */
        fun enabled(context: Context): Boolean {
            val list = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            return list.split(':').any { it.endsWith("/.ControlService") || it.endsWith("/de.limtec.peekaview.ControlService") }
        }
    }
}

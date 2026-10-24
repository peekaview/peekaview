package de.limtec.peekaview

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.WindowManager

/** Separate test-APK UID: its red pixels must never appear in an unapproved capture. */
class PrivateAppActivity : Activity() {
    private var overlay: View? = null
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        setContentView(View(this).apply { setBackgroundColor(Color.rgb(220, 20, 30)) })
        applyIntent()
    }
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyIntent()
    }
    private fun applyIntent() {
        if (intent.getBooleanExtra("finish", false)) { finish(); return }
        if (intent.getBooleanExtra("overlay", false) && overlay == null) {
            overlay = View(this).apply { setBackgroundColor(Color.rgb(220, 20, 30)) }
            getSystemService(WindowManager::class.java).addView(overlay, WindowManager.LayoutParams(
                500, 500, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                android.graphics.PixelFormat.OPAQUE,
            ))
        }
    }
    override fun onDestroy() {
        overlay?.let { getSystemService(WindowManager::class.java).removeView(it) }
        super.onDestroy()
    }
}

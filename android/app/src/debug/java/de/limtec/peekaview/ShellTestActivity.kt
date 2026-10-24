package de.limtec.peekaview

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.view.View
import android.view.WindowManager
import android.view.MotionEvent
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** On-device integration fixture, excluded from release builds. */
class ShellTestActivity : Activity() {
    lateinit var input: EditText
    lateinit var scroll: ScrollView
    @Volatile var lastTouch = "none"

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        lastTouch = "${event.actionMasked}@${event.x},${event.y}"
        return super.dispatchTouchEvent(event)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN)
        input = EditText(this).apply { hint = "Shell-Eingabetest"; textSize = 24f }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(35, 110, 170))
            // ADB's connection heads-up notification covers the top of the physical screen.
            addView(View(this@ShellTestActivity), LinearLayout.LayoutParams(-1, resources.displayMetrics.heightPixels / 3))
            addView(input, LinearLayout.LayoutParams(-1, 180))
            addView(View(this@ShellTestActivity), LinearLayout.LayoutParams(-1, resources.displayMetrics.heightPixels * 3))
        }
        scroll = ScrollView(this).apply { addView(column) }
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(scroll)
    }
}

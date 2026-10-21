package de.limtec.peekaview

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.view.Surface
import org.webrtc.CapturerObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer

/**
 * The phone's screen as WebRTC video. Like libwebrtc's ScreenCapturerAndroid, but a new size
 * (turning the phone, fresh frames for a new viewer) resizes the virtual display instead of
 * creating another one – since Android 14 a capture permission allows only one, and Android ends
 * the capture otherwise.
 */
class ScreenCapture(private val permission: Intent, private val onEnded: () -> Unit) : VideoCapturer {
    private lateinit var context: Context
    private lateinit var textures: SurfaceTextureHelper
    private lateinit var observer: CapturerObserver
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var density = 400

    private val callback = object : MediaProjection.Callback() {
        override fun onStop() {
            textures.handler.post { stopCapture() }
            onEnded()
        }
    }

    override fun initialize(helper: SurfaceTextureHelper, context: Context, observer: CapturerObserver) {
        this.textures = helper
        this.context = context
        this.observer = observer
        density = context.resources.displayMetrics.densityDpi
    }

    override fun startCapture(width: Int, height: Int, framerate: Int) {
        textures.handler.post {
            val manager = context.getSystemService(MediaProjectionManager::class.java)
            val p = manager.getMediaProjection(Activity.RESULT_OK, permission) ?: return@post onEnded()
            projection = p
            p.registerCallback(callback, textures.handler)
            textures.setTextureSize(width, height)
            display = p.createVirtualDisplay(
                "PeekaView", width, height, density, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                Surface(textures.surfaceTexture), null, null,
            )
            observer.onCapturerStarted(true)
            textures.startListening { frame -> observer.onFrameCaptured(frame) }
        }
    }

    override fun stopCapture() {
        textures.handler.post {
            textures.stopListening()
            display?.release()
            display = null
            projection?.unregisterCallback(callback)
            projection?.stop()
            projection = null
            observer.onCapturerStopped()
        }
    }

    /** Another size: the same virtual display, resized. */
    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {
        textures.handler.post {
            val d = display ?: return@post
            textures.setTextureSize(width, height)
            d.resize(width, height, density)
        }
    }

    override fun dispose() {}

    override fun isScreencast() = true
}

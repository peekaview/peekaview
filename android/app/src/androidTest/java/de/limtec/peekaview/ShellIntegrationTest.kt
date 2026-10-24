package de.limtec.peekaview

import android.app.UiAutomation
import android.content.Intent
import android.provider.Settings
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.webrtc.CapturerObserver
import org.webrtc.EglBase
import org.webrtc.PeerConnectionFactory
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoFrame
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import java.security.KeyStore

/** Explicit opt-in: -e adbPort PORT; pairing: -e pairPort PORT -e pairCode CODE. */
class ShellIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val args = InstrumentationRegistry.getArguments()

    @Test fun persistentIdentityLivesInAndroidKeyStore() {
        assumeTrue(android.os.Build.VERSION.SDK_INT >= 30)
        LocalAdb()
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = store.getKey("peekaview-adb", null)
        assertEquals("RSA", key.algorithm)
        assertNull("The private key must not be exportable", key.encoded)
        val cipher = javax.crypto.Cipher.getInstance("RSA/ECB/NoPadding")
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, key)
        assertEquals(256, cipher.doFinal(ByteArray(256).apply { this[255] = 1 }).size)
        val certificate = store.getCertificate("peekaview-adb").encoded
        LocalAdb()
        assertArrayEquals(certificate, store.getCertificate("peekaview-adb").encoded)
    }

    @Test fun pairLocally() {
        val port = args.getString("pairPort")?.toIntOrNull()
        val code = args.getString("pairCode")
        assumeTrue("Pass pairPort and pairCode with the system pairing dialog open", port != null && code != null)
        if (args.getString("resetIdentity") == "true") {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("peekaview-adb") }
        }
        LocalAdb().pairLocal(port!!, code!!)
    }

    @Test fun physicalScreenInputAppsRotationAndCleanup() {
        val port = args.getString("adbPort")?.toIntOrNull()
        assumeTrue("Pass the phone's wireless debugging connection port", port != null)
        fun command(text: String) = instrumentation.uiAutomation.executeShellCommand(text).use {
            java.io.FileInputStream(it.fileDescriptor).bufferedReader().readText().trim()
        }
        val originalDebug = command("settings get global adb_wifi_enabled")
        val initialWifi = command("settings get global wifi_on")
        val targetWifi = args.getString("targetWifi")
        val originalWifi = args.getString("originalWifi")
        fun connectWifi(ssid: String) {
            instrumentation.runOnMainSync {
                context.startActivity(Intent(Settings.ACTION_WIFI_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            instrumentation.uiAutomation.waitForIdle(500, 5000)
            val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(25)
            fun click(node: android.view.accessibility.AccessibilityNodeInfo?): Boolean {
                if (node == null) return false
                if (node.text?.toString() == ssid || node.contentDescription?.toString() == ssid) {
                    var item: android.view.accessibility.AccessibilityNodeInfo? = node
                    while (item != null) {
                        if (item.isClickable) return item.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)
                        item = item.parent
                    }
                }
                for (i in 0 until node.childCount) if (click(node.getChild(i))) return true
                return false
            }
            while (!click(instrumentation.uiAutomation.rootInActiveWindow) && System.nanoTime() < deadline) Thread.sleep(100)
            while (!command("cmd wifi status").contains("SSID: \"$ssid\"") && System.nanoTime() < deadline) Thread.sleep(100)
            assertTrue("Phone must really connect to target WLAN", command("cmd wifi status").contains("SSID: \"$ssid\""))
        }
        val activity = instrumentation.startActivitySync(Intent(context, ShellTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as ShellTestActivity
        val failure = AtomicReference<String>()
        val frames = AtomicInteger()
        val luma = AtomicInteger()
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
        val egl = EglBase.create()
        val textures = SurfaceTextureHelper.create("shell-test", egl.eglBaseContext)
        lateinit var activated: java.util.concurrent.CompletableFuture<ShellHelper>
        instrumentation.runOnMainSync { activated = ShellHelperService.activate(context, port!!) }
        val helper = activated.get(60, java.util.concurrent.TimeUnit.SECONDS)
        val capture = ShellCapture(helper, {}, { failure.set(it) })
        val automation = instrumentation.uiAutomation
        val autoRotate = Settings.System.getInt(context.contentResolver, Settings.System.ACCELEROMETER_ROTATION, 0)
        val initialRotation = activity.display!!.rotation
        fun waitFor(description: String, condition: () -> Boolean) {
            val end = System.nanoTime() + 30_000_000_000L
            while (!condition() && failure.get() == null && System.nanoTime() < end) Thread.sleep(50)
            assertNull(failure.get(), failure.get())
            assertTrue("$description (active=${automation.rootInActiveWindow?.packageName}, touch=${activity.lastTouch}, focused=${activity.hasWindowFocus()})", condition())
        }
        capture.initialize(textures, context, object : CapturerObserver {
            override fun onCapturerStarted(success: Boolean) { assertTrue(success) }
            override fun onCapturerStopped() {}
            override fun onFrameCaptured(frame: VideoFrame) {
                val buffer = frame.buffer.toI420()!!
                luma.set(buffer.dataY.get(buffer.strideY * (buffer.height * 3 / 4) + buffer.width / 2).toInt() and 255)
                buffer.release()
                frames.incrementAndGet()
            }
        })
        val foreign = AtomicReference<Throwable>()
        val rejected = java.util.concurrent.CountDownLatch(1)
        val queued = java.util.concurrent.CountDownLatch(1)
        val attacker = Thread({
            try {
                val trust = java.security.KeyStore.getInstance(java.security.KeyStore.getDefaultType()).apply { load(null) }
                val appKeys = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                trust.setCertificateEntry("endpoint", appKeys.getCertificate("peekaview-adb"))
                val managers = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm()).apply { init(trust) }
                val tls = javax.net.ssl.SSLContext.getInstance("TLSv1.3").apply { init(null, managers.trustManagers, null) }
                val raw = java.net.Socket("127.0.0.1", helper.port)
                queued.countDown()
                (tls.socketFactory.createSocket(raw, "127.0.0.1", helper.port, true) as javax.net.ssl.SSLSocket).use { client ->
                    client.soTimeout = 10000
                    client.startHandshake()
                    client.outputStream.write(ByteArray(32))
                    client.outputStream.flush()
                    assertEquals("Client without the random capability must be rejected", -1, client.inputStream.read())
                }
            } catch (e: Throwable) { foreign.set(e) }
            finally { queued.countDown(); rejected.countDown() }
        }, "foreign-client").apply { isDaemon = true; start() }
        try {
            assertTrue(queued.await(5, java.util.concurrent.TimeUnit.SECONDS))
            capture.startCapture(720, 1600, 30)
            waitFor("The physical screen produces decoded WebRTC frames") { frames.get() > 2 }
            assertTrue("Foreign client must be rejected without disrupting the genuine helper", rejected.await(10, java.util.concurrent.TimeUnit.SECONDS))
            assertNull(foreign.get()?.toString(), foreign.get())
            val helperPid = helper.ping()
            assertEquals("ADB Wi-Fi must be disabled after helper bootstrap", "0", command("settings get global adb_wifi_enabled"))
            if (args.getString("switchWifi") == "true") {
                command("svc wifi disable")
                waitFor("Wi-Fi is really off") { command("settings get global wifi_on") == "0" }
                val before = frames.get()
                capture.refresh()
                waitFor("Fresh physical frames without Wi-Fi or ADB transport") { frames.get() > before + 3 }
                assertEquals(helperPid, helper.ping())
                command("svc wifi enable")
                waitFor("Wi-Fi radio is back") { command("settings get global wifi_on") == "1" }
                if (targetWifi != null) {
                    require(originalWifi != null) { "Pass originalWifi so the test restores the initial network" }
                    connectWifi(targetWifi)
                    assertEquals("No new ADB Wi-Fi authorization", "0", command("settings get global adb_wifi_enabled"))
                    assertEquals("Same helper across different WLANs", helperPid, helper.ping())
                    instrumentation.runOnMainSync {
                        context.startActivity(Intent(context, ShellTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
                    }
                    waitFor("Physical test app is back after WLAN change") { automation.rootInActiveWindow?.packageName?.toString() == context.packageName }
                    capture.refresh()
                    val count = frames.get()
                    waitFor("Fresh physical frames in the new WLAN") { frames.get() > count + 3 }
                }
            }
            // Fixture blue (35,110,170) has limited-range BT.601 luma ~96. Blank/black isn't enough.
            assertTrue("Decoded frame must contain the visible physical fixture: ${luma.get()}", luma.get() in 80..115)
            waitFor("Physical test app is active") { automation.rootInActiveWindow?.packageName?.toString() == context.packageName }
            automation.waitForIdle(1000, 5000)
            val location = IntArray(2)
            instrumentation.runOnMainSync { activity.input.getLocationOnScreen(location) }
            val screen = automation.takeScreenshot()!!
            val px = (location[0] + activity.input.width / 2.0) / screen.width
            val py = (location[1] + activity.input.height / 2.0) / screen.height
            screen.recycle()
            capture.touch(0, px, py)
            capture.cancel()
            capture.touch(0, px, py)
            capture.touch(1, px, py)
            waitFor("Remote touch reaches the actual app") { activity.lastTouch != "none" }
            waitFor("Remote tap focuses the input") {
                var focused = false
                instrumentation.runOnMainSync { focused = activity.input.hasFocus() }
                focused
            }
            val value = "PeekaView äöü 😀"
            capture.text(value)
            waitFor("Unicode text reaches the focused app") {
                var text = ""
                instrumentation.runOnMainSync { text = activity.input.text.toString() }
                text == value
            }
            capture.key("a", true, false, false)
            capture.text("123")
            capture.key("Backspace", false, false, false)
            waitFor("Ctrl+A, paste and Backspace reach Android") {
                var text = ""
                instrumentation.runOnMainSync { text = activity.input.text.toString() }
                text == "12"
            }
            capture.nav("back")
            waitFor("Back hides the phone keyboard") {
                var hidden = false
                instrumentation.runOnMainSync { hidden = ViewCompat.getRootWindowInsets(activity.scroll)?.isVisible(WindowInsetsCompat.Type.ime()) == false }
                hidden
            }
            automation.waitForIdle(1000, 5000)
            capture.touch(0, 0.5, 0.8)
            for (step in 1..8) {
                capture.touch(2, 0.5, 0.8 - step * 0.06)
                Thread.sleep(30)
            }
            capture.touch(1, 0.5, 0.32)
            waitFor("Remote swipe scrolls the physical app") { activity.scroll.scrollY > 100 }
            automation.waitForIdle(500, 5000)
            val scrolled = activity.scroll.scrollY
            capture.scroll(0.5, 0.6, 0.0, 3.0)
            waitFor("Mouse wheel scrolls the physical app") { activity.scroll.scrollY > scrolled }
            val oldWidth = capture.videoWidth
            val oldHeight = capture.videoHeight
            automation.setRotation(if (initialRotation == 1) UiAutomation.ROTATION_FREEZE_0 else UiAutomation.ROTATION_FREEZE_90)
            waitFor("Capture follows physical rotation") {
                capture.videoWidth == oldHeight && capture.videoHeight == oldWidth
            }
            val count = frames.get()
            capture.refresh()
            waitFor("A reset produces fresh frames") { frames.get() > count + 2 }
            capture.launch("com.android.settings")
            waitFor("App starts on the physical screen") {
                val app = automation.rootInActiveWindow?.packageName?.toString()
                app == "com.android.settings" || app == "com.google.android.settings.intelligence"
            }
            capture.nav("home")
            waitFor("Home leaves the settings app") {
                val app = automation.rootInActiveWindow?.packageName?.toString()
                app != null && app != "com.android.settings" && app != "com.google.android.settings.intelligence" && app != context.packageName
            }
        } finally {
            try {
                capture.stopCapture()
                attacker.join(1000)
                context.stopService(Intent(context, ShellHelperService::class.java))
                // Restore orientation before selecting a network: landscape can scroll the
                // saved network below the visible area of Android's Internet settings.
                automation.setRotation(if (autoRotate == 1) UiAutomation.ROTATION_UNFREEZE else initialRotation)
                if (targetWifi != null && originalWifi != null) connectWifi(originalWifi)
            } finally {
                command("svc wifi " + if (initialWifi == "0") "disable" else "enable")
                if (originalDebug == "1") command("settings put global adb_wifi_enabled 1")
                textures.dispose()
                egl.release()
                instrumentation.runOnMainSync { activity.finish() }
            }
        }
    }
}

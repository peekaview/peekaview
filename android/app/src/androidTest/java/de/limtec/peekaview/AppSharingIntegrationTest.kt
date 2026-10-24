package de.limtec.peekaview

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.ParcelFileDescriptor
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.DataInputStream
import java.io.DataOutputStream
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLSocket
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody

/** Opt-in real compositor/TLS test. Bootstrap uses USB shell, never enables wireless debugging. */
class AppSharingIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val testContext = instrumentation.context
    private fun command(cmd: String) = instrumentation.uiAutomation.executeShellCommand(cmd).use {
        java.io.FileInputStream(it.fileDescriptor).bufferedReader().readText().trim()
    }
    private fun field(instance: Any, name: String) = instance.javaClass.getDeclaredField(name).apply { isAccessible = true }

    private fun helper(): ShellHelper {
        val helper = ShellHelper::class.java.getDeclaredConstructor(Context::class.java).apply { isAccessible = true }.newInstance(context)
        val identity = field(helper, "identity").get(helper) as LocalAdb
        val listener = field(helper, "listener").get(helper) as javax.net.ssl.SSLServerSocket
        val token = field(helper, "token").get(helper) as ByteArray
        val file = "/data/local/tmp/pv-filter-test-${java.util.UUID.randomUUID()}.json"
        val config = JSONObject().put("port", listener.localPort)
            .put("token", android.util.Base64.encodeToString(token, android.util.Base64.NO_WRAP))
            .put("certificate", android.util.Base64.encodeToString(identity.certificatePin(), android.util.Base64.NO_WRAP))
            .put("apk", context.applicationInfo.sourceDir).put("version", BuildConfig.SCRCPY_VERSION)
        val pipes = instrumentation.uiAutomation.executeShellCommandRw("sh")
        ParcelFileDescriptor.AutoCloseOutputStream(pipes[1]).use { it.write("umask 077\ncat > $file <<'PV_BOOTSTRAP'\n$config\nPV_BOOTSTRAP\n".toByteArray()) }
        ParcelFileDescriptor.AutoCloseInputStream(pipes[0]).use { it.readBytes() }
        val launched = instrumentation.uiAutomation.executeShellCommand("env CLASSPATH=${context.applicationInfo.sourceDir} app_process / --nice-name=peekaview-filter-test de.limtec.peekaview.shell.ShellHelperMain $file")
        try {
            val manager = helper.javaClass.getDeclaredMethod("accept", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
                .apply { isAccessible = true }.invoke(helper, 0, 0) as SSLSocket
            manager.soTimeout = 20000
            field(helper, "manager").set(helper, manager)
            field(helper, "input").set(helper, DataInputStream(manager.inputStream))
            field(helper, "output").set(helper, DataOutputStream(manager.outputStream))
            assertTrue(helper.ping() > 0)
            return helper
        } catch (error: Throwable) { helper.close(); throw AssertionError("Test helper bootstrap failed", error) }
        finally { launched.close() }
    }

    @Test fun compositorFiltersForeignPixelsAndSelectionUpdatesKeepTheSession() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("appSharingTest") == "true")
        assumeTrue(android.os.Build.VERSION.SDK_INT >= 34)
        val beforeDebug = command("settings get global adb_wifi_enabled")
        val own = PhoneApps.App(context.packageName, "Approved blue app", context.applicationInfo.uid, true)
        val other = PhoneApps.App(testContext.packageName, "Private red app", testContext.applicationInfo.uid, true)
        assertNotEquals(own.uid, other.uid)
        val activity = instrumentation.startActivitySync(Intent(context, ShellTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as ShellTestActivity
        val helper = helper()
        try {
            val pid = helper.ping()
            val streams = helper.startCapture(listOf(own))
            streams.video.soTimeout = 15000
            val input = DataInputStream(streams.video.inputStream)
            assertEquals(AppCaptureProtocol.MAGIC, input.readInt())
            fun image(generation: Long, predicate: (Int) -> Boolean, visible: Boolean? = null): AppCaptureProtocol.Frame {
                val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
                while (System.nanoTime() < end) {
                    val frame = AppCaptureProtocol.read(input)
                    if (frame.generation != generation) continue
                    val bitmap = checkNotNull(BitmapFactory.decodeByteArray(frame.bytes, 0, frame.bytes.size))
                    try {
                        if (generation != 2L) assertNoPrivatePixels(bitmap)
                        if ((visible == null || frame.visible == visible) && predicate(bitmap.getPixel(bitmap.width / 2, bitmap.height / 2))) return frame
                    }
                    finally { bitmap.recycle() }
                }
                throw AssertionError("No expected frame for selection $generation")
            }
            fun black(color: Int) = Color.red(color) < 12 && Color.green(color) < 12 && Color.blue(color) < 12
            fun blue(color: Int) = Color.blue(color) > 120 && Color.blue(color) > Color.red(color) + 60
            fun red(color: Int) = Color.red(color) > 160 && Color.red(color) > Color.blue(color) + 80
            assertTrue(image(1, ::blue).visible)
            command("am start -W -n ${testContext.packageName}/${PrivateAppActivity::class.java.name}")
            assertFalse("Unapproved real app produces black frames", image(1, ::black, false).visible)
            helper.updateApps(2, listOf(other))
            assertTrue(image(2, ::red).visible)
            helper.updateApps(3, emptyList())
            assertFalse(image(3, ::black, false).visible)
            helper.updateApps(4, listOf(own))
            image(4, ::black)
            instrumentation.runOnMainSync { activity.startActivity(Intent(context, ShellTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }
            image(4, ::blue)
            instrumentation.runOnMainSync { activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE) }
            image(4, ::black)
            instrumentation.runOnMainSync { activity.window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE) }
            image(4, ::blue)
            // A foreign UID overlays a visible approved app: polling foreground packages alone would leak red.
            command("appops set ${testContext.packageName} SYSTEM_ALERT_WINDOW allow")
            command("am start -W -f 0x24000000 -n ${testContext.packageName}/${PrivateAppActivity::class.java.name} --ez overlay true")
            instrumentation.runOnMainSync { activity.startActivity(Intent(context, ShellTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }
            repeat(8) {
                val frame = AppCaptureProtocol.read(input)
                if (frame.generation == 4L) {
                    val bitmap = checkNotNull(BitmapFactory.decodeByteArray(frame.bytes, 0, frame.bytes.size))
                    try { assertNoPrivatePixels(bitmap) }
                    finally { bitmap.recycle() }
                }
            }
            assertEquals("Selection edits keep the exact TLS video channel", streams, field(helper, "capture").get(helper))
            assertEquals("Same detached helper", pid, helper.ping())
            helper.stopCapture(streams)
            // A second capture in the same helper also exercises native wrapper reuse.
            val next = helper.startCapture(emptyList())
            next.video.soTimeout = 10000
            assertEquals(AppCaptureProtocol.MAGIC, DataInputStream(next.video.inputStream).readInt())
            helper.stopCapture(next)
            command("am start -W -f 0x24000000 -n ${testContext.packageName}/${PrivateAppActivity::class.java.name} --ez finish true")
            instrumentation.runOnMainSync { activity.startActivity(Intent(context, ShellTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }
            hostKeepsItsTrackAndFramesAcrossSelectionChanges(helper, own)
            assertEquals(beforeDebug, command("settings get global adb_wifi_enabled"))
        } finally {
            helper.close()
            command("am start -W -f 0x24000000 -n ${testContext.packageName}/${PrivateAppActivity::class.java.name} --ez finish true")
            command("appops set ${testContext.packageName} SYSTEM_ALERT_WINDOW default")
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    private fun assertNoPrivatePixels(bitmap: android.graphics.Bitmap) {
        for (y in 0 until bitmap.height step 4) for (x in 0 until bitmap.width step 4) {
            val color = bitmap.getPixel(x, y)
            assertFalse("Unapproved red pixels at $x,$y", Color.red(color) > 160 && Color.red(color) > Color.blue(color) + 80)
        }
    }

    @Test fun unattendedCallUsesOnlyApprovedAppsAndStopsWhenDisabled() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("unattendedTest") == "true")
        assumeTrue(android.os.Build.VERSION.SDK_INT >= 34)
        assertNull("The test must not interrupt another share",HostService.host)
        val activity=instrumentation.startActivitySync(Intent(context,ShellTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val helper=helper()
        val link=ShellHelperService::class.java.getDeclaredField("link").apply{isAccessible=true}
        val previousLink=link.get(null)
        val http=RoomCalls::class.java.getDeclaredField("http").apply{isAccessible=true}
        val previousHttp=http.get(null)
        val preferences=listOf("fixed_rooms","settings").associateWith{context.getSharedPreferences(it,Context.MODE_PRIVATE).all}
        val room="a123456789abcdef";val call="b123456789abcdef"
        val status=java.util.concurrent.atomic.AtomicReference("none")
        val autoJoins=java.util.concurrent.atomic.AtomicInteger()
        val own=PhoneApps.App(context.packageName,"Approved app",context.applicationInfo.uid,true)
        val client=okhttp3.OkHttpClient.Builder().addInterceptor{chain->
            val request=chain.request()
            val data=when(request.url.queryParameter("action")){
                "calls/auto-join"->{autoJoins.incrementAndGet();status.set("joined");JSONObject()}
                "calls/leave"->{status.set("none");JSONObject()}
                "state"->JSONObject().put("calls",org.json.JSONArray().also{calls->
                    if(status.get()!="none")calls.put(JSONObject().put("id",call).put("room",room).put("status",status.get())
                        .put("unattended_allowed",true).put("participants",org.json.JSONArray()))
                })
                else->JSONObject()
            }
            okhttp3.Response.Builder().request(request).protocol(okhttp3.Protocol.HTTP_1_1).code(200).message("OK")
                .body(data.toString().toResponseBody("application/json".toMediaType())).build()
        }.build()
        fun await(message:String,condition:()->Boolean){
            val end=System.nanoTime()+TimeUnit.SECONDS.toNanos(30)
            while(!condition() && System.nanoTime()<end)Thread.sleep(100)
            assertTrue("$message; ${HostService.lastError}",condition())
        }
        try{
            link.set(null,helper);http.set(null,client)
            context.getSharedPreferences("fixed_rooms",Context.MODE_PRIVATE).edit().clear().commit()
            RoomCalls.configure(context,JSONObject().put("api","https://example.test/api.php").put("token","t".repeat(43)).toString())
            context.getSharedPreferences("settings",Context.MODE_PRIVATE).edit().putString("relays","wss://127.0.0.1:1").commit()
            val options=JSONObject(RoomCalls.accessOptions(context,room))
            assertFalse(options.toString(),options.has("error"))
            val selection=JSONObject().put("enabled",true).put("screens",org.json.JSONArray()).put("apps",org.json.JSONArray().put(own.id))
            val configured=JSONObject(RoomCalls.configureAccess(context,room,selection.toString()))
            assertFalse(configured.toString(),configured.has("error"))
            await("Foreground readiness is armed"){HostService.isArmed()}
            // The call arrives while the setup activity is no longer in the foreground.
            command("input keyevent KEYCODE_HOME")
            status.set("ringing")
            await("PIN-authorized incoming call starts the actual capture"){HostService.host?.fixedCall==call}
            val host=checkNotNull(HostService.host)
            assertEquals(room,host.automaticRoom)
            assertTrue("App-only access must never expand to the whole display",host.appsOnly)
            assertEquals(setOf(own.id),host.selectedApps())
            assertTrue(host.accessCurrent())
            await("Control mode is active"){host.mode=="control"}
            Thread.sleep(7000)
            assertSame("The first poll must not immediately stop the new share",host,HostService.host)
            assertEquals(1,autoJoins.get())
            val disabled=JSONObject(RoomCalls.configureAccess(context,room,JSONObject().put("enabled",false).toString()))
            assertFalse(disabled.toString(),disabled.has("error"))
            await("Disabling access ends automatic capture"){HostService.host==null}
            assertFalse(host.accessCurrent())
            await("Disabling the last group removes foreground readiness"){!HostService.isArmed()}
        }finally{
            context.stopService(Intent(context,RoomCallsService::class.java))
            context.stopService(Intent(context,HostService::class.java))
            await("Capture resources stop"){HostService.host==null}
            Thread.sleep(1000)
            http.set(null,previousHttp);link.set(null,previousLink);helper.close()
            for((name,saved) in preferences){
                val edit=context.getSharedPreferences(name,Context.MODE_PRIVATE).edit().clear()
                for((key,value)in saved)when(value){
                    is String->edit.putString(key,value)
                    is Boolean->edit.putBoolean(key,value)
                    is Int->edit.putInt(key,value)
                    is Long->edit.putLong(key,value)
                    is Float->edit.putFloat(key,value)
                    is Set<*>->edit.putStringSet(key,value.filterIsInstance<String>().toSet())
                }
                edit.commit()
            }
            instrumentation.runOnMainSync{activity.finish()}
        }
    }

    private fun hostKeepsItsTrackAndFramesAcrossSelectionChanges(helper: ShellHelper, own: PhoneApps.App) {
        val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
        val saved = prefs.all
        val link = ShellHelperService::class.java.getDeclaredField("link").apply { isAccessible = true }
        val previous = link.get(null)
        var host: Host? = null
        val failures = java.util.concurrent.ConcurrentLinkedQueue<String>()
        val pixels = java.util.concurrent.LinkedBlockingQueue<Triple<Int, Int, Int>>()
        val sink = org.webrtc.VideoSink { frame ->
            val buffer = frame.buffer.toI420() ?: return@VideoSink
            try {
                val x = buffer.width / 2; val y = buffer.height / 2
                pixels.offer(Triple(buffer.dataY.get(y * buffer.strideY + x).toInt() and 255,
                    buffer.dataU.get(y / 2 * buffer.strideU + x / 2).toInt() and 255,
                    buffer.dataV.get(y / 2 * buffer.strideV + x / 2).toInt() and 255))
            } finally { buffer.release() }
        }
        fun awaitFrame(black: Boolean) {
            val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
            while (System.nanoTime() < end) {
                assertTrue("Capture failed: $failures", failures.isEmpty())
                val p = pixels.poll(200, TimeUnit.MILLISECONDS) ?: continue
                if (if (black) p.first < 25 else p.first > 60 && p.second > 145 && p.third < 125) return
            }
            fail("No ${if (black) "black" else "blue"} WebRTC frame; capture errors: $failures")
        }
        var track: org.webrtc.VideoTrack? = null
        try {
            link.set(null, helper)
            Prefs.setAppSelection(context, setOf(own.id), true)
            val current = Host(context, "Local capture test", null, true, width=1280, height=2856, onChange={}, onEnded={ failures.add(it ?: "Capture ended") })
            host = current
            track = field(current, "track").get(current) as org.webrtc.VideoTrack
            val source = field(current, "source").get(current)
            val room = field(current, "room").get(current)
            track.addSink(sink)
            (field(current, "capturer").get(current) as org.webrtc.VideoCapturer).startCapture(716, 1600, 30)
            awaitFrame(false)
            fun select(apps: List<PhoneApps.App>, only: Boolean) {
                val done = java.util.concurrent.CountDownLatch(1)
                var error: String? = null
                current.setApps(apps, only) { error = it; done.countDown() }
                assertTrue("Selection edit timed out", done.await(15, TimeUnit.SECONDS))
                assertNull(error)
                assertSame(track, field(current, "track").get(current))
                assertSame(source, field(current, "source").get(current))
                assertSame(room, field(current, "room").get(current))
                pixels.clear()
            }
            select(emptyList(), true); awaitFrame(true)
            select(listOf(own), true); awaitFrame(false)
            select(listOf(own), false); awaitFrame(false)
            select(listOf(own), true); awaitFrame(false)
            assertTrue(failures.toString(), failures.isEmpty())
        } finally {
            track?.removeSink(sink)
            host?.let {
                it.stop()
                val exec = field(it, "exec").get(it) as java.util.concurrent.ScheduledExecutorService
                val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
                while (!exec.isTerminated && System.nanoTime() < end) Thread.sleep(50)
                assertTrue("Host resources did not stop", exec.isTerminated)
            }
            link.set(null, previous)
            val edit = prefs.edit().clear()
            saved.forEach { (key, value) -> when (value) {
                is String -> edit.putString(key, value)
                is Boolean -> edit.putBoolean(key, value)
                is Int -> edit.putInt(key, value)
                is Long -> edit.putLong(key, value)
                is Float -> edit.putFloat(key, value)
                is Set<*> -> edit.putStringSet(key, value.filterIsInstance<String>().toSet())
            } }
            edit.commit()
        }
    }

}

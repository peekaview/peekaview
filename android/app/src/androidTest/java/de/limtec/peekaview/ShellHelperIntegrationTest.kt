package de.limtec.peekaview

import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

/** Device opt-in: -e helperTest true. Uses the app's saved ADB pairing and actual boot path. */
class ShellHelperIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test fun shareStartsHelperImplicitlyAndContinuesAfterSettings() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("implicitShareTest")=="true")
        assumeTrue(Prefs.adbPaired(context))
        assumeTrue(android.os.Build.VERSION.SDK_INT>=34)
        val keyguard=context.getSystemService(android.app.KeyguardManager::class.java)
        val unlockUntil=System.nanoTime()+TimeUnit.MINUTES.toNanos(2)
        while(keyguard.isKeyguardLocked && System.nanoTime()<unlockUntil)Thread.sleep(100)
        assumeTrue("Unlock the phone before running this foreground-sharing test",!keyguard.isKeyguardLocked)
        assertNull("Do not interrupt another share",HostService.host)
        assertNull("This test needs a stopped helper",ShellHelperService.link)
        fun command(text:String)=instrumentation.uiAutomation.executeShellCommand(text).use{
            java.io.FileInputStream(it.fileDescriptor).bufferedReader().readText().trim()
        }
        fun await(message:String,condition:()->Boolean){
            val end=System.nanoTime()+TimeUnit.SECONDS.toNanos(60)
            while(!condition() && System.nanoTime()<end)Thread.sleep(100)
            assertTrue("$message; ${AdbSetupService.state()}; ${HostService.lastError}",condition())
        }
        val preferences=listOf("settings","fixed_rooms").associateWith{context.getSharedPreferences(it,android.content.Context.MODE_PRIVATE).all}
        val debug=command("settings get global adb_wifi_enabled")
        var activity:ShareActivity?=null
        fun state():org.json.JSONObject{
            val method=ShareActivity::class.java.getDeclaredMethod("state").apply{isAccessible=true}
            return org.json.JSONObject(method.invoke(checkNotNull(activity)) as String)
        }
        fun start(){instrumentation.runOnMainSync{
            checkNotNull(activity).Bridge().start("Implicit start test",false,false,"",true,0,"[\"${context.packageName}\"]",true)
        }}
        fun hasFrame():Boolean{
            val field=Host::class.java.getDeclaredField("shell").apply{isAccessible=true}
            val capture=HostService.host?.let{field.get(it) as? ShellCapture}
            return capture!=null && capture.videoWidth>0 && capture.videoHeight>0
        }
        try{
            context.getSharedPreferences("fixed_rooms",android.content.Context.MODE_PRIVATE).edit().putBoolean("enabled",false).commit()
            context.getSharedPreferences("settings",android.content.Context.MODE_PRIVATE).edit().putString("site","https://example.test").putString("relays","wss://127.0.0.1:1").commit()
            command("settings put global adb_wifi_enabled 0")
            command("cmd statusbar collapse")
            activity=instrumentation.startActivitySync(Intent(context,ShareActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as ShareActivity
            instrumentation.runOnMainSync{checkNotNull(activity).window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}
            start()
            await("One share click starts the setup assistant"){AdbSetupService.active && state().optBoolean("starting")}
            instrumentation.runOnMainSync{checkNotNull(activity).Bridge().adbSetupStop()}
            await("Cancel clears the pending action"){!AdbSetupService.active && !state().optBoolean("starting")}
            assertNull(HostService.host)
            command("am start -n ${context.packageName}/.ShareActivity")
            start()
            await("The notification can cancel setup too"){AdbSetupService.active}
            context.startService(Intent(context,AdbSetupService::class.java).setAction(AdbSetupService.STOP))
            await("Notification cancellation clears the pending share"){!AdbSetupService.active && !state().optBoolean("starting")}
            assertNull(HostService.host)
            start()
            await("A second request reuses the saved pairing"){AdbSetupService.active}
            // Recreate during the interrupted action: no PIN or grant is serialized.
            val monitor=instrumentation.addMonitor(ShareActivity::class.java.name,null,false)
            instrumentation.runOnMainSync{checkNotNull(activity).recreate()}
            activity=monitor.waitForActivityWithTimeout(10000) as? ShareActivity ?: error("ShareActivity was not restored")
            instrumentation.removeMonitor(monitor)
            instrumentation.runOnMainSync{checkNotNull(activity).window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}
            assertTrue(state().getBoolean("starting"))
            assertEquals(setOf(context.packageName),Prefs.shellApps(context))
            instrumentation.runOnMainSync{checkNotNull(activity).Bridge().debuggingSettings()}
            await("PeekaView opens Android Settings for the pending share"){
                !checkNotNull(activity).lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)
            }
            // Optionally exercise the nested Settings page as well as its root.
            if(InstrumentationRegistry.getArguments().getString("nestedSettingsTest")=="true"){
                fun descendants(node:android.view.accessibility.AccessibilityNodeInfo):Sequence<android.view.accessibility.AccessibilityNodeInfo> = sequence{
                    yield(node)
                    for(index in 0 until node.childCount)node.getChild(index)?.let{yieldAll(descendants(it))}
                }
                await("Settings content is visible"){instrumentation.uiAutomation.rootInActiveWindow?.packageName?.toString()=="com.android.settings"}
                var openedWireless=false
                for(attempt in 0 until 15){
                    val root=instrumentation.uiAutomation.rootInActiveWindow
                    var row=root?.let{descendants(it).firstOrNull{node->node.text?.toString() in listOf("Debugging über WLAN","WLAN-Debugging","Wireless debugging")}}
                    if(row!=null){
                        while(row!=null && !row.isClickable)row=row.parent
                        openedWireless=row?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)==true
                        break
                    }
                    assertEquals("Keep Settings in the foreground during this UI test","com.android.settings",root?.packageName?.toString())
                    val bounds=android.graphics.Rect().also{checkNotNull(root).getBoundsInScreen(it)}
                    command("input swipe ${bounds.centerX()} ${bounds.top+bounds.height()*3/4} ${bounds.centerX()} ${bounds.top+bounds.height()/3} 300")
                    Thread.sleep(500)
                }
                val labels=instrumentation.uiAutomation.rootInActiveWindow?.takeIf{it.packageName?.toString()=="com.android.settings"}?.let{descendants(it).mapNotNull{node->node.text}.toList()}
                assertTrue("Open the wireless debugging subpage: $labels",openedWireless)
                instrumentation.waitForIdleSync()
            }
            command("settings put global adb_wifi_enabled 1")
            await("The helper authenticates automatically"){ShellHelperService.link!=null}
            await("Settings closes and PeekaView resumes the share without a return tap"){
                checkNotNull(activity).lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED) && HostService.host?.link?.isNotEmpty()==true
            }
            await("The first share receives real capture frames"){hasFrame()}
            val host=checkNotNull(HostService.host)
            assertTrue(host.appsOnly)
            assertEquals(setOf(context.packageName),host.selectedApps())
            assertTrue(host.link.startsWith("https://peekaview.de/#"))
            assertEquals("0",command("settings get global adb_wifi_enabled"))
            start()
            Thread.sleep(500)
            assertSame("Repeated start cannot replace the active share",host,HostService.host)
            val helper=checkNotNull(ShellHelperService.link)
            val pid=helper.ping()
            HostService.stopCapture()
            await("Ending a share leaves the helper ready"){HostService.host==null}
            start()
            await("The next share starts directly without setup"){HostService.host?.link?.isNotEmpty()==true}
            await("The next share receives frames after the previous capture released the helper"){hasFrame()}
            assertTrue(checkNotNull(HostService.host).link.startsWith("https://peekaview.de/#"))
            assertFalse(AdbSetupService.active)
            assertEquals(pid,checkNotNull(ShellHelperService.link).ping())
            assertEquals("0",command("settings get global adb_wifi_enabled"))
        }finally{
            context.stopService(Intent(context,AdbSetupService::class.java))
            context.stopService(Intent(context,HostService::class.java))
            context.stopService(Intent(context,ShellHelperService::class.java))
            await("The test capture stops"){HostService.host==null}
            Thread.sleep(1000)
            for((name,saved)in preferences){
                val edit=context.getSharedPreferences(name,android.content.Context.MODE_PRIVATE).edit().clear()
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
            command("settings put global adb_wifi_enabled $debug")
            instrumentation.runOnMainSync{activity?.finishAndRemoveTask()}
        }
    }

    @Test fun savedPairingWaitsForDebuggingThenActivatesHelper() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("activationTest") == "true")
        assumeTrue(Prefs.adbPaired(context))
        fun command(text: String) = instrumentation.uiAutomation.executeShellCommand(text).use {
            java.io.FileInputStream(it.fileDescriptor).bufferedReader().readText().trim()
        }
        fun await(message: String, condition: () -> Boolean) {
            val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(90)
            while (!condition() && System.nanoTime() < end) Thread.sleep(100)
            assertTrue(message, condition())
        }
        val originalDebug = command("settings get global adb_wifi_enabled")
        val activity = instrumentation.startActivitySync(Intent(context, ShellTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            command("settings put global adb_wifi_enabled 0")
            context.startForegroundService(Intent(context, AdbSetupService::class.java))
            await("Assistant waits for runtime debugging despite saved pairing") { AdbSetupService.active }
            assertEquals("searching", AdbSetupService.state().getString("phase"))
            assertNull("A saved pairing is not a running helper", ShellHelperService.link)
            command("settings put global adb_wifi_enabled 1")
            await("Helper becomes ready after Android network approval") { ShellHelperService.link != null }
            val helper = ShellHelperService.link!!
            val pid = helper.ping()
            await("Activation assistant completes") { !AdbSetupService.active }
            assertEquals("ready", AdbSetupService.state().getString("phase"))
            assertEquals("0", command("settings get global adb_wifi_enabled"))
            repeat(2) {
                val streams = helper.startCapture()
                try {
                    streams.video.soTimeout = 10000
                    val input = java.io.DataInputStream(streams.video.inputStream)
                    assertEquals(0x68323634, input.readInt())
                    assertTrue(ScrcpyProtocol.readPacket(input) is ScrcpyProtocol.Packet.Session)
                    assertTrue(ScrcpyProtocol.readPacket(input) is ScrcpyProtocol.Packet.Frame)
                } finally { helper.stopCapture(streams) }
                assertEquals("Further shares use the same helper without ADB", pid, helper.ping())
            }
        } finally {
            context.stopService(Intent(context, AdbSetupService::class.java))
            context.stopService(Intent(context, ShellHelperService::class.java))
            command("settings put global adb_wifi_enabled $originalDebug")
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test fun detachedHelperDisablesAdbAndSurvivesWifiLoss() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("helperTest") == "true")
        fun command(text: String) = instrumentation.uiAutomation.executeShellCommand(text).use {
            java.io.FileInputStream(it.fileDescriptor).bufferedReader().readText().trim()
        }
        val originalDebug = command("settings get global adb_wifi_enabled")
        val wifiEnabled = command("settings get global wifi_on")
        val activity = instrumentation.startActivitySync(Intent(context, ShellTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        lateinit var ready: java.util.concurrent.CompletableFuture<ShellHelper>
        instrumentation.runOnMainSync { ready = ShellHelperService.activate(context) }
        try {
            val helper = ready.get(60, TimeUnit.SECONDS)
            val pid = helper.ping()
            assertEquals("0", command("settings get global adb_wifi_enabled"))
            repeat(2) {
                val streams = helper.startCapture()
                try {
                    streams.video.soTimeout = 10000
                    val input = java.io.DataInputStream(streams.video.inputStream)
                    assertEquals(0x68323634, input.readInt())
                    assertTrue(ScrcpyProtocol.readPacket(input) is ScrcpyProtocol.Packet.Session)
                    assertTrue(ScrcpyProtocol.readPacket(input) is ScrcpyProtocol.Packet.Frame)
                } finally { helper.stopCapture(streams) }
                assertEquals("A new share reuses the helper without ADB", pid, helper.ping())
                assertEquals("0", command("settings get global adb_wifi_enabled"))
            }
            command("svc wifi disable")
            val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
            while (command("settings get global wifi_on") != "0" && System.nanoTime() < end) Thread.sleep(50)
            assertEquals("0", command("settings get global wifi_on"))
            assertEquals("Same detached shell process without Wi-Fi or wireless debugging", pid, helper.ping())
            lateinit var reused: java.util.concurrent.CompletableFuture<ShellHelper>
            instrumentation.runOnMainSync { reused = ShellHelperService.activate(context) }
            assertSame("Reactivation must not need a new ADB connection", helper, reused.get(1, TimeUnit.SECONDS))
        } finally {
            context.stopService(Intent(context, ShellHelperService::class.java))
            command("svc wifi " + if (wifiEnabled == "0") "disable" else "enable")
            if (originalDebug == "1") {
                val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
                while (!command("cmd wifi status").contains("Wifi is connected to") && System.nanoTime() < end) Thread.sleep(100)
                command("settings put global adb_wifi_enabled 1")
            }
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}

package de.limtec.peekaview

import android.content.Intent
import android.app.NotificationManager
import android.app.RemoteInput
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import androidx.core.content.ContextCompat
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Opt in with -e adbSetup true on a phone with wireless debugging enabled and a saved pairing. */
class AdbSetupIntegrationTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun enabled() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("adbSetup") == "true")
    }

    @Test fun discoversThisPhoneAndAuthenticatesWithoutManualPort() {
        enabled()
        val port = AdbDiscovery.connectionPort(context)
        assertTrue(port in 1..65535)
        LocalAdb().use { it.verifyLocal(port) }
    }

    @Test fun setupReusesSavedPairingAndStopsItsForegroundService() {
        enabled()
        val done = CountDownLatch(1)
        val phase = AtomicReference<String>()
        val listener: () -> Unit = {
            val state = AdbSetupService.state()
            phase.set(state.getString("phase"))
            if (!state.getBoolean("active") && phase.get() in listOf("ready", "error")) done.countDown()
        }
        AdbSetupService.listeners.add(listener)
        try {
            ContextCompat.startForegroundService(context, Intent(context, AdbSetupService::class.java))
            assertTrue("setup did not complete", done.await(30, TimeUnit.SECONDS))
            assertEquals(AdbSetupService.state().toString(), "ready", phase.get())
            assertTrue(Prefs.adbPaired(context))
            assertTrue(Prefs.adbPort(context) in 1..65535)
            assertFalse(AdbSetupService.active)
        } finally {
            AdbSetupService.listeners.remove(listener)
            context.stopService(Intent(context, AdbSetupService::class.java))
        }
    }

    /** Open Android's code dialog after forgetting only PeekaView; never regenerates the key. */
    @Test fun pairsThroughNotificationWhileSystemCodeDialogRemainsOpen() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("adbPairUi") == "true")
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        fun texts(node: AccessibilityNodeInfo?): List<String> {
            if (node == null) return emptyList()
            return listOfNotNull(node.text?.toString()) + (0 until node.childCount).flatMap { texts(node.getChild(it)) }
        }
        val uiDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        var visibleCode: String? = null
        while (visibleCode == null && System.nanoTime() < uiDeadline) {
            visibleCode = texts(automation.rootInActiveWindow).map { it.replace(" ", "") }.singleOrNull { Regex("[0-9]{6}").matches(it) }
            if (visibleCode == null) Thread.sleep(50)
        }
        val code = requireNotNull(visibleCode) { "Open Android's pairing-code dialog before this test" }
        val store = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val identity = store.getCertificate("peekaview-adb").encoded
        ContextCompat.startForegroundService(context, Intent(context, AdbSetupService::class.java))
        try {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
            val notifications = context.getSystemService(NotificationManager::class.java)
            var reply: android.app.Notification.Action? = null
            while (reply == null && System.nanoTime() < deadline) {
                reply = notifications.activeNotifications.flatMap { it.notification.actions?.toList().orEmpty() }
                    .firstOrNull { it.remoteInputs?.isNotEmpty() == true }
                if (reply == null) Thread.sleep(50)
            }
            assertNotNull("pairing notification with reply input missing", reply)
            assertTrue("system code dialog must remain open", texts(automation.rootInActiveWindow).any { it.replace(" ", "") == code })
            val fill = Intent()
            val action = requireNotNull(reply)
            val input = action.remoteInputs.single()
            RemoteInput.addResultsToIntent(arrayOf(input), fill, Bundle().apply { putCharSequence(input.resultKey, code) })
            action.actionIntent.send(context, 0, fill)
            while (System.nanoTime() < deadline && (AdbSetupService.active || AdbSetupService.state().getString("phase") != "ready")) Thread.sleep(50)
            assertEquals(AdbSetupService.state().toString(), "ready", AdbSetupService.state().getString("phase"))
            assertFalse(AdbSetupService.active)
            assertArrayEquals("pairing must preserve the existing identity", identity, store.getCertificate("peekaview-adb").encoded)
            assertTrue("setup notification removed", notifications.activeNotifications.none { it.notification.actions?.any { action -> action.remoteInputs?.isNotEmpty() == true } == true })
        } finally {
            context.stopService(Intent(context, AdbSetupService::class.java))
        }
    }
}

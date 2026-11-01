package com.codevo.fixture

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class KeyboardTest {
    @After fun releaseRotation() { device.unfreezeRotation() }
    @Before fun emulatorOnly() { require(android.os.Build.MODEL.startsWith("sdk_gphone")) { "Use GeometryTest only on physical devices" } }
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val device=UiDevice.getInstance(instrumentation)
    private fun waitText(text:String,timeout:Long=20000) = device.wait(Until.findObject(By.text(text)),timeout) ?: error("Missing UI: $text")
    private fun click(text:String) {
        if (text in listOf("Switch keyboard","Setup","Cancel")) {
            device.wait(Until.findObject(By.desc(text)),20000)?.click() ?: error("Missing control: $text")
        } else waitText(text).click()
    }
    private fun capture(name:String) {
        assertTrue(device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null),"$name.png")))
    }
    private fun launchFixture() {
        val context=instrumentation.targetContext
        context.startActivity(Intent(context,EditorActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        device.wait(Until.hasObject(By.desc("First editor")),10000)
        device.findObject(By.desc("First editor")).click()
        waitText("Record")
        device.waitForIdle()
    }
    @Test fun compactIdleKeyboardControls() {
        val landscape=InstrumentationRegistry.getArguments().getString("orientation")=="landscape"
        if (landscape) device.setOrientationLeft()
        else device.setOrientationNatural()
        device.executeShellCommand("ime enable com.codevo.mobile/com.codevo.VoiceInputService")
        device.executeShellCommand("ime set com.codevo.mobile/com.codevo.VoiceInputService")
        launchFixture()
        assertEquals("Requested orientation must match actual display ${device.displayWidth}x${device.displayHeight}",landscape,device.displayWidth>device.displayHeight)
        assertFalse("Cancel is only relevant during a run",device.hasObject(By.desc("Cancel")))
        assertFalse("One primary action replaces separate idle Stop",device.hasObject(By.text("Stop")))
        assertTrue(waitText("Record").isEnabled)
        assertTrue(device.hasObject(By.desc("Switch keyboard")))
        device.findObject(By.desc("Setup"))
        val minimumTarget=(48*instrumentation.targetContext.resources.displayMetrics.density).toInt()
        capture("ready")
        for (control in listOf(waitText("Record"),device.findObject(By.desc("Setup")),device.findObject(By.desc("Switch keyboard")))) {
            val bounds=control.visibleBounds
            val label=control.text ?: control.contentDescription
            assertTrue("$label must be at least 48dp wide: $bounds",bounds.width()>=minimumTarget)
            assertTrue("$label must be at least 48dp tall: $bounds",bounds.height()>=minimumTarget)
            assertTrue(bounds.bottom<=device.displayHeight)
        }
        device.findObject(By.desc("Password")).click()
        waitText("Voice typing is disabled for this field")
        assertFalse(waitText("Record").isEnabled)
        assertFalse(device.hasObject(By.desc("Cancel")))
        capture("password")
    }
    @Test fun packagedHermesPairingAndColdKeyboard() {
        device.setOrientationNatural()
        device.executeShellCommand("am start -n com.codevo.mobile/com.codevo.MainActivity")
        val token=device.executeShellCommand("cat /data/local/tmp/codevo-pair-token").trim()
        require(token.startsWith("cw1:"))
        val tokenInput=device.wait(Until.findObject(By.desc("Pairing token")),20000) ?: error("Pairing token field missing")
        tokenInput.text=token
        click("Pair server")
        waitText("Paired server",30000)
        device.executeShellCommand("rm /data/local/tmp/codevo-pair-token")
        device.executeShellCommand("am force-stop com.codevo.mobile")
        device.executeShellCommand("ime enable com.codevo.mobile/com.codevo.VoiceInputService")
        device.executeShellCommand("ime set com.codevo.mobile/com.codevo.VoiceInputService")
        launchFixture()
        device.executeShellCommand("pm revoke com.codevo.mobile android.permission.RECORD_AUDIO")
        device.executeShellCommand("ime set com.codevo.mobile/com.codevo.VoiceInputService")
        click("Record")
        waitText("Voice operation failed. Check permission, pairing and keyboard setup.")
        assertTrue(waitText("Record").isEnabled)
        assertFalse(device.hasObject(By.desc("Cancel")))
        capture("permission-error")
        assertEquals("First editor",device.findObject(By.desc("First editor")).text)
        device.executeShellCommand("pm grant com.codevo.mobile android.permission.RECORD_AUDIO")
        device.findObject(By.descStartsWith("Language:")).click()
        device.wait(Until.findObject(By.desc("Language Slovak")),5000)?.click() ?: error("Language menu missing")
        assertTrue(device.hasObject(By.desc("Language: Slovak")))
        click("Record")
        waitText("Recording",30000)
        assertTrue(waitText("Stop").isEnabled)
        assertFalse(device.findObject(By.desc("Language: Slovak")).isEnabled)
        assertTrue(device.findObject(By.desc("Cancel")).isEnabled)
        assertFalse(device.hasObject(By.text("Record")))
        capture("recording")
        Thread.sleep(1500)
        click("Stop")
        waitText("Finishing…")
        assertFalse(waitText("Finishing").isEnabled)
        assertTrue(device.findObject(By.desc("Cancel")).isEnabled)
        capture("finishing")
        waitText("Done",30000)
        assertTrue(waitText("Record").isEnabled)
        assertFalse(device.hasObject(By.desc("Cancel")))
        capture("done")
        assertEquals("Ahoj z mobilu",device.findObject(By.desc("First editor")).text)
        Thread.sleep(1000)
        assertEquals("Ahoj z mobilu",device.findObject(By.desc("First editor")).text)
        click("Record");waitText("Recording");Thread.sleep(1000);click("Stop")
        device.findObject(By.desc("Second editor")).click()
        Thread.sleep(3000)
        assertEquals("Ahoj z mobilu",device.findObject(By.desc("First editor")).text)
        assertEquals("Second editor",device.findObject(By.desc("Second editor")).text)
        click("Record");waitText("Recording");Thread.sleep(1000);click("Cancel");Thread.sleep(2000)
        assertEquals("Second editor",device.findObject(By.desc("Second editor")).text)
        click("Record");waitText("Recording");device.pressBack();Thread.sleep(2000)
        assertEquals("Second editor",device.findObject(By.desc("Second editor")).text)
        device.findObject(By.desc("Password")).click()
        waitText("Voice typing is disabled for this field")
        assertFalse(waitText("Record").isEnabled)
        click("Switch keyboard")
        device.wait(Until.findObject(By.textContains("Gboard")),3000)?.click()
        assertTrue(device.wait(Until.hasObject(By.pkg("com.google.android.inputmethod.latin")),10000))
        device.executeShellCommand("ime set com.codevo.mobile/com.codevo.VoiceInputService")
        device.findObject(By.text("BROWSER FIELD")).click()
        assertTrue(device.wait(Until.hasObject(By.clazz("android.webkit.WebView")),10000))
        device.wait(Until.findObject(By.clazz("android.widget.EditText")),10000)?.click() ?: error("Browser input missing")
        click("Record");waitText("Recording");Thread.sleep(1000);click("Stop");waitText("Done")
        assertEquals("Ahoj z mobilu",device.findObject(By.clazz("android.widget.EditText")).text)
        device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null),"browser-success.png"))
        device.executeShellCommand("am start -n com.codevo.mobile/com.codevo.MainActivity")
        device.wait(Until.hasObject(By.text("Codevo Voice")),10000)
        if (device.hasObject(By.text("Switch keyboard"))) device.pressBack()
        repeat(8) {
            if (!device.hasObject(By.text("Record"))) device.swipe(device.displayWidth/2,device.displayHeight*4/5,device.displayWidth/2,device.displayHeight/4,20)
        }
        click("Record");waitText("Recording…");Thread.sleep(1000);click("Stop")
        waitText("Ahoj z mobilu")
        repeat(8) {
            device.findObject(By.text("Pairing settings"))?.click()
            if (!device.hasObject(By.desc("Pairing token"))) device.swipe(device.displayWidth/2,device.displayHeight/4,device.displayWidth/2,device.displayHeight*4/5,20)
        }
        val replacement=device.executeShellCommand("cat /data/local/tmp/codevo-runtime-token").trim()
        require(replacement.startsWith("cw1:"))
        val input=device.wait(Until.findObject(By.desc("Pairing token")),20000) ?: error("Pairing field missing")
        input.text=replacement
        if (device.hasObject(By.desc("Switch keyboard"))) device.pressBack()
        repeat(8) { if (!device.hasObject(By.text("Replace pairing"))) device.swipe(device.displayWidth/2,device.displayHeight*4/5,device.displayWidth/2,device.displayHeight/3,15) }
        click("Replace pairing")
        repeat(8) { if (!device.hasObject(By.text("Pairing was not approved"))) device.swipe(device.displayWidth/2,device.displayHeight/3,device.displayWidth/2,device.displayHeight*4/5,15) }
        waitText("Pairing was not approved")
        assertTrue(device.hasObject(By.text("Paired server")))
        repeat(8) { if (!device.hasObject(By.text("Replace pairing"))) device.swipe(device.displayWidth/2,device.displayHeight*4/5,device.displayWidth/2,device.displayHeight/3,15) }
        click("Replace pairing")
        assertTrue(device.wait(Until.hasObject(By.desc("Pairing token").text("")),10000))
        device.executeShellCommand("rm /data/local/tmp/codevo-runtime-token")
        launchFixture()
        click("Record");waitText("Recording");Thread.sleep(1500);click("Stop");waitText("Done")
        assertEquals("Flow respected Č 👋 100%",device.findObject(By.desc("First editor")).text)
        click("Record");waitText("Recording");Thread.sleep(1000);click("Stop")
        waitText("Server error: stt_unavailable")
        capture("server-error")
        assertEquals("Flow respected Č 👋 100%",device.findObject(By.desc("First editor")).text)
        click("Record");waitText("Recording");Thread.sleep(1000);click("Stop")
        waitText("Server authentication or protocol failed")
        Thread.sleep(500)
        assertEquals("Flow respected Č 👋 100%",device.findObject(By.desc("First editor")).text)
        val audio=device.executeShellCommand("dumpsys audio")
        val active=audio.substringAfter("RecordActivityMonitor dump time:").substringBefore("Events log:")
        assertFalse(active.contains("com.codevo.mobile"))
        device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null),"error-safety.png"))
    }
}

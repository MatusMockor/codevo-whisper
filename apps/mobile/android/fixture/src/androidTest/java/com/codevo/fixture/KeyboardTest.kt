package com.codevo.fixture

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class KeyboardTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val device=UiDevice.getInstance(instrumentation)
    private fun waitText(text:String,timeout:Long=20000) = device.wait(Until.findObject(By.text(text)),timeout) ?: error("Missing UI: $text")
    private fun click(text:String) { waitText(text).click() }
    private fun launchFixture() {
        val context=instrumentation.targetContext
        context.startActivity(Intent(context,EditorActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        device.wait(Until.hasObject(By.desc("First editor")),10000)
        device.findObject(By.desc("First editor")).click()
        waitText("Record")
    }
    @Test fun packagedHermesPairingAndColdKeyboard() {
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
        assertEquals("First editor",device.findObject(By.desc("First editor")).text)
        device.executeShellCommand("pm grant com.codevo.mobile android.permission.RECORD_AUDIO")
        click("Record")
        waitText("Recording",30000)
        Thread.sleep(1500)
        click("Stop")
        waitText("Done",30000)
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
            if (!device.hasObject(By.desc("Pairing token"))) device.swipe(device.displayWidth/2,device.displayHeight/4,device.displayWidth/2,device.displayHeight*4/5,20)
        }
        val replacement=device.executeShellCommand("cat /data/local/tmp/codevo-runtime-token").trim()
        require(replacement.startsWith("cw1:"))
        val input=device.wait(Until.findObject(By.desc("Pairing token")),20000) ?: error("Pairing field missing")
        input.text=replacement;click("Replace pairing")
        waitText("Pairing was not approved")
        assertTrue(device.hasObject(By.text("Paired server")))
        click("Replace pairing")
        assertTrue(device.wait(Until.hasObject(By.desc("Pairing token").text("")),10000))
        device.executeShellCommand("rm /data/local/tmp/codevo-runtime-token")
        launchFixture()
        click("Record");waitText("Recording");Thread.sleep(1500);click("Stop");waitText("Done")
        assertEquals("Flow respected Č 👋 100%",device.findObject(By.desc("First editor")).text)
        click("Record");waitText("Recording");Thread.sleep(1000);click("Stop")
        waitText("Server error: stt_unavailable")
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

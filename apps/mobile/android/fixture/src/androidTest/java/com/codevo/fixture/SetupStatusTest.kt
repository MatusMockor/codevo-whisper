package com.codevo.fixture

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
class SetupStatusTest {
    @Test fun completedPermissionAndKeyboardStepsRefreshOnForeground() {
        require(android.os.Build.MODEL.startsWith("sdk_gphone"))
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val device=UiDevice.getInstance(instrumentation)
        fun launch(first: Boolean=false) {
            val flags=if(first) "0x10008000" else "0x20000"
            device.executeShellCommand("am start -W -f $flags -n com.codevo.mobile/com.codevo.MainActivity")
            device.waitForIdle()
            var scrolls=0
            while (!device.hasObject(By.text("Codevo Voice")) && scrolls++<8) device.swipe(device.displayWidth/2,device.displayHeight/4,device.displayWidth/2,device.displayHeight*3/4,15)
            assertTrue(device.wait(Until.hasObject(By.text("Codevo Voice")),10000))
        }
        fun find(text: String): Boolean {
            repeat(8) {
                if (device.hasObject(By.text(text))) return true
                device.swipe(device.displayWidth/2,device.displayHeight*4/5,device.displayWidth/2,device.displayHeight/3,15)
            }
            return device.hasObject(By.text(text))
        }
        device.executeShellCommand("pm revoke com.codevo.mobile android.permission.RECORD_AUDIO")
        device.executeShellCommand("ime enable com.codevo.mobile/com.codevo.VoiceInputService")
        device.executeShellCommand("ime set com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME")
        launch(true)
        assertTrue(find("Allow microphone"))
        assertTrue(find("Choose keyboard"))
        device.executeShellCommand("am start -n com.codevo.fixture/.GeometryActivity")
        device.executeShellCommand("pm grant com.codevo.mobile android.permission.RECORD_AUDIO")
        launch()
        assertTrue(find("Microphone allowed"))
        assertFalse(device.hasObject(By.text("Allow microphone")))
        device.executeShellCommand("ime enable com.codevo.mobile/com.codevo.VoiceInputService")
        device.executeShellCommand("ime set com.codevo.mobile/com.codevo.VoiceInputService")
        device.executeShellCommand("am start -n com.codevo.fixture/.GeometryActivity")
        launch()
        assertTrue(find("Voice keyboard ready"))
        assertFalse(device.hasObject(By.text("Enable keyboard")))
        assertFalse(device.hasObject(By.text("Choose keyboard")))
        device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null),"setup-granted.png"))
    }
}

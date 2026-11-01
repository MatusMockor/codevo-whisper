package com.codevo

import android.graphics.Rect
import android.os.SystemClock
import android.view.WindowInsets
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
class KeyboardPreviewTest {
    @org.junit.After fun releaseEmulatorRotation() { UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).unfreezeRotation() }
    @Test fun rendersPhasesAndAccessibleIconTargets() {
        require(android.os.Build.MODEL.startsWith("sdk_gphone"))
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val device=UiDevice.getInstance(instrumentation)
        val args=InstrumentationRegistry.getArguments()
        val target=(48*instrumentation.targetContext.resources.displayMetrics.density).toInt()
        for (phase in VoicePhase.entries) {
            val monitor=instrumentation.addMonitor("com.codevo.KeyboardPreviewActivity",null,false)
            device.executeShellCommand("am start -W -f 0x10008000 -n com.codevo.mobile/com.codevo.KeyboardPreviewActivity --es phase $phase")
            val activity=monitor.waitForActivityWithTimeout(10000) ?: error("Preview activity missing")
            instrumentation.removeMonitor(monitor)
            assertTrue(device.wait(Until.hasObject(By.text("Synthetic keyboard preview\nNo microphone or connection")),10000))
            if (args.getString("configureEmulator")=="true") {
                val landscape=args.getString("expectedOrientation")=="landscape"
                if (landscape) device.setOrientationLeft() else device.setOrientationNatural()
                val deadline=SystemClock.uptimeMillis()+10000
                while(SystemClock.uptimeMillis()<deadline && (device.displayWidth>device.displayHeight)!=landscape) SystemClock.sleep(50)
            }
            device.waitForIdle()
            args.getString("expectedOrientation")?.let { assertEquals(it=="landscape",device.displayWidth>device.displayHeight) }
            var usable=Rect()
            instrumentation.runOnMainSync {
                val metrics=activity.windowManager.currentWindowMetrics
                val bars=activity.window.decorView.rootWindowInsets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                usable=Rect(metrics.bounds).apply { inset(bars.left,bars.top,bars.right,bars.bottom) }
            }
            val primary=when(phase) {
                VoicePhase.CONNECTING -> "Connecting"
                VoicePhase.RECORDING -> "Stop"
                VoicePhase.FINISHING -> "Finishing"
                else -> "Record"
            }
            for (label in listOf("Setup","Switch keyboard",primary,"Language: Slovak")+if(phase in listOf(VoicePhase.CONNECTING,VoicePhase.RECORDING,VoicePhase.FINISHING)) listOf("Cancel") else emptyList()) {
                val bounds=(device.wait(Until.findObject(By.desc(label)),5000) ?: error("$phase missing $label")).visibleBounds
                assertTrue("$label hit target $bounds",bounds.width()>=target && bounds.height()>=target)
                assertTrue("$phase $label inside usable screen $usable: $bounds",usable.contains(bounds))
            }
            assertTrue(device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null),"preview-${phase.name.lowercase()}.png")))
        }
    }
}

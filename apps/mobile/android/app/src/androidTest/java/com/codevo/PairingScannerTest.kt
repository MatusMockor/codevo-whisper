package com.codevo

import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.regex.Pattern

@RunWith(AndroidJUnit4::class)
class PairingScannerTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private fun waitText(text: String, timeout: Long = 20000) = device.wait(Until.findObject(By.text(text)), timeout) ?: error("Expected scanner UI missing: $text")
    private fun launch(clearTask: Boolean = true) {
        require(Build.MODEL.startsWith("sdk_gphone")) { "Use a disposable emulator for scanner acceptance" }
        val flags = if (clearTask) "-f 0x10008000" else ""
        device.executeShellCommand("am start -W $flags -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n com.codevo.mobile/com.codevo.MainActivity")
        waitText("Codevo Voice")
    }
    private fun cameraClosed() {
        repeat(30) {
            val dump = device.executeShellCommand("dumpsys media.camera")
            if (dump.substringAfter("Active Camera Clients:").substringBefore("Allowed user IDs:").trim() == "[]") return
            Thread.sleep(100)
        }
        fail("Scanner still owns the camera")
    }

    @Test fun cancellationReleasesCameraAndPreservesPairing() {
        launch()
        val context = instrumentation.targetContext
        val vault = PairingVault(context)
        val previous = vault.load()
        device.executeShellCommand("pm grant com.codevo.mobile android.permission.CAMERA")
        waitText("Scan QR").click()
        waitText("Scan pairing QR")
        waitText("Cancel").click()
        waitText("Scan QR")
        cameraClosed()
        assertEquals(previous, vault.load())
        assertFalse(device.hasObject(By.textContains("QR scanner is unavailable")))
        waitText("Scan QR").click()
        waitText("Scan pairing QR")
        device.pressBack()
        waitText("Scan QR")
        cameraClosed()
        waitText("Scan QR").click()
        waitText("Scan pairing QR")
        device.pressHome()
        cameraClosed()
        launch(clearTask = false)
        waitText("Scan QR")
        assertFalse(device.hasObject(By.text("Scan pairing QR")))
        assertEquals(previous, vault.load())
        device.takeScreenshot(File(context.getExternalFilesDir(null), "qr-cancel.png"))
    }

    @Test fun permissionDenialOffersSettingsAndPaste() {
        launch()
        waitText("Scan QR").click()
        val deny = device.wait(Until.findObject(By.res(Pattern.compile(".*:id/permission_deny.*_button"))), 10000)
            ?: error("Expected camera permission prompt; revoke CAMERA on the emulator before running")
        deny.click()
        waitText("Camera access is required to scan. Allow Camera in app settings, or paste the token.")
        waitText("Open app settings")
        assertTrue(waitText("Scan QR").isEnabled)
        assertNotNull(device.findObject(By.desc("Pairing token")))
        cameraClosed()
        device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null), "qr-permission.png"))
    }

    @Test fun rejectsOtherQrWithoutChangingEnteredTokenOrPairing() {
        launch()
        val context = instrumentation.targetContext
        val previous = PairingVault(context).load()
        device.wait(Until.findObject(By.desc("Pairing token")), 10000)?.text = "previous-manual-token"
        val entered = device.findObject(By.desc("Pairing token")).text
        waitText("Scan QR").click()
        waitText("This is not a valid Codevo pairing QR. Try Scan QR again or paste a cw1 token.", 30000)
        cameraClosed()
        assertEquals(entered, device.findObject(By.desc("Pairing token")).text)
        assertEquals(previous, PairingVault(context).load())
        device.takeScreenshot(File(context.getExternalFilesDir(null), "qr-invalid.png"))
    }

    @Test fun scansCameraFixtureWithoutPairingAutomatically() {
        require(Build.MODEL.startsWith("sdk_gphone")) { "Use a disposable emulator for scanner acceptance" }
        val context = instrumentation.targetContext
        val vault = PairingVault(context)
        val previous = vault.load()
        val fixture = """{"version":1,"privateKey":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE","serverPublicKey":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI","endpoint":"wss://previous.example.invalid","deviceId":"previous-device"}"""
        try {
            vault.save(fixture)
            launch()
            waitText("Paired server")
            device.executeShellCommand("pm grant com.codevo.mobile android.permission.CAMERA")
            waitText("Scan QR").click()
            waitText("QR scanned. Choose Replace pairing to continue.", 30000)
            cameraClosed()
            assertTrue(waitText("Replace pairing").isEnabled)
            assertEquals(fixture, vault.load())
            assertTrue(device.hasObject(By.text("Paired server")))
            assertFalse(device.hasObject(By.text("Authenticating server…")))
            device.takeScreenshot(File(context.getExternalFilesDir(null), "qr-ready.png"))
        } finally {
            if (previous == null) vault.remove() else vault.save(previous)
        }
    }
}

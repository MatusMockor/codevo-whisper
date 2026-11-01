package com.codevo.fixture

import android.content.Intent
import android.os.SystemClock
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.ActivityTestRule
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@org.junit.FixMethodOrder(org.junit.runners.MethodSorters.NAME_ASCENDING)
@RunWith(AndroidJUnit4::class)
class GeometryTest {
    @get:Rule val fixture=ActivityTestRule(GeometryActivity::class.java,false,false)
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val device=UiDevice.getInstance(instrumentation)
    private fun configureEmulator() {
        val args=InstrumentationRegistry.getArguments()
        if (args.getString("configureEmulator")!="true") return
        require(android.os.Build.MODEL.startsWith("sdk_gphone"))
        val landscape=args.getString("expectedOrientation")=="landscape"
        if (landscape) device.setOrientationLeft() else device.setOrientationNatural()
        val orientation=if(landscape) android.content.res.Configuration.ORIENTATION_LANDSCAPE else android.content.res.Configuration.ORIENTATION_PORTRAIT
        val deadline=SystemClock.uptimeMillis()+10000
        var stableSince=0L
        while(SystemClock.uptimeMillis()<deadline) {
            val configuration=instrumentation.targetContext.resources.configuration
            val matching=(device.displayWidth>device.displayHeight)==landscape && configuration.orientation==orientation && (args.getString("expectedFont")?.toFloat()?.let { kotlin.math.abs(configuration.fontScale-it)<0.01f } ?: true)
            if (!matching) stableSince=0L else if(stableSince==0L) stableSince=SystemClock.uptimeMillis()
            if(stableSince!=0L && SystemClock.uptimeMillis()-stableSince>=500) break
            SystemClock.sleep(50)
        }
        assertEquals("Requested display orientation",landscape,device.displayWidth>device.displayHeight)
        assertEquals("Requested resource orientation",orientation,instrumentation.targetContext.resources.configuration.orientation)
        device.waitForIdle()
    }
    @org.junit.After fun releaseEmulatorRotation() {
        if (InstrumentationRegistry.getArguments().getString("configureEmulator")=="true") device.unfreezeRotation()
    }
    private fun capture(activity: GeometryActivity,name: String) {
        var focused=false
        instrumentation.runOnMainSync {
            focused=activity.hasWindowFocus() && !activity.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked
        }
        check(focused && device.currentPackageName=="com.codevo.fixture") { "Refuse screenshot outside the unlocked synthetic editor" }
        assertTrue(device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null),"$name.png")))
    }
    private fun checkGeometry(web: Boolean) {
        val expected=InstrumentationRegistry.getArguments()
        val activity=fixture.launchActivity(Intent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK).putExtra("web",web))
        configureEmulator()
        expected.getString("expectedFont")?.let { assertEquals("Font scale",it.toFloat(),activity.resources.configuration.fontScale,0.01f) }
        expected.getString("expectedOrientation")?.let { assertEquals("Orientation",it=="landscape",device.displayWidth>device.displayHeight) }
        expected.getString("expectedNavigation")?.let { assertEquals("Navigation mode",it,device.executeShellCommand("settings get secure navigation_mode").trim()) }
        if (web) {
            val input=device.wait(Until.findObject(By.clazz("android.widget.EditText").pkg("com.codevo.fixture")),10000) ?: error("Browser composer missing")
            input.click()
        }
        if (!web) {
            device.waitForIdle()
            device.wait(Until.findObject(By.desc("Bottom composer")),5000)?.click()
        }
        val ready=device.wait(Until.hasObject(By.text("Record").pkg("com.codevo.mobile")),15000)
        if (!ready) {
            Log.i("CodevoGeometry",instrumentation.uiAutomation.windows.joinToString { "type=${it.type} active=${it.isActive} root=${it.root?.packageName} children=${it.root?.childCount}" })
            capture(activity,"geometry-missing-ime")
        }
        assertTrue("Codevo must already be selected",ready)
        repeat(3) { iteration ->
            device.waitForIdle()
            SystemClock.sleep(500)
            var geometry=IntArray(0)
            instrumentation.runOnMainSync { geometry=activity.hostGeometry() }
            val screenBottom=geometry[0];val ime=geometry[1];val nav=geometry[2]
            val visibleBottom=geometry[3];val editorBottom=geometry[4];val caretBottom=geometry[5]
            val imeTop=screenBottom-ime
            Log.i("CodevoGeometry","web=$web iteration=$iteration display=${device.displayWidth}x${device.displayHeight} screen=$screenBottom ime=$ime imeTop=$imeTop nav=$nav visibleBottom=$visibleBottom editorBottom=$editorBottom caretBottom=$caretBottom font=${activity.resources.configuration.fontScale} density=${activity.resources.displayMetrics.densityDpi}")
            assertTrue("Host must receive a visible IME occlusion: ${geometry.toList()}",ime>nav)
            if (!web) {
                assertTrue("Bottom editor $editorBottom must be above IME $imeTop",editorBottom<=imeTop)
                assertTrue("Caret $caretBottom must be above IME $imeTop",caretBottom<=imeTop)
            } else {
                val latch=CountDownLatch(1)
                var result=""
                instrumentation.runOnMainSync {
                    activity.browser!!.evaluateJavascript("JSON.stringify({bottom:document.querySelector('#composer').getBoundingClientRect().bottom,caretBottom:getSelection().getRangeAt(0).getBoundingClientRect().bottom,height:visualViewport.height,width:document.documentElement.clientWidth,focused:document.activeElement.id==='composer'})") { result=it;latch.countDown() }
                }
                assertTrue(latch.await(5,TimeUnit.SECONDS))
                val json=org.json.JSONObject(org.json.JSONTokener(result).nextValue().toString())
                assertTrue("Browser caret must retain focus",json.getBoolean("focused"))
                assertTrue("Browser bottom composer must fit visual viewport: $result",json.getDouble("bottom")<=json.getDouble("height")+1)
                assertTrue("Browser actual caret must fit visual viewport: $result",json.getDouble("caretBottom")>0 && json.getDouble("caretBottom")<=json.getDouble("height"))
                var browserY=0
                var browserWidth=0
                instrumentation.runOnMainSync {
                    val position=IntArray(2);activity.browser!!.getLocationOnScreen(position)
                    browserY=position[1];browserWidth=activity.browser!!.width
                }
                val caretScreen=browserY+json.getDouble("caretBottom")*browserWidth/json.getDouble("width")
                assertTrue("Browser caret $caretScreen must be above IME $imeTop",caretScreen<=imeTop)
                val input=device.findObject(By.clazz("android.widget.EditText").pkg("com.codevo.fixture"))
                Log.i("CodevoGeometry","webResult=$result input=${input.visibleBounds}")
                assertTrue("Browser accessibility bounds must fit within one dp rounding of IME $imeTop: ${input.visibleBounds}",input.visibleBounds.bottom<=imeTop+kotlin.math.ceil(activity.resources.displayMetrics.density).toInt())
            }
            val target=(48*activity.resources.displayMetrics.density).toInt()
            val controls=listOfNotNull(device.findObject(By.text("Record").pkg("com.codevo.mobile")),device.findObject(By.desc("Switch keyboard")),device.findObject(By.desc("Setup")) ?: device.findObject(By.text("Setup")),device.findObject(By.descStartsWith("Language:")))
            assertTrue("Record, Setup and Switch keyboard must be present",controls.size>=3)
            if (expected.getString("expectedLanguage")=="true") assertNotNull("Language selector must be present",device.findObject(By.descStartsWith("Language:")))
            for (control in controls) {
                val bounds=control.visibleBounds
                Log.i("CodevoGeometry","control=${control.contentDescription ?: control.text} bounds=$bounds")
                assertTrue("Control clipped or too small: $bounds target=$target",bounds.width()>=target && bounds.height()>=target)
                assertTrue("Control overlaps navigation $nav: $bounds",bounds.bottom<=screenBottom-nav)
                assertTrue("Control overlaps side navigation: $bounds",bounds.left>=geometry[6] && bounds.right<=device.displayWidth-geometry[7])
                assertTrue("Control above reported IME top $imeTop: $bounds",bounds.top>=imeTop)
            }
            capture(activity,"geometry-${if(web) "web" else "native"}-$iteration")
            if (iteration<2) {
                device.pressBack()
                if (web) device.findObject(By.clazz("android.widget.EditText").pkg("com.codevo.fixture")).click() else device.findObject(By.desc("Bottom composer")).click()
                assertTrue(device.wait(Until.hasObject(By.text("Record").pkg("com.codevo.mobile")),10000))
            }
        }
    }
    @Test fun languageMenuKeepsOriginalEditor() {
        val activity=fixture.launchActivity(Intent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        configureEmulator()
        device.wait(Until.findObject(By.desc("Bottom composer")),5000)?.click()
        val selector=device.wait(Until.findObject(By.descStartsWith("Language:")),15000) ?: error("Language selector missing")
        selector.click()
        val option=device.wait(Until.findObject(By.desc("Language Slovak")),5000) ?: error("Language option missing")
        assertTrue(option.isEnabled)
        option.click()
        assertTrue(device.wait(Until.hasObject(By.desc("Language: Slovak")),5000))
        instrumentation.runOnMainSync {
            assertTrue(activity.editor.hasFocus())
            assertEquals("Synthetic caret",activity.editor.text.toString())
        }
        device.findObject(By.desc("Language: Slovak")).click()
        device.pressBack()
        device.findObject(By.desc("Bottom composer")).click()
        assertTrue(device.wait(Until.hasObject(By.desc("Language: Slovak")),5000))
        instrumentation.runOnMainSync { assertEquals("Synthetic caret",activity.editor.text.toString()) }
    }
    @Test fun nativeBottomComposer()=checkGeometry(false)
    @Test fun browserBottomComposer()=checkGeometry(true)
}

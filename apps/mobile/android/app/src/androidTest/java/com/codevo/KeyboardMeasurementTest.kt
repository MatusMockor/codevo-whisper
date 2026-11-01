package com.codevo

import android.graphics.Insets
import android.view.View
import android.view.WindowInsets
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KeyboardMeasurementTest {
    @Test fun keyboardKeepsIntrinsicContentWhenNavigationInsetsGrow() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val context=instrumentation.targetContext
            val view=VoiceKeyboardView(context,{}, {}, {}, {}, {})
            val width=(400*context.resources.displayMetrics.density).toInt()
            val widthSpec=View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY)
            view.measure(widthSpec,View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED))
            val contentHeight=view.measuredHeight
            val insets=WindowInsets.Builder().setInsets(WindowInsets.Type.navigationBars(),Insets.of(0,0,0,132)).build()
            view.dispatchApplyWindowInsets(insets)
            assertEquals("Framework fits the actual navigation inset",132,view.paddingBottom)
            view.measure(widthSpec,View.MeasureSpec.makeMeasureSpec(contentHeight,View.MeasureSpec.AT_MOST))
            assertEquals("Navigation must grow the wrapped keyboard, preserving every control",contentHeight+132,view.measuredHeight)
        }
    }
}

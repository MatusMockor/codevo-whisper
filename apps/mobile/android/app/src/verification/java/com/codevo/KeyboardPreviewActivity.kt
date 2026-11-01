package com.codevo

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

class KeyboardPreviewActivity: Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val phase=VoicePhase.valueOf(intent.getStringExtra("phase") ?: "IDLE")
        val samples=ByteArray(3200)
        val levels=VoiceLevels()
        for (bar in 0 until 26) {
            val amplitude=(kotlin.math.abs(kotlin.math.sin(bar*0.7))*24000).toInt()
            for (i in samples.indices step 2) { samples[i]=amplitude.toByte();samples[i+1]=(amplitude shr 8).toByte() }
            levels.update(phase,VoiceLevels.rms(samples,samples.size))
        }
        val keyboard=VoiceKeyboardView(this,{}, {}, {}, {}, {}).apply {
            render(KeyboardState(phase,when(phase) {
                VoicePhase.IDLE -> "Ready"
                VoicePhase.CONNECTING -> "Connecting…"
                VoicePhase.RECORDING -> "Recording"
                VoicePhase.FINISHING -> "Finishing…"
                VoicePhase.DONE -> "Done"
                VoicePhase.ERROR -> "Microphone permission required"
            },VoiceLanguage.SK,levels.values),false)
        }
        setContentView(LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL
            setBackgroundColor(0xff0f131b.toInt())
            setOnApplyWindowInsetsListener { view,insets ->
                if (android.os.Build.VERSION.SDK_INT>=30) {
                    val bars=insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
                    view.setPadding(bars.left,bars.top,bars.right,bars.bottom)
                    insets.inset(bars.left,bars.top,bars.right,bars.bottom)
                } else {
                    view.setPadding(insets.systemWindowInsetLeft,insets.systemWindowInsetTop,insets.systemWindowInsetRight,insets.systemWindowInsetBottom)
                    insets.consumeSystemWindowInsets()
                }
            }
            addView(TextView(this@KeyboardPreviewActivity).apply {
                text="Synthetic keyboard preview\nNo microphone or connection"
                setTextColor(0xffe8ecf2.toInt());gravity=Gravity.CENTER
            },LinearLayout.LayoutParams(-1,0,1f))
            addView(keyboard,LinearLayout.LayoutParams(-1,-2))
        })
    }
}

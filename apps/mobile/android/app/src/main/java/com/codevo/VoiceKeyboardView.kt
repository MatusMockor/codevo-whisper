package com.codevo

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.view.Gravity
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.roundToInt

class VoiceKeyboardView(
    context: Context,
    private val onHeightChanged: (Int) -> Unit,
    onPrimary: () -> Unit,
    onCancel: () -> Unit,
    onSwitch: () -> Unit,
    onSetup: () -> Unit,
) : LinearLayout(context) {
    private val surface=0xff182222.toInt()
    private val onSurface=0xffe6f3ef.toInt()
    private val mint=0xffa2e8ce.toInt()
    private val muted=0xffb4c9c1.toInt()
    private val error=0xffffb4ab.toInt()
    private val inactive=0xff30433c.toInt()
    private val status=TextView(context).apply {
        textSize=16f
        setTypeface(typeface,Typeface.BOLD)
        accessibilityLiveRegion=ACCESSIBILITY_LIVE_REGION_POLITE
        setPadding(0,dp(8),dp(8),dp(8))
    }
    private val primary=button("Record",onPrimary).apply {
        textSize=18f
        setTypeface(typeface,Typeface.BOLD)
        setPadding(dp(20),dp(12),dp(20),dp(12))
    }
    private val cancel=button("Cancel",onCancel)

    init {
        orientation=VERTICAL
        setBackgroundColor(surface)
        setPadding(dp(16),dp(8),dp(16),dp(12))
        setOnApplyWindowInsetsListener { _,insets ->
            applyInsets(insets)
            insets
        }
        addView(LinearLayout(context).apply {
            gravity=Gravity.CENTER_VERTICAL
            addView(status,LayoutParams(0,LayoutParams.WRAP_CONTENT,1f))
            addView(button("Setup",onSetup).apply { style(this,inactive,onSurface) })
        },LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.WRAP_CONTENT))
        addView(LinearLayout(context).apply {
            gravity=Gravity.CENTER_VERTICAL
            addView(button("",onSwitch).apply {
                contentDescription="Switch keyboard"
                if (Build.VERSION.SDK_INT>=26) tooltipText="Switch keyboard"
                setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_keyboard,0,0,0)
                compoundDrawableTintList=ColorStateList.valueOf(onSurface)
                setPadding(dp(12),dp(12),dp(12),dp(12))
                style(this,inactive,onSurface)
            },LayoutParams(dp(48),LayoutParams.WRAP_CONTENT).apply { marginEnd=dp(8) })
            addView(primary,LayoutParams(0,LayoutParams.WRAP_CONTENT,1f))
            addView(cancel,LayoutParams(LayoutParams.WRAP_CONTENT,LayoutParams.WRAP_CONTENT).apply { marginStart=dp(8) })
        },LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.WRAP_CONTENT).apply { topMargin=dp(8) })
    }

    fun render(state: KeyboardState,protected: Boolean) {
        val busy=state.phase in listOf(VoicePhase.CONNECTING,VoicePhase.RECORDING,VoicePhase.FINISHING)
        val recording=state.phase==VoicePhase.RECORDING
        status.text=if (protected) "Voice typing is disabled for this field" else state.message
        status.setTextColor(when {
            protected -> muted
            state.phase==VoicePhase.ERROR -> error
            state.phase==VoicePhase.RECORDING || state.phase==VoicePhase.DONE -> mint
            else -> onSurface
        })
        primary.text=when (state.phase) {
            VoicePhase.CONNECTING -> "Connecting"
            VoicePhase.RECORDING -> "Stop"
            VoicePhase.FINISHING -> "Finishing"
            else -> "Record"
        }
        primary.contentDescription=primary.text
        primary.isEnabled=!protected && state.phase!=VoicePhase.CONNECTING && state.phase!=VoicePhase.FINISHING
        primary.setCompoundDrawablesRelativeWithIntrinsicBounds(if (recording) R.drawable.ic_stop else R.drawable.ic_mic,0,0,0)
        primary.compoundDrawablePadding=dp(12)
        val ink=if (primary.isEnabled) surface else muted
        primary.compoundDrawableTintList=ColorStateList.valueOf(ink)
        style(primary,if (primary.isEnabled) mint else inactive,ink)
        cancel.visibility=if (busy && !protected) VISIBLE else GONE
        style(cancel,inactive,onSurface)
    }

    private fun button(label: String,action: () -> Unit)=Button(context).apply {
        text=label
        isAllCaps=false
        textSize=14f
        minWidth=dp(48)
        minHeight=dp(48)
        minimumWidth=dp(48)
        minimumHeight=dp(48)
        setPadding(dp(12),dp(10),dp(12),dp(10))
        stateListAnimator=null
        setOnClickListener { action() }
    }

    private fun style(button: Button,fill: Int,ink: Int) {
        button.setTextColor(ink)
        button.background=RippleDrawable(ColorStateList.valueOf(0x3385d9b5),
            GradientDrawable().apply { setColor(fill);cornerRadius=dp(16).toFloat() },null)
    }

    private fun dp(value: Int)=(value*resources.displayMetrics.density).roundToInt()

    private fun applyInsets(insets: WindowInsets) {
        val left: Int
        val right: Int
        val bottom: Int
        if (Build.VERSION.SDK_INT>=30) {
            val bars=insets.getInsetsIgnoringVisibility(WindowInsets.Type.navigationBars() or WindowInsets.Type.displayCutout())
            left=dp(16)+bars.left
            right=dp(16)+bars.right
            bottom=dp(12)+bars.bottom
        } else {
            left=dp(16)+insets.stableInsetLeft
            right=dp(16)+insets.stableInsetRight
            bottom=dp(12)+insets.stableInsetBottom
        }
        if (paddingLeft==left && paddingRight==right && paddingBottom==bottom) return
        setPadding(left,dp(8),right,bottom)
    }
    override fun onMeasure(widthMeasureSpec: Int,heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec,MeasureSpec.makeMeasureSpec(0,MeasureSpec.UNSPECIFIED))
        val heightPx=measuredHeight
        post { onHeightChanged(heightPx) }
    }

}

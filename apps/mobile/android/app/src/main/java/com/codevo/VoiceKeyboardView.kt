package com.codevo

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.StateListDrawable
import android.view.Gravity
import android.view.View
import android.os.Build
import android.widget.Button
import android.widget.LinearLayout
import android.widget.FrameLayout
import android.widget.LinearLayout.LayoutParams as RowParams
import android.widget.TextView
import kotlin.math.roundToInt

class VoiceKeyboardView(
    context: Context,
    onPrimary: () -> Unit,
    onCancel: () -> Unit,
    onSwitch: () -> Unit,
    onSetup: () -> Unit,
    private val onLanguage: (VoiceLanguage) -> Unit,
) : FrameLayout(context) {
    private val surface=0xff121620.toInt()
    private val ink=0xffe8ecf2.toInt()
    private val amber=0xfff0a23a.toInt()
    private val muted=0xffb6bfcc.toInt()
    private val inactive=0xff161b25.toInt()
    private val body=LinearLayout(context).apply {
        orientation=LinearLayout.VERTICAL
        setPadding(dp(12),dp(8),dp(12),dp(12))
    }
    private var selectedLanguage=VoiceLanguage.AUTO
    private val choices=LinearLayout(context).apply { orientation=LinearLayout.HORIZONTAL;visibility=GONE }
    private var rendered: KeyboardState?=null
    private var renderedProtected=false
    private val status=TextView(context).apply {
        textSize=16f
        setTypeface(typeface,Typeface.BOLD)
        accessibilityLiveRegion=ACCESSIBILITY_LIVE_REGION_POLITE
        setPadding(0,dp(4),dp(8),dp(4))
    }
    private val waveform=Waveform(context)
    private val primary=button("Record",onPrimary).apply {
        textSize=18f
        setTypeface(typeface,Typeface.BOLD)
        setPadding(dp(12),dp(10),dp(12),dp(10))
    }
    private val cancel=icon("Cancel",R.drawable.ic_close,onCancel)
    private val language=button("Auto") { showLanguages() }.apply {
        contentDescription="Language: Auto"
        style(this,inactive,ink)
    }
    init {
        fitsSystemWindows=true
        setBackgroundColor(surface)
        addView(body,FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,FrameLayout.LayoutParams.WRAP_CONTENT))
        body.addView(LinearLayout(context).apply {
            gravity=Gravity.CENTER_VERTICAL
            addView(status,RowParams(0,RowParams.WRAP_CONTENT,1f))
            addView(icon("Setup",R.drawable.ic_settings,onSetup),RowParams(dp(48),dp(48)))
        },RowParams(RowParams.MATCH_PARENT,RowParams.WRAP_CONTENT))
        for (value in VoiceLanguage.entries) choices.addView(button(value.label) {
            dismissLanguages()
            onLanguage(value)
        }.apply {
            contentDescription="Language ${value.label}"
        },RowParams(0,RowParams.WRAP_CONTENT,1f).apply { marginEnd=dp(4) })
        body.addView(choices,RowParams(RowParams.MATCH_PARENT,RowParams.WRAP_CONTENT).apply { bottomMargin=dp(8) })
        body.addView(waveform,RowParams(RowParams.MATCH_PARENT,dp(28)).apply { bottomMargin=dp(8) })
        body.addView(LinearLayout(context).apply {
            gravity=Gravity.CENTER_VERTICAL
            addView(icon("Switch keyboard",R.drawable.ic_keyboard,onSwitch),RowParams(dp(48),dp(48)).apply { marginEnd=dp(6) })
            addView(language,RowParams(RowParams.WRAP_CONTENT,RowParams.WRAP_CONTENT).apply { marginEnd=dp(6) })
            addView(primary,RowParams(0,RowParams.WRAP_CONTENT,1f))
            addView(cancel,RowParams(dp(48),dp(48)).apply { marginStart=dp(6) })
        },RowParams(RowParams.MATCH_PARENT,RowParams.WRAP_CONTENT))
    }
    fun render(state: KeyboardState,protected: Boolean) {
        val busy=state.phase==VoicePhase.CONNECTING || state.phase==VoicePhase.RECORDING || state.phase==VoicePhase.FINISHING
        val recording=state.phase==VoicePhase.RECORDING
        waveform.levels=if(recording && !protected) state.levels else emptyList()
        waveform.visibility=if(recording && !protected) VISIBLE else INVISIBLE
        waveform.invalidate()
        val previous=rendered
        rendered=state
        if (previous!=null && previous.phase==state.phase && previous.message==state.message && previous.language==state.language && renderedProtected==protected) return
        renderedProtected=protected
        selectedLanguage=state.language
        language.text=state.language.label
        language.contentDescription="Language: ${state.language.label}"
        language.isEnabled=!busy && !protected
        if (!language.isEnabled) dismissLanguages()
        status.text=if (protected) "Voice typing is disabled for this field" else state.message
        status.setTextColor(when {
            protected -> muted
            state.phase==VoicePhase.ERROR -> 0xffffb4ab.toInt()
            recording || state.phase==VoicePhase.DONE -> amber
            else -> ink
        })
        primary.text=when (state.phase) {
            VoicePhase.CONNECTING -> "Connecting"
            VoicePhase.RECORDING -> "Stop"
            VoicePhase.FINISHING -> "Finishing"
            else -> "Record"
        }
        primary.contentDescription=primary.text
        primary.isEnabled=!protected && state.phase!=VoicePhase.CONNECTING && state.phase!=VoicePhase.FINISHING
        primary.setCompoundDrawablesRelativeWithIntrinsicBounds(if(recording) R.drawable.ic_stop else R.drawable.ic_mic,0,0,0)
        primary.compoundDrawablePadding=dp(8)
        primary.compoundDrawableTintList=ColorStateList.valueOf(if(primary.isEnabled) surface else muted)
        style(primary,if(primary.isEnabled) amber else inactive,if(primary.isEnabled) surface else muted)
        cancel.visibility=if(busy && !protected) VISIBLE else INVISIBLE
    }
    private fun showLanguages() {
        if (!language.isEnabled) return
        if (choices.visibility==VISIBLE) { dismissLanguages();return }
        for (i in 0 until choices.childCount) {
            val choice=choices.getChildAt(i) as Button
            choice.isSelected=VoiceLanguage.entries[i]==selectedLanguage
            style(choice,if(choice.isSelected) amber else inactive,if(choice.isSelected) surface else ink)
        }
        choices.visibility=VISIBLE
    }
    fun dismissLanguages(): Boolean {
        val visible=choices.visibility==VISIBLE
        choices.visibility=GONE
        return visible
    }
    override fun onDetachedFromWindow() { dismissLanguages();super.onDetachedFromWindow() }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        requestApplyInsets()
    }
    override fun onMeasure(widthMeasureSpec:Int,heightMeasureSpec:Int) {
        super.onMeasure(widthMeasureSpec,MeasureSpec.makeMeasureSpec(0,MeasureSpec.UNSPECIFIED))
    }
    private fun button(label: String,action: () -> Unit)=Button(context).apply {
        text=label;isAllCaps=false;textSize=14f
        minWidth=dp(48);minHeight=dp(48);minimumWidth=dp(48);minimumHeight=dp(48)
        setPadding(dp(10),dp(8),dp(10),dp(8))
        stateListAnimator=null
        setOnClickListener { action() }
    }
    private fun icon(label: String,drawable: Int,action: () -> Unit)=button("",action).apply {
        contentDescription=label
        if (Build.VERSION.SDK_INT>=26) tooltipText=label
        setCompoundDrawablesRelativeWithIntrinsicBounds(drawable,0,0,0)
        compoundDrawableTintList=ColorStateList.valueOf(ink)
        setPadding(dp(12),dp(12),dp(12),dp(12))
        style(this,inactive,ink)
    }
    private fun style(button: Button,fill: Int,foreground: Int) {
        button.setTextColor(foreground)
        fun shape(focused: Boolean)=GradientDrawable().apply {
            setColor(fill);cornerRadius=dp(12).toFloat()
            if (focused) setStroke(dp(2),0xffffd08a.toInt())
        }
        val states=StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused),shape(true))
            addState(intArrayOf(),shape(false))
        }
        button.background=RippleDrawable(ColorStateList.valueOf(0x33ffd08a),states,null)
    }
    private fun dp(value: Int)=(value*resources.displayMetrics.density).roundToInt()
    private class Waveform(context: Context): View(context) {
        var levels: List<Float> = emptyList()
        private val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply { color=0xfff0a23a.toInt() }
        init { importantForAccessibility=IMPORTANT_FOR_ACCESSIBILITY_NO }
        override fun onDraw(canvas: Canvas) {
            val step=width/26f
            val barWidth=minOf(step*0.55f,4*resources.displayMetrics.density)
            for (i in 0 until 26) {
                val level=levels.getOrElse(i-(26-levels.size)) { 0f }
                val barHeight=height*VoiceLevels.scale(level)
                val x=(i+0.5f)*step
                canvas.drawRoundRect(x-barWidth/2,(height-barHeight)/2,x+barWidth/2,(height+barHeight)/2,barWidth/2,barWidth/2,paint)
            }
        }
    }
}

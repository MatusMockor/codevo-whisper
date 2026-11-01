package com.codevo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.text.InputType
import android.view.View
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager

class VoiceInputService:InputMethodService() {
    private val voice get()=(application as MainApplication).voice
    private val lease=EditorLease<InputConnection>()
    private var protected=false
    private var keyboard:VoiceKeyboardView?=null
    private val screenOff=object:BroadcastReceiver() {
        override fun onReceive(context:Context?,intent:Intent?) { voice.cancel("Device locked") }
    }
    override fun onCreate() {
        super.onCreate()
        voice.ime=this
        val filter=IntentFilter(Intent.ACTION_SCREEN_OFF)
        if (Build.VERSION.SDK_INT>=33) { registerReceiver(screenOff,filter,Context.RECEIVER_NOT_EXPORTED);return }
        registerReceiver(screenOff,filter)
    }
    override fun onCreateInputView():View {
        return VoiceKeyboardView(this,
            onLanguage={ voice.selectLanguage(it.wire) },
            onPrimary={ if (voice.keyboardState.phase==VoicePhase.RECORDING) voice.requestStop() else voice.startIme() },
            onCancel={ voice.cancel() },
            onSwitch={
                voice.cancel("Keyboard switched")
                if (Build.VERSION.SDK_INT<28 || !switchToNextInputMethod(false)) {
                    (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
                }
            },
            onSetup={
                voice.cancel("Setup opened")
                startActivity(Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        ).also { keyboard=it;render() }
    }
    override fun onKeyDown(keyCode:Int,event:KeyEvent):Boolean {
        if (keyCode==KeyEvent.KEYCODE_BACK && keyboard?.dismissLanguages()==true) return true
        return super.onKeyDown(keyCode,event)
    }
    override fun onEvaluateFullscreenMode()=false
    override fun onStartInput(attribute:EditorInfo?,restarting:Boolean) {
        keyboard?.dismissLanguages()
        voice.cancel("Ready")
        super.onStartInput(attribute,restarting)
        val input=attribute?.inputType ?: 0
        val kind=input and InputType.TYPE_MASK_CLASS
        val variation=input and InputType.TYPE_MASK_VARIATION
        protected=input==InputType.TYPE_NULL || (kind==InputType.TYPE_CLASS_TEXT && variation in listOf(InputType.TYPE_TEXT_VARIATION_PASSWORD,InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD)) || (kind==InputType.TYPE_CLASS_NUMBER && variation==InputType.TYPE_NUMBER_VARIATION_PASSWORD)
        lease.open(if (protected) null else currentInputConnection)
        render()
    }
    override fun onStartInputView(info:EditorInfo?,restarting:Boolean) { super.onStartInputView(info,restarting);render() }
    override fun onUpdateSelection(oldSelStart:Int,oldSelEnd:Int,newSelStart:Int,newSelEnd:Int,candidatesStart:Int,candidatesEnd:Int) {
        if (oldSelStart!=newSelStart || oldSelEnd!=newSelEnd) {
            lease.invalidate()
            if (voice.active()) voice.cancel("Selection changed")
        }
        super.onUpdateSelection(oldSelStart,oldSelEnd,newSelStart,newSelEnd,candidatesStart,candidatesEnd)
    }
    override fun onFinishInput() { voice.cancel("Editor closed");lease.open(null);super.onFinishInput() }
    override fun onUnbindInput() { voice.cancel("Editor unbound");lease.open(null);super.onUnbindInput() }
    override fun onWindowHidden() { keyboard?.dismissLanguages();voice.cancel("Keyboard hidden");super.onWindowHidden() }
    override fun onDestroy() {
        voice.cancel("Keyboard stopped");voice.ime=null;unregisterReceiver(screenOff);super.onDestroy()
    }
    fun beginLease(id:String):Boolean= !protected && !voice.locked() && lease.begin(id)
    fun finishLease(id:String):Boolean=lease.finish(id)
    fun invalidateLease() { lease.invalidate() }
    fun commitLease(id:String,text:String):Boolean {
        if (protected || voice.locked()) return false
        val connection=lease.consume(id) ?: return false
        return connection.commitText(text,1)
    }
    fun render() { keyboard?.render(voice.keyboardState,protected) }
}

package com.codevo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class VoiceInputService:InputMethodService() {
    private val voice get()=(application as MainApplication).voice
    private val lease=EditorLease<InputConnection>()
    private var protected=false
    private var label:TextView?=null
    private var record:Button?=null
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
        val layout=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(20,16,20,24);setBackgroundColor(0xff182222.toInt()) }
        label=TextView(this).apply { setTextColor(0xffe6f3ef.toInt());textSize=17f;text=voice.status }
        layout.addView(label)
        fun button(text:String,action:()->Unit):Button {
            val button=Button(this).apply { this.text=text;setOnClickListener { action() } }
            layout.addView(button);return button
        }
        record=button("Record") { voice.startIme() }
        button("Stop") { voice.requestStop() }
        button("Cancel") { voice.cancel() }
        button("Switch keyboard") {
            voice.cancel("Keyboard switched")
            if (Build.VERSION.SDK_INT>=28 && switchToNextInputMethod(false)) return@button
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
        }
        button("Setup") {
            voice.cancel("Setup opened")
            startActivity(Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        return layout
    }
    override fun onStartInput(attribute:EditorInfo?,restarting:Boolean) {
        voice.cancel("Ready")
        super.onStartInput(attribute,restarting)
        val input=attribute?.inputType ?: 0
        val kind=input and InputType.TYPE_MASK_CLASS
        val variation=input and InputType.TYPE_MASK_VARIATION
        protected=input==InputType.TYPE_NULL || (kind==InputType.TYPE_CLASS_TEXT && variation in listOf(InputType.TYPE_TEXT_VARIATION_PASSWORD,InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD)) || (kind==InputType.TYPE_CLASS_NUMBER && variation==InputType.TYPE_NUMBER_VARIATION_PASSWORD)
        lease.open(if (protected) null else currentInputConnection)
        showStatus(if (protected) "Voice typing is disabled for this field" else "Ready")
    }
    override fun onStartInputView(info:EditorInfo?,restarting:Boolean) { super.onStartInputView(info,restarting);record?.isEnabled=!protected }
    override fun onUpdateSelection(oldSelStart:Int,oldSelEnd:Int,newSelStart:Int,newSelEnd:Int,candidatesStart:Int,candidatesEnd:Int) {
        if (oldSelStart!=newSelStart || oldSelEnd!=newSelEnd) {
            lease.invalidate()
            if (voice.active()) voice.cancel("Selection changed")
        }
        super.onUpdateSelection(oldSelStart,oldSelEnd,newSelStart,newSelEnd,candidatesStart,candidatesEnd)
    }
    override fun onFinishInput() { voice.cancel("Editor closed");lease.open(null);super.onFinishInput() }
    override fun onUnbindInput() { voice.cancel("Editor unbound");lease.open(null);super.onUnbindInput() }
    override fun onWindowHidden() { voice.cancel("Keyboard hidden");super.onWindowHidden() }
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
    fun showStatus(status:String) { label?.text=status;record?.isEnabled= !protected && !voice.active() }
}

package com.codevo

import android.app.KeyguardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

class VoiceCoordinator(private val app: MainApplication) {
    private val main=Handler(Looper.getMainLooper())
    var ime: VoiceInputService? = null
    private data class Run(val id:String, val ime:Boolean, val language:VoiceLanguage, var ready:Boolean=false, var finishing:Boolean=false, var capture:PcmCapture?=null)
    private var run:Run?=null
    private val preferences=VoicePreferences(app)
    private val levels=VoiceLevels()
    val language get()=preferences.language
    fun selectLanguage(value:String) {
        check(run==null)
        preferences.setLanguage(value)
        update(keyboardState.message,keyboardState.phase)
        app.reactHost.currentReactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit("CodevoLanguageChanged",language.wire)
    }
    fun runLanguage(id:String):String { val current=run;check(current!=null && current.id==id);return current.language.wire }
    private val tasks=mutableMapOf<Int,HeadlessJsTaskContext>()
    var keyboardState=KeyboardState(VoicePhase.IDLE,"Open Codevo Voice to pair and allow microphone")
        private set

    fun locked():Boolean=(app.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
    fun active():Boolean=run!=null
    fun startIme() {
        if (run != null || locked()) return
        val id=UUID.randomUUID().toString()
        if (ime?.beginLease(id) != true) return
        run=Run(id,true,language)
        update("Connecting…",VoicePhase.CONNECTING)
        val host=app.reactHost
        fun launch(context:ReactContext) {
            val taskContext=HeadlessJsTaskContext.getInstance(context)
            var ownedTaskId = -1
            val listener=object:HeadlessJsTaskEventListener {
                override fun onHeadlessJsTaskStart(taskId:Int) {}
                override fun onHeadlessJsTaskFinish(taskId:Int) {
                    if (taskId != ownedTaskId || tasks.remove(taskId) == null) return
                    taskContext.removeTaskEventListener(this)
                    if (run?.id==id) cancel("Recording ended")
                }
            }
            taskContext.addTaskEventListener(listener)
            val data=Arguments.createMap().apply { putString("runId",id) }
            val taskId=taskContext.startTask(HeadlessJsTaskConfig("CodevoDictation",data,360000,true))
            ownedTaskId = taskId
            tasks[taskId]=taskContext
        }
        val context=host.currentReactContext
        if (context!=null) { launch(context);return }
        val listener=object:ReactInstanceEventListener {
            override fun onReactContextInitialized(context:ReactContext) {
                host.removeReactInstanceEventListener(this)
                main.post { launch(context) }
            }
        }
        host.addReactInstanceEventListener(listener)
        host.start()
        main.postDelayed({ if (run?.id==id && run?.ready==false) cancel("Voice runtime did not start. Reopen Codevo Voice.",VoicePhase.ERROR) },20000)
    }
    fun startCompanion():String {
        check(run==null && !locked())
        val id=UUID.randomUUID().toString()
        run=Run(id,false,language)
        update("Connecting…",VoicePhase.CONNECTING)
        return id
    }
    fun ready(id:String):Boolean {
        val current=run ?: return false
        if (current.id!=id || locked()) return false
        current.ready=true
        return true
    }
    fun capture(id:String) {
        val current=run ?: error("Recording cancelled")
        check(current.id==id && current.ready && !current.finishing && !locked())
        val capture=PcmCapture(
            {sequence,pcm,level -> main.post { if (run===current) {
                emit("pcm",id,sequence,pcm)
                if (keyboardState.phase==VoicePhase.RECORDING) {
                    levels.update(VoicePhase.RECORDING,level)
                    keyboardState=keyboardState.copy(levels=levels.values)
                    ime?.render()
                }
            } } },
            { main.post { if (run===current) emit("ended",id) } },
            { main.post { if (run===current) cancel("Microphone stopped or audio queue full",VoicePhase.ERROR) } }
        )
        current.capture=capture
        capture.start()
        update("Recording",VoicePhase.RECORDING)
    }
    fun acknowledge(id:String, sequence:Int) { if (run?.id==id) run?.capture?.acknowledge(sequence) }
    fun requestStop() {
        val current=run ?: return
        if (current.finishing) return
        if (current.ime && ime?.finishLease(current.id)!=true) { cancel("Editor changed");return }
        current.finishing=true
        update("Finishing…",VoicePhase.FINISHING)
        emit("stop",current.id)
    }
    fun stopCapture(id:String) {
        val current=run ?: return
        if (current.id!=id) return
        if (current.capture==null) { emit("ended",id);return }
        current.capture?.stop()
    }
    fun complete(id:String, text:String):Boolean {
        val current=run ?: return false
        if (current.id!=id || !current.finishing || locked()) return false
        run=null
        current.capture?.stop()
        val committed= !current.ime || ime?.commitLease(id,text)==true
        update(if (committed) "Done" else "Editor changed. Text was not inserted.",if (committed) VoicePhase.DONE else VoicePhase.ERROR)
        return committed
    }
    fun terminal(id:String, message:String) {
        if (run?.id!=id) return
        cancel(message,VoicePhase.ERROR)
    }
    fun cancel(message:String="Cancelled",phase:VoicePhase=VoicePhase.IDLE) {
        ime?.invalidateLease()
        val current=run
        run=null
        current?.capture?.stop()
        if (current!=null) emit("cancel",current.id)
        update(message,phase)
    }
    fun companionHidden() { if (run?.ime==false) cancel("Recording stopped when app left foreground") }
    private fun update(value:String,phase:VoicePhase) {
        if (phase!=VoicePhase.RECORDING) levels.update(phase)
        keyboardState=KeyboardState(phase,value,language,levels.values);ime?.render()
    }
    private fun emit(type:String, id:String, sequence:Int?=null, pcm:String?=null) {
        val context=app.reactHost.currentReactContext ?: return
        val data=Arguments.createMap().apply {
            putString("type",type);putString("runId",id)
            if (sequence!=null) putInt("sequence",sequence)
            if (pcm!=null) putString("pcm",pcm)
        }
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("CodevoVoiceEvent",data)
    }
}

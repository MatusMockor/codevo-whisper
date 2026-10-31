package com.codevo

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.view.inputmethod.InputMethodManager
import com.facebook.react.bridge.*
import java.security.SecureRandom

class VoiceModule(context:ReactApplicationContext):ReactContextBaseJavaModule(context),LifecycleEventListener {
    private val app get()=reactApplicationContext.applicationContext as MainApplication
    private val main=Handler(Looper.getMainLooper())
    private val vault=PairingVault(context)
    private val random=SecureRandom()
    init { context.addLifecycleEventListener(this) }
    override fun getName()="CodevoVoice"
    @ReactMethod(isBlockingSynchronousMethod=true) fun randomBytes(size:Int):String {
        require(size in 0..65536)
        return Base64.encodeToString(ByteArray(size).also { random.nextBytes(it) },Base64.NO_WRAP)
    }
    private fun perform(promise:Promise,action:()->Any?) {
        main.post { try { promise.resolve(action()) } catch (_:Exception) { promise.reject("voice_error","Voice operation failed. Check permission, pairing and keyboard setup.") } }
    }
    @ReactMethod fun loadPairing(promise:Promise)=perform(promise) { vault.load() }
    @ReactMethod fun savePairing(value:String,promise:Promise)=perform(promise) { vault.save(value);null }
    @ReactMethod fun removePairing(promise:Promise)=perform(promise) { app.voice.cancel("Pairing removed");vault.remove();null }
    @ReactMethod fun beginCompanion(promise:Promise)=perform(promise) { app.voice.startCompanion() }
    @ReactMethod fun ready(id:String,promise:Promise)=perform(promise) { app.voice.ready(id) }
    @ReactMethod fun capture(id:String,promise:Promise)=perform(promise) { app.voice.capture(id);null }
    @ReactMethod fun stopCapture(id:String,promise:Promise)=perform(promise) { app.voice.stopCapture(id);null }
    @ReactMethod fun stop(promise:Promise)=perform(promise) { app.voice.requestStop();null }
    @ReactMethod fun cancel(promise:Promise)=perform(promise) { app.voice.cancel();null }
    @ReactMethod fun acknowledge(id:String,sequence:Int) { main.post { app.voice.acknowledge(id,sequence) } }
    @ReactMethod fun complete(id:String,text:String,promise:Promise)=perform(promise) { app.voice.complete(id,text) }
    @ReactMethod fun terminal(id:String,message:String,promise:Promise)=perform(promise) { app.voice.terminal(id,message);null }
    @ReactMethod fun keyboardSettings(promise:Promise)=perform(promise) {
        reactApplicationContext.startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));null
    }
    @ReactMethod fun switchKeyboard(promise:Promise)=perform(promise) { (app.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker();null }
    @ReactMethod fun addListener(eventName:String) {}
    @ReactMethod fun removeListeners(count:Int) {}
    override fun onHostResume() {}
    override fun onHostPause() { main.post { app.voice.companionHidden() } }
    override fun onHostDestroy() { main.post { app.voice.companionHidden() } }
}

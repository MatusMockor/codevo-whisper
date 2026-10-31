package com.codevo

import android.util.Base64
import com.facebook.react.bridge.*
import okhttp3.OkHttpClient
import okio.ByteString.Companion.toByteString
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class SocketModule(context:ReactApplicationContext):ReactContextBaseJavaModule(context) {
    private val client=OkHttpClient.Builder().connectTimeout(10,TimeUnit.SECONDS).writeTimeout(10,TimeUnit.SECONDS).readTimeout(0,TimeUnit.SECONDS).build()
    private val scheduler=Executors.newSingleThreadScheduledExecutor()
    private val sockets=mutableMapOf<String,SocketTransport>()
    private var invalidated=false
    override fun getName()="CodevoSocket"
    private fun emit(id:String,type:String,data:String?=null) {
        if (!reactApplicationContext.hasActiveReactInstance()) return
        val event=Arguments.createMap().apply { putString("id",id);putString("type",type);if (data!=null) putString("data",data) }
        reactApplicationContext.emitDeviceEvent("CodevoSocketEvent",event)
    }
    @ReactMethod @Synchronized fun connect(id:String,endpoint:String,promise:Promise) {
        if (invalidated || sockets.containsKey(id) || sockets.size>=4) { promise.reject("socket_error","Socket unavailable");return }
        try {
            val transport=SocketTransport(client,scheduler,{ bytes->emit(id,"frame",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP)) },{ emit(id,"failed") })
            sockets[id]=transport
            transport.connect(endpoint).whenComplete { _,error->
                if (error==null) promise.resolve(null) else promise.reject("socket_error","Connection failed")
            }
        } catch (_:Exception) { sockets.remove(id)?.close();promise.reject("socket_error","Connection failed") }
    }
    @ReactMethod @Synchronized fun send(id:String,data:String,promise:Promise) {
        val transport=sockets[id]
        if (transport==null || data.length>85336) { promise.reject("socket_error","Socket unavailable or full");return }
        try {
            transport.send(Base64.decode(data,Base64.NO_WRAP).toByteString()).whenComplete { _,error->
                if (error==null) promise.resolve(null) else promise.reject("socket_error","Socket closed or stalled")
            }
        } catch (_:Exception) { transport.close();promise.reject("socket_error","Socket send failed") }
    }
    @ReactMethod @Synchronized fun close(id:String) { sockets.remove(id)?.close() }
    @ReactMethod fun addListener(eventName:String) {}
    @ReactMethod fun removeListeners(count:Int) {}
    @Synchronized override fun invalidate() {
        invalidated=true
        sockets.values.forEach { it.close() };sockets.clear()
        scheduler.shutdownNow()
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
        super.invalidate()
    }
}

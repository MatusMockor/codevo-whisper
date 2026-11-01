package com.codevo

import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class SocketTransport(
    private val factory:WebSocket.Factory,
    private val scheduler:ScheduledExecutorService,
    private val frame:(ByteString)->Unit,
    private val failed:()->Unit,
) {
    private var socket:WebSocket?=null
    private val opening=CompletableFuture<Unit>()
    private var pending:CompletableFuture<Unit>?=null
    private var poll:ScheduledFuture<*>?=null
    private var closed=false

    @Synchronized fun connect(endpoint:String):CompletableFuture<Unit> {
        check(socket==null && !closed)
        socket=factory.newWebSocket(Request.Builder().url(endpoint).build(),object:WebSocketListener() {
            override fun onOpen(webSocket:WebSocket,response:Response) { synchronized(this@SocketTransport) {
                if (closed) webSocket.cancel() else opening.complete(Unit)
            } }
            override fun onMessage(webSocket:WebSocket,bytes:ByteString) { synchronized(this@SocketTransport) {
                if (closed) return
                if (bytes.size>65535) fail() else frame(bytes)
            } }
            override fun onMessage(webSocket:WebSocket,text:String) { fail() }
            override fun onClosing(webSocket:WebSocket,code:Int,reason:String) { fail() }
            override fun onFailure(webSocket:WebSocket,t:Throwable,response:Response?) { fail() }
        })
        return opening
    }

    @Synchronized fun send(bytes:ByteString):CompletableFuture<Unit> {
        val result=CompletableFuture<Unit>()
        val current=socket
        if (closed || !opening.isDone || opening.isCompletedExceptionally || current==null || pending!=null || bytes.size==0 || bytes.size>64000 || current.queueSize()+bytes.size>64000) {
            result.completeExceptionally(IllegalStateException("Socket unavailable or full"))
            fail()
            return result
        }
        pending=result
        if (!current.send(bytes)) { fail();return result }
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10)
        poll=scheduler.scheduleAtFixedRate({ synchronized(this) {
            if (closed) return@scheduleAtFixedRate
            if (current.queueSize()==0L) {
                poll?.cancel(false);poll=null;pending=null;result.complete(Unit)
            } else if (System.nanoTime()>=deadline) fail()
        } },10,10,TimeUnit.MILLISECONDS)
        return result
    }

    @Synchronized private fun fail() {
        if (closed) return
        close()
        failed()
    }

    @Synchronized fun close() {
        if (closed) return
        closed=true
        poll?.cancel(false);poll=null
        socket?.cancel();socket=null
        val error=IllegalStateException("Socket closed or stalled")
        opening.completeExceptionally(error)
        pending?.completeExceptionally(error);pending=null
    }
}

package com.codevo

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.ByteString
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

class SocketTransportTest {
    @Test fun stalledNativeQueueDoesNotAcknowledgeSendAndTimesOut() {
        val server=MockWebServer()
        val release=CountDownLatch(1)
        val failed=CountDownLatch(1)
        server.enqueue(MockResponse().withWebSocketUpgrade(object:WebSocketListener() {
            override fun onMessage(webSocket:WebSocket,bytes:ByteString) { release.await(20,TimeUnit.SECONDS) }
        }))
        server.start()
        val client=OkHttpClient.Builder().writeTimeout(0,TimeUnit.SECONDS).build()
        val scheduler=Executors.newSingleThreadScheduledExecutor()
        var actual:WebSocket?=null
        val factory=object:WebSocket.Factory {
            override fun newWebSocket(request:Request,listener:WebSocketListener):WebSocket = client.newWebSocket(request,listener).also { actual=it }
        }
        val transport=SocketTransport(factory,scheduler,{}, { failed.countDown() })
        try {
            transport.connect(server.url("/").toString().replace("http:","ws:")).get(3,TimeUnit.SECONDS)
            val bytes=ByteString.of(*ByteArray(64000))
            var stalled=false
            for (i in 0..511) {
                val sent=transport.send(bytes)
                try { sent.get(200,TimeUnit.MILLISECONDS) } catch (_:TimeoutException) {
                    assertFalse("A queued write was prematurely acknowledged",sent.isDone)
                    assertTrue("Expected an actual stalled OkHttp queue",(actual?.queueSize() ?: 0)>0)
                    assertTrue((actual?.queueSize() ?: Long.MAX_VALUE)<=64000)
                    assertTrue("Stalled socket must fail",failed.await(12,TimeUnit.SECONDS))
                    assertTrue(sent.isCompletedExceptionally)
                    stalled=true
                    break
                }
            }
            assertTrue("Peer never produced a stalled native queue",stalled)
            assertTrue(transport.send(bytes).isCompletedExceptionally)
        } finally {
            transport.close();release.countDown();scheduler.shutdownNow()
            actual?.cancel();client.dispatcher.executorService.shutdownNow();client.connectionPool.evictAll();server.close()
        }
    }

    @Test fun rejectsFramesOverTheNativeBoundBeforeSending() {
        val server=MockWebServer()
        val received=CountDownLatch(1)
        server.enqueue(MockResponse().withWebSocketUpgrade(object:WebSocketListener() {
            override fun onMessage(webSocket:WebSocket,bytes:ByteString) { received.countDown() }
        }))
        val client=OkHttpClient()
        val scheduler=Executors.newSingleThreadScheduledExecutor()
        val transport=SocketTransport(client,scheduler,{}, {})
        try {
            transport.connect(server.url("/").toString().replace("http:","ws:")).get(3,TimeUnit.SECONDS)
            assertTrue(transport.send(ByteString.of(*ByteArray(64001))).isCompletedExceptionally)
            assertFalse(received.await(100,TimeUnit.MILLISECONDS))
        } finally {
            transport.close();scheduler.shutdownNow();client.dispatcher.executorService.shutdownNow();client.connectionPool.evictAll();server.close()
        }
    }
}

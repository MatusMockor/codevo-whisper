package com.codevo

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import java.util.concurrent.atomic.AtomicBoolean

class PcmCapture(private val frame: (Int, String, Float) -> Unit, private val ended: () -> Unit, private val failed: () -> Unit) {
    private val running = AtomicBoolean(false)
    private val pending = java.util.concurrent.ConcurrentHashMap.newKeySet<Int>()
    private var recorder: AudioRecord? = null
    private var thread: Thread? = null

    @Synchronized fun start() {
        check(thread == null)
        val size=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT)
        check(size > 0)
        val record=try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,maxOf(size,12800))
        } catch (denied: SecurityException) { throw IllegalStateException("Microphone permission required",denied) }
        if (record.state != AudioRecord.STATE_INITIALIZED) { record.release(); error("Microphone unavailable") }
        recorder=record
        try {
            record.startRecording()
            check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING)
        } catch (failure: Exception) {
            record.release()
            recorder=null
            throw failure
        }
        running.set(true)
        thread=Thread({
            val buffer=ByteArray(3200)
            var filled=0
            var sequence=0
            try {
                while (running.get()) {
                    val count=record.read(buffer,filled,buffer.size-filled,AudioRecord.READ_BLOCKING)
                    if (count < 0) { check(!running.get()); break }
                    filled+=count
                    if (filled == buffer.size) {
                        check(pending.size < 8)
                        pending.add(sequence)
                        frame(sequence++,Base64.encodeToString(buffer,Base64.NO_WRAP),VoiceLevels.rms(buffer,filled))
                        filled=0
                    }
                }
                if (filled > 0) {
                    check(filled % 2 == 0)
                    check(pending.size < 8)
                    pending.add(sequence)
                    frame(sequence,Base64.encodeToString(buffer.copyOf(filled),Base64.NO_WRAP),VoiceLevels.rms(buffer,filled))
                }
                ended()
            } catch (_: Exception) { failed() }
            finally { running.set(false);record.release();recorder=null }
        },"CodevoPCM").apply { start() }
    }
    fun acknowledge(sequence: Int) { pending.remove(sequence) }
    fun stop() {
        running.set(false)
        try { recorder?.stop() } catch (_: IllegalStateException) { failed() }
    }
}

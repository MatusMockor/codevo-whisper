package com.codevo

import kotlin.math.sqrt

class VoiceLevels {
    var values: List<Float> = emptyList()
        private set
    fun update(phase: VoicePhase,level: Float=0f) {
        values=if (phase==VoicePhase.RECORDING) (values+if(level.isFinite()) level.coerceIn(0f,1f) else 0f).takeLast(26) else emptyList()
    }
    companion object {
        fun rms(pcm: ByteArray,count: Int): Float {
            if (count<2) return 0f
            var energy=0.0
            for (i in 0 until count-1 step 2) {
                val sample=((pcm[i].toInt() and 255) or (pcm[i+1].toInt() shl 8)).toShort().toDouble()/32768.0
                energy+=sample*sample
            }
            return sqrt(energy/(count/2)).toFloat().coerceIn(0f,1f)
        }
        fun scale(level: Float): Float=if (level.isFinite()) (sqrt(level.coerceIn(0f,1f))*1.6f).coerceIn(0.08f,1f) else 0.08f
    }
}

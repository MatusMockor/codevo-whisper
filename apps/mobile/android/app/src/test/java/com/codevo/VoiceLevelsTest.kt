package com.codevo

import org.junit.Assert.*
import org.junit.Test

class VoiceLevelsTest {
    @Test fun levelsComeFromSignedPcmAndHistoryResetsOutsideRecording() {
        val history=VoiceLevels()
        assertEquals(0f,VoiceLevels.rms(ByteArray(3200),3200),0.00001f)
        assertEquals(0.5f,VoiceLevels.rms(byteArrayOf(0,64,0,-64),4),0.00001f)
        assertEquals(1f,VoiceLevels.rms(byteArrayOf(0,-128),2),0.00001f)
        assertEquals(0.08f,VoiceLevels.scale(0f),0.00001f)
        assertEquals(0.8f,VoiceLevels.scale(0.25f),0.00001f)
        repeat(40) { history.update(VoicePhase.RECORDING,0.25f) }
        assertEquals(26,history.values.size)
        assertTrue(history.values.all { it==0.25f })
        for (phase in VoicePhase.entries.filter { it!=VoicePhase.RECORDING }) {
            history.update(phase,1f)
            assertTrue("$phase clears waveform",history.values.isEmpty())
            history.update(VoicePhase.RECORDING,Float.NaN)
            assertEquals(listOf(0f),history.values)
        }
    }
}

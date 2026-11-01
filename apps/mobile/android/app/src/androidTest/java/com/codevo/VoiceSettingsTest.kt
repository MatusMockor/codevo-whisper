package com.codevo

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VoiceSettingsTest {
    @Test fun languageIsPersistentAndInvalidBridgeValuesCannotReplaceIt() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val prefs=VoicePreferences(context)
        val previous=prefs.language
        try {
            prefs.setLanguage("sk")
            assertEquals(VoiceLanguage.SK,VoicePreferences(context).language)
            assertThrows(IllegalArgumentException::class.java) { prefs.setLanguage("de") }
            assertEquals(VoiceLanguage.SK,prefs.language)
            val app=context.applicationContext as MainApplication
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                val id=app.voice.startCompanion()
                assertEquals("sk",app.voice.runLanguage(id))
                assertThrows(IllegalStateException::class.java) { app.voice.selectLanguage("en") }
                assertEquals("sk",app.voice.runLanguage(id))
                app.voice.cancel()
                app.voice.selectLanguage("en")
                assertEquals(VoiceLanguage.EN,prefs.language)
            }
        } finally { prefs.setLanguage(previous.wire) }
    }
}

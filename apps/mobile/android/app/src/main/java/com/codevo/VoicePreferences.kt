package com.codevo

import android.content.Context

enum class VoiceLanguage(val wire: String,val label: String) {
    AUTO("auto","Auto"), SK("sk","Slovak"), EN("en","English"), CS("cs","Czech");
    companion object {
        fun parse(value: String)=entries.firstOrNull { it.wire==value } ?: throw IllegalArgumentException("Invalid voice language")
    }
}
class VoicePreferences(context: Context) {
    private val preferences=context.getSharedPreferences("voice-settings",Context.MODE_PRIVATE)
    val language: VoiceLanguage get()=VoiceLanguage.parse(preferences.getString("language","auto") ?: "auto")
    fun setLanguage(value: String) {
        val selected=VoiceLanguage.parse(value)
        check(preferences.edit().putString("language",selected.wire).commit())
    }
}

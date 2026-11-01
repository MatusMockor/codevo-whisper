package com.codevo

enum class VoicePhase { IDLE, CONNECTING, RECORDING, FINISHING, DONE, ERROR }

data class KeyboardState(val phase: VoicePhase, val message: String)

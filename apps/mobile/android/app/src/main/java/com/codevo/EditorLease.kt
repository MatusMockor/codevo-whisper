package com.codevo

class EditorLease<T> {
    private var generation = 0L
    private var editor: T? = null
    private data class Run<T>(val id: String, val generation: Long, val connection: T, var finishing: Boolean = false)
    private var run: Run<T>? = null

    fun open(connection: T?) {
        invalidate()
        editor = connection
    }
    fun invalidate() {
        generation++
        run = null
    }
    fun begin(id: String): Boolean {
        val connection = editor ?: return false
        if (run != null) return false
        run = Run(id, generation, connection)
        return true
    }
    fun finish(id: String): Boolean {
        val active = run ?: return false
        if (active.id != id || active.generation != generation || active.finishing) return false
        active.finishing = true
        return true
    }
    fun consume(id: String): T? {
        val active = run ?: return null
        if (active.id != id || active.generation != generation || !active.finishing) return null
        run = null
        return active.connection
    }
}

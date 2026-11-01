package com.codevo

import org.junit.Assert.*
import org.junit.Test

class EditorLeaseTest {
    @Test fun finishCommitsToCapturedConnectionOnlyOnce() {
        val lease = EditorLease<String>()
        lease.open("original")
        assertTrue(lease.begin("run"))
        assertNull(lease.consume("run"))
        assertTrue(lease.finish("run"))
        assertEquals("original", lease.consume("run"))
        assertNull(lease.consume("run"))
    }
    @Test fun editorRestartOrSelectionChangeCannotAuthorizeLateDone() {
        for (replace in listOf(false, true)) {
            val lease = EditorLease<String>()
            lease.open("original"); lease.begin("run"); lease.finish("run")
            if (replace) lease.open("next") else lease.invalidate()
            assertNull(lease.consume("run"))
        }
    }
    @Test fun staleRunCannotConsumeNewLease() {
        val lease=EditorLease<String>()
        lease.open("first");lease.begin("old");lease.finish("old")
        lease.open("second");lease.begin("new");lease.finish("new")
        assertNull(lease.consume("old"))
        assertEquals("second",lease.consume("new"))
    }
}

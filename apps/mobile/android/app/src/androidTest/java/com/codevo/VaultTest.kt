package com.codevo

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class VaultTest {
    @Test fun protectsPairingWithoutBackupsAndRejectsTampering() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val vault=PairingVault(context)
        val previous=vault.load()
        try {
            val value="test-private-pairing-with-no-real-credentials"
            vault.save(value)
            assertEquals(value,vault.load())
            val file=File(context.noBackupFilesDir,"pairing.gcm")
            val bytes=file.readBytes()
            assertFalse(String(bytes,Charsets.ISO_8859_1).contains(value))
            assertEquals(0,context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP)
            try { vault.save("x".repeat(16385));fail("Oversized replacement accepted") } catch (_:IllegalArgumentException) {}
            assertEquals(value,vault.load())
            bytes[bytes.lastIndex]=(bytes.last().toInt() xor 1).toByte()
            file.writeBytes(bytes)
            try { vault.load();fail("Modified ciphertext accepted") } catch (_:javax.crypto.AEADBadTagException) {}
            vault.remove();assertNull(vault.load())
        } finally {
            if (previous!=null) vault.save(previous) else vault.remove()
        }
    }
}

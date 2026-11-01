package com.codevo

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class PairingVault(context: Context) {
    private val file = File(context.noBackupFilesDir, "pairing.gcm")
    private val alias = "codevo-pairing-v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(alias, null)
        if (existing != null) return existing as SecretKey
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun load(): String? {
        if (!file.exists()) return null
        val bytes = file.readBytes()
        require(bytes.size in 29..16412)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0,12)))
        return String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)), Charsets.UTF_8)
    }
    @Synchronized fun save(value: String) {
        val bytes=value.toByteArray(Charsets.UTF_8)
        require(bytes.size <= 16384)
        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE,key())
        val temporary=File(file.parentFile,"pairing.pending")
        java.io.FileOutputStream(temporary).use { stream -> stream.write(cipher.iv + cipher.doFinal(bytes)); stream.fd.sync() }
        check(temporary.renameTo(file))
    }
    @Synchronized fun remove() {
        if (file.exists()) check(file.delete())
    }
}

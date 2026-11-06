package kz.studenthub.app.core.session

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Хранилище секретов. Интерфейс — ради тестов: в них подставляется словарь в памяти. */
interface SecretStore {
    fun value(key: SecretKey): String?

    fun set(key: SecretKey, value: String)

    fun remove(key: SecretKey)

    enum class SecretKey(val id: String) {
        /**
         * Refresh-токен. Сервер отдаёт его только в httpOnly-cookie, приложение переносит
         * значение сюда: cookie живут в памяти процесса и умирают вместе с ним.
         */
        REFRESH_TOKEN("session.refresh-token"),

        /**
         * Признак того, что вход уже был. Без него холодный старт не отличает «не входил
         * ни разу» от «токен в памяти пропал после выгрузки».
         */
        SESSION_PRESENT("session.present"),
    }
}

/**
 * Секреты в `SharedPreferences`, зашифрованные ключом AES-GCM из Android Keystore.
 *
 * Сам ключ из Keystore не извлекается: даже копия файла настроек с телефона ничего не
 * даст без этого устройства. Библиотека security-crypto устарела, поэтому шифрование
 * своё — это двадцать строк вокруг `Cipher`, а не повод для зависимости.
 *
 * Ключ, который нельзя прочитать (сброс экрана блокировки на части устройств,
 * восстановление на другой телефон), не роняет приложение: значение считается
 * отсутствующим, и человек просто входит заново.
 */
class KeystoreSecretStore(context: Context) : SecretStore {
    private val prefs: SharedPreferences = context.getSharedPreferences("secrets", Context.MODE_PRIVATE)

    override fun value(key: SecretStore.SecretKey): String? {
        val stored = prefs.getString(key.id, null) ?: return null
        return runCatching {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, bytes, 0, IV_SIZE))
            cipher.doFinal(bytes, IV_SIZE, bytes.size - IV_SIZE).decodeToString()
        }.getOrElse {
            prefs.edit { remove(key.id) }
            null
        }
    }

    override fun set(key: SecretStore.SecretKey, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val sealed = cipher.iv + cipher.doFinal(value.toByteArray())
        prefs.edit { putString(key.id, Base64.encodeToString(sealed, Base64.NO_WRAP)) }
    }

    override fun remove(key: SecretStore.SecretKey) {
        prefs.edit { remove(key.id) }
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "studenthub.secrets"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_SIZE = 12
    }
}

/** Словарь в памяти — для тестов. */
class InMemorySecretStore : SecretStore {
    private val values = mutableMapOf<SecretStore.SecretKey, String>()

    override fun value(key: SecretStore.SecretKey): String? = synchronized(values) { values[key] }

    override fun set(key: SecretStore.SecretKey, value: String) {
        synchronized(values) { values[key] = value }
    }

    override fun remove(key: SecretStore.SecretKey) {
        synchronized(values) { values.remove(key) }
    }
}

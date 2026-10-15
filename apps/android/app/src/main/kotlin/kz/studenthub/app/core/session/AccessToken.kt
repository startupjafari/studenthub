package kz.studenthub.app.core.session

import kz.studenthub.app.core.model.Role
import kz.studenthub.app.core.network.AppJson
import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.Base64

/**
 * Разобранный access-токен.
 *
 * Подпись клиент не проверяет и не должен: ключ у сервера. Содержимое здесь только
 * читается — чтобы знать срок жизни и не рисовать разделы, которых у роли нет.
 * Решение о доступе принимает API.
 */
data class AccessToken(
    val raw: String,
    val subject: String,
    val role: Role,
    val universityId: String?,
    val facultyId: String?,
    val groupId: String?,
    val twoFactorEnabled: Boolean,
    val expiresAt: Instant,
) {
    /**
     * Токен живёт 15 минут. Обновляем заранее: запрос с токеном, которому осталась
     * секунда, доедет до сервера уже просроченным.
     */
    fun isUsable(at: Instant = Instant.now()): Boolean = expiresAt.epochSecond - at.epochSecond > REFRESH_MARGIN_SECONDS

    @Serializable
    private data class Claims(
        val sub: String,
        val role: String,
        val universityId: String? = null,
        val facultyId: String? = null,
        val groupId: String? = null,
        val tfa: Boolean? = null,
        val exp: Double,
    )

    companion object {
        const val REFRESH_MARGIN_SECONDS = 30L

        /** `null`, если строка не JWT или в ней нет нужных полей. */
        fun parse(raw: String): AccessToken? {
            val parts = raw.split('.')
            if (parts.size != 3) return null
            // base64url без выравнивания — декодер URL-алфавита принимает его как есть.
            val payload = runCatching { Base64.getUrlDecoder().decode(parts[1]) }.getOrNull() ?: return null
            val claims = runCatching {
                AppJson.decodeFromString(Claims.serializer(), payload.decodeToString())
            }.getOrNull() ?: return null
            return AccessToken(
                raw = raw,
                subject = claims.sub,
                role = Role.from(claims.role),
                universityId = claims.universityId,
                facultyId = claims.facultyId,
                groupId = claims.groupId,
                twoFactorEnabled = claims.tfa ?: false,
                expiresAt = Instant.ofEpochSecond(claims.exp.toLong()),
            )
        }
    }
}

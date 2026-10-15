package kz.studenthub.app.core.network

import kz.studenthub.app.R
import kz.studenthub.app.core.ui.UiText
import kotlinx.serialization.Serializable
import java.io.IOException

/**
 * Код ошибки API (PROJECT.md §8.2).
 *
 * Клиент реагирует на код, а не на текст: тексты сервер отдаёт по-русски и меняет,
 * когда захочет. Незнакомый код не роняет разбор — он остаётся строкой, и экран
 * показывает серверное сообщение как есть. Это важно для старых сборок: новый код на
 * сервере появится раньше, чем все обновят приложение.
 */
@JvmInline
value class ApiErrorCode(val raw: String) {
    /** Токен протух или не принят — единственный повод попробовать обновить сессию. */
    val meansSessionExpired: Boolean get() = this == UNAUTHORIZED || this == TOKEN_EXPIRED

    companion object {
        val BAD_REQUEST = ApiErrorCode("BAD_REQUEST")
        val UNAUTHORIZED = ApiErrorCode("UNAUTHORIZED")
        val TOKEN_EXPIRED = ApiErrorCode("TOKEN_EXPIRED")
        val FORBIDDEN = ApiErrorCode("FORBIDDEN")
        val WRONG_SCOPE = ApiErrorCode("WRONG_SCOPE")
        val NOT_FOUND = ApiErrorCode("NOT_FOUND")
        val CONFLICT = ApiErrorCode("CONFLICT")
        val FILE_TYPE_NOT_ALLOWED = ApiErrorCode("FILE_TYPE_NOT_ALLOWED")
        val FILE_TOO_LARGE = ApiErrorCode("FILE_TOO_LARGE")
        val FILE_DIRECT_UPLOAD_REQUIRED = ApiErrorCode("FILE_DIRECT_UPLOAD_REQUIRED")
        val VALIDATION_ERROR = ApiErrorCode("VALIDATION_ERROR")
        val RATE_LIMIT = ApiErrorCode("RATE_LIMIT")
        val INTERNAL_ERROR = ApiErrorCode("INTERNAL_ERROR")
        val INVALID_2FA_CODE = ApiErrorCode("INVALID_2FA_CODE")
        val MAINTENANCE = ApiErrorCode("MAINTENANCE")
        val LOGIN_LOCKED = ApiErrorCode("LOGIN_LOCKED")
    }
}

@Serializable
data class ApiErrorDetail(val field: String, val message: String)

/** Всё, чем может закончиться запрос. */
sealed class ApiError(cause: Throwable? = null) : Exception(cause) {
    /** Сеть не дала ответа: нет связи, таймаут, обрыв. */
    class Transport(cause: IOException) : ApiError(cause)

    /** Сервер ответил ошибкой по контракту. */
    class Server(
        override val code: ApiErrorCode,
        val serverMessage: String,
        val details: List<ApiErrorDetail>,
        val statusCode: Int,
    ) : ApiError() {
        override val message: String get() = "$statusCode ${code.raw}: $serverMessage"
    }

    /**
     * Ответ пришёл, но прочитать его не удалось — расхождение контракта. Чинится не
     * повтором, а правкой модели, поэтому не глушим.
     */
    class Decoding(cause: Throwable, val statusCode: Int) : ApiError(cause)

    /** Ответ без тела там, где оно обязано быть, или нечитаемый статус. */
    class Malformed(val statusCode: Int) : ApiError()

    open val code: ApiErrorCode? get() = null

    /**
     * Текст для человека. Серверное сообщение уже на языке платформы — показываем его;
     * свои строки только там, где сервер ничего не сказал.
     */
    val displayMessage: UiText
        get() = when (this) {
            is Server -> UiText.Raw(serverMessage)
            is Transport -> UiText.Res(R.string.error_network)
            is Decoding, is Malformed -> UiText.Res(R.string.error_unexpected)
        }
}

/** Текст ошибки любого происхождения: не-API ошибка — это «неожиданный ответ». */
fun Throwable.displayMessage(): UiText =
    (this as? ApiError)?.displayMessage ?: UiText.Res(R.string.error_unexpected)

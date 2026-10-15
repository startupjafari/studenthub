package kz.studenthub.app.core.session

import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.Endpoint
import kotlinx.serialization.Serializable
import java.net.URI

/**
 * Разобранный код входа по QR.
 *
 * В QR на экране компьютера лежит ссылка вида `https://<веб>/qr?t=<uuid>` — тот же
 * адрес, который открывает камера телефона без приложения.
 */
data class QrLoginTicket(val approveToken: String) {
    companion object {
        private val UUID_PATTERN = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

        /**
         * Строгий разбор — часть защиты. На платформе есть и другие QR (посещаемость,
         * помещения): пустив сюда любую ссылку с `t`, мы дали бы подтвердить вход, глядя
         * на чужой код. Поэтому проверяем схему, путь и то, что токен — UUID.
         */
        fun parse(scanned: String): QrLoginTicket? {
            val uri = runCatching { URI(scanned.trim()) }.getOrNull() ?: return null
            val scheme = uri.scheme?.lowercase()
            if (scheme != "https" && scheme != "http") return null
            if (uri.path?.endsWith("/qr") != true) return null
            val token = uri.rawQuery.orEmpty().split('&')
                .map { it.split('=', limit = 2) }
                .firstOrNull { it.first() == "t" }
                ?.getOrNull(1)
                ?: return null
            return if (UUID_PATTERN.matches(token)) QrLoginTicket(token) else null
        }
    }
}

/** Подтверждение входа с уже залогиненного устройства. */
interface QrLoginApproving {
    suspend fun approve(ticket: QrLoginTicket)
}

/**
 * Единственный маршрут входа по QR, который делает телефон. Запрос идёт с авторизацией:
 * сервер берёт пользователя из токена. Отсюда и место экрана — за входом, а не на нём.
 */
class QrLoginApi(private val client: ApiClient) : QrLoginApproving {
    override suspend fun approve(ticket: QrLoginTicket) {
        client.send(Endpoint.post("auth/qr/approve", ApproveRequest.serializer(), ApproveRequest(ticket.approveToken)))
    }

    @Serializable
    private data class ApproveRequest(val approveToken: String)
}

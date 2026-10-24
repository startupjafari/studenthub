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

/** Кто просит вход: браузер и ОС по User-Agent, сеть — IP с маской `a.b.c.x`. */
@Serializable
data class QrRequester(val browser: String? = null, val os: String? = null, val ip: String? = null)

/** Подтверждение входа с уже залогиненного устройства. */
interface QrLoginApproving {
    /**
     * Кто просит вход — до кнопки «Подтвердить» (§8.3 «Вход по QR»). Без этого ссылку на
     * чужой QR присылают «на проверку», и человек отдаёт сессию постороннему вслепую.
     */
    suspend fun preview(ticket: QrLoginTicket): QrRequester

    suspend fun approve(ticket: QrLoginTicket)
}

/**
 * Маршруты входа по QR, которые делает телефон. Запросы идут с авторизацией: сервер
 * берёт пользователя из токена. Отсюда и место экрана — за входом, а не на нём.
 */
class QrLoginApi(private val client: ApiClient) : QrLoginApproving {
    override suspend fun preview(ticket: QrLoginTicket): QrRequester =
        client.send(Endpoint.post("auth/qr/preview", ApproveRequest.serializer(), ApproveRequest(ticket.approveToken)), Preview.serializer())
            .requester

    override suspend fun approve(ticket: QrLoginTicket) {
        client.send(Endpoint.post("auth/qr/approve", ApproveRequest.serializer(), ApproveRequest(ticket.approveToken)))
    }

    @Serializable
    private data class ApproveRequest(val approveToken: String)

    @Serializable
    private data class Preview(val requester: QrRequester = QrRequester())
}

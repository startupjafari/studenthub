package kz.studenthub.app.core.chats

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.Endpoint
import kz.studenthub.app.core.network.HttpMethod
import kz.studenthub.app.core.network.InstantSerializer
import kz.studenthub.app.core.network.MultipartForm
import kz.studenthub.app.core.network.Page
import kz.studenthub.app.core.network.await
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import java.io.File
import java.time.Instant
import java.time.format.DateTimeFormatter
import okhttp3.RequestBody.Companion.asRequestBody

/** Маршруты, нужные списку. Интерфейс — ради тестов: синхронизация проверяется без сети. */
interface ChatsFetching {
    suspend fun chats(cursor: String?, limit: Int = ChatsApi.PAGE_LIMIT): Page<ChatListItemDto>

    suspend fun folders(): List<ChatFolderDto>

    suspend fun setPinned(pinned: Boolean, chatId: String)

    suspend fun setArchived(archived: Boolean, chatId: String)

    suspend fun setMuted(muted: Boolean, chatId: String)
}

/** Маршруты переписки. */
interface ChatMessagesFetching {
    /** Страница истории. Сервер отдаёт свежие первыми. */
    suspend fun messages(chatId: String, cursor: String?, limit: Int = ChatsApi.MESSAGE_PAGE_LIMIT): Page<ChatMessageDto>

    /** Догон после обрыва: только то, что изменилось с позиции клиента. */
    suspend fun updates(chatId: String, since: Int, sinceTs: Instant?): ChatUpdatesDto
}

/** Отправка текста. */
interface ChatMessageSending {
    suspend fun send(text: String, chatId: String, replyToId: String?): ChatMessageDto
}

/** Три шага вложения: подпись, загрузка в хранилище, сообщение по ключам. */
interface AttachmentSending {
    suspend fun presign(chatId: String, mime: String): AttachmentUploadTicket

    suspend fun upload(file: File, url: String, mime: String)

    suspend fun sendUploaded(chatId: String, content: String?, replyToId: String?, attachments: List<AttachmentUpload>): ChatMessageDto
}

class ChatsApi(private val client: ApiClient, private val storage: OkHttpClient) :
    ChatsFetching, ChatMessagesFetching, ChatMessageSending, AttachmentSending, DraftSaving {

    override suspend fun chats(cursor: String?, limit: Int): Page<ChatListItemDto> =
        client.page(Endpoint.get("chats", "limit" to "$limit", "cursor" to cursor), ChatListItemDto.serializer())

    override suspend fun folders(): List<ChatFolderDto> =
        client.send(Endpoint.get("chats/folders"), ListSerializer(ChatFolderDto.serializer()))

    // У каждого переключателя два маршрута вместо одного с телом — так на сервере.
    override suspend fun setPinned(pinned: Boolean, chatId: String) = toggle(pinned, "chats/$chatId/pin")

    override suspend fun setArchived(archived: Boolean, chatId: String) = toggle(archived, "chats/$chatId/archive")

    /**
     * У «без звука» тело обязательно: сервер разбирает его схемой (`MuteSchema`), и POST
     * без тела — не объект, а `422`. Пустой объект — «навсегда», как кнопка в вебе.
     */
    override suspend fun setMuted(muted: Boolean, chatId: String) {
        val path = "chats/$chatId/mute"
        client.send(if (muted) Endpoint.post(path, MuteRequest.serializer(), MuteRequest()) else Endpoint.delete(path))
    }

    private suspend fun toggle(on: Boolean, path: String) {
        client.send(if (on) Endpoint.post(path) else Endpoint.delete(path))
    }

    override suspend fun saveDraft(chatId: String, text: String) {
        client.send(Endpoint.json(HttpMethod.PUT, "chats/$chatId/draft", DraftRequest.serializer(), DraftRequest(text)))
    }

    override suspend fun messages(chatId: String, cursor: String?, limit: Int): Page<ChatMessageDto> =
        client.page(Endpoint.get("chats/$chatId/messages", "limit" to "$limit", "cursor" to cursor), ChatMessageDto.serializer())

    override suspend fun updates(chatId: String, since: Int, sinceTs: Instant?): ChatUpdatesDto =
        client.send(
            // Без отметки времени сервер не ищет правки и удаления: сравнивать не с чем.
            Endpoint.get("chats/$chatId/updates", "since" to "$since", "sinceTs" to sinceTs?.let(DateTimeFormatter.ISO_INSTANT::format)),
            ChatUpdatesDto.serializer(),
        )

    /** Маршрут multipart: текст и вложения на сервере приходят одним запросом. */
    override suspend fun send(text: String, chatId: String, replyToId: String?): ChatMessageDto {
        val form = MultipartForm()
        form.append(text, "content")
        replyToId?.let { form.append(it, "replyToId") }
        return client.send(Endpoint.multipart("chats/$chatId/messages", form), ChatMessageDto.serializer())
    }

    override suspend fun presign(chatId: String, mime: String): AttachmentUploadTicket =
        client.send(
            Endpoint.post("chats/$chatId/attachments/presign", PresignRequest.serializer(), PresignRequest(mime)),
            AttachmentUploadTicket.serializer(),
        )

    /**
     * Загрузка идёт в хранилище напрямую, мимо API: тело файла не проходит через
     * процесс сервера. Отдельный клиент — без cookie и без заголовков API: подписанная
     * ссылка не терпит лишнего.
     */
    override suspend fun upload(file: File, url: String, mime: String) {
        val body: RequestBody = file.asRequestBody(mime.toMediaType())
        val response = storage.newCall(Request.Builder().url(url).put(body).build()).await()
        response.use { if (!it.isSuccessful) throw ApiError.Malformed(it.code) }
    }

    override suspend fun sendUploaded(
        chatId: String,
        content: String?,
        replyToId: String?,
        attachments: List<AttachmentUpload>,
    ): ChatMessageDto = client.send(
        Endpoint.post("chats/$chatId/messages/uploaded", UploadedRequest.serializer(), UploadedRequest(content, replyToId, attachments)),
        ChatMessageDto.serializer(),
    )

    /** Подписанная ссылка на файл вложения: живёт минуты. */
    suspend fun attachmentUrl(fileId: String): AttachmentLink =
        client.send(Endpoint.get("chats/attachments/$fileId/url"), AttachmentLink.serializer())

    @Serializable
    data class AttachmentLink(val url: String, @Serializable(InstantSerializer::class) val expiresAt: Instant? = null)

    /** Без полей уходит `{}`: срок и режим «только важные» приложение пока не выбирает. */
    @Serializable
    private data class MuteRequest(val minutes: Int? = null, val importantOnly: Boolean? = null)

    @Serializable
    private data class DraftRequest(val text: String)

    @Serializable
    private data class PresignRequest(val mime: String)

    @Serializable
    private data class UploadedRequest(val content: String?, val replyToId: String?, val attachments: List<AttachmentUpload>)

    companion object {
        /** Сервер отдаёт до 200 чатов за страницу; сотня — его же значение по умолчанию. */
        const val PAGE_LIMIT = 100

        /** Потолок страницы истории на сервере — 50. */
        const val MESSAGE_PAGE_LIMIT = 50
    }
}

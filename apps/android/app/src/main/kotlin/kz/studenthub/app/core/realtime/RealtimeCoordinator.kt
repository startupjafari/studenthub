package kz.studenthub.app.core.realtime

import kz.studenthub.app.core.storage.transaction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kz.studenthub.app.core.chats.ChatMessageDto
import kz.studenthub.app.core.chats.ChatStore
import kz.studenthub.app.core.chats.MessageStore
import kz.studenthub.app.core.session.SessionStore
import kz.studenthub.app.core.storage.AppDatabase
import java.time.Instant

/** Смена статуса заявки, пришедшая в реальном времени; время — чтобы повтор тоже был новостью. */
data class ApplicationStatusChange(val id: String, val status: String, val at: Instant)

/**
 * Приём событий реального времени.
 *
 * Всё, что приходит, ложится в базу — экраны перерисовываются сами, как и от сети. В
 * памяти остаётся только то, чему в базе не место: кто печатает и кто сейчас в сети
 * (PROJECT.md §9.1a — действие живёт секунды и в хранилище не попадает).
 */
class RealtimeCoordinator(
    private val transport: RealtimeTransport,
    private val session: SessionStore,
    private val db: AppDatabase,
    private val scope: CoroutineScope,
    /** Подпись живёт без подтверждения столько: «стоп» может не прийти вовсе. */
    private val actionTtlMillis: Long = 4_000,
    /** Как часто продлевать токен живого соединения: access живёт 15 минут. */
    private val tokenRefreshMillis: Long = 10 * 60_000,
) {
    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected

    /**
     * Счётчик успешных подключений. По его изменению открытый чат понимает, что пора
     * догнать пропущенное: событий за время обрыва никто не переприсылает.
     */
    private val _connectionEpoch = MutableStateFlow(0)
    val connectionEpoch: StateFlow<Int> = _connectionEpoch

    /** Кто что делает: чат → (пользователь → действие). */
    private val _actions = MutableStateFlow<Map<String, Map<String, String>>>(emptyMap())
    val actions: StateFlow<Map<String, Map<String, String>>> = _actions

    private val _online = MutableStateFlow<Set<String>>(emptySet())
    val online: StateFlow<Set<String>> = _online

    private val _applicationStatus = MutableStateFlow<ApplicationStatusChange?>(null)
    val applicationStatus: StateFlow<ApplicationStatusChange?> = _applicationStatus

    private val chats = ChatStore(db)
    private var pump: Job? = null
    private var keepAlive: Job? = null
    private val expiry = mutableMapOf<String, Job>()

    /** Чат на экране: его сообщения не увеличивают счётчик непрочитанного. */
    @Volatile
    private var openChatId: String? = null

    fun start() {
        if (pump != null) return
        pump = scope.launch { transport.events.collect { handle(it) } }
        keepAlive = scope.launch {
            while (isActive) {
                delay(tokenRefreshMillis)
                session.accessToken()?.let(transport::refresh)
            }
        }
        scope.launch { session.accessToken()?.let(transport::connect) }
    }

    fun stop() {
        pump?.cancel()
        keepAlive?.cancel()
        pump = null
        keepAlive = null
        expiry.values.forEach { it.cancel() }
        expiry.clear()
        _isConnected.value = false
        _actions.value = emptyMap()
        _online.value = emptySet()
        transport.disconnect()
    }

    /** Открытый чат: вход в комнату и признак, что его сообщения читают прямо сейчас. */
    fun open(chatId: String) {
        openChatId = chatId
        transport.join(chatId)
    }

    fun close(chatId: String) {
        if (openChatId == chatId) openChatId = null
        transport.leave(chatId)
    }

    fun markRead(chatId: String, messageId: String) = transport.markRead(chatId, messageId)

    fun send(action: String?, chatId: String) = transport.send(action, chatId)

    /** Обработать событие. Открыт для тестов: они подают события без транспорта. */
    suspend fun handle(event: RealtimeEvent) {
        when (event) {
            RealtimeEvent.Connected -> {
                _isConnected.value = true
                _connectionEpoch.value += 1
                // Комнату после переподключения сервер не помнит — входим заново.
                openChatId?.let(transport::join)
            }
            RealtimeEvent.Disconnected -> _isConnected.value = false
            // Сервер отверг рукопожатие — подкладываем свежий токен: следующая попытка
            // переподключения пойдёт уже с ним.
            RealtimeEvent.ConnectFailed -> session.refreshedAccessToken()?.let(transport::refresh)
            is RealtimeEvent.MessageNew -> save(event.message, countsAsUnread = true)
            is RealtimeEvent.MessageUpdated -> save(event.message, countsAsUnread = false)
            is RealtimeEvent.MessageDeleted -> {
                val dao = db.messages()
                val row = dao.byRemoteId(event.messageId) ?: dao.get(event.messageId) ?: return
                if (row.deletedAt == null) dao.update(row.copy(deletedAt = Instant.now()))
            }
            // Прочитано на другом устройстве — счётчик гаснет и здесь.
            is RealtimeEvent.ChatRead -> {
                val chat = db.chats().get(event.chatId) ?: return
                if (chat.unreadCount != 0) db.chats().update(chat.copy(unreadCount = 0))
            }
            is RealtimeEvent.MessageRead -> {
                val chat = db.chats().get(event.chatId) ?: return
                if ((chat.othersReadAt ?: Instant.EPOCH) < event.readAt) db.chats().update(chat.copy(othersReadAt = event.readAt))
            }
            is RealtimeEvent.Action -> apply(event.action, event.chatId, event.userId)
            is RealtimeEvent.Presence ->
                _online.value = if (event.online) _online.value + event.userId else _online.value - event.userId
            is RealtimeEvent.ChatUpdated -> chats.saveChats(listOf(event.chat))
            is RealtimeEvent.ApplicationStatusChanged ->
                _applicationStatus.value = ApplicationStatusChange(event.applicationId, event.status, Instant.now())
        }
    }

    private suspend fun save(message: ChatMessageDto, countsAsUnread: Boolean) {
        val viewerId = session.currentToken?.subject
        val isOpen = openChatId == message.chatId
        db.transaction {
            MessageStore.upsert(db, message)
            var chat = db.chats().get(message.chatId) ?: return@transaction
            val seq = message.seq
            // Превью и порядок списка — по самому свежему известному сообщению.
            val preview = chat.lastMessageId?.let { db.messages().byRemoteId(it) ?: db.messages().get(it) }
            if (seq != null && seq > (preview?.seq ?: 0)) {
                chat = chat.copy(lastMessageId = message.id, updatedAt = message.createdAt)
            }
            // Позиция догона — «всё до N есть» (§9.2c): двигается только вплотную. Сообщение
            // через разрыв (пришло после переподключения раньше догона) её не трогает, иначе
            // догон начал бы с него и пропустил середину.
            if (seq != null && seq == chat.lastSeq + 1) chat = chat.copy(lastSeq = seq)
            // Счётчик растёт только от чужого и только в закрытом чате.
            if (countsAsUnread && !isOpen && message.senderId != viewerId) {
                chat = chat.copy(unreadCount = chat.unreadCount + 1)
            }
            db.chats().update(chat)
        }
    }

    private fun apply(action: String?, chatId: String, userId: String) {
        val key = "$chatId|$userId"
        expiry.remove(key)?.cancel()
        val current = _actions.value.toMutableMap()
        if (action == null) {
            val users = current[chatId].orEmpty() - userId
            if (users.isEmpty()) current.remove(chatId) else current[chatId] = users
            _actions.value = current
            return
        }
        current[chatId] = current[chatId].orEmpty() + (userId to action)
        _actions.value = current
        expiry[key] = scope.launch {
            delay(actionTtlMillis)
            apply(null, chatId, userId)
        }
    }
}

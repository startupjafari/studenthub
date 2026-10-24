package kz.studenthub.app.features.chats

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kz.studenthub.app.core.chats.AttachmentUploader
import kz.studenthub.app.core.chats.ChatMessagesFetching
import kz.studenthub.app.core.chats.ChatsApi
import kz.studenthub.app.core.chats.DraftSync
import kz.studenthub.app.core.chats.MessageOutbox
import kz.studenthub.app.core.chats.MessageStore
import kz.studenthub.app.core.chats.OutgoingAttachment
import kz.studenthub.app.core.network.displayMessage
import kz.studenthub.app.core.realtime.RealtimeCoordinator
import kz.studenthub.app.core.storage.AppDatabase
import kz.studenthub.app.core.storage.MessageEntity
import kz.studenthub.app.core.ui.UiText
import java.time.Instant

/**
 * Экран переписки. Как и список, читает только базу: открывается мгновенно и в самолёте
 * показывает то, что успело скачаться. Сеть догоняет разницу и пишет её в базу.
 *
 * Отправка и вложения идут в области процесса (`sendScope`), а не экрана: человек нажал
 * «отправить» и ушёл из чата — сообщение всё равно уходит.
 */
class ChatThreadModel(
    val chatId: String,
    private val viewerId: String,
    private val db: AppDatabase,
    private val api: ChatMessagesFetching,
    private val outbox: MessageOutbox,
    private val uploader: AttachmentUploader,
    private val drafts: DraftSync,
    private val realtime: RealtimeCoordinator?,
    private val sendScope: CoroutineScope,
    private val store: MessageStore = MessageStore(db),
    private val now: () -> Instant = Instant::now,
) : ViewModel() {
    var days by mutableStateOf<List<MessageTimeline.Day>>(emptyList())
        private set
    var title by mutableStateOf<String?>(null)
        private set
    var isLoadingOlder by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set

    /** Первое непрочитанное на момент открытия: лента прокручивается к нему один раз. */
    var openingAnchor by mutableStateOf<String?>(null)
        private set

    /** До какого времени собеседники прочитали переписку — для двойной галочки. */
    var othersReadAt by mutableStateOf<Instant?>(null)
        private set

    /** Текст в поле ввода. Черновик пишется в базу с задержкой, но не теряется. */
    var draft by mutableStateOf("")
        private set

    var replyTo by mutableStateOf<MessageEntity?>(null)
        private set

    private var messages: List<MessageEntity> = emptyList()
    private var unreadCount = 0
    private var chatLoaded = false
    private var didPickAnchor = false
    private var olderCursor: String? = null
    private var reachedBeginning = false
    private var draftJob: Job? = null
    private var lastReadSent: String? = null
    private var lastReadAt: Instant? = null
    private var lastActionAt: Instant? = null

    fun start() {
        // Сообщения и вложения — одним наблюдением: раздельные дали бы кадр, где картинка
        // уже пришла, а сообщения под неё ещё нет.
        db.messages().observeThread(chatId).onEach { snapshot ->
            messages = snapshot.map { it.message }
            days = MessageTimeline.build(messages, snapshot.associate { it.message.id to it.attachments }, viewerId)
            pickAnchorIfNeeded()
        }.launchIn(viewModelScope)
        db.chats().observe(chatId).onEach { chat ->
            title = chat?.title
            // Счётчик для якоря — только первый, до нашей же отметки прочтения.
            if (!chatLoaded) unreadCount = chat?.unreadCount ?: 0
            chatLoaded = true
            othersReadAt = chat?.othersReadAt
            pickAnchorIfNeeded()
        }.launchIn(viewModelScope)
        viewModelScope.launch {
            val stored = db.drafts().get(chatId)
            if (draft.isEmpty() && stored != null) draft = stored.text
        }
    }

    /** Вход в чат: комната сокета плюс открытие. */
    suspend fun enter() {
        realtime?.open(chatId)
        open()
    }

    /** Уход с экрана: комнату отпускаем и гасим свою подпись — иначе «печатает…» у закрытого чата. */
    fun leave() {
        realtime?.send(null, chatId)
        realtime?.close(chatId)
        // Набранное не теряем, даже если отложенная запись ещё не случилась.
        val text = draft
        sendScope.launch { persistDraft(text) }
    }

    /** Связь вернулась — догоняем пропущенное: события за время обрыва никто не переприсылает. */
    suspend fun catchUpAfterReconnect() {
        val known = store.lastSeq(chatId)
        if (known == 0) loadLatest() else catchUp(known)
    }

    /** Открытие: догнать разницу, а если истории нет вовсе — скачать последнюю страницу. */
    suspend fun open() {
        val known = store.lastSeq(chatId)
        if (known == 0 || messages.isEmpty()) loadLatest() else catchUp(known)
        // Неотправленное с прошлого раза досылаем молча — и сообщения, и черновики.
        outbox.flush(chatId)
        drafts.flush()
    }

    // --- отправка ---

    fun send() {
        val text = draft.trim()
        if (text.isEmpty()) return
        val answering = replyTo?.remoteId
        draft = ""
        replyTo = null
        draftJob?.cancel()
        sendScope.launch {
            persistDraft("")
            outbox.send(text, chatId, viewerId, answering)
        }
        // Сообщение ушло — подпись «печатает…» снимаем сразу, не дожидаясь таймера.
        lastActionAt = null
        realtime?.send(null, chatId)
    }

    /** Отправить вложение. Подпись к нему — текущий текст поля, как в вебе. */
    fun attach(attachment: OutgoingAttachment) {
        val caption = draft.trim().ifEmpty { null }
        val answering = replyTo?.remoteId
        draft = ""
        replyTo = null
        sendScope.launch {
            persistDraft("")
            // Подпись о загрузке — не сразу: сжатый снимок улетает за доли секунды, и
            // она успела бы только мигнуть (§9.1a).
            val notifier = launch {
                delay(400)
                realtime?.send(actionFor(attachment.mime), chatId)
            }
            uploader.send(attachment, chatId, viewerId, caption, answering)
            notifier.cancel()
            realtime?.send(null, chatId)
        }
    }

    fun retry(message: MessageEntity) {
        sendScope.launch { outbox.retry(message) }
    }

    /** Отвечать можно только на то, что знает сервер: у неотправленного нет id. */
    fun reply(message: MessageEntity) {
        if (message.remoteId == null || message.deletedAt != null) return
        replyTo = message
    }

    fun cancelReply() {
        replyTo = null
    }

    // --- черновик и прочтение ---

    fun onDraftChange(text: String) {
        draft = text
        noteTyping()
        draftJob?.cancel()
        draftJob = viewModelScope.launch {
            delay(400)
            persistDraft(text)
        }
    }

    /**
     * Отметить прочитанным до последнего чужого. Не чаще раза в 800 мс и только то, что
     * новее прошлой отметки: сервер двигает её только вперёд.
     */
    fun markRead() {
        val last = messages.lastOrNull { it.senderId != viewerId && it.remoteId != null } ?: return
        val id = last.remoteId ?: return
        if (id == lastReadSent) return
        val sentAt = lastReadAt
        if (sentAt != null && now().toEpochMilli() - sentAt.toEpochMilli() < 800) return
        lastReadSent = id
        lastReadAt = now()
        realtime?.markRead(chatId, id)
        // Своё прочтение гасит счётчик сразу, не дожидаясь эха из сокета.
        viewModelScope.launch {
            db.chats().get(chatId)?.takeIf { it.unreadCount != 0 }?.let { db.chats().update(it.copy(unreadCount = 0)) }
        }
    }

    /** Подтверждение набора — не чаще раза в три секунды: получатель гасит подпись через четыре. */
    private fun noteTyping() {
        val sentAt = lastActionAt
        if (sentAt != null && now().toEpochMilli() - sentAt.toEpochMilli() < 3_000) return
        lastActionAt = now()
        realtime?.send("TYPING", chatId)
    }

    /** Черновик — в базу и на сервер: его видят другие устройства человека. */
    private suspend fun persistDraft(text: String) = drafts.save(chatId, text)

    /** Подгрузка вверх — когда лента подъехала к началу загруженного. */
    suspend fun loadOlder() {
        if (isLoadingOlder || reachedBeginning) return
        isLoadingOlder = true
        try {
            val page = api.messages(chatId, olderCursor, ChatsApi.MESSAGE_PAGE_LIMIT)
            store.saveMessages(page.items, chatId)
            olderCursor = page.meta?.cursor
            reachedBeginning = page.meta?.hasNext != true
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failure = error.displayMessage()
        } finally {
            isLoadingOlder = false
        }
    }

    fun loadOlderNow() {
        viewModelScope.launch { loadOlder() }
    }

    // --- синхронизация ---

    private suspend fun loadLatest() {
        try {
            val page = api.messages(chatId, null, ChatsApi.MESSAGE_PAGE_LIMIT)
            store.saveMessages(page.items, chatId)
            olderCursor = page.meta?.cursor
            reachedBeginning = page.meta?.hasNext != true
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failure = error.displayMessage()
        }
    }

    private suspend fun catchUp(since: Int) {
        try {
            // Отметка для правок и удалений — время самого свежего известного сообщения:
            // всё, что отредактировали позже, в ответ попадёт.
            val updates = api.updates(chatId, since, messages.lastOrNull()?.createdAt)
            if (updates.overflow) {
                // Разрыв больше серверного лимита: честнее перекачать хвост заново.
                store.clearHistory(chatId)
                olderCursor = null
                reachedBeginning = false
                loadLatest()
                return
            }
            store.apply(updates, chatId)
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failure = error.displayMessage()
        }
    }

    /** Якорь выбирается один раз: пересчитывать его на каждое сообщение — дёргать ленту под пальцем. */
    private fun pickAnchorIfNeeded() {
        // Нужны оба среза: без счётчика якорь посчитался бы как «всё прочитано».
        if (didPickAnchor || messages.isEmpty() || !chatLoaded) return
        didPickAnchor = true
        openingAnchor = MessageTimeline.firstUnreadId(messages, viewerId, unreadCount)
    }

    companion object {
        fun actionFor(mime: String): String = when {
            mime.startsWith("audio/") -> "RECORDING_VOICE"
            mime.startsWith("image/") -> "UPLOADING_PHOTO"
            mime.startsWith("video/") -> "UPLOADING_VIDEO"
            else -> "UPLOADING_FILE"
        }
    }
}

package kz.studenthub.app.features.feed

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kz.studenthub.app.core.chats.OutgoingAttachment
import kz.studenthub.app.core.feed.EventDto
import kz.studenthub.app.core.feed.FeedFetching
import kz.studenthub.app.core.feed.NotificationDto
import kz.studenthub.app.core.feed.NotificationSettingsDto
import kz.studenthub.app.core.feed.PostCommentDto
import kz.studenthub.app.core.feed.PostDto
import kz.studenthub.app.core.feed.UserProfileDto
import kz.studenthub.app.core.network.displayMessage
import kz.studenthub.app.core.ui.UiText

/** Ошибка любого действия экрана — в текст для человека, отмену корутины не глотаем. */
private inline fun <T> attempt(onError: (UiText) -> Unit, block: () -> T): T? = try {
    block()
} catch (error: Exception) {
    if (error is kotlinx.coroutines.CancellationException) throw error
    onError(error.displayMessage())
    null
}

/**
 * Лента постов. Реакции оптимистичны: палец убрал — цифра уже изменилась. Отказ сервера
 * откатываем, иначе человек уверен, что поставил реакцию, а её нет.
 *
 * Сервер отдаёт реакции списком «кто что поставил», поэтому счётчики и «мои» считаются
 * здесь, от id смотрящего.
 */
class FeedModel(private val api: FeedFetching, private val viewerId: String) : ViewModel() {
    var posts by mutableStateOf<List<PostDto>>(emptyList())
        private set
    var isRefreshing by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set
    private var loaded = false

    /** Поправки к реакциям поверх ответа: id поста → эмодзи → поставил ли я. */
    private val overrides = mutableStateMapOf<String, Map<String, Boolean>>()
    private var cursor: String? = null

    fun refreshNow() {
        viewModelScope.launch { refresh() }
    }

    suspend fun refresh() {
        if (isRefreshing) return
        isRefreshing = true
        attempt({ failure = it }) {
            val page = api.posts(null)
            posts = page.items
            cursor = page.meta?.cursor?.takeIf { page.meta.hasNext == true }
            overrides.clear()
            loaded = true
            failure = null
        }
        isRefreshing = false
    }

    val isEmptyAfterLoad: Boolean get() = loaded && posts.isEmpty()

    /** Хвост ленты. Неудача молча: это не повод рисовать ошибку поверх читаемого. */
    fun loadMore() {
        val next = cursor ?: return
        if (isRefreshing) return
        viewModelScope.launch {
            isRefreshing = true
            runCatching { api.posts(next) }.onSuccess { page ->
                posts = posts + page.items.filter { new -> posts.none { it.id == new.id } }
                cursor = page.meta?.cursor?.takeIf { page.meta.hasNext == true }
            }
            isRefreshing = false
        }
    }

    fun isMine(emoji: String, post: PostDto): Boolean =
        overrides[post.id]?.get(emoji) ?: post.reactions.any { it.emoji == emoji && it.userId == viewerId }

    fun count(emoji: String, post: PostDto): Int {
        val server = post.reactions.count { it.emoji == emoji }
        val serverMine = post.reactions.any { it.emoji == emoji && it.userId == viewerId }
        val mine = isMine(emoji, post)
        return server + (if (mine && !serverMine) 1 else 0) - (if (!mine && serverMine) 1 else 0)
    }

    fun toggle(emoji: String, post: PostDto) {
        viewModelScope.launch { toggleNow(emoji, post) }
    }

    suspend fun toggleNow(emoji: String, post: PostDto) {
        val was = isMine(emoji, post)
        overrides[post.id] = overrides[post.id].orEmpty() + (emoji to !was)
        attempt({ failure = it }) { api.react(post.id, emoji, !was) } ?: run {
            overrides[post.id] = overrides[post.id].orEmpty() + (emoji to was)
        }
    }
}

/** Комментарии одного поста. */
class PostCommentsModel(private val postId: String, private val api: FeedFetching) : ViewModel() {
    var comments by mutableStateOf<List<PostCommentDto>>(emptyList())
        private set
    var draft by mutableStateOf("")
    var failure by mutableStateOf<UiText?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set

    suspend fun load() {
        isLoading = true
        attempt({ failure = it }) {
            comments = api.comments(postId)
            failure = null
        }
        isLoading = false
    }

    fun sendNow() {
        viewModelScope.launch { send() }
    }

    suspend fun send() {
        val text = draft.trim()
        if (text.isEmpty()) return
        draft = ""
        attempt({
            // Текст возвращаем в поле: потерять написанное из-за сети нельзя.
            draft = text
            failure = it
        }) {
            comments = comments + api.comment(postId, text)
            failure = null
        }
    }
}

/** События и запись на них — оптимистично: «пойду» видно сразу. */
class EventsModel(private val api: FeedFetching) : ViewModel() {
    var events by mutableStateOf<List<EventDto>>(emptyList())
        private set
    val registered = mutableStateMapOf<String, Boolean>()
    var isLoading by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set
    var loaded by mutableStateOf(false)
        private set

    fun refreshNow() {
        viewModelScope.launch { refresh() }
    }

    suspend fun refresh() {
        isLoading = true
        attempt({ failure = it }) {
            events = api.events(mine = false)
            registered.clear()
            events.forEach { registered[it.id] = it.isRegistered == true }
            loaded = true
            failure = null
        }
        isLoading = false
    }

    fun isRegistered(id: String): Boolean = registered[id] == true

    fun toggle(id: String) {
        viewModelScope.launch { toggleNow(id) }
    }

    suspend fun toggleNow(id: String) {
        val was = isRegistered(id)
        registered[id] = !was
        attempt({ failure = it }) { api.register(id, !was) } ?: run { registered[id] = was }
    }
}

/** Центр уведомлений и каналы доставки. */
class NotificationsModel(private val api: FeedFetching) : ViewModel() {
    var items by mutableStateOf<List<NotificationDto>>(emptyList())
        private set
    var settings by mutableStateOf<NotificationSettingsDto?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set
    var loaded by mutableStateOf(false)
        private set

    val unreadCount: Int get() = items.count { !it.isRead }

    fun refreshNow() {
        viewModelScope.launch { refresh() }
    }

    suspend fun refresh() {
        isLoading = true
        attempt({ failure = it }) {
            items = api.notifications(null).items
            loaded = true
            failure = null
        }
        // Настройки — отдельно: их отказ не должен прятать сами уведомления.
        attempt({ failure = it }) { settings = api.notificationSettings() }
        isLoading = false
    }

    /** Прочитанное помечаем сразу у себя; сервер догоняет. */
    fun markRead(id: String) {
        val item = items.firstOrNull { it.id == id } ?: return
        if (item.isRead) return
        items = items.map { if (it.id == id) it.copy(isRead = true) else it }
        viewModelScope.launch { runCatching { api.markRead(id) } }
    }

    fun markAllRead() {
        items = items.map { it.copy(isRead = true) }
        viewModelScope.launch { attempt({ failure = it }) { api.markAllRead() } }
    }

    fun update(change: (NotificationSettingsDto) -> NotificationSettingsDto) {
        val current = settings ?: return
        val next = change(current)
        settings = next
        viewModelScope.launch { updateNow(current, next) }
    }

    /** Шлём только изменённое: остальное сервер оставит как было. Отказ — откат. */
    suspend fun updateNow(previous: NotificationSettingsDto, next: NotificationSettingsDto) {
        val diff = NotificationSettingsDto(
            pushEnabled = next.pushEnabled.takeIf { it != previous.pushEnabled },
            emailEnabled = next.emailEnabled.takeIf { it != previous.emailEnabled },
            messageEnabled = next.messageEnabled.takeIf { it != previous.messageEnabled },
            scheduleChangeEnabled = next.scheduleChangeEnabled.takeIf { it != previous.scheduleChangeEnabled },
            postEnabled = next.postEnabled.takeIf { it != previous.postEnabled },
            eventEnabled = next.eventEnabled.takeIf { it != previous.eventEnabled },
            appUpdateEnabled = next.appUpdateEnabled.takeIf { it != previous.appUpdateEnabled },
            systemEnabled = next.systemEnabled.takeIf { it != previous.systemEnabled },
        )
        attempt({
            settings = previous
            failure = it
        }) { settings = api.updateNotificationSettings(diff) }
    }
}

/**
 * Профиль: свой — с правкой, чужой — только чтение. Один экран на оба случая: иначе они
 * начинают по-разному показывать одни и те же поля.
 */
class ProfileModel(private val userId: String?, private val api: FeedFetching) : ViewModel() {
    val isMine: Boolean get() = userId == null

    var profile by mutableStateOf<UserProfileDto?>(null)
        private set
    var firstName by mutableStateOf("")
    var lastName by mutableStateOf("")
    var bio by mutableStateOf("")
    var isSaving by mutableStateOf(false)
        private set
    var saved by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set

    suspend fun load() {
        attempt({ failure = it }) {
            show(if (userId == null) api.me() else api.user(userId))
            failure = null
        }
    }

    fun saveNow() {
        viewModelScope.launch { save() }
    }

    suspend fun save() {
        if (isSaving) return
        isSaving = true
        attempt({ failure = it }) {
            show(api.updateProfile(firstName.trim(), lastName.trim(), bio.trim().ifEmpty { null }))
            saved = true
            failure = null
        }
        isSaving = false
    }

    fun uploadAvatar(attachment: OutgoingAttachment) {
        viewModelScope.launch {
            attempt({ failure = it }) { show(api.uploadAvatar(attachment.file, attachment.mime)) }
        }
    }

    private fun show(loaded: UserProfileDto) {
        profile = loaded
        firstName = loaded.firstName.orEmpty()
        lastName = loaded.lastName.orEmpty()
        bio = loaded.bio.orEmpty()
    }
}

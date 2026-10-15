package kz.studenthub.app.features.chats

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kz.studenthub.app.R
import kz.studenthub.app.core.chats.ChatStore
import kz.studenthub.app.core.chats.ChatsApi
import kz.studenthub.app.core.chats.ChatsFetching
import kz.studenthub.app.core.network.displayMessage
import kz.studenthub.app.core.storage.AppDatabase
import kz.studenthub.app.core.storage.ChatListRow
import kz.studenthub.app.core.ui.UiText

/** Вкладка над списком. */
sealed interface ChatListTab {
    data object All : ChatListTab

    data class Folder(val id: String, val name: String) : ChatListTab

    data object Requests : ChatListTab

    data object Archive : ChatListTab
}

/**
 * Список чатов. Экран читает базу, а не сеть: наблюдаемый запрос сам присылает новый
 * срез после любой записи — со списка, из сокета или от действия над строкой.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatListModel(
    private val db: AppDatabase,
    private val api: ChatsFetching,
    private val store: ChatStore = ChatStore(db),
) : ViewModel() {
    private val selected = MutableStateFlow<ChatListTab>(ChatListTab.All)

    /**
     * Вкладки: «Все», папки по позиции, «Запросы» и «Архив» — последние две только когда
     * в них что-то есть: пустой «Архив» занимает место и ничего не сообщает.
     */
    val tabs: StateFlow<List<ChatListTab>> = combine(
        db.folders().observe(),
        db.chats().observeRequestCount(),
        db.chats().observeArchivedCount(),
    ) { folders, requests, archived ->
        buildList {
            add(ChatListTab.All)
            folders.forEach { add(ChatListTab.Folder(it.id, it.name)) }
            if (requests > 0) add(ChatListTab.Requests)
            if (archived > 0) add(ChatListTab.Archive)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), listOf(ChatListTab.All))

    /** Выбранная вкладка. Папку удалили на другом устройстве — возвращаемся к «Все». */
    val tab: StateFlow<ChatListTab> = combine(selected, tabs) { chosen, available ->
        if (chosen in available) chosen else ChatListTab.All
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ChatListTab.All)

    val rows: StateFlow<List<ChatListRow>?> = tab.flatMapLatest(::rowsFor)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    var isRefreshing by mutableStateOf(false)
        private set

    /** Последняя неудача. Список при этом работает: он читает базу, сеть ему не нужна. */
    var failure by mutableStateOf<UiText?>(null)
        private set

    fun select(tab: ChatListTab) {
        selected.value = tab
    }

    fun refreshNow() {
        viewModelScope.launch { refresh() }
    }

    /**
     * Догнать сервер. Пять страниц по сотне покрывают любого живого человека, а цикл по
     * курсору на сломанном сервере без потолка крутился бы вечно.
     */
    suspend fun refresh() {
        if (isRefreshing) return
        isRefreshing = true
        try {
            var cursor: String? = null
            for (attempt in 0 until MAX_PAGES) {
                val page = api.chats(cursor, ChatsApi.PAGE_LIMIT)
                store.saveChats(page.items)
                val next = page.meta?.cursor
                if (page.meta?.hasNext != true || next == null) break
                cursor = next
            }
            store.saveFolders(api.folders())
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failure = error.displayMessage()
        } finally {
            isRefreshing = false
        }
    }

    /*
     * Все три действия устроены одинаково: пишем в базу сразу, затем говорим серверу.
     * Отказ сервера откатываем — иначе список разойдётся с ним молча.
     */

    fun togglePinned(row: ChatListRow) = act(
        local = { store.setPinned(!row.isPinned, row.id) },
        remote = { api.setPinned(!row.isPinned, row.id) },
        rollback = { store.setPinned(row.isPinned, row.id) },
    )

    fun toggleMuted(row: ChatListRow) = act(
        local = { store.setMuted(!row.muted, row.id) },
        remote = { api.setMuted(!row.muted, row.id) },
        rollback = { store.setMuted(row.muted, row.id) },
    )

    fun toggleArchived(row: ChatListRow) {
        val archived = row.archivedAt != null
        act(
            local = { store.setArchived(!archived, row.id) },
            remote = { api.setArchived(!archived, row.id) },
            rollback = { store.setArchived(archived, row.id) },
        )
    }

    private fun act(local: suspend () -> Unit, remote: suspend () -> Unit, rollback: suspend () -> Unit) {
        viewModelScope.launch { perform(local, remote, rollback) }
    }

    suspend fun perform(local: suspend () -> Unit, remote: suspend () -> Unit, rollback: suspend () -> Unit) {
        try {
            local()
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failure = UiText.Res(R.string.chats_error_local)
            return
        }
        try {
            remote()
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            runCatching { rollback() }
            failure = error.displayMessage()
        }
    }

    private fun rowsFor(tab: ChatListTab): Flow<List<ChatListRow>> = when (tab) {
        ChatListTab.All -> db.chats().observeAll()
        is ChatListTab.Folder -> db.chats().observeFolder(tab.id)
        ChatListTab.Requests -> db.chats().observeRequests()
        ChatListTab.Archive -> db.chats().observeArchive()
    }

    private companion object {
        const val MAX_PAGES = 5
    }
}

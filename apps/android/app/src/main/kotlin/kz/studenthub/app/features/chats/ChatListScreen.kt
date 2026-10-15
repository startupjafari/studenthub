package kz.studenthub.app.features.chats

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kz.studenthub.app.R
import kz.studenthub.app.core.navigation.AppRoute
import kz.studenthub.app.core.navigation.AppTab
import kz.studenthub.app.core.storage.ChatKind
import kz.studenthub.app.core.storage.ChatListRow
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.ControlHeight
import kz.studenthub.app.designsystem.FormAlert
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.shell.LocalServices
import kz.studenthub.app.shell.ScreenScaffold

/**
 * Список чатов. Рисуется из базы и потому открывается мгновенно и в самолёте. Сеть
 * только догоняет: ошибка запроса — строкой сверху, а список продолжает жить.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen() {
    val services = LocalServices.current
    val model = viewModel { ChatListModel(services.database, services.chatsApi) }
    val rows by model.rows.collectAsStateWithLifecycle()
    val tabs by model.tabs.collectAsStateWithLifecycle()
    val tab by model.tab.collectAsStateWithLifecycle()
    // Подпись видна и в списке: событие уходит в личные комнаты участников (§9.2).
    val actions by services.realtime.actions.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { model.refresh() }

    ScreenScaffold(title = stringResource(AppTab.CHATS.title)) {
        if (tabs.size > 1) ChatTabs(tabs, tab, model::select)
        PullToRefreshBox(isRefreshing = model.isRefreshing, onRefresh = model::refreshNow, modifier = Modifier.fillMaxSize()) {
            LazyColumn(contentPadding = PaddingValues(bottom = Spacing.xl), modifier = Modifier.fillMaxSize()) {
                model.failure?.let { failure ->
                    item(key = "failure") {
                        FormAlert(failure.resolve(), Modifier.padding(horizontal = Spacing.xl, vertical = Spacing.md))
                    }
                }
                val list = rows
                if (list != null && list.isEmpty()) {
                    item(key = "empty") { EmptyChats(model.isRefreshing) }
                }
                items(list.orEmpty(), key = { it.id }) { row ->
                    ChatRow(
                        row = row,
                        action = actions[row.id]?.values?.firstOrNull(),
                        onOpen = { services.router.push(AppRoute.Chat(row.id)) },
                        onTogglePinned = { model.togglePinned(row) },
                        onToggleMuted = { model.toggleMuted(row) },
                        onToggleArchived = { model.toggleArchived(row) },
                        modifier = Modifier.animateItem(),
                    )
                }
            }
        }
    }
}

/** Вкладки над списком: «Все», папки, «Запросы», «Архив». */
@Composable
private fun ChatTabs(tabs: List<ChatListTab>, selected: ChatListTab, onSelect: (ChatListTab) -> Unit) {
    val colors = AppTheme.colors
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        contentPadding = PaddingValues(horizontal = Spacing.xl, vertical = Spacing.md),
    ) {
        items(tabs, key = { it.toString() }) { tab ->
            val active = tab == selected
            Text(
                text = when (tab) {
                    ChatListTab.All -> stringResource(R.string.chats_tab_all)
                    is ChatListTab.Folder -> tab.name
                    ChatListTab.Requests -> stringResource(R.string.chats_tab_requests)
                    ChatListTab.Archive -> stringResource(R.string.chats_tab_archive)
                },
                style = AppType.meta,
                color = if (active) colors.primary else colors.mutedForeground,
                modifier = Modifier
                    .background(if (active) colors.primary.copy(alpha = 0.1f) else colors.muted, CircleShape)
                    .combinedClickable(onClick = { onSelect(tab) })
                    .padding(horizontal = Spacing.lg, vertical = Spacing.sm),
            )
        }
    }
}

/**
 * Строка списка. Порядок тот же, что в вебе: аватар, название и превью, справа время и
 * счётчик. Действия — долгим нажатием: так на Android устроены списки переписок.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatRow(
    row: ChatListRow,
    action: String?,
    onOpen: () -> Unit,
    onTogglePinned: () -> Unit,
    onToggleMuted: () -> Unit,
    onToggleArchived: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AppTheme.colors
    val haptics = LocalHapticFeedback.current
    var menu by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(
                    onClick = onOpen,
                    onLongClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        menu = true
                    },
                )
                .padding(horizontal = Spacing.xl, vertical = Spacing.md),
        ) {
            ChatAvatar(row.title, row.kind)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Text(
                        row.title ?: stringResource(R.string.chats_untitled),
                        style = AppType.cardTitle,
                        color = colors.foreground,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (row.muted) {
                        val label = stringResource(R.string.chats_mutedBadge)
                        Icon(Icons.Filled.NotificationsOff, contentDescription = label, tint = colors.mutedForeground, modifier = Modifier.size(14.dp))
                    }
                    if (row.isPinned) {
                        val label = stringResource(R.string.chats_pinnedBadge)
                        Icon(Icons.Filled.PushPin, contentDescription = label, tint = colors.mutedForeground, modifier = Modifier.size(14.dp))
                    }
                }
                when {
                    action != null -> Text(actionCaption(action), style = AppType.meta, color = colors.primary, maxLines = 1)
                    row.preview != null -> Text(
                        row.preview!!,
                        style = AppType.meta,
                        // Черновик — красным, как в вебе: он важнее чужого сообщения.
                        color = if (row.draftText.isNullOrEmpty()) colors.mutedForeground else colors.destructive,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    row.lastHasMedia -> Text(stringResource(R.string.chats_photo), style = AppType.meta, color = colors.mutedForeground)
                }
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text(ChatMoment.short(row.lastCreatedAt ?: row.updatedAt), style = AppType.tabular(AppType.meta), color = colors.mutedForeground)
                if (row.unreadCount > 0) {
                    Text(
                        if (row.unreadCount > 99) "99+" else row.unreadCount.toString(),
                        style = AppType.tabular(AppType.meta),
                        color = colors.primaryForeground,
                        modifier = Modifier
                            .background(if (row.muted) colors.mutedForeground else colors.primary, CircleShape)
                            .defaultMinSize(minWidth = 22.dp)
                            .padding(horizontal = Spacing.sm, vertical = 1.dp),
                    )
                }
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(if (row.isPinned) R.string.chats_unpin else R.string.chats_pin)) },
                onClick = { menu = false; onTogglePinned() },
            )
            DropdownMenuItem(
                text = { Text(stringResource(if (row.muted) R.string.chats_unmute else R.string.chats_mute)) },
                onClick = { menu = false; onToggleMuted() },
            )
            DropdownMenuItem(
                text = { Text(stringResource(if (row.archivedAt == null) R.string.chats_archive else R.string.chats_unarchive)) },
                onClick = { menu = false; onToggleArchived() },
            )
        }
    }
}

/** Аватар-заглушка: буква названия на фоне; у «Избранного» — закладка. */
@Composable
fun ChatAvatar(title: String?, kind: ChatKind, size: androidx.compose.ui.unit.Dp = ControlHeight.island - 8.dp) {
    val colors = AppTheme.colors
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(size)
            .background(colors.muted, CircleShape),
    ) {
        if (kind == ChatKind.SAVED) {
            Icon(Icons.Filled.Bookmark, contentDescription = null, tint = colors.primary)
        } else {
            val initial = title?.trim()?.firstOrNull()?.uppercaseChar()?.toString() ?: "•"
            Text(initial, style = AppType.cardTitle, color = colors.mutedForeground)
        }
    }
}

/** Текст подписи собирает интерфейс: сервер шлёт только значение действия (§9.1a). */
@Composable
fun actionCaption(action: String): String = stringResource(
    when (action) {
        "RECORDING_VOICE" -> R.string.chats_action_voice
        "UPLOADING_PHOTO" -> R.string.chats_action_photo
        "UPLOADING_VIDEO" -> R.string.chats_action_video
        "UPLOADING_FILE" -> R.string.chats_action_file
        else -> R.string.chats_action_typing
    },
)

@Composable
private fun EmptyChats(isRefreshing: Boolean) {
    Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xxl)) {
        if (isRefreshing) {
            CircularProgressIndicator(color = AppTheme.colors.primary, modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
        } else {
            Text(stringResource(R.string.chats_empty), style = AppType.body, color = AppTheme.colors.mutedForeground)
        }
    }
}

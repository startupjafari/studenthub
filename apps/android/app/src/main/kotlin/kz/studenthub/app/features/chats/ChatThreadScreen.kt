package kz.studenthub.app.features.chats

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kz.studenthub.app.R
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.ControlHeight
import kz.studenthub.app.designsystem.FormAlert
import kz.studenthub.app.designsystem.Radius
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.designsystem.currentLocale
import kz.studenthub.app.shell.LocalServices
import kz.studenthub.app.shell.ScreenScaffold
import java.time.LocalDate
import java.time.ZoneId

/** Строка ленты: разделитель дня или сообщение. */
private sealed interface ThreadRow {
    val key: String

    data class Separator(val day: LocalDate) : ThreadRow {
        override val key = "day-$day"
    }

    data class Message(val item: MessageTimeline.Item) : ThreadRow {
        override val key = item.id
    }
}

/**
 * Экран переписки: лента сверху, поле ввода снизу.
 *
 * Лента перевёрнута (`reverseLayout`): свежее — у нижнего края и в начале списка. Так
 * подгрузка истории сверху не сдвигает то, что человек читает, а новое сообщение само
 * подматывает ленту, пока он стоит внизу, — без ручной компенсации прокрутки.
 */
@Composable
fun ChatThreadScreen(chatId: String, viewerId: String) {
    val services = LocalServices.current
    val model = viewModel(key = "thread-$chatId") {
        ChatThreadModel(
            chatId = chatId,
            viewerId = viewerId,
            db = services.database,
            api = services.chatsApi,
            outbox = services.outbox,
            uploader = services.uploader,
            drafts = services.drafts,
            realtime = services.realtime,
            sendScope = services.appScope,
        ).also { it.start() }
    }
    val epoch by services.realtime.connectionEpoch.collectAsStateWithLifecycle()
    val actions by services.realtime.actions.collectAsStateWithLifecycle()
    val othersAction = actions[chatId]?.values?.firstOrNull()

    LaunchedEffect(chatId) {
        model.enter()
        model.markRead()
    }
    // Переподключение — догоняем пропущенное.
    LaunchedEffect(Unit) {
        snapshotFlow { epoch }.drop(1).distinctUntilChanged().collect { model.catchUpAfterReconnect() }
    }
    DisposableEffect(chatId) { onDispose { model.leave() } }

    val rows = remember(model.days) {
        model.days.flatMap { day -> listOf<ThreadRow>(ThreadRow.Separator(day.date)) + day.items.map(ThreadRow::Message) }.asReversed()
    }
    // Пришло новое — пока чат открыт, оно прочитано.
    LaunchedEffect(rows.size) { model.markRead() }

    // Панели разделов в чате нет — низ экрана (клавиатура или жесты системы) учитываем сами.
    ScreenScaffold(
        title = model.title ?: stringResource(R.string.shell_chat),
        modifier = Modifier.windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)),
    ) {
        model.failure?.let { FormAlert(it.resolve(), Modifier.padding(horizontal = Spacing.xl, vertical = Spacing.md)) }
        MessageList(rows, model, Modifier.weight(1f))
        if (othersAction != null) {
            Text(
                actionCaption(othersAction),
                style = AppType.meta,
                color = AppTheme.colors.mutedForeground,
                modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xl, vertical = Spacing.xs),
            )
        }
        Composer(model)
    }
}

@Composable
private fun MessageList(rows: List<ThreadRow>, model: ChatThreadModel, modifier: Modifier) {
    val state = rememberLazyListState()
    val today = remember { LocalDate.now(ZoneId.systemDefault()) }

    // Якорь первого непрочитанного — один раз за открытие.
    var anchorApplied by remember { mutableStateOf(false) }
    LaunchedEffect(model.openingAnchor, rows.isNotEmpty()) {
        val anchor = model.openingAnchor ?: return@LaunchedEffect
        if (anchorApplied) return@LaunchedEffect
        val index = rows.indexOfFirst { it.key == anchor }
        if (index >= 0) {
            anchorApplied = true
            state.scrollToItem(index)
        }
    }
    // Подгружаем заранее: к моменту, когда человек долистает до начала, страница уже тут.
    LaunchedEffect(state, rows.size) {
        snapshotFlow { state.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .collect { last -> if (rows.isNotEmpty() && last >= rows.size - 10) model.loadOlderNow() }
    }

    LazyColumn(
        state = state,
        reverseLayout = true,
        contentPadding = PaddingValues(vertical = Spacing.md),
        modifier = modifier.fillMaxWidth(),
    ) {
        items(rows, key = { it.key }) { row ->
            when (row) {
                is ThreadRow.Separator -> DaySeparator(row.day, today)
                is ThreadRow.Message -> MessageBubble(
                    item = row.item,
                    othersReadAt = model.othersReadAt,
                    onRetry = { model.retry(row.item.message) },
                    onReply = { model.reply(row.item.message) },
                )
            }
        }
        if (model.isLoadingOlder) {
            item(key = "older") {
                Box(Modifier.fillMaxWidth().padding(Spacing.md), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(20.dp), color = AppTheme.colors.primary, strokeWidth = 2.dp)
                }
            }
        }
    }
}

/** Разделитель дня — «пилюля» по центру. */
@Composable
private fun DaySeparator(day: LocalDate, today: LocalDate) {
    val label = when (val value = ChatMoment.day(day, today, currentLocale())) {
        ChatMoment.DayLabel.Today -> stringResource(R.string.chats_today)
        ChatMoment.DayLabel.Yesterday -> stringResource(R.string.chats_yesterday)
        is ChatMoment.DayLabel.Date -> value.text
    }
    Box(Modifier.fillMaxWidth().padding(vertical = Spacing.md), contentAlignment = Alignment.Center) {
        Text(
            label,
            style = AppType.meta,
            color = AppTheme.colors.mutedForeground,
            modifier = Modifier
                .background(AppTheme.colors.muted, CircleShape)
                .padding(horizontal = Spacing.lg, vertical = Spacing.xs),
        )
    }
}

/**
 * Поле ввода. Высота панели — 48: в открытом чате нижней навигации нет, и совпадать ей
 * не с чем (DESIGN_SYSTEM §4). Пустое поле — вместо «отправить» микрофон.
 */
@Composable
private fun Composer(model: ChatThreadModel) {
    val colors = AppTheme.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val recorder = remember { VoiceRecorder(context.applicationContext, scope) }
    var attachMenu by remember { mutableStateOf(false) }
    DisposableEffect(recorder) { onDispose { if (recorder.isRecording) recorder.cancel() } }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { OutgoingFiles.copy(context, uri)?.let(model::attach) }
    }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch { OutgoingFiles.copy(context, uri)?.let(model::attach) }
    }
    val askMicrophone = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) recorder.start()
    }
    val toggleRecording = {
        when {
            recorder.isRecording -> recorder.stop()?.let(model::attach)
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> recorder.start()
            else -> askMicrophone.launch(Manifest.permission.RECORD_AUDIO)
        }
        Unit
    }

    Column(Modifier.fillMaxWidth().background(colors.background)) {
        HorizontalDivider(color = colors.border)
        model.replyTo?.let { reply ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                modifier = Modifier.fillMaxWidth().background(colors.muted).padding(horizontal = Spacing.xl, vertical = Spacing.md),
            ) {
                Box(Modifier.width(2.dp).height(ControlHeight.sm).background(colors.primary))
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.chats_replyingTo), style = AppType.meta, color = colors.primary)
                    Text(reply.content, style = AppType.meta, color = colors.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = model::cancelReply) {
                    Icon(Icons.Filled.Close, stringResource(R.string.common_cancel), tint = colors.mutedForeground)
                }
            }
        }
        if (recorder.isRecording) RecordingBar(recorder, onCancel = recorder::cancel, onSend = toggleRecording)

        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = ControlHeight.chatInput)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        ) {
            Box {
                IconButton(onClick = { attachMenu = true }) {
                    Icon(Icons.Filled.AttachFile, stringResource(R.string.chats_attach), tint = colors.mutedForeground)
                }
                DropdownMenu(expanded = attachMenu, onDismissRequest = { attachMenu = false }) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chats_attachPhoto)) },
                        onClick = {
                            attachMenu = false
                            pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chats_attachFile)) },
                        onClick = {
                            attachMenu = false
                            pickFile.launch(arrayOf("*/*"))
                        },
                    )
                }
            }
            val placeholder = stringResource(R.string.chats_placeholder)
            BasicTextField(
                value = model.draft,
                onValueChange = model::onDraftChange,
                textStyle = AppType.body.copy(color = colors.foreground),
                cursorBrush = SolidColor(colors.primary),
                maxLines = 5,
                modifier = Modifier
                    .weight(1f)
                    .background(colors.muted, RoundedCornerShape(Radius.xl))
                    .padding(horizontal = Spacing.lg, vertical = Spacing.md),
                decorationBox = { inner ->
                    Box {
                        if (model.draft.isEmpty()) Text(placeholder, style = AppType.body, color = colors.mutedForeground)
                        inner()
                    }
                },
            )
            if (model.draft.isNotBlank()) {
                IconButton(onClick = model::send, modifier = Modifier.background(colors.primary, CircleShape)) {
                    Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.chats_send), tint = colors.primaryForeground)
                }
            } else {
                IconButton(
                    onClick = toggleRecording,
                    modifier = Modifier.background(if (recorder.isRecording) colors.destructive else colors.primary, CircleShape),
                ) {
                    Icon(
                        if (recorder.isRecording) Icons.Filled.Stop else Icons.Filled.Mic,
                        stringResource(if (recorder.isRecording) R.string.chats_voice_stop else R.string.chats_voice_record),
                        tint = colors.primaryForeground,
                    )
                }
            }
        }
    }
}

/**
 * Полоса записи: настоящая волна по показаниям микрофона, время и две кнопки. По волне
 * видно, что микрофон слышит голос, а не пишет тишину из-за занятого входа.
 */
@Composable
private fun RecordingBar(recorder: VoiceRecorder, onCancel: () -> Unit, onSend: () -> Unit) {
    val colors = AppTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        modifier = Modifier.fillMaxWidth().background(colors.muted).padding(horizontal = Spacing.md, vertical = Spacing.sm),
    ) {
        IconButton(onClick = onCancel) { Icon(Icons.Filled.Delete, stringResource(R.string.common_cancel), tint = colors.destructive) }
        Row(
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.weight(1f).height(ControlHeight.sm),
        ) {
            recorder.levels.forEach { level ->
                // Минимум в пару точек: нулевая высота читается как обрыв записи.
                Box(
                    Modifier
                        .width(3.dp)
                        .fillMaxHeight(maxOf(0.08f, level))
                        .background(colors.primary, CircleShape),
                )
            }
            Spacer(Modifier.weight(1f))
        }
        Text(voiceTime(recorder.durationMillis), style = AppType.tabular(AppType.meta), color = colors.mutedForeground)
        IconButton(onClick = onSend) { Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.chats_send), tint = colors.primary) }
    }
}

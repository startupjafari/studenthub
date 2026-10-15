package kz.studenthub.app.features.chats

import android.content.Intent
import android.text.format.Formatter
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import coil3.compose.SubcomposeAsyncImage
import coil3.request.ImageRequest
import kotlinx.coroutines.launch
import kz.studenthub.app.R
import kz.studenthub.app.core.storage.AttachmentEntity
import kz.studenthub.app.core.storage.SendState
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.ControlHeight
import kz.studenthub.app.designsystem.Radius
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.shell.LocalServices
import java.io.File
import java.time.Instant

/**
 * Пузырь сообщения. Своё справа и синим, чужое слева и на карточке — различение по
 * положению и цвету, как во всех мессенджерах.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubble(
    item: MessageTimeline.Item,
    othersReadAt: Instant?,
    onRetry: () -> Unit,
    onReply: () -> Unit,
) {
    val message = item.message
    if (message.systemType != null) {
        // Системное: без автора и без пузыря.
        Text(
            message.content,
            style = AppType.meta,
            color = AppTheme.colors.mutedForeground,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm, horizontal = Spacing.xl),
        )
        return
    }

    val colors = AppTheme.colors
    val haptics = LocalHapticFeedback.current
    var menu by remember { mutableStateOf(false) }
    val deleted = message.deletedAt != null
    val textColor = when {
        deleted -> if (item.isOwn) colors.primaryForeground.copy(alpha = 0.75f) else colors.mutedForeground
        item.isOwn -> colors.primaryForeground
        else -> colors.foreground
    }
    val metaColor = if (item.isOwn) colors.primaryForeground.copy(alpha = 0.75f) else colors.mutedForeground

    Row(
        horizontalArrangement = if (item.isOwn) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.lg, vertical = if (item.isLastInGroup) 4.dp else 1.dp),
    ) {
        if (item.isOwn && message.sendState == SendState.FAILED) {
            IconButton(onClick = onRetry) {
                Icon(Icons.Filled.Refresh, stringResource(R.string.chats_retrySend), tint = colors.destructive)
            }
        }
        Box {
            Column(
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                modifier = Modifier
                    .widthIn(max = 300.dp)
                    .clip(RoundedCornerShape(Radius.xl))
                    .background(if (item.isOwn) colors.primary else colors.card)
                    .combinedClickable(
                        onClick = {},
                        onLongClick = {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            menu = true
                        },
                    )
                    .padding(horizontal = Spacing.lg, vertical = Spacing.md),
            ) {
                val quote = message.replyQuote
                if (quote != null && !deleted) ReplyQuote(quote, item.isOwn)
                if (!deleted) item.attachments.forEach { AttachmentView(it, item.isOwn) }
                // Подпись к вложению может быть пустой — тогда и строки нет.
                if (message.content.isNotEmpty() || item.attachments.isEmpty() || deleted) {
                    Text(
                        if (deleted) stringResource(R.string.chats_deletedMessage) else message.content,
                        style = AppType.body,
                        color = textColor,
                        fontStyle = if (deleted) FontStyle.Italic else FontStyle.Normal,
                    )
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.align(Alignment.End),
                ) {
                    if (message.editedAt != null && !deleted) Text(stringResource(R.string.chats_edited), style = AppType.meta, color = metaColor)
                    Text(ChatMoment.time(message.createdAt), style = AppType.tabular(AppType.meta), color = metaColor)
                    if (item.isOwn) SendMark(message.sendState, read = othersReadAt != null && !othersReadAt.isBefore(message.createdAt), metaColor)
                }
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                if (message.remoteId != null && !deleted) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.chats_reply)) }, onClick = { menu = false; onReply() })
                }
                if (message.sendState == SendState.FAILED) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.chats_retrySend)) }, onClick = { menu = false; onRetry() })
                }
            }
        }
    }
}

/** Состояние своей отправки: часы, галочка, две галочки (прочитано), ошибка. */
@Composable
private fun SendMark(state: SendState, read: Boolean, tint: Color) {
    val (icon, label) = when (state) {
        SendState.PENDING -> Icons.Filled.Schedule to R.string.chats_sending
        SendState.FAILED -> Icons.Filled.Warning to R.string.chats_sendFailed
        SendState.SENT -> if (read) Icons.Filled.DoneAll to R.string.chats_readMark else Icons.Filled.Done to R.string.chats_sent
    }
    Icon(
        icon,
        contentDescription = stringResource(label),
        tint = if (state == SendState.FAILED) AppTheme.colors.destructive else tint,
        modifier = Modifier.size(14.dp),
    )
}

/** Цитата над текстом: полоска и усечённый фрагмент — как в вебе. */
@Composable
private fun ReplyQuote(text: String, isOwn: Boolean) {
    val colors = AppTheme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.height(IntrinsicSize.Min)) {
        Box(
            Modifier
                .width(2.dp)
                .fillMaxHeight()
                .background(if (isOwn) colors.primaryForeground.copy(alpha = 0.6f) else colors.primary),
        )
        Text(
            text,
            style = AppType.meta,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            color = if (isOwn) colors.primaryForeground.copy(alpha = 0.85f) else colors.mutedForeground,
        )
    }
}

/**
 * Вложение в пузыре. Вид — из mime и имени, как на сервере. Картинка берётся с диска,
 * если файл уже здесь, и только иначе — по подписанной ссылке; ключ кэша — id файла.
 */
@Composable
fun AttachmentView(attachment: AttachmentEntity, isOwn: Boolean) {
    when {
        attachment.isVoice -> VoiceAttachment(attachment, isOwn)
        attachment.isImage -> ImageAttachment(attachment)
        else -> FileAttachment(attachment, isOwn)
    }
}

@Composable
private fun rememberAttachmentSource(attachment: AttachmentEntity): String? {
    val services = LocalServices.current
    val local = attachment.localPath?.takeIf { File(it).exists() }
    var remote by remember(attachment.id) { mutableStateOf<String?>(null) }
    LaunchedEffect(attachment.id, local) {
        if (local == null) remote = services.attachmentUrls.url(attachment.id)
    }
    return local ?: remote
}

@Composable
private fun ImageAttachment(attachment: AttachmentEntity) {
    val context = LocalContext.current
    val source = rememberAttachmentSource(attachment)
    val label = stringResource(R.string.chats_photo)
    val shape = RoundedCornerShape(Radius.lg)
    val placeholder: @Composable () -> Unit = {
        Box(Modifier.fillMaxWidth().height(180.dp).background(AppTheme.colors.muted), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Image, contentDescription = null, tint = AppTheme.colors.mutedForeground)
        }
    }
    Box(
        Modifier
            .widthIn(max = 260.dp)
            .height(180.dp)
            .clip(shape)
            .semantics { contentDescription = label },
    ) {
        if (source == null) {
            placeholder()
        } else {
            SubcomposeAsyncImage(
                model = ImageRequest.Builder(context)
                    .data(if (source.startsWith("/")) File(source) else source)
                    // Ссылка протухает через минуты, файл — нет: кэш по id файла.
                    .memoryCacheKey(attachment.id)
                    .diskCacheKey(attachment.id)
                    .build(),
                contentDescription = label,
                contentScale = ContentScale.Crop,
                loading = { placeholder() },
                error = { placeholder() },
                modifier = Modifier.fillMaxWidth().height(180.dp),
            )
        }
    }
}

@Composable
private fun FileAttachment(attachment: AttachmentEntity, isOwn: Boolean) {
    val colors = AppTheme.colors
    val context = LocalContext.current
    val services = LocalServices.current
    val scope = rememberCoroutineScope()
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clickable {
                // Файл открывает система по подписанной ссылке: просмотрщик выберет человек.
                scope.launch {
                    val url = services.attachmentUrls.url(attachment.id) ?: return@launch
                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }
                }
            }
            .padding(vertical = Spacing.xs),
    ) {
        Icon(
            Icons.AutoMirrored.Filled.InsertDriveFile,
            contentDescription = null,
            tint = if (isOwn) colors.primaryForeground else colors.primary,
        )
        Column {
            Text(
                attachment.name ?: stringResource(R.string.chats_file),
                style = AppType.body,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = if (isOwn) colors.primaryForeground else colors.foreground,
            )
            attachment.size?.let {
                Text(
                    Formatter.formatShortFileSize(context, it),
                    style = AppType.meta,
                    color = if (isOwn) colors.primaryForeground.copy(alpha = 0.8f) else colors.mutedForeground,
                )
            }
        }
    }
}

/** Голосовое: кнопка и полоса прогресса. Волны у входящих нет: сервер её значений не хранит. */
@Composable
private fun VoiceAttachment(attachment: AttachmentEntity, isOwn: Boolean) {
    val colors = AppTheme.colors
    val services = LocalServices.current
    val scope = rememberCoroutineScope()
    val player = remember(attachment.id) { VoicePlayer(scope) }
    DisposableEffect(player) { onDispose { player.release() } }

    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
        IconButton(
            onClick = {
                if (player.isPlaying) {
                    player.pause()
                } else {
                    scope.launch {
                        val source = attachment.localPath?.takeIf { File(it).exists() } ?: services.attachmentUrls.url(attachment.id)
                        source?.let(player::play)
                    }
                }
            },
            modifier = Modifier
                .size(ControlHeight.md)
                .background(if (isOwn) colors.primaryForeground else colors.primary, CircleShape),
        ) {
            Icon(
                if (player.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = stringResource(if (player.isPlaying) R.string.chats_voice_pause else R.string.chats_voice_play),
                tint = if (isOwn) colors.primary else colors.primaryForeground,
            )
        }
        Column(Modifier.width(160.dp), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            LinearProgressIndicator(
                progress = { player.progress },
                color = if (isOwn) colors.primaryForeground else colors.primary,
                trackColor = (if (isOwn) colors.primaryForeground else colors.primary).copy(alpha = 0.25f),
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                voiceTime(player.positionMillis),
                style = AppType.tabular(AppType.meta),
                color = if (isOwn) colors.primaryForeground.copy(alpha = 0.8f) else colors.mutedForeground,
            )
        }
    }
}

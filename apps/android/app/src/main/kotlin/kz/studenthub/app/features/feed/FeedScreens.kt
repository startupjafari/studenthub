package kz.studenthub.app.features.feed

import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import kotlinx.coroutines.launch
import kz.studenthub.app.BuildConfig
import kz.studenthub.app.R
import kz.studenthub.app.core.feed.NotificationSettingsDto
import kz.studenthub.app.core.feed.PostDto
import kz.studenthub.app.core.model.Role
import kz.studenthub.app.core.navigation.AppRoute
import kz.studenthub.app.core.navigation.AppTab
import kz.studenthub.app.core.navigation.MoreSection
import kz.studenthub.app.core.session.AccessToken
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.ControlHeight
import kz.studenthub.app.designsystem.FormAlert
import kz.studenthub.app.designsystem.ListDivider
import kz.studenthub.app.designsystem.ListGroup
import kz.studenthub.app.designsystem.ListRow
import kz.studenthub.app.designsystem.PrimaryButton
import kz.studenthub.app.designsystem.Radius
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.designsystem.currentLocale
import kz.studenthub.app.features.chats.OutgoingFiles
import kz.studenthub.app.features.study.EmptyRow
import kz.studenthub.app.features.study.ScheduleModel
import kz.studenthub.app.shell.LocalServices
import kz.studenthub.app.shell.ScreenScaffold
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Эмодзи быстрых реакций — те же, что в вебе и iOS. */
private val QUICK_REACTIONS = listOf("👍", "🔥", "❤️")

@Composable
private fun formatMoment(instant: Instant): String =
    instant.atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(currentLocale()))

/**
 * Главная: ближайшая пара, затем лента. Сверху — то, ради чего приложение открывают
 * («когда и где я должен быть»), ниже — то, что читают, если есть минута.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(viewer: AccessToken) {
    val services = LocalServices.current
    val context = LocalContext.current
    val feed = viewModel { FeedModel(services.feedApi, viewer.subject) }
    val schedule = viewModel { ScheduleModel(services.database, services.studyApi, ScheduleModel.prefs(context.applicationContext)) }
    val pairs by schedule.pairs.collectAsStateWithLifecycle()
    val day by schedule.day.collectAsStateWithLifecycle()
    // Ближайшая — ещё не закончившаяся сегодняшняя: прошедшая пара на главной бесполезна.
    val now = remember { java.time.LocalTime.now().toString().take(5) }
    val next = pairs?.firstOrNull { !it.isCancelled && (day != java.time.LocalDate.now().dayOfWeek.value || it.endTime > now) }

    LaunchedEffect(Unit) {
        feed.refresh()
        schedule.refresh()
    }

    ScreenScaffold(
        title = stringResource(AppTab.HOME.title),
        actions = {
            IconButton(onClick = { services.router.push(AppRoute.Section(MoreSection.NOTIFICATIONS)) }) {
                Icon(Icons.Outlined.Notifications, stringResource(R.string.home_notifications))
            }
        },
    ) {
        PullToRefreshBox(
            isRefreshing = feed.isRefreshing,
            onRefresh = {
                feed.refreshNow()
                schedule.refreshNow()
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(Spacing.md),
                contentPadding = PaddingValues(Spacing.xl),
                modifier = Modifier.fillMaxSize(),
            ) {
                feed.failure?.let { item(key = "failure") { FormAlert(it.resolve()) } }
                if (next != null && viewer.role != Role.UNKNOWN) {
                    item(key = "next-title") { SectionTitle(stringResource(R.string.home_nextPair)) }
                    item(key = "next") {
                        ListGroup {
                            ListRow(
                                title = next.pair.subject,
                                icon = Icons.Outlined.Schedule,
                                subtitle = listOfNotNull("${next.startTime}–${next.endTime}", next.pair.roomName).joinToString(" · "),
                            ) { services.router.push(AppRoute.Lesson(next.id)) }
                        }
                    }
                }
                item(key = "feed-title") { SectionTitle(stringResource(R.string.home_feed)) }
                items(feed.posts, key = { it.id }) { post ->
                    PostCard(post, feed)
                    if (post.id == feed.posts.lastOrNull()?.id) LaunchedEffect(post.id) { feed.loadMore() }
                }
                if (feed.isEmptyAfterLoad) item(key = "empty") { EmptyRow(stringResource(R.string.home_emptyFeed)) }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = AppType.sectionTitle,
        color = AppTheme.colors.foreground,
        modifier = Modifier.padding(top = Spacing.sm).semantics { heading() },
    )
}

/** Карточка поста: автор, текст, медиа, реакции и переход к комментариям. */
@Composable
fun PostCard(post: PostDto, model: FeedModel) {
    val services = LocalServices.current
    val colors = AppTheme.colors
    Column(
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.card, RoundedCornerShape(Radius.xl))
            .padding(Spacing.lg),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text(
                post.author?.name?.ifEmpty { null } ?: stringResource(R.string.home_someone),
                style = AppType.cardTitle,
                color = colors.foreground,
                modifier = Modifier
                    .weight(1f)
                    .clickable(enabled = post.author != null) { post.author?.let { services.router.push(AppRoute.Profile(it.id)) } },
            )
            Text(formatMoment(post.createdAt), style = AppType.meta, color = colors.mutedForeground)
        }
        post.title?.takeIf { it.isNotEmpty() }?.let { Text(it, style = AppType.sectionTitle, color = colors.foreground) }
        post.content?.takeIf { it.isNotEmpty() }?.let { Text(it, style = AppType.body, color = colors.foreground) }
        post.media.firstOrNull { it.mime?.startsWith("image/") != false }?.let { PostImage(post.id, it.id) }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            QUICK_REACTIONS.forEach { emoji ->
                val mine = model.isMine(emoji, post)
                val count = model.count(emoji, post)
                Text(
                    if (count > 0) "$emoji $count" else emoji,
                    style = AppType.tabular(AppType.meta),
                    color = if (mine) colors.primary else colors.mutedForeground,
                    modifier = Modifier
                        .background(if (mine) colors.primary.copy(alpha = 0.1f) else colors.muted, CircleShape)
                        .clickable { model.toggle(emoji, post) }
                        .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                )
            }
            Spacer(Modifier.weight(1f))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                modifier = Modifier.clickable { services.router.push(AppRoute.Post(post.id)) }.padding(Spacing.sm),
            ) {
                Icon(Icons.AutoMirrored.Outlined.Chat, null, tint = colors.mutedForeground, modifier = Modifier.size(16.dp))
                Text("${post.commentsCount}", style = AppType.tabular(AppType.meta), color = colors.mutedForeground)
            }
        }
    }
}

/** Картинка поста: ссылка подписанная и короткоживущая, кэш — по id файла. */
@Composable
private fun PostImage(postId: String, fileId: String) {
    val services = LocalServices.current
    val context = LocalContext.current
    var url by remember(fileId) { mutableStateOf<String?>(null) }
    LaunchedEffect(fileId) { url = services.postMediaUrls.url("$postId/$fileId") }
    Box(Modifier.fillMaxWidth().height(200.dp).clip(RoundedCornerShape(Radius.lg)).background(AppTheme.colors.muted)) {
        url?.let {
            AsyncImage(
                model = ImageRequest.Builder(context).data(it).memoryCacheKey(fileId).diskCacheKey(fileId).build(),
                contentDescription = stringResource(R.string.chats_photo),
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/** Пост с комментариями. */
@Composable
fun PostDetailScreen(postId: String) {
    val services = LocalServices.current
    val model = viewModel { PostCommentsModel(postId, services.feedApi) }
    LaunchedEffect(Unit) { model.load() }
    val colors = AppTheme.colors

    ScreenScaffold(title = stringResource(R.string.shell_post)) {
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
            contentPadding = PaddingValues(Spacing.xl),
            modifier = Modifier.weight(1f),
        ) {
            model.failure?.let { item { FormAlert(it.resolve()) } }
            items(model.comments, key = { it.id }) { comment ->
                Column(
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                    modifier = Modifier.fillMaxWidth().background(colors.card, RoundedCornerShape(Radius.xl)).padding(Spacing.lg),
                ) {
                    Text(comment.author?.name?.ifEmpty { null } ?: stringResource(R.string.home_someone), style = AppType.meta, color = colors.mutedForeground)
                    Text(comment.content, style = AppType.body, color = colors.foreground)
                }
            }
            if (!model.isLoading && model.comments.isEmpty()) item { EmptyRow(stringResource(R.string.feed_noComments)) }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            modifier = Modifier.fillMaxWidth().padding(Spacing.xl),
        ) {
            val placeholder = stringResource(R.string.feed_comment)
            BasicTextField(
                value = model.draft,
                onValueChange = { model.draft = it },
                textStyle = AppType.body.copy(color = colors.foreground),
                cursorBrush = SolidColor(colors.primary),
                maxLines = 4,
                modifier = Modifier.weight(1f).background(colors.muted, RoundedCornerShape(Radius.xl)).padding(horizontal = Spacing.lg, vertical = Spacing.md),
                decorationBox = { inner ->
                    Box {
                        if (model.draft.isEmpty()) Text(placeholder, style = AppType.body, color = colors.mutedForeground)
                        inner()
                    }
                },
            )
            IconButton(onClick = model::sendNow, enabled = model.draft.isNotBlank(), modifier = Modifier.background(colors.primary, CircleShape)) {
                Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.chats_send), tint = colors.primaryForeground)
            }
        }
    }
}

/** События: что будет и куда я иду. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventsScreen() {
    val services = LocalServices.current
    val model = viewModel { EventsModel(services.feedApi) }
    LaunchedEffect(Unit) { model.refresh() }
    val colors = AppTheme.colors

    ScreenScaffold(title = stringResource(R.string.more_events)) {
        PullToRefreshBox(isRefreshing = model.isLoading, onRefresh = model::refreshNow, modifier = Modifier.fillMaxSize()) {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(Spacing.md), contentPadding = PaddingValues(Spacing.xl), modifier = Modifier.fillMaxSize()) {
                model.failure?.let { item { FormAlert(it.resolve()) } }
                items(model.events, key = { it.id }) { event ->
                    val going = model.isRegistered(event.id)
                    Column(
                        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                        modifier = Modifier.fillMaxWidth().background(colors.card, RoundedCornerShape(Radius.xl)).padding(Spacing.lg),
                    ) {
                        Text(event.title, style = AppType.cardTitle, color = colors.foreground)
                        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.CalendarMonth, null, tint = colors.mutedForeground, modifier = Modifier.size(14.dp))
                            Text(formatMoment(event.startsAt), style = AppType.meta, color = colors.mutedForeground)
                            event.location?.let {
                                Icon(Icons.Outlined.Place, null, tint = colors.mutedForeground, modifier = Modifier.size(14.dp))
                                Text(it, style = AppType.meta, color = colors.mutedForeground)
                            }
                        }
                        event.description?.takeIf { it.isNotEmpty() }?.let { Text(it, style = AppType.meta, color = colors.mutedForeground, maxLines = 3) }
                        Text(
                            stringResource(if (going) R.string.events_cancel else R.string.events_join),
                            style = AppType.meta,
                            color = if (going) colors.mutedForeground else colors.primary,
                            modifier = Modifier
                                .background(if (going) colors.muted else colors.primary.copy(alpha = 0.1f), CircleShape)
                                .clickable { model.toggle(event.id) }
                                .padding(horizontal = Spacing.lg, vertical = Spacing.sm),
                        )
                    }
                }
                if (model.loaded && model.events.isEmpty()) item { EmptyRow(stringResource(R.string.events_empty)) }
            }
        }
    }
}

/** Центр уведомлений: нажатие ведёт туда, о чём уведомление, и помечает прочитанным. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(viewer: AccessToken) {
    val services = LocalServices.current
    val model = viewModel { NotificationsModel(services.feedApi) }
    LaunchedEffect(Unit) { model.refresh() }
    val colors = AppTheme.colors

    ScreenScaffold(
        title = stringResource(R.string.home_notifications),
        actions = {
            TextButton(onClick = model::markAllRead, enabled = model.unreadCount > 0) {
                Text(stringResource(R.string.notifications_readAll), style = AppType.meta)
            }
        },
    ) {
        PullToRefreshBox(isRefreshing = model.isLoading, onRefresh = model::refreshNow, modifier = Modifier.fillMaxSize()) {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(Spacing.md), contentPadding = PaddingValues(Spacing.xl), modifier = Modifier.fillMaxSize()) {
                model.failure?.let { item { FormAlert(it.resolve()) } }
                items(model.items, key = { it.id }) { item ->
                    Column(
                        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(colors.card, RoundedCornerShape(Radius.xl))
                            .clickable {
                                model.markRead(item.id)
                                item.link?.let { services.router.open(it, viewer.role) }
                            }
                            .padding(Spacing.lg),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                            if (!item.isRead) Box(Modifier.size(8.dp).background(colors.primary, CircleShape))
                            Text(item.title, style = AppType.cardTitle, color = if (item.isRead) colors.mutedForeground else colors.foreground)
                        }
                        Text(item.body, style = AppType.meta, color = colors.mutedForeground)
                        Text(formatMoment(item.createdAt), style = AppType.meta, color = colors.mutedForeground)
                    }
                }
                if (model.loaded && model.items.isEmpty()) item { EmptyRow(stringResource(R.string.notifications_empty)) }
            }
        }
    }
}

/**
 * Настройки: каналы и типы уведомлений — те же переключатели, что в вебе, — плюс язык
 * приложения и системные настройки уведомлений (каналы Android, звук).
 */
@Composable
fun SettingsScreen() {
    val services = LocalServices.current
    val context = LocalContext.current
    val model = viewModel { NotificationsModel(services.feedApi) }
    LaunchedEffect(Unit) { model.refresh() }

    ScreenScaffold(title = stringResource(R.string.more_settings)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl), modifier = Modifier.verticalScroll(rememberScrollState()).padding(Spacing.xl)) {
            model.failure?.let { FormAlert(it.resolve()) }
            model.settings?.let { settings ->
                SectionTitle(stringResource(R.string.notifications_channels))
                ListGroup {
                    Toggle(stringResource(R.string.notifications_push), settings.pushEnabled) { on -> model.update { it.copy(pushEnabled = on) } }
                    ListDivider(inset = false)
                    Toggle(stringResource(R.string.notifications_email), settings.emailEnabled) { on -> model.update { it.copy(emailEnabled = on) } }
                }
                SectionTitle(stringResource(R.string.notifications_types))
                ListGroup {
                    val rows: List<Triple<Int, Boolean?, (Boolean) -> (NotificationSettingsDto) -> NotificationSettingsDto>> = listOf(
                        Triple(R.string.notifications_typeMessages, settings.messageEnabled) { on -> { s -> s.copy(messageEnabled = on) } },
                        Triple(R.string.notifications_typeSchedule, settings.scheduleChangeEnabled) { on -> { s -> s.copy(scheduleChangeEnabled = on) } },
                        Triple(R.string.notifications_typePosts, settings.postEnabled) { on -> { s -> s.copy(postEnabled = on) } },
                        Triple(R.string.notifications_typeEvents, settings.eventEnabled) { on -> { s -> s.copy(eventEnabled = on) } },
                        Triple(R.string.notifications_typeSystem, settings.systemEnabled) { on -> { s -> s.copy(systemEnabled = on) } },
                    )
                    rows.forEachIndexed { index, (title, value, change) ->
                        if (index > 0) ListDivider(inset = false)
                        Toggle(stringResource(title), value) { on -> model.update(change(on)) }
                    }
                }
            }
            ListGroup {
                ListRow(stringResource(R.string.settings_systemNotifications), Icons.Outlined.NotificationsActive) {
                    runCatching {
                        context.startActivity(
                            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
                        )
                    }
                }
                // Язык приложения отдельно от языка телефона — системная настройка Android 13+.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    ListDivider()
                    ListRow(stringResource(R.string.settings_language), Icons.Outlined.Language) {
                        runCatching {
                            context.startActivity(Intent(Settings.ACTION_APP_LOCALE_SETTINGS, "package:${context.packageName}".toUri()))
                        }
                    }
                }
            }
            Text(
                stringResource(R.string.settings_version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
                style = AppType.meta,
                color = AppTheme.colors.mutedForeground,
            )
        }
    }
}

@Composable
private fun Toggle(title: String, value: Boolean?, onChange: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xl, vertical = Spacing.sm),
    ) {
        Text(title, style = AppType.body, color = AppTheme.colors.foreground, modifier = Modifier.weight(1f))
        Switch(
            checked = value ?: false,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = AppTheme.colors.primary),
        )
    }
}

/** Профиль: свой — с правкой и сменой фото, чужой — только чтение. */
@Composable
fun ProfileScreen(userId: String?) {
    val services = LocalServices.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val model = viewModel(key = "profile-$userId") { ProfileModel(userId, services.feedApi) }
    LaunchedEffect(Unit) { model.load() }
    val pickAvatar = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { OutgoingFiles.copy(context, uri)?.let(model::uploadAvatar) }
    }
    val profile = model.profile
    val colors = AppTheme.colors

    ScreenScaffold(title = stringResource(R.string.more_profile)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg), modifier = Modifier.verticalScroll(rememberScrollState()).padding(Spacing.xl)) {
            model.failure?.let { FormAlert(it.resolve()) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Avatar(profile?.avatarThumbUrl ?: profile?.avatarUrl, profile?.name)
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Text(profile?.name.orEmpty(), style = AppType.sectionTitle, color = colors.foreground)
                    profile?.username?.let { Text("@$it", style = AppType.meta, color = colors.mutedForeground) }
                    (profile?.headline ?: profile?.position)?.let { Text(it, style = AppType.meta, color = colors.mutedForeground) }
                }
            }
            if (model.isMine) {
                ListGroup {
                    ListRow(stringResource(R.string.profile_changeAvatar), Icons.Outlined.PhotoCamera) {
                        pickAvatar.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }
                }
                SectionTitle(stringResource(R.string.profile_personal))
                OutlinedTextField(model.lastName, { model.lastName = it }, label = { Text(stringResource(R.string.profile_lastName)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(model.firstName, { model.firstName = it }, label = { Text(stringResource(R.string.profile_firstName)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(model.bio, { model.bio = it }, label = { Text(stringResource(R.string.profile_bio)) }, minLines = 2, maxLines = 6, modifier = Modifier.fillMaxWidth())
                PrimaryButton(
                    text = stringResource(if (model.isSaving) R.string.profile_saving else R.string.common_save),
                    isLoading = model.isSaving,
                    onClick = model::saveNow,
                )
                if (model.saved) Text(stringResource(R.string.profile_saved), style = AppType.meta, color = colors.success)
            } else {
                profile?.bio?.takeIf { it.isNotEmpty() }?.let {
                    SectionTitle(stringResource(R.string.profile_about))
                    Text(it, style = AppType.body, color = colors.foreground)
                }
            }
        }
    }
}

/** Аватар с запасным вариантом — буквой имени. */
@Composable
fun Avatar(url: String?, name: String?) {
    val colors = AppTheme.colors
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier.size(ControlHeight.island).clip(CircleShape).background(colors.muted),
    ) {
        Text(name?.trim()?.firstOrNull()?.uppercaseChar()?.toString() ?: "•", style = AppType.sectionTitle, color = colors.mutedForeground)
        if (!url.isNullOrEmpty()) {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

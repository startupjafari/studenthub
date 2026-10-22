package kz.studenthub.app.shell

import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import kz.studenthub.app.R
import kz.studenthub.app.core.navigation.AppRoute
import kz.studenthub.app.core.navigation.AppTab
import kz.studenthub.app.core.session.AccessToken
import kz.studenthub.app.features.chats.ChatListScreen
import kz.studenthub.app.features.chats.ChatThreadScreen
import kz.studenthub.app.core.model.Role
import kz.studenthub.app.core.navigation.MoreSection
import kz.studenthub.app.features.applications.ApplicationDetailScreen
import kz.studenthub.app.features.applications.ApplicationFormScreen
import kz.studenthub.app.features.applications.ApplicationsScreen
import kz.studenthub.app.features.applications.DocumentsScreen
import kz.studenthub.app.features.applications.ServiceCatalogScreen
import kz.studenthub.app.features.feed.EventsScreen
import kz.studenthub.app.features.feed.HomeScreen
import kz.studenthub.app.features.feed.NotificationsScreen
import kz.studenthub.app.features.feed.PostDetailScreen
import kz.studenthub.app.features.feed.ProfileScreen
import kz.studenthub.app.features.feed.SettingsScreen
import kz.studenthub.app.features.library.BookRef
import kz.studenthub.app.features.library.BookScreen
import kz.studenthub.app.features.library.LibraryScreen
import kz.studenthub.app.features.library.MyBooksScreen
import kz.studenthub.app.features.more.MoreScreen
import kz.studenthub.app.features.study.AssignmentDetailScreen
import kz.studenthub.app.features.study.AssignmentsScreen
import kz.studenthub.app.features.study.AttendanceMarkingScreen
import kz.studenthub.app.features.study.AttendanceScreen
import kz.studenthub.app.features.study.GradesScreen
import kz.studenthub.app.features.study.LessonScreen
import kz.studenthub.app.features.study.MaterialsScreen
import kz.studenthub.app.features.study.ScheduleScreen
import kz.studenthub.app.features.study.StudyScreen

/**
 * Корень раздела. Экраны разделов приходят фазами плана; что ещё не готово, стоит
 * заглушкой с понятным текстом.
 */
@Composable
fun TabRoot(tab: AppTab, viewer: AccessToken) {
    when (tab) {
        AppTab.HOME -> HomeScreen(viewer)
        AppTab.CHATS -> ChatListScreen()
        AppTab.SCHEDULE -> ScheduleScreen()
        AppTab.STUDY -> StudyScreen(viewer.role)
        AppTab.MORE -> MoreScreen(role = viewer.role)
        else -> ScreenScaffold(title = stringResource(tab.title)) {
            PlaceholderScreen(title = stringResource(tab.title))
        }
    }
}

/** Экран шага внутри раздела. */
@Composable
fun Destination(route: AppRoute, viewer: AccessToken) {
    when (route) {
        is AppRoute.Chat -> return ChatThreadScreen(chatId = route.id, viewerId = viewer.subject)
        is AppRoute.Section -> when (route.section) {
            MoreSection.GRADES -> return GradesScreen()
            MoreSection.ATTENDANCE -> return AttendanceScreen()
            MoreSection.ASSIGNMENTS -> return AssignmentsScreen()
            MoreSection.MATERIALS -> return MaterialsScreen()
            MoreSection.NOTIFICATIONS -> return NotificationsScreen(viewer)
            MoreSection.EVENTS -> return EventsScreen()
            MoreSection.SETTINGS -> return SettingsScreen()
            MoreSection.PROFILE -> return ProfileScreen(userId = null)
            MoreSection.APPLICATIONS -> return ApplicationsScreen()
            MoreSection.SERVICE_CATALOG -> return ServiceCatalogScreen()
            MoreSection.DOCUMENTS -> return DocumentsScreen()
            MoreSection.LIBRARY -> return LibraryScreen()
            MoreSection.MY_BOOKS -> return MyBooksScreen()
            else -> Unit
        }
        is AppRoute.Post -> return PostDetailScreen(route.id)
        is AppRoute.Application -> return ApplicationDetailScreen(route.id)
        is AppRoute.Service -> return ApplicationFormScreen(route.id)
        is AppRoute.Event -> return EventsScreen()
        is AppRoute.Profile -> return ProfileScreen(userId = route.userId.takeIf { it != viewer.subject })
        is AppRoute.Assignment -> return AssignmentDetailScreen(route.id)
        is AppRoute.Book -> return BookScreen(BookRef.Id(route.id))
        is AppRoute.BookCopy -> return BookScreen(BookRef.CopyCode(route.code))
        // Преподаватель с занятия идёт отмечать посещаемость — главное, зачем он вообще
        // открывает пару на телефоне.
        is AppRoute.Lesson -> return if (viewer.role == Role.TEACHER) AttendanceMarkingScreen(route.id) else LessonScreen(route.id)
        else -> Unit
    }
    val title = when (route) {
        is AppRoute.Section -> stringResource(route.section.title)
        is AppRoute.Lesson -> stringResource(R.string.shell_lesson)
        else -> stringResource(R.string.app_name)
    }
    ScreenScaffold(title = title) {
        PlaceholderScreen(title = title, reference = route.toString())
    }
}

/**
 * Что делает оболочка, пока человек внутри: позже здесь поднимаются реальное время и
 * пуши. Ключ — субъект токена: сменился человек — эффекты перезапускаются.
 */
@Composable
fun ShellEffects(viewer: AccessToken) {
    val services = LocalServices.current
    LaunchedEffect(viewer.subject) {
        services.onSignedIn(viewer)
    }
    // Разрешение на уведомления — здесь, а не на входе: до входа уведомлять не о чем,
    // и запрос выглядел бы попрошайничеством. Отказ — не ошибка.
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    // Ссылку, которую приложение не знает, не перехватываем: её откроет браузер, где
    // работает полная версия.
    val link = services.pendingLink
    val context = LocalContext.current
    LaunchedEffect(link) {
        if (link == null) return@LaunchedEffect
        services.pendingLink = null
        val opened = services.router.open(link, viewer.role)
        if (!opened && (link.startsWith("https://") || link.startsWith("http://"))) {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, link.toUri())) }
        }
    }
}

package kz.studenthub.app.shell

import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import kz.studenthub.app.R
import kz.studenthub.app.core.navigation.AppRoute
import kz.studenthub.app.core.navigation.AppTab
import kz.studenthub.app.core.session.AccessToken
import kz.studenthub.app.features.more.MoreScreen

/**
 * Корень раздела. Экраны разделов приходят фазами плана; что ещё не готово, стоит
 * заглушкой с понятным текстом.
 */
@Composable
fun TabRoot(tab: AppTab, viewer: AccessToken) {
    when (tab) {
        AppTab.MORE -> MoreScreen(role = viewer.role)
        else -> ScreenScaffold(title = stringResource(tab.title)) {
            PlaceholderScreen(title = stringResource(tab.title))
        }
    }
}

/** Экран шага внутри раздела. */
@Composable
fun Destination(route: AppRoute, viewer: AccessToken) {
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

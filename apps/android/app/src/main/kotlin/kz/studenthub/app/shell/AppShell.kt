package kz.studenthub.app.shell

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import kz.studenthub.app.BuildConfig
import kz.studenthub.app.R
import kz.studenthub.app.core.navigation.AppRoute
import kz.studenthub.app.core.navigation.AppTab
import kz.studenthub.app.core.session.AccessToken
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.Motion
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.designsystem.rememberReduceMotion

/**
 * Оболочка: пять разделов в нижней панели Material, у каждого свой стек.
 *
 * Наполнение разделов приходит из роли, структура — нет: ни одна роль MVP не теряет
 * и не добавляет раздел.
 */
@Composable
fun AppShell(viewer: AccessToken) {
    val services = LocalServices.current
    val router = services.router
    val reduceMotion = rememberReduceMotion()
    // Состояние экранов (прокрутка, набранный текст) переживает уход на соседнюю вкладку.
    val saveable = rememberSaveableStateHolder()
    val stores = remember { RouteStores() }
    DisposableEffect(Unit) { onDispose { stores.clear() } }

    // Шаг навигации — ключ его модели и сохранённого состояния. Ушёл из стека — отпускаем.
    val live = AppTab.entries.flatMap { tab -> (0..router.stack(tab).size).map { depth -> routeKey(tab, depth, router.stack(tab)) } }.toSet()
    SideEffect { stores.retainOnly(live) }

    ShellEffects(viewer)

    // «Назад» сначала идёт по стеку раздела; пустой стек — уход с главного раздела.
    BackHandler(enabled = router.stack(router.selectedTab).isNotEmpty()) { router.pop() }

    // В открытом чате панели разделов нет: под клавиатурой она бы только мешала, а в
    // переписке её место занимает поле ввода — так же, как в iOS.
    val showsBar = router.stack(router.selectedTab).lastOrNull() !is AppRoute.Chat

    Scaffold(
        containerColor = AppTheme.colors.background,
        // Системные отступы считают сами экраны и панель разделов — иначе сверху двойной.
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            if (showsBar) NavigationBar(containerColor = AppTheme.colors.card) {
                AppTab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = router.selectedTab == tab,
                        onClick = { router.switchTo(tab) },
                        icon = { Icon(tab.icon, contentDescription = null) },
                        label = { Text(stringResource(tab.title), style = AppType.meta) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = AppTheme.colors.primary,
                            selectedTextColor = AppTheme.colors.primary,
                            indicatorColor = AppTheme.colors.accent,
                            unselectedIconColor = AppTheme.colors.mutedForeground,
                            unselectedTextColor = AppTheme.colors.mutedForeground,
                        ),
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            val tab = router.selectedTab
            val route = router.stack(tab).lastOrNull()
            val depth = router.stack(tab).size
            AnimatedContent(
                targetState = Triple(tab, depth, route),
                transitionSpec = { Motion.crossfade(reduceMotion) },
                label = "shell",
            ) { (currentTab, currentDepth, _) ->
                val key = routeKey(currentTab, currentDepth, router.stack(currentTab))
                val route = router.stack(currentTab).getOrNull(currentDepth - 1)
                saveable.SaveableStateProvider(key = key) {
                    CompositionLocalProvider(LocalViewModelStoreOwner provides stores.owner(key)) {
                        if (route == null) TabRoot(currentTab, viewer) else Destination(route, viewer)
                    }
                }
            }
        }
    }
}

/** Ключ шага: вкладка, глубина и сам маршрут — один и тот же чат на разной глубине различим. */
private fun routeKey(tab: AppTab, depth: Int, stack: List<AppRoute>): String =
    "$tab/$depth/${stack.getOrNull(depth - 1)}"

/**
 * Заглушка раздела. Пустой экран без объяснения человек читает как поломку.
 * В отладочной сборке показывает идентификатор из ссылки — так видно, что диплинк
 * довёл до нужной записи.
 */
@Composable
fun PlaceholderScreen(title: String, reference: String? = null) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterVertically),
        modifier = Modifier
            .fillMaxSize()
            .background(AppTheme.colors.background)
            .padding(Spacing.xl),
    ) {
        Text(title, style = AppType.pageTitle, color = AppTheme.colors.foreground)
        Text(
            stringResource(R.string.shell_placeholder),
            style = AppType.meta,
            color = AppTheme.colors.mutedForeground,
            textAlign = TextAlign.Center,
        )
        if (BuildConfig.DEBUG && reference != null) {
            Text(reference, style = AppType.tabular(AppType.meta), color = AppTheme.colors.mutedForeground)
        }
    }
}

package kz.studenthub.app.shell

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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

    ShellEffects(viewer)

    // «Назад» сначала идёт по стеку раздела; пустой стек — уход с главного раздела.
    BackHandler(enabled = router.stack(router.selectedTab).isNotEmpty()) { router.pop() }

    Scaffold(
        containerColor = AppTheme.colors.background,
        bottomBar = {
            NavigationBar(containerColor = AppTheme.colors.card) {
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
            ) { (currentTab, currentDepth, currentRoute) ->
                saveable.SaveableStateProvider(key = "$currentTab/$currentDepth/$currentRoute") {
                    if (currentRoute == null) {
                        TabRoot(currentTab, viewer)
                    } else {
                        Destination(currentRoute, viewer)
                    }
                }
            }
        }
    }
}

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

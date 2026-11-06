package kz.studenthub.app.shell

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kz.studenthub.app.R
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.Motion
import kz.studenthub.app.designsystem.QuietButton
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.designsystem.rememberReduceMotion
import kz.studenthub.app.features.auth.LoginScreen
import kz.studenthub.app.features.update.ForcedUpdateScreen
import kz.studenthub.app.features.update.UpdateGateModel

/** Сборка зависимостей, доступная любому экрану. */
val LocalServices = staticCompositionLocalOf<AppServices> { error("AppServices не переданы в композицию") }

/**
 * Корень: проверка версии, вход, пока сессии нет, и приложение, когда она есть.
 *
 * Роль для оболочки берётся из токена: решение о доступе всё равно принимает API, а
 * приложению роль нужна, чтобы не рисовать разделы, которых у человека нет.
 */
@Composable
fun RootScreen() {
    val services = LocalServices.current
    val session = services.sessionModel
    val update = services.updateGate
    val reduceMotion = rememberReduceMotion()
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        // Версию и сессию спрашиваем разом: по очереди это лишняя секунда к запуску.
        coroutineScope {
            val version = async { update.check() }
            val restored = async { if (session.state == AppSessionModel.State.Restoring) session.restore() }
            version.await()
            restored.await()
        }
        services.observability.launchFinished(session.token?.subject)
    }

    // Проверка версии стоит перед сессией: со сборкой старше контракта не работает и вход.
    val blocked = update.state as? UpdateGateModel.State.Blocked
    if (blocked != null) {
        ForcedUpdateScreen(storeUrl = blocked.storeUrl, onRetry = { scope.launch { update.check() } })
        return
    }

    AnimatedContent(
        targetState = session.state,
        contentKey = { it::class },
        transitionSpec = { Motion.crossfade(reduceMotion) },
        label = "session",
    ) { state ->
        when (state) {
            AppSessionModel.State.Restoring -> RestoringScreen()
            AppSessionModel.State.SignedOut -> LoginScreen()
            is AppSessionModel.State.SignedIn ->
                // Роли вне MVP приложение не ведёт: честнее сказать про браузер, чем
                // показать оболочку с пятью пустыми разделами.
                if (state.token.role.isSupportedOnPhone) {
                    AppShell(viewer = state.token)
                } else {
                    UnsupportedRoleScreen(onSignOut = { scope.launch { session.signOut() } })
                }
        }
    }
}

/** Холодный старт: признак сессии есть, токен ещё едет. Имя приложения, а не спиннер во весь экран. */
@Composable
private fun RestoringScreen() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterVertically),
        modifier = Modifier
            .fillMaxSize()
            .background(AppTheme.colors.background),
    ) {
        Text(stringResource(R.string.app_name), style = AppType.pageTitle, color = AppTheme.colors.foreground)
        CircularProgressIndicator(color = AppTheme.colors.primary, modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
    }
}

/** Роль вне MVP: деканат, администраторы, работодатели — их разделы живут в браузере. */
@Composable
private fun UnsupportedRoleScreen(onSignOut: () -> Unit) {
    val colors = AppTheme.colors
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xl, Alignment.CenterVertically),
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .safeDrawingPadding()
            .padding(Spacing.xl),
    ) {
        Icon(Icons.Outlined.Laptop, contentDescription = null, tint = colors.primary, modifier = Modifier.size(36.dp))
        Text(
            stringResource(R.string.session_roleInWebTitle),
            style = AppType.sectionTitle,
            color = colors.foreground,
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.session_roleInWebHint),
            style = AppType.meta,
            color = colors.mutedForeground,
            textAlign = TextAlign.Center,
        )
        QuietButton(text = stringResource(R.string.session_signOut), onClick = onSignOut)
    }
}

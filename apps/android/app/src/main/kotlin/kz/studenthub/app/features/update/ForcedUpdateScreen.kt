package kz.studenthub.app.features.update

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import kz.studenthub.app.R
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.PrimaryButton
import kz.studenthub.app.designsystem.QuietButton
import kz.studenthub.app.designsystem.Spacing

/**
 * «Обновите приложение». Стоит до входа: со старой сборкой не работает и форма входа.
 * Выхода с экрана нет намеренно — «продолжить всё равно» значило бы предложить
 * пользоваться тем, что не работает.
 */
@Composable
fun ForcedUpdateScreen(storeUrl: String?, onRetry: () -> Unit) {
    val context = LocalContext.current
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
        Icon(Icons.Outlined.SystemUpdate, contentDescription = null, tint = colors.primary, modifier = Modifier.size(44.dp))
        Text(stringResource(R.string.update_title), style = AppType.pageTitle, color = colors.foreground, textAlign = TextAlign.Center)
        Text(stringResource(R.string.update_hint), style = AppType.body, color = colors.mutedForeground, textAlign = TextAlign.Center)
        if (storeUrl != null) {
            PrimaryButton(
                text = stringResource(R.string.update_action),
                onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, storeUrl.toUri())) } },
            )
        }
        // Нужна и тогда, когда человек обновился, а приложение ещё не спросило.
        QuietButton(text = stringResource(R.string.update_retry), onClick = onRetry)
    }
}

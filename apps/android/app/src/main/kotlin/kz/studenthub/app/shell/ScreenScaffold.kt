package kz.studenthub.app.shell

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import kz.studenthub.app.R
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType

/**
 * Каркас экрана раздела: заголовок, «назад», если экран не корень вкладки, и тело.
 *
 * Стрелку «назад» экран не решает сам: она появляется, когда под ним в стеке вкладки
 * что-то есть. Иначе экран, открытый пушем как корень, показывал бы стрелку в никуда.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScreenScaffold(
    title: String,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
    snackbar: SnackbarHostState = remember { SnackbarHostState() },
    floating: @Composable () -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    val router = LocalServices.current.router
    val canGoBack = router.stack(router.selectedTab).isNotEmpty()
    Scaffold(
        modifier = modifier,
        containerColor = AppTheme.colors.background,
        // Нижние отступы уже учла оболочка — у неё панель разделов.
        contentWindowInsets = TopAppBarDefaults.windowInsets,
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = floating,
        topBar = {
            TopAppBar(
                title = {
                    // Заголовок экрана — заголовок и для TalkBack: по ним переходят жестом.
                    Text(
                        title,
                        style = AppType.sectionTitle,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.semantics { heading() },
                    )
                },
                navigationIcon = {
                    if (canGoBack) {
                        IconButton(onClick = { router.pop() }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                        }
                    }
                },
                actions = actions,
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = AppTheme.colors.background,
                    titleContentColor = AppTheme.colors.foreground,
                    navigationIconContentColor = AppTheme.colors.foreground,
                    actionIconContentColor = AppTheme.colors.foreground,
                ),
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding), content = content)
    }
}

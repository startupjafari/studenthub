package kz.studenthub.app.features.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import kotlinx.coroutines.launch
import kz.studenthub.app.R
import kz.studenthub.app.core.model.Role
import kz.studenthub.app.core.navigation.AppRoute
import kz.studenthub.app.core.navigation.AppTab
import kz.studenthub.app.core.navigation.MoreSection
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.ListDivider
import kz.studenthub.app.designsystem.ListGroup
import kz.studenthub.app.designsystem.ListRow
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.features.auth.QrApproveScreen
import kz.studenthub.app.shell.LocalServices
import kz.studenthub.app.shell.ScreenScaffold

/**
 * Вкладка «Ещё»: разделы по роли плюс действия сессии. Состав разделов — из одного места
 * с разбором диплинков (`MoreSection.sections`), иначе ссылка открывала бы раздел,
 * которого в списке нет.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoreScreen(role: Role) {
    val services = LocalServices.current
    val scope = rememberCoroutineScope()
    var showsQr by rememberSaveable { mutableStateOf(false) }

    // Библиотеку включает админ вуза: пункт появляется, только когда она включена.
    // Последний ответ переживает уход на соседнюю вкладку — пункт не мигает при возврате.
    var libraryEnabled by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(role) {
        if (!MoreSection.readsLibrary(role)) return@LaunchedEffect
        libraryEnabled = try {
            services.libraryApi.settings().enabled
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            // Нет связи — оставляем, что знали: пропавший пункт хуже устаревшего.
            libraryEnabled
        }
    }

    ScreenScaffold(title = stringResource(AppTab.MORE.title)) {
        Column(
            verticalArrangement = Arrangement.spacedBy(Spacing.xl),
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(Spacing.xl),
        ) {
            ListGroup {
                MoreSection.sections(role, libraryEnabled).forEachIndexed { index, section ->
                    if (index > 0) ListDivider()
                    ListRow(stringResource(section.title), section.icon) {
                        services.router.push(AppRoute.Section(section))
                    }
                }
            }
            ListGroup {
                ListRow(stringResource(R.string.auth_qrApproveTitle), Icons.Outlined.QrCodeScanner) { showsQr = true }
                ListDivider()
                ListRow(
                    stringResource(R.string.session_signOut),
                    Icons.AutoMirrored.Outlined.Logout,
                    tint = AppTheme.colors.destructive,
                ) { scope.launch { services.sessionModel.signOut() } }
            }
        }
    }

    if (showsQr) {
        ModalBottomSheet(
            onDismissRequest = { showsQr = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = AppTheme.colors.background,
        ) {
            QrApproveScreen(onClose = { showsQr = false })
        }
    }
}

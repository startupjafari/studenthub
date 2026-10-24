package kz.studenthub.app.features.auth

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.GppMaybe
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kz.studenthub.app.R
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.ApiErrorCode
import kz.studenthub.app.core.network.displayMessage
import kz.studenthub.app.core.session.QrLoginApproving
import kz.studenthub.app.core.session.QrLoginTicket
import kz.studenthub.app.core.session.QrRequester
import kz.studenthub.app.core.ui.UiText
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.PrimaryButton
import kz.studenthub.app.designsystem.QuietButton
import kz.studenthub.app.designsystem.Radius
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.shell.LocalServices
import kotlin.coroutines.resume

/**
 * Подтверждение входа по QR.
 *
 * Не делается молча по факту сканирования: код может оказаться чужим, и единственная
 * защита здесь — человек, который видит, что подтверждает. Поэтому между сканированием
 * и запросом стоят два шага, как на странице `/qr` в вебе: `Checking` спрашивает сервер,
 * чьё устройство просит вход (`/auth/qr/preview`), а `Confirming` показывает его рядом с
 * предупреждением. Подтвердить, не увидев устройства, нельзя.
 */
class QrApproveModel(private val api: QrLoginApproving) : ViewModel() {
    sealed interface State {
        data object Scanning : State

        /** Код распознан, спрашиваем сервер, кто просит вход. */
        data class Checking(val ticket: QrLoginTicket) : State

        data class Confirming(val ticket: QrLoginTicket, val requester: QrRequester) : State

        data object Approving : State

        data object Approved : State

        data object Rejected : State

        data class Failed(val message: UiText) : State

        /** Сканер недоступен: нет сервисов Google или модуль не скачался. */
        data object ScannerUnavailable : State
    }

    var state: State by mutableStateOf(State.Scanning)
        private set

    /** Код распознан. Чужой QR до запроса не доходит: разбор ссылки строгий. */
    fun scanned(payload: String) {
        if (state != State.Scanning) return
        val ticket = QrLoginTicket.parse(payload)
        state = if (ticket == null) State.Failed(UiText.Res(R.string.auth_qrApproveInvalid)) else State.Checking(ticket)
    }

    /**
     * Узнать, кто просит вход. Код истёк или уже подтверждён — `404`: показываем то же,
     * что веб, «ссылка недействительна или устарела».
     */
    suspend fun inspect() {
        val ticket = (state as? State.Checking)?.ticket ?: return
        state = try {
            State.Confirming(ticket, api.preview(ticket))
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            if ((error as? ApiError)?.code == ApiErrorCode.NOT_FOUND) {
                State.Failed(UiText.Res(R.string.auth_qrApproveInvalid))
            } else {
                State.Failed(error.displayMessage())
            }
        }
    }

    fun confirm() {
        viewModelScope.launch { approve() }
    }

    suspend fun approve() {
        val ticket = (state as? State.Confirming)?.ticket ?: return
        state = State.Approving
        state = try {
            api.approve(ticket)
            State.Approved
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            // Сессия QR живёт две минуты: серверный текст про истёкший код точнее общей фразы.
            State.Failed(error.displayMessage())
        }
    }

    fun reject() {
        state = State.Rejected
    }

    fun scanAgain() {
        state = State.Scanning
    }

    fun scannerUnavailable() {
        state = State.ScannerUnavailable
    }
}

/**
 * Сканер из Google Play services: камеру, разрешение и видоискатель показывает система,
 * приложению не нужно ни разрешение на камеру, ни своя библиотека распознавания.
 *
 * Возвращает текст кода, `null` — человек закрыл сканер. Исключение — сканер недоступен.
 */
private suspend fun scanQr(context: Context): String? = suspendCancellableCoroutine { continuation ->
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(context, options).startScan()
        .addOnSuccessListener { continuation.resume(it.rawValue) }
        .addOnCanceledListener { continuation.resume(null) }
        .addOnFailureListener { continuation.resumeWith(Result.failure(it)) }
}

/** Экран за входом: подтвердить чужой вход может только тот, кто сам вошёл. */
@Composable
fun QrApproveScreen(onClose: () -> Unit) {
    val services = LocalServices.current
    val model = viewModel { QrApproveModel(services.qrLogin) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val colors = AppTheme.colors

    val startScan: () -> Unit = {
        scope.launch {
            try {
                val payload = scanQr(context)
                if (payload != null) model.scanned(payload)
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                model.scannerUnavailable()
            }
        }
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xl, Alignment.CenterVertically),
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .verticalScroll(rememberScrollState())
            .padding(Spacing.xl),
    ) {
        when (val state = model.state) {
            QrApproveModel.State.Scanning -> {
                Icon(Icons.Outlined.QrCodeScanner, null, tint = colors.primary, modifier = Modifier.size(56.dp))
                Text(stringResource(R.string.auth_qrScanHint), style = AppType.body, color = colors.mutedForeground, textAlign = TextAlign.Center)
                PrimaryButton(text = stringResource(R.string.auth_qrScanStart), onClick = startScan)
                QuietButton(text = stringResource(R.string.common_close), onClick = onClose)
            }
            is QrApproveModel.State.Checking -> {
                LaunchedEffect(state) { model.inspect() }
                CircularProgressIndicator(color = colors.primary)
                Text(stringResource(R.string.auth_qrChecking), style = AppType.meta, color = colors.mutedForeground)
            }
            is QrApproveModel.State.Confirming -> {
                Icon(Icons.Outlined.Computer, null, tint = colors.primary, modifier = Modifier.size(36.dp))
                Text(stringResource(R.string.auth_qrApprovePrompt), style = AppType.sectionTitle, color = colors.foreground, textAlign = TextAlign.Center)
                // Чьё устройство просит вход: браузер, система и сеть — до кнопки.
                Column(
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.card, RoundedCornerShape(Radius.xl))
                        .padding(Spacing.lg),
                ) {
                    Text(stringResource(R.string.auth_qrApproveRequester), style = AppType.meta, color = colors.mutedForeground)
                    Text(requesterLine(state.requester), style = AppType.body, color = colors.foreground)
                }
                // Предупреждение — главная часть экрана: единственное, что отделяет
                // подтверждение своего входа от чужого, — внимание человека.
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.warning.copy(alpha = 0.1f), RoundedCornerShape(Radius.xl))
                        .padding(Spacing.lg),
                ) {
                    Icon(Icons.Outlined.GppMaybe, null, tint = colors.warning, modifier = Modifier.size(18.dp))
                    Text(stringResource(R.string.auth_qrApproveWarning), style = AppType.meta, color = colors.foreground)
                }
                PrimaryButton(text = stringResource(R.string.auth_qrApproveConfirm), onClick = model::confirm)
                QuietButton(text = stringResource(R.string.auth_qrApproveReject), onClick = model::reject)
            }
            QrApproveModel.State.Approving -> {
                CircularProgressIndicator(color = colors.primary)
                Text(stringResource(R.string.auth_qrApproving), style = AppType.meta, color = colors.mutedForeground)
            }
            QrApproveModel.State.Approved ->
                Outcome(Icons.Filled.CheckCircle, colors.success, stringResource(R.string.auth_qrApproveDone), null, onClose)
            QrApproveModel.State.Rejected ->
                Outcome(Icons.Filled.Cancel, colors.mutedForeground, stringResource(R.string.auth_qrApproveRejected), null, onClose)
            is QrApproveModel.State.Failed -> Outcome(
                Icons.Filled.Warning,
                colors.destructive,
                state.message.resolve(),
                stringResource(R.string.auth_qrScanAgain) to model::scanAgain,
                onClose,
            )
            QrApproveModel.State.ScannerUnavailable -> Outcome(
                Icons.Filled.Warning,
                colors.destructive,
                stringResource(R.string.auth_qrScannerUnavailable),
                stringResource(R.string.auth_qrScanAgain) to model::scanAgain,
                onClose,
            )
        }
    }
}

/** «Chrome · Windows · IP 1.2.3.x» — как строка устройства на странице `/qr` в вебе. */
@Composable
private fun requesterLine(requester: QrRequester): String =
    listOfNotNull(
        requester.browser ?: stringResource(R.string.auth_qrApproveUnknownBrowser),
        requester.os,
        requester.ip?.let { "IP $it" },
    ).joinToString(" · ")

@Composable
private fun Outcome(
    icon: ImageVector,
    tint: Color,
    message: String,
    action: Pair<String, () -> Unit>?,
    onDone: () -> Unit,
) {
    Icon(icon, null, tint = tint, modifier = Modifier.size(36.dp))
    Text(message, style = AppType.body, color = AppTheme.colors.foreground, textAlign = TextAlign.Center)
    if (action != null) PrimaryButton(text = action.first, onClick = action.second)
    QuietButton(text = stringResource(R.string.common_done), onClick = onDone)
}

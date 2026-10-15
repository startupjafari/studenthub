package kz.studenthub.app.features.applications

import android.app.DownloadManager
import android.content.Context
import android.os.Environment
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import kz.studenthub.app.R
import kz.studenthub.app.core.applications.ApplicationDto
import kz.studenthub.app.core.applications.DocumentDto
import kz.studenthub.app.core.applications.ServiceCategoryDto
import kz.studenthub.app.core.applications.ServiceDto
import kz.studenthub.app.core.navigation.AppRoute
import kz.studenthub.app.core.navigation.AppTab
import kz.studenthub.app.core.navigation.MoreSection
import kz.studenthub.app.core.network.displayMessage
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.FieldLabel
import kz.studenthub.app.designsystem.FormAlert
import kz.studenthub.app.designsystem.ListGroup
import kz.studenthub.app.designsystem.ListRow
import kz.studenthub.app.designsystem.PrimaryButton
import kz.studenthub.app.designsystem.QuietButton
import kz.studenthub.app.designsystem.Radius
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.designsystem.currentLocale
import kz.studenthub.app.features.study.EmptyRow
import kz.studenthub.app.features.study.SectionModel
import kz.studenthub.app.features.study.SectionScreen
import kz.studenthub.app.shell.LocalServices
import kz.studenthub.app.shell.ScreenScaffold
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@Composable
private fun formatDate(instant: Instant): String =
    instant.atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(currentLocale()))

@Composable
private fun statusTitle(status: String): String = ApplicationStatus.title(status)?.let { stringResource(it) } ?: status

/**
 * Сохранить файл в «Загрузки» системным загрузчиком: он переживает уход с экрана и
 * показывает прогресс в шторке. Ссылка подписанная — её берут прямо перед загрузкой.
 */
fun download(context: Context, url: String, name: String) {
    val request = DownloadManager.Request(url.toUri())
        .setTitle(name)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name.replace('/', '_'))
    context.getSystemService(DownloadManager::class.java)?.enqueue(request)
    Toast.makeText(context, R.string.documents_downloading, Toast.LENGTH_SHORT).show()
}

/**
 * Мои заявки. Статусы приезжают в реальном времени (`application.status.changed`):
 * человек ждёт справку и не должен обновлять экран, чтобы узнать, что она готова.
 */
@Composable
fun ApplicationsScreen() {
    val services = LocalServices.current
    val model = viewModel { SectionModel { services.applicationsApi.applications() } }
    val change by services.realtime.applicationStatus.collectAsStateWithLifecycle()
    LaunchedEffect(change) { if (change != null) model.refresh() }
    val colors = AppTheme.colors

    SectionScreen(stringResource(R.string.more_applications), model) { applications ->
        item(key = "new") {
            ListGroup {
                ListRow(stringResource(R.string.applications_new), Icons.Outlined.AddCircleOutline) {
                    services.router.push(AppRoute.Section(MoreSection.SERVICE_CATALOG))
                }
            }
        }
        item(key = "mine") { Text(stringResource(R.string.applications_mine), style = AppType.sectionTitle, color = colors.foreground) }
        if (applications.isEmpty()) item(key = "empty") { EmptyRow(stringResource(R.string.applications_empty)) }
        items(applications, key = { it.id }) { application ->
            Column(
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.card, RoundedCornerShape(Radius.xl))
                    .clickable { services.router.push(AppRoute.Application(application.id)) }
                    .padding(Spacing.lg),
            ) {
                Text(application.service?.name(currentLocale()) ?: stringResource(R.string.applications_service), style = AppType.cardTitle, color = colors.foreground)
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    Text(
                        statusTitle(application.status),
                        style = AppType.meta,
                        color = if (ApplicationStatus.isOpen(application.status)) colors.primary else colors.mutedForeground,
                    )
                    application.number?.let { Text(stringResource(R.string.applications_number, it), style = AppType.meta, color = colors.mutedForeground) }
                    Text(formatDate(application.submittedAt ?: application.createdAt), style = AppType.meta, color = colors.mutedForeground)
                }
            }
        }
    }
}

/** Каталог услуг: категории и услуги внутри них. */
@Composable
fun ServiceCatalogScreen() {
    val services = LocalServices.current
    val model = viewModel { SectionModel<List<ServiceCategoryDto>> { services.applicationsApi.categories() } }
    val locale = currentLocale()
    SectionScreen(stringResource(R.string.applications_catalog), model) { categories ->
        if (categories.isEmpty()) item { EmptyRow(stringResource(R.string.applications_noServices)) }
        categories.forEach { category ->
            item(key = "category-${category.id}") {
                Text(category.name(locale), style = AppType.sectionTitle, color = AppTheme.colors.foreground, modifier = Modifier.padding(top = Spacing.sm))
            }
            items(category.services, key = { it.id }) { service ->
                ListGroup {
                    ListRow(
                        title = service.name(locale),
                        icon = Icons.Outlined.Description,
                        subtitle = service.slaHours?.let { stringResource(R.string.applications_sla, it) },
                    ) { services.router.push(AppRoute.Service(service.id)) }
                }
            }
        }
    }
}

/** Подача заявки на услугу: поля по ответу сервера, способ получения, документы. */
@Composable
fun ApplicationFormScreen(serviceId: String) {
    val services = LocalServices.current
    val model = viewModel { ApplicationFormModel(serviceId, services.applicationsApi) }
    LaunchedEffect(Unit) { if (model.service == null) model.load() }
    val locale = currentLocale()
    val colors = AppTheme.colors

    ScreenScaffold(title = stringResource(R.string.applications_new)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg), modifier = Modifier.verticalScroll(rememberScrollState()).padding(Spacing.xl)) {
            model.failure?.let { FormAlert(it.resolve()) }
            if (model.submitted) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    Icon(Icons.Outlined.CheckCircle, null, tint = colors.success)
                    Text(stringResource(R.string.applications_sent), style = AppType.body, color = colors.success)
                }
                QuietButton(stringResource(R.string.applications_mine), onClick = {
                    services.router.select(AppTab.MORE)
                    services.router.push(AppRoute.Section(MoreSection.APPLICATIONS))
                })
                return@Column
            }
            val service = model.service ?: return@Column
            Text(service.name(locale), style = AppType.sectionTitle, color = colors.foreground)
            service.description(locale)?.let { Text(it, style = AppType.body, color = colors.mutedForeground) }
            service.instructions(locale)?.let { Text(it, style = AppType.meta, color = colors.mutedForeground) }

            service.formFields.forEach { field -> FormFieldInput(field, model) }

            if (service.deliveryTypes.size > 1) {
                FieldLabel(stringResource(R.string.applications_delivery) + " *")
                service.deliveryTypes.forEach { type ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth().clickable { model.deliveryType = type },
                    ) {
                        RadioButton(selected = model.deliveryType == type, onClick = { model.deliveryType = type })
                        Text(stringResource(ApplicationStatus.delivery(type)), style = AppType.body, color = colors.foreground)
                    }
                }
            }

            if (service.requirements.isNotEmpty()) {
                Text(stringResource(R.string.applications_documents), style = AppType.sectionTitle, color = colors.foreground)
                service.requirements.forEach { requirement -> RequirementPicker(requirement, model) }
            }

            if (!model.isComplete) Text(stringResource(R.string.applications_fillRequired), style = AppType.meta, color = colors.mutedForeground)
            PrimaryButton(
                text = stringResource(if (model.isSubmitting) R.string.applications_sending else R.string.applications_submit),
                isLoading = model.isSubmitting,
                enabled = model.isComplete && model.draftId != null,
                onClick = model::submitNow,
            )
        }
    }
}

/**
 * Поле формы. Тип приходит с сервера, и под каждый — свой контрол: дата текстом
 * приводит к тому, что половина заявок возвращается на уточнение.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FormFieldInput(field: ServiceDto.FormField, model: ApplicationFormModel) {
    val locale = currentLocale()
    // Звёздочка объясняет, почему кнопка не нажимается, до того как на неё нажмут.
    val label = field.label(locale) + if (field.required) " *" else ""
    val value = model.answers[field.code].orEmpty()
    val colors = AppTheme.colors
    when (field.type) {
        "SELECT", "RADIO" -> Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            FieldLabel(label)
            field.options.orEmpty().forEach { option ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { model.answers[field.code] = option.value }) {
                    RadioButton(selected = value == option.value, onClick = { model.answers[field.code] = option.value })
                    Text(option.label(locale), style = AppType.body, color = colors.foreground)
                }
            }
        }
        "CHECKBOX", "BOOLEAN" -> Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().clickable { model.answers[field.code] = (value != "true").toString() },
        ) {
            Checkbox(checked = value == "true", onCheckedChange = { model.answers[field.code] = it.toString() })
            Text(label, style = AppType.body, color = colors.foreground)
        }
        "DATE" -> {
            var picking by remember { mutableStateOf(false) }
            val shown = runCatching { LocalDate.parse(value).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)) }.getOrNull()
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                FieldLabel(label)
                Text(
                    shown ?: "—",
                    style = AppType.body,
                    color = colors.foreground,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.muted, RoundedCornerShape(Radius.xl))
                        .clickable { picking = true }
                        .padding(Spacing.lg),
                )
            }
            if (picking) {
                val state = rememberDatePickerState()
                DatePickerDialog(
                    onDismissRequest = { picking = false },
                    confirmButton = {
                        TextButton(onClick = {
                            state.selectedDateMillis?.let {
                                // Дата формы — «ГГГГ-ММ-ДД», без часового пояса.
                                model.answers[field.code] = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()
                            }
                            picking = false
                        }) { Text(stringResource(R.string.common_done)) }
                    },
                ) { DatePicker(state = state) }
            }
        }
        else -> OutlinedTextField(
            value = value,
            onValueChange = { model.answers[field.code] = it },
            label = { Text(label) },
            placeholder = field.placeholder(locale)?.let { { Text(it) } },
            singleLine = field.type != "TEXTAREA",
            minLines = if (field.type == "TEXTAREA") 3 else 1,
            keyboardOptions = if (field.type == "NUMBER") KeyboardOptions(keyboardType = KeyboardType.Number) else KeyboardOptions.Default,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** Требование услуги — выбор документа из своего хранилища. */
@Composable
private fun RequirementPicker(requirement: ServiceDto.Requirement, model: ApplicationFormModel) {
    val colors = AppTheme.colors
    val locale = currentLocale()
    val options = model.documentsFor(requirement)
    var menu by remember { mutableStateOf(false) }
    val chosen = options.firstOrNull { it.id == model.attachments[requirement.id] }
    Column(
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        modifier = Modifier.fillMaxWidth().background(colors.card, RoundedCornerShape(Radius.xl)).padding(Spacing.lg),
    ) {
        Text(requirement.title(locale) + if (requirement.required) " *" else "", style = AppType.body, color = colors.foreground)
        requirement.description?.takeIf { it.isNotEmpty() }?.let { Text(it, style = AppType.meta, color = colors.mutedForeground) }
        if (options.isEmpty()) {
            Text(stringResource(R.string.applications_noSuitableDocuments), style = AppType.meta, color = colors.warning)
        } else {
            Box {
                Text(
                    chosen?.let { documentTitle(it) } ?: stringResource(R.string.applications_pickDocument),
                    style = AppType.meta,
                    color = colors.primary,
                    modifier = Modifier.clickable { menu = true }.padding(vertical = Spacing.sm),
                )
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    options.forEach { document ->
                        DropdownMenuItem(text = { Text(documentTitle(document)) }, onClick = {
                            model.attachments[requirement.id] = document.id
                            menu = false
                        })
                    }
                }
            }
        }
    }
}

@Composable
private fun documentTitle(document: DocumentDto): String =
    document.title ?: document.type ?: stringResource(R.string.more_documents)

/** Карточка заявки: статус, история, выданные результаты, отзыв. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApplicationDetailScreen(applicationId: String) {
    val services = LocalServices.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val model = viewModel { SectionModel<ApplicationDto> { services.applicationsApi.application(applicationId) } }
    val change by services.realtime.applicationStatus.collectAsStateWithLifecycle()
    // Статус сменился на сервере — перечитываем карточку.
    LaunchedEffect(change) { if (change?.id == applicationId) model.refresh() }
    var actionFailure by remember { mutableStateOf<String?>(null) }
    val colors = AppTheme.colors
    val locale = currentLocale()

    SectionScreen(stringResource(R.string.shell_application), model) { application ->
        actionFailure?.let { item { FormAlert(it) } }
        item(key = "head") {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text(application.service?.name(locale) ?: stringResource(R.string.applications_service), style = AppType.sectionTitle, color = colors.foreground)
                Text(
                    statusTitle(application.status),
                    style = AppType.body,
                    color = if (ApplicationStatus.isOpen(application.status)) colors.primary else colors.mutedForeground,
                )
                application.number?.let { Text(stringResource(R.string.applications_number, it), style = AppType.meta, color = colors.mutedForeground) }
                application.rejectionReason?.let { Text(it, style = AppType.meta, color = colors.destructive) }
                application.pickupLocation?.let { Text(it, style = AppType.meta, color = colors.foreground) }
                application.pickupInstructions?.let { Text(it, style = AppType.meta, color = colors.mutedForeground) }
            }
        }
        if (application.results.isNotEmpty()) {
            item(key = "results-title") { Text(stringResource(R.string.applications_result), style = AppType.sectionTitle, color = colors.foreground) }
            items(application.results, key = { "result-${it.id}" }) { result ->
                ListGroup {
                    ListRow(
                        title = result.documentNumber ?: stringResource(R.string.applications_openDocument),
                        icon = Icons.Outlined.Download,
                        subtitle = result.note,
                    ) {
                        scope.launch {
                            runCatching { services.applicationsApi.resultUrl(applicationId, result.id) }
                                .onSuccess { download(context, it, "${result.documentNumber ?: result.id}") }
                                .onFailure { actionFailure = it.displayMessage().resolve(context) }
                        }
                    }
                }
            }
        }
        if (application.events.isNotEmpty()) {
            item(key = "history-title") { Text(stringResource(R.string.applications_history), style = AppType.sectionTitle, color = colors.foreground) }
            items(application.events, key = { "event-${it.id}" }) { event ->
                Column(
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                    modifier = Modifier.fillMaxWidth().background(colors.card, RoundedCornerShape(Radius.xl)).padding(Spacing.lg),
                ) {
                    Text(event.toStatus?.let { statusTitle(it) } ?: event.action.orEmpty(), style = AppType.body, color = colors.foreground)
                    event.comment?.takeIf { it.isNotEmpty() }?.let { Text(it, style = AppType.meta, color = colors.mutedForeground) }
                    Text(formatDate(event.createdAt), style = AppType.meta, color = colors.mutedForeground)
                }
            }
        }
        if (ApplicationStatus.canCancel(application.status)) {
            item(key = "cancel") {
                QuietButton(stringResource(R.string.applications_cancelAction), color = colors.destructive, onClick = {
                    scope.launch {
                        runCatching { services.applicationsApi.cancel(applicationId, null) }
                            .onSuccess { model.refresh() }
                            .onFailure { actionFailure = it.displayMessage().resolve(context) }
                    }
                })
            }
        }
    }
}

/**
 * Документы, выданные вузом. Ссылка на файл запрашивается в момент сохранения: она
 * подписанная и короткоживущая, вчерашняя сегодня ведёт в отказ.
 */
@Composable
fun DocumentsScreen() {
    val services = LocalServices.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val model = viewModel { SectionModel { services.applicationsApi.documents() } }
    var actionFailure by remember { mutableStateOf<String?>(null) }
    val colors = AppTheme.colors

    SectionScreen(stringResource(R.string.more_documents), model) { documents ->
        actionFailure?.let { item { FormAlert(it) } }
        if (documents.isEmpty()) item { EmptyRow(stringResource(R.string.documents_empty)) }
        items(documents, key = { it.id }) { document ->
            Column(
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                modifier = Modifier.fillMaxWidth().background(colors.card, RoundedCornerShape(Radius.xl)).padding(Spacing.lg),
            ) {
                Text(documentTitle(document), style = AppType.cardTitle, color = colors.foreground)
                listOfNotNull(document.numberMasked, document.issuedBy).joinToString(" · ").takeIf { it.isNotEmpty() }?.let {
                    Text(it, style = AppType.meta, color = colors.mutedForeground)
                }
                if (document.files.isEmpty()) Text(stringResource(R.string.documents_noFiles), style = AppType.meta, color = colors.mutedForeground)
                document.files.forEachIndexed { index, file ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                scope.launch {
                                    runCatching { services.applicationsApi.documentFileUrl(document.id, file.id) }
                                        .onSuccess { download(context, it, "${document.title ?: document.id}-${index + 1}") }
                                        .onFailure { actionFailure = it.displayMessage().resolve(context) }
                                }
                            }
                            .padding(vertical = Spacing.sm),
                    ) {
                        Icon(Icons.Outlined.Download, null, tint = colors.primary, modifier = Modifier.size(18.dp))
                        Text(stringResource(R.string.applications_download), style = AppType.meta, color = colors.primary)
                    }
                }
            }
        }
    }
}

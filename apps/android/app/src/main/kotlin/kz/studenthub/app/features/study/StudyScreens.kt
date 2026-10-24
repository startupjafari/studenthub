package kz.studenthub.app.features.study

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Assignment
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import kz.studenthub.app.R
import kz.studenthub.app.core.model.Role
import kz.studenthub.app.core.navigation.AppRoute
import kz.studenthub.app.core.navigation.AppTab
import kz.studenthub.app.core.navigation.MoreSection
import kz.studenthub.app.core.study.AssignmentDto
import kz.studenthub.app.core.study.AttendanceSummaryDto
import kz.studenthub.app.core.study.CourseGradesDto
import kz.studenthub.app.core.study.MaterialDto
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.FormAlert
import kz.studenthub.app.designsystem.ListDivider
import kz.studenthub.app.designsystem.ListGroup
import kz.studenthub.app.designsystem.ListRow
import kz.studenthub.app.designsystem.PrimaryButton
import kz.studenthub.app.designsystem.Radius
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.designsystem.currentLocale
import kz.studenthub.app.shell.LocalServices
import kz.studenthub.app.shell.ScreenScaffold
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * Вкладка «Учёба». Структура одна для всех ролей, состав — по роли: преподаватель
 * вместо своей успеваемости ведёт журнал (тот же раздел, другой заголовок).
 */
@Composable
fun StudyScreen(role: Role) {
    val router = LocalServices.current.router
    ScreenScaffold(title = stringResource(AppTab.STUDY.title)) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(Spacing.xl)) {
            ListGroup {
                ListRow(stringResource(if (role == Role.TEACHER) R.string.study_gradebook else R.string.study_grades), Icons.Outlined.School) {
                    router.push(AppRoute.Section(MoreSection.GRADES))
                }
                ListDivider()
                ListRow(stringResource(R.string.study_attendance), Icons.Outlined.CheckCircle) {
                    router.push(AppRoute.Section(MoreSection.ATTENDANCE))
                }
                ListDivider()
                ListRow(stringResource(R.string.study_assignments), Icons.AutoMirrored.Outlined.Assignment) {
                    router.push(AppRoute.Section(MoreSection.ASSIGNMENTS))
                }
                ListDivider()
                ListRow(stringResource(R.string.study_materials), Icons.Outlined.Folder) {
                    router.push(AppRoute.Section(MoreSection.MATERIALS))
                }
            }
        }
    }
}

/** Каркас раздела-списка: обновление жестом, ошибка сверху, данные с прошлого раза не стираются. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> SectionScreen(title: String, model: SectionModel<T>, content: LazyListScope.(T) -> Unit) {
    LaunchedEffect(model) { model.refresh() }
    ScreenScaffold(title = title) {
        PullToRefreshBox(isRefreshing = model.isLoading, onRefresh = model::refreshNow, modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(Spacing.md),
                contentPadding = PaddingValues(Spacing.xl),
                modifier = Modifier.fillMaxSize(),
            ) {
                model.failure?.let { item(key = "failure") { FormAlert(it.resolve()) } }
                model.value?.let { content(it) }
            }
        }
    }
}

/** Оценки студента: дисциплины с долей набранного и точками. */
@Composable
fun GradesScreen() {
    val api = LocalServices.current.studyApi
    val model = viewModel { SectionModel<List<CourseGradesDto>> { api.grades() } }
    val locale = currentLocale()
    SectionScreen(stringResource(R.string.study_grades), model) { courses ->
        if (courses.isEmpty()) item { EmptyRow(stringResource(R.string.study_noGrades)) }
        items(courses, key = { it.courseId }) { course ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Row(Modifier.padding(horizontal = Spacing.sm)) {
                    Text(course.subject.name, style = AppType.sectionTitle, color = AppTheme.colors.foreground, modifier = Modifier.weight(1f))
                    course.ratio?.let { Text("${(it * 100).toInt()}%", style = AppType.tabular(AppType.meta), color = AppTheme.colors.primary) }
                }
                ListGroup {
                    course.columns.forEachIndexed { index, column ->
                        if (index > 0) ListDivider(inset = false)
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xl, vertical = Spacing.md),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(column.title, style = AppType.body, color = AppTheme.colors.foreground)
                                GradeFormat.kindTitle(column.kind)?.let {
                                    Text(stringResource(it), style = AppType.meta, color = AppTheme.colors.mutedForeground)
                                }
                            }
                            Text(
                                column.score?.let { GradeFormat.score(it, column.maxScore, locale) } ?: stringResource(R.string.study_noScore),
                                style = AppType.tabular(AppType.body),
                                color = if (column.score == null) AppTheme.colors.mutedForeground else AppTheme.colors.foreground,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Посещаемость студента: доля сверху, журнал занятий ниже. */
@Composable
fun AttendanceScreen() {
    val api = LocalServices.current.studyApi
    val model = viewModel { SectionModel<AttendanceSummaryDto> { api.attendance() } }
    SectionScreen(stringResource(R.string.study_attendance), model) { summary ->
        item(key = "summary") {
            ListGroup {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xl, vertical = Spacing.md),
                ) {
                    Text(stringResource(R.string.study_attendanceRate), style = AppType.body, color = AppTheme.colors.foreground, modifier = Modifier.weight(1f))
                    Text(summary.rate?.let { "${(it * 100).toInt()}%" } ?: "—", style = AppType.tabular(AppType.metric), color = AppTheme.colors.primary)
                }
                listOf("PRESENT", "LATE", "ABSENT", "EXCUSED").forEach { status ->
                    ListDivider(inset = false)
                    Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.xl, vertical = Spacing.md)) {
                        Text(attendanceTitle(status), style = AppType.body, color = AppTheme.colors.foreground, modifier = Modifier.weight(1f))
                        Text("${summary.counts[status] ?: 0}", style = AppType.tabular(AppType.body), color = AppTheme.colors.mutedForeground)
                    }
                }
            }
        }
        if (summary.records.isNotEmpty()) {
            item(key = "log") {
                Text(stringResource(R.string.study_attendanceLog), style = AppType.sectionTitle, color = AppTheme.colors.foreground, modifier = Modifier.padding(top = Spacing.md))
            }
        }
        items(summary.records, key = { it.id }) { record ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.card, RoundedCornerShape(Radius.xl))
                    .padding(horizontal = Spacing.xl, vertical = Spacing.md),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(record.pair?.subject ?: stringResource(R.string.study_lesson), style = AppType.body, color = AppTheme.colors.foreground)
                    Text(formatDate(record.date), style = AppType.meta, color = AppTheme.colors.mutedForeground)
                }
                Text(attendanceTitle(record.status), style = AppType.meta, color = attendanceColor(record.status))
            }
        }
    }
}

@Composable
fun attendanceTitle(status: String): String = when (status) {
    "PRESENT" -> stringResource(R.string.study_present)
    "LATE" -> stringResource(R.string.study_late)
    "ABSENT" -> stringResource(R.string.study_absent)
    "EXCUSED" -> stringResource(R.string.study_excused)
    else -> status
}

@Composable
fun attendanceColor(status: String): Color = when (status) {
    "ABSENT" -> AppTheme.colors.destructive
    "LATE" -> AppTheme.colors.warning
    "EXCUSED" -> AppTheme.colors.info
    else -> AppTheme.colors.success
}

@Composable
private fun formatDate(instant: Instant): String =
    instant.atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(currentLocale()))

@Composable
private fun formatDateTime(instant: Instant): String =
    instant.atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(currentLocale()))

/** Задания студента: что сдано, что на проверке, что просрочено. */
@Composable
fun AssignmentsScreen() {
    val services = LocalServices.current
    val model = viewModel { SectionModel<List<AssignmentDto>> { services.studyApi.assignments() } }
    SectionScreen(stringResource(R.string.study_assignments), model) { assignments ->
        if (assignments.isEmpty()) item { EmptyRow(stringResource(R.string.study_noAssignments)) }
        items(assignments, key = { it.id }) { assignment ->
            AssignmentRow(assignment) { services.router.push(AppRoute.Assignment(assignment.id)) }
        }
    }
}

@Composable
private fun AssignmentRow(assignment: AssignmentDto, onOpen: () -> Unit) {
    val colors = AppTheme.colors
    Column(
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.card, RoundedCornerShape(Radius.xl))
            .clickable(onClick = onOpen)
            .padding(Spacing.lg),
    ) {
        Text(assignment.title, style = AppType.cardTitle, color = colors.foreground)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
            assignment.subject?.let { Text(it, style = AppType.meta, color = colors.mutedForeground) }
            assignment.dueAt?.let { due ->
                // Просроченное выделяем цветом: это единственное, что ищут глазами.
                val overdue = due.isBefore(Instant.now())
                Icon(Icons.Outlined.Schedule, null, tint = if (overdue) colors.destructive else colors.mutedForeground, modifier = Modifier.size(14.dp))
                Text(formatDateTime(due), style = AppType.meta, color = if (overdue) colors.destructive else colors.mutedForeground)
            }
        }
        Text(SubmissionState.of(assignment).title.resolve(), style = AppType.meta, color = colors.primary)
    }
}

/** Карточка задания со сдачей: текст и ссылка — то, что принимает сервер. */
@Composable
fun AssignmentDetailScreen(assignmentId: String) {
    val services = LocalServices.current
    val list = viewModel { SectionModel<List<AssignmentDto>> { services.studyApi.assignments() } }
    val submission = viewModel { SubmissionModel(assignmentId, services.studyApi) }
    val scope = rememberCoroutineScope()
    val assignment = list.value?.firstOrNull { it.id == assignmentId }
    LaunchedEffect(Unit) { list.refresh() }
    LaunchedEffect(assignment) { assignment?.let(submission::prefill) }

    ScreenScaffold(title = stringResource(R.string.study_assignment)) {
        Column(
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(Spacing.xl),
        ) {
            (submission.failure ?: list.failure)?.let { FormAlert(it.resolve()) }
            if (assignment != null) {
                Text(assignment.title, style = AppType.sectionTitle, color = AppTheme.colors.foreground)
                assignment.description?.takeIf { it.isNotEmpty() }?.let {
                    Text(it, style = AppType.body, color = AppTheme.colors.mutedForeground)
                }
                Text(SubmissionState.of(assignment).title.resolve(), style = AppType.meta, color = AppTheme.colors.primary)
                assignment.mySubmission?.feedback?.takeIf { it.isNotEmpty() }?.let {
                    Text(it, style = AppType.meta, color = AppTheme.colors.foreground)
                }
                Text(stringResource(R.string.study_yourWork), style = AppType.sectionTitle, color = AppTheme.colors.foreground)
                OutlinedTextField(
                    value = submission.text,
                    onValueChange = { submission.text = it },
                    label = { Text(stringResource(R.string.study_answer)) },
                    minLines = 3,
                    maxLines = 10,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = submission.link,
                    onValueChange = { submission.link = it },
                    label = { Text(stringResource(R.string.study_link)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth(),
                )
                PrimaryButton(
                    text = stringResource(if (submission.isSending) R.string.study_sending else R.string.study_submit),
                    isLoading = submission.isSending,
                    onClick = { scope.launch { if (submission.submit()) list.refresh() } },
                )
            }
        }
    }
}

/** Материалы: файлы открывает системный просмотрщик по подписанной ссылке. */
@Composable
fun MaterialsScreen() {
    val services = LocalServices.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val model = viewModel { SectionModel<List<MaterialDto>> { services.studyApi.materials() } }
    SectionScreen(stringResource(R.string.study_materials), model) { materials ->
        if (materials.isEmpty()) item { EmptyRow(stringResource(R.string.study_noMaterials)) }
        items(materials, key = { it.id }) { material ->
            Column(
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                modifier = Modifier
                    .fillMaxWidth()
                    .background(AppTheme.colors.card, RoundedCornerShape(Radius.xl))
                    .padding(Spacing.lg),
            ) {
                Text(material.title, style = AppType.cardTitle, color = AppTheme.colors.foreground)
                material.subject?.let { Text(it, style = AppType.meta, color = AppTheme.colors.mutedForeground) }
                material.description?.takeIf { it.isNotEmpty() }?.let { Text(it, style = AppType.meta, color = AppTheme.colors.mutedForeground) }
                material.files.orEmpty().forEach { file ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                        modifier = Modifier
                            .heightIn(min = 40.dp)
                            .clickable {
                                scope.launch {
                                    val url = runCatching { services.studyApi.materialFileUrl(material.id, file.id) }.getOrNull() ?: return@launch
                                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }
                                }
                            },
                    ) {
                        Icon(Icons.Outlined.Description, null, tint = AppTheme.colors.primary, modifier = Modifier.size(18.dp))
                        Text(file.name ?: stringResource(R.string.chats_file), style = AppType.meta, color = AppTheme.colors.primary)
                    }
                }
            }
        }
    }
}

/**
 * Отметка посещаемости преподавателем — под один жест: «пришли все, кроме двоих».
 * Поэтому сверху «все присутствуют», а дальше правятся исключения.
 */
@Composable
fun AttendanceMarkingScreen(pairId: String) {
    val api = LocalServices.current.studyApi
    val model = viewModel { AttendanceMarkingModel(pairId, api) }
    LaunchedEffect(Unit) { model.load() }
    val statuses = listOf("PRESENT", "LATE", "ABSENT", "EXCUSED")

    ScreenScaffold(
        title = stringResource(R.string.study_attendance),
        actions = {
            TextButton(onClick = model::saveNow, enabled = !model.isSaving) {
                Text(stringResource(R.string.common_save), color = AppTheme.colors.primary)
            }
        },
    ) {
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
            contentPadding = PaddingValues(Spacing.xl),
            modifier = Modifier.fillMaxSize(),
        ) {
            model.failure?.let { item { FormAlert(it.resolve()) } }
            if (model.saved) {
                item { Text(stringResource(R.string.study_saved), style = AppType.meta, color = AppTheme.colors.success) }
            }
            item {
                ListGroup { ListRow(stringResource(R.string.study_markAllPresent), Icons.Outlined.CheckCircle) { model.markAllPresent() } }
            }
            items(model.students, key = { it.id }) { student ->
                Column(
                    verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(AppTheme.colors.card, RoundedCornerShape(Radius.xl))
                        .padding(Spacing.lg),
                ) {
                    Text(student.name, style = AppType.body, color = AppTheme.colors.foreground)
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        statuses.forEach { status ->
                            val active = model.statuses[student.id] == status
                            val color = attendanceColor(status)
                            Text(
                                attendanceTitle(status),
                                style = AppType.meta,
                                color = if (active) color else AppTheme.colors.mutedForeground,
                                modifier = Modifier
                                    .background(if (active) color.copy(alpha = 0.15f) else AppTheme.colors.muted, CircleShape)
                                    .clickable { model.set(status, student.id) }
                                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Карточка пары для студента: всё, что есть о ней в расписании, — время, место,
 * преподаватель и сегодняшние изменения. Открывается без сети: данные из базы.
 */
@Composable
fun LessonScreen(pairId: String) {
    val services = LocalServices.current
    val pair = androidx.compose.runtime.produceState<kz.studenthub.app.core.storage.PairEntity?>(null, pairId) {
        value = services.database.schedule().pair(pairId)
    }.value
    ScreenScaffold(title = stringResource(R.string.shell_lesson)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.padding(Spacing.xl)) {
            if (pair == null) {
                EmptyRow(stringResource(R.string.shell_placeholder))
                return@Column
            }
            Text(pair.subject, style = AppType.pageTitle, color = AppTheme.colors.foreground)
            Text("${pair.startTime}–${pair.endTime}", style = AppType.tabular(AppType.body), color = AppTheme.colors.foreground)
            pair.roomName?.let { Text(it, style = AppType.body, color = AppTheme.colors.mutedForeground) }
            pair.teacherName?.let { Text(it, style = AppType.body, color = AppTheme.colors.mutedForeground) }
        }
    }
}

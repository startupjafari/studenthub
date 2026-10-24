package kz.studenthub.app.features.study

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kz.studenthub.app.R
import kz.studenthub.app.core.navigation.AppRoute
import kz.studenthub.app.core.navigation.AppTab
import kz.studenthub.app.core.study.WeekParity
import kz.studenthub.app.designsystem.AppTheme
import kz.studenthub.app.designsystem.AppType
import kz.studenthub.app.designsystem.FormAlert
import kz.studenthub.app.designsystem.Radius
import kz.studenthub.app.designsystem.Spacing
import kz.studenthub.app.designsystem.currentLocale
import kz.studenthub.app.shell.LocalServices
import kz.studenthub.app.shell.ScreenScaffold
import java.time.DayOfWeek
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle

/**
 * Расписание: неделя полосой дней, под ней — пары выбранного дня. Неделя сеткой, как в
 * вебе, на телефоне не читается: семь колонок по восемь пар превращаются в мозаику.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleScreen() {
    val services = LocalServices.current
    val context = LocalContext.current
    val model = viewModel { ScheduleModel(services.database, services.studyApi, ScheduleModel.prefs(context.applicationContext)) }
    val day by model.day.collectAsStateWithLifecycle()
    val parity by model.parity.collectAsStateWithLifecycle()
    val pairs by model.pairs.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { model.refresh() }

    ScreenScaffold(
        title = stringResource(AppTab.SCHEDULE.title),
        actions = {
            TextButton(onClick = model::toggleParity) {
                Text(
                    stringResource(if (parity == WeekParity.ODD) R.string.schedule_oddWeek else R.string.schedule_evenWeek),
                    style = AppType.meta,
                    color = AppTheme.colors.primary,
                )
            }
        },
    ) {
        DayStrip(selected = day, onSelect = model::select)
        PullToRefreshBox(isRefreshing = model.isRefreshing, onRefresh = model::refreshNow, modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(Spacing.md),
                contentPadding = PaddingValues(Spacing.xl),
                modifier = Modifier.fillMaxSize(),
            ) {
                model.failure?.let { item(key = "failure") { FormAlert(it.resolve()) } }
                items(pairs.orEmpty(), key = { it.id }) { item ->
                    // Пара — в дату выбранного дня, а не сегодня: отметку сервер примет только на неё.
                    PairRow(item) { services.router.push(AppRoute.Lesson(item.id, model.dateOf(day))) }
                }
                if (pairs?.isEmpty() == true) {
                    item(key = "empty") { EmptyRow(stringResource(R.string.schedule_empty)) }
                }
                model.syncedAt?.let { synced ->
                    item(key = "synced") {
                        val formatted = synced.atZone(ZoneId.systemDefault())
                            .format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(currentLocale()))
                        Text(
                            stringResource(R.string.schedule_syncedAt, formatted),
                            style = AppType.meta,
                            color = AppTheme.colors.mutedForeground,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
}

/** Полоса дней недели. Названия дней — системные, на языке телефона. */
@Composable
private fun DayStrip(selected: Int, onSelect: (Int) -> Unit) {
    val colors = AppTheme.colors
    val locale = currentLocale()
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xl, vertical = Spacing.md),
    ) {
        (1..7).forEach { day ->
            val active = day == selected
            Text(
                DayOfWeek.of(day).getDisplayName(TextStyle.SHORT_STANDALONE, locale).replaceFirstChar { it.titlecase(locale) },
                style = AppType.meta,
                color = if (active) colors.primary else colors.mutedForeground,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .weight(1f)
                    .background(if (active) colors.primary.copy(alpha = 0.1f) else colors.muted, RoundedCornerShape(Radius.md))
                    .clickable(role = Role.Tab) { onSelect(day) }
                    .semantics { this.selected = active }
                    // Высота от содержимого: при крупном шрифте фиксированная обрезала бы подпись.
                    .padding(vertical = Spacing.md),
            )
        }
    }
}

/** Строка пары: время слева, предмет и место справа. */
@Composable
private fun PairRow(item: SchedulePair, onOpen: () -> Unit) {
    val colors = AppTheme.colors
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.card, RoundedCornerShape(Radius.xl))
            .clickable(onClick = onOpen)
            .padding(Spacing.lg),
    ) {
        Column(Modifier.width(56.dp)) {
            Text(item.startTime, style = AppType.tabular(AppType.body), color = colors.foreground)
            Text(item.endTime, style = AppType.tabular(AppType.meta), color = colors.mutedForeground)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs), modifier = Modifier.weight(1f)) {
            Text(
                item.pair.subject,
                style = AppType.cardTitle,
                color = if (item.isCancelled) colors.mutedForeground else colors.foreground,
                textDecoration = if (item.isCancelled) TextDecoration.LineThrough else null,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                item.teacherName?.let { Meta(Icons.Outlined.Person, it) }
                item.roomName?.let { Meta(Icons.Outlined.Place, it) }
            }
            item.changeNote?.let { Text(it.resolve(), style = AppType.meta, color = colors.warning) }
        }
    }
}

@Composable
private fun Meta(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(icon, null, tint = AppTheme.colors.mutedForeground, modifier = Modifier.size(14.dp))
        Text(text, style = AppType.meta, color = AppTheme.colors.mutedForeground)
    }
}

/** Пустой раздел: короткая фраза по центру, а не пустота, которую читают как поломку. */
@Composable
fun EmptyRow(text: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = Spacing.xxl), contentAlignment = Alignment.Center) {
        Text(text, style = AppType.body, color = AppTheme.colors.mutedForeground, textAlign = TextAlign.Center)
    }
}

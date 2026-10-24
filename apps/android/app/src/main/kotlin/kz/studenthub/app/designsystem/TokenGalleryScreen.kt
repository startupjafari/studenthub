package kz.studenthub.app.designsystem

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/**
 * Витрина дизайн-ядра: цвет, типографика, радиусы, движение, формы — на устройстве, в
 * обеих темах и на любом масштабе шрифта. Аналог `/_dev/design-system` веба; доступна
 * только в отладочной сборке, тексты в ней служебные и не переводятся.
 */
@Composable
fun TokenGalleryScreen(onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    val colors = AppTheme.colors
    val reduceMotion = rememberReduceMotion()
    var nudged by remember { mutableStateOf(false) }
    var sample by remember { mutableStateOf("") }
    var invalid by remember { mutableStateOf(false) }
    val offset by animateDpAsState(if (nudged) 120.dp else 0.dp, Motion.respecting(Motion.lively(), reduceMotion), label = "nudge")

    Column(
        verticalArrangement = Arrangement.spacedBy(Spacing.xxl),
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.xl),
    ) {
        Text("Дизайн-ядро", style = AppType.pageTitle, color = colors.foreground)
        Swatches("Поверхности", listOf("background" to colors.background, "card" to colors.card, "muted" to colors.muted, "border" to colors.border))
        Swatches("Действия", listOf("primary" to colors.primary, "secondary" to colors.secondary, "accent" to colors.accent, "ring" to colors.ring))
        Swatches("Статусы", listOf("success" to colors.success, "warning" to colors.warning, "info" to colors.info, "destructive" to colors.destructive))

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text("Типографика", style = AppType.sectionTitle, color = colors.foreground)
            Text("Заголовок экрана", style = AppType.pageTitle, color = colors.foreground)
            Text("Заголовок секции", style = AppType.sectionTitle, color = colors.foreground)
            Text("Основной текст", style = AppType.body, color = colors.foreground)
            Text("Вторичный текст", style = AppType.meta, color = colors.mutedForeground)
            Text("1 234", style = AppType.tabular(AppType.metric), color = colors.foreground)
        }

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            Text("Радиусы", style = AppType.sectionTitle, color = colors.foreground)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                listOf(Radius.sm, Radius.md, Radius.xl, Radius.xxl).forEach {
                    Box(Modifier.size(ControlHeight.island).border(1.dp, colors.input, RoundedCornerShape(it)))
                }
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            Text("Движение", style = AppType.sectionTitle, color = colors.foreground)
            Box(Modifier.offset { IntOffset(offset.roundToPx(), 0) }.size(ControlHeight.island).background(colors.primary, RoundedCornerShape(Radius.xl)))
            QuietButton("Толкнуть пружиной", onClick = { nudged = !nudged })
        }

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            Text("Формы", style = AppType.sectionTitle, color = colors.foreground)
            FieldLabel("Поле")
            FormField(value = sample, onValueChange = { sample = it }, label = "Поле", placeholder = "Поле", isInvalid = invalid)
            FieldError(if (invalid) "Так выглядит ошибка поля" else null)
            FormAlert("Так выглядит ошибка формы")
            PrimaryButton("Основное действие", onClick = { invalid = !invalid })
            PrimaryButton("Загрузка", onClick = {}, isLoading = true)
            QuietButton("Закрыть витрину", onClick = onClose)
        }
    }
}

@Composable
private fun Swatches(title: String, items: List<Pair<String, Color>>) {
    val colors = AppTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        Text(title, style = AppType.sectionTitle, color = colors.foreground)
        items.forEach { (name, color) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Box(
                    Modifier
                        .size(ControlHeight.xl)
                        .background(color, RoundedCornerShape(Radius.md))
                        .border(1.dp, colors.border, RoundedCornerShape(Radius.md)),
                )
                Text(name, style = AppType.body, color = colors.foreground)
            }
        }
    }
}

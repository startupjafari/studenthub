package kz.studenthub.app.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

private val LocalPalette = staticCompositionLocalOf { Palette.Light }

/** Доступ к токенам из экранов: `AppTheme.colors.mutedForeground`. */
object AppTheme {
    val colors: Palette
        @Composable @ReadOnlyComposable
        get() = LocalPalette.current
}

/**
 * Тема приложения: Material 3 как набор компонентов, а цвета, шрифты и формы — наши.
 *
 * Dynamic Color выключен намеренно (план, «Архитектурные решения»): цвета обоев
 * перекрасили бы статусные токены, и «одобрено» с «отклонено» перестали бы читаться.
 * Компоненты Material, которые экраны берут как есть (диалоги, нижняя панель,
 * переключатели), получают схему, собранную из тех же токенов.
 */
@Composable
fun StudentHubTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val palette = if (darkTheme) Palette.Dark else Palette.Light
    CompositionLocalProvider(LocalPalette provides palette) {
        MaterialTheme(
            colorScheme = palette.toColorScheme(darkTheme),
            typography = MaterialTypography,
            shapes = MaterialShapes,
            content = content,
        )
    }
}

private fun Palette.toColorScheme(dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = primary,
        onPrimary = primaryForeground,
        primaryContainer = accent,
        onPrimaryContainer = accentForeground,
        secondary = secondaryForeground,
        onSecondary = secondary,
        secondaryContainer = secondary,
        onSecondaryContainer = secondaryForeground,
        background = background,
        onBackground = foreground,
        surface = background,
        onSurface = foreground,
        surfaceVariant = muted,
        onSurfaceVariant = mutedForeground,
        surfaceContainerLowest = card,
        surfaceContainerLow = card,
        surfaceContainer = card,
        surfaceContainerHigh = popover,
        surfaceContainerHighest = muted,
        error = destructive,
        onError = primaryForeground,
        outline = input,
        outlineVariant = border,
        scrim = overlay,
    )
}

private val MaterialTypography = Typography(
    titleLarge = AppType.pageTitle,
    titleMedium = AppType.sectionTitle,
    titleSmall = AppType.cardTitle,
    bodyLarge = AppType.body,
    bodyMedium = AppType.body,
    bodySmall = AppType.meta,
    labelLarge = AppType.cardTitle,
    labelMedium = AppType.meta,
    labelSmall = AppType.meta,
)

private val MaterialShapes = Shapes(
    extraSmall = RoundedCornerShape(Radius.sm),
    small = RoundedCornerShape(Radius.md),
    medium = RoundedCornerShape(Radius.xl),
    large = RoundedCornerShape(Radius.xxl),
    extraLarge = RoundedCornerShape(Radius.xxxl),
)

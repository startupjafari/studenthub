import SwiftUI

/// Токены цвета StudentHub.
///
/// Имена повторяют `globals.css` один в один, значения скопированы оттуда же
/// (DESIGN_SYSTEM §2.1). Светлая и тёмная темы — две записи одного токена, поэтому
/// в экранах тема не упоминается: `Palette.card` верен в обеих.
///
/// Статусные токены (`success`, `warning`, `info` и их пары) в `.dark` не
/// переопределены — тёмная тема наследует светлые значения. Это не упущение
/// переноса, а то, как устроен веб; разойдётся там — поправим здесь.
enum Palette {
    // Поверхности
    static let background = token(light: OKLCH(1, 0, 0), dark: OKLCH(0.177, 0.009, 264.3))
    static let foreground = token(light: OKLCH(0.145, 0, 0), dark: OKLCH(0.967, 0.003, 264.5))
    static let card = token(light: OKLCH(1, 0, 0), dark: OKLCH(0.214, 0.019, 266.1))
    static let cardForeground = token(light: OKLCH(0.145, 0, 0), dark: OKLCH(0.967, 0.003, 264.5))
    static let popover = token(light: OKLCH(1, 0, 0), dark: OKLCH(0.214, 0.019, 266.1))
    static let popoverForeground = token(light: OKLCH(0.145, 0, 0), dark: OKLCH(0.967, 0.003, 264.5))
    /// Подложка модальных окон: затемняет фон в обеих темах.
    static let overlay = token(light: OKLCH(0.145, 0, 0), dark: OKLCH(0.09, 0.008, 264.3))

    // Действия
    static let primary = token(light: OKLCH(0.546, 0.215, 262.9), dark: OKLCH(0.573, 0.188, 259.8))
    static let primaryForeground = token(OKLCH(1, 0, 0))
    static let secondary = token(light: OKLCH(0.967, 0.003, 264.5), dark: OKLCH(0.261, 0.024, 267.1))
    static let secondaryForeground = token(light: OKLCH(0.205, 0, 0), dark: OKLCH(0.967, 0.003, 264.5))
    static let accent = token(light: OKLCH(0.967, 0.003, 264.5), dark: OKLCH(0.261, 0.024, 267.1))
    static let accentForeground = token(light: OKLCH(0.205, 0, 0), dark: OKLCH(0.967, 0.003, 264.5))

    // Приглушённое
    static let muted = token(light: OKLCH(0.967, 0.003, 264.5), dark: OKLCH(0.261, 0.024, 267.1))
    static let mutedForeground = token(light: OKLCH(0.545, 0.023, 264.4), dark: OKLCH(0.714, 0.019, 261.3))

    // Статусы
    static let destructive = token(light: OKLCH(0.561, 0.208, 25.3), dark: OKLCH(0.711, 0.166, 22.2))
    static let success = token(OKLCH(0.522, 0.114, 162.5))
    static let successForeground = token(OKLCH(1, 0, 0))
    static let warning = token(OKLCH(0.543, 0.119, 70.1))
    static let warningForeground = token(OKLCH(0.145, 0, 0))
    static let info = token(OKLCH(0.543, 0.188, 259.8))
    static let infoForeground = token(OKLCH(1, 0, 0))

    // Линии и фокус
    static let border = token(light: OKLCH(0.928, 0.006, 264.5), dark: OKLCH(0.311, 0.022, 259.4))
    static let input = token(light: OKLCH(0.668, 0.006, 264.5), dark: OKLCH(0.49, 0.025, 260.1))
    static let ring = token(light: OKLCH(0.546, 0.215, 262.9), dark: OKLCH(0.623, 0.188, 259.8))

    // Данные
    static let chart1 = token(light: OKLCH(0.546, 0.215, 262.9), dark: OKLCH(0.623, 0.188, 259.8))
    static let chart2 = token(light: OKLCH(0.623, 0.188, 259.8), dark: OKLCH(0.546, 0.215, 262.9))
    static let chart3 = token(OKLCH(0.696, 0.149, 162.5))
    static let chart4 = token(OKLCH(0.769, 0.165, 70.1))
    static let chart5 = token(light: OKLCH(0.637, 0.208, 25.3), dark: OKLCH(0.711, 0.166, 22.2))

    private static func token(light: OKLCH, dark: OKLCH) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark.uiColor : light.uiColor
        })
    }

    /// Токен, одинаковый в обеих темах.
    private static func token(_ both: OKLCH) -> Color {
        Color(uiColor: both.uiColor)
    }
}

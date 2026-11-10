import SwiftUI

/// Токены цвета StudentHub.
///
/// Имена повторяют `globals.css` (DESIGN_SYSTEM §2.1), но значения поверхностей, текста,
/// линий и статусов — системные цвета iOS, а не копия веба. Так приложение выглядит как
/// iOS 26: сгруппированные списки, материалы и Liquid Glass рассчитаны на системные фоны,
/// и под чужой серо-синий фон стекло и края прокрутки смотрятся инородно. Системные цвета
/// сами подстраиваются под тему, повышенный контраст и затемнение фона под листом.
///
/// От веба остаётся фирменный синий (`primary`, `ring`, графики) — им тонируются акценты,
/// стеклянные кнопки и выбранные элементы.
enum Palette {
    // Поверхности
    static let background = Color(uiColor: .systemGroupedBackground)
    /// Фон «плоских» экранов: список чатов, переписка, расписание — как системный
    /// `.plain`-список, без серой подложки сгруппированного.
    static let plainBackground = Color(uiColor: .systemBackground)
    static let foreground = Color(uiColor: .label)
    /// Карточка на фоне экрана — как ячейка сгруппированного списка.
    static let card = Color(uiColor: .secondarySystemGroupedBackground)
    static let cardForeground = Color(uiColor: .label)
    static let popover = Color(uiColor: .secondarySystemGroupedBackground)
    static let popoverForeground = Color(uiColor: .label)
    /// Подложка модальных окон: затемняет фон в обеих темах.
    static let overlay = Color.black

    // Действия
    static let primary = token(light: OKLCH(0.546, 0.215, 262.9), dark: OKLCH(0.623, 0.188, 259.8))
    static let primaryForeground = Color.white
    static let secondary = Color(uiColor: .secondarySystemFill)
    static let secondaryForeground = Color(uiColor: .label)
    static let accent = Color(uiColor: .tertiarySystemFill)
    static let accentForeground = Color(uiColor: .label)

    // Приглушённое
    /// Заливка вторичных элементов: капсулы, плашки, поля поиска.
    static let muted = Color(uiColor: .tertiarySystemFill)
    static let mutedForeground = Color(uiColor: .secondaryLabel)

    // Статусы — системные: зелёный, оранжевый, красный и синий iOS узнаются сразу.
    static let destructive = Color(uiColor: .systemRed)
    static let success = Color(uiColor: .systemGreen)
    static let successForeground = Color.white
    static let warning = Color(uiColor: .systemOrange)
    static let warningForeground = Color.white
    static let info = Color(uiColor: .systemBlue)
    static let infoForeground = Color.white

    // Линии и фокус
    static let border = Color(uiColor: .separator)
    static let input = Color(uiColor: .tertiaryLabel)
    static let ring = token(light: OKLCH(0.546, 0.215, 262.9), dark: OKLCH(0.623, 0.188, 259.8))

    // Данные
    static let chart1 = token(light: OKLCH(0.546, 0.215, 262.9), dark: OKLCH(0.623, 0.188, 259.8))
    static let chart2 = Color(uiColor: .systemIndigo)
    static let chart3 = Color(uiColor: .systemTeal)
    static let chart4 = Color(uiColor: .systemYellow)
    static let chart5 = Color(uiColor: .systemRed)

    private static func token(light: OKLCH, dark: OKLCH) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark.uiColor : light.uiColor
        })
    }
}

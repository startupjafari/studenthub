import SwiftUI

/// Типографические роли (DESIGN_SYSTEM §3).
///
/// Два осознанных отступления от веба, оба в пользу платформы:
///
/// 1. Гарнитура — системная SF, а не Inter. Inter пришлось бы класть в бандл
///    отдельным ресурсом, и он потерял бы оптические размеры и начертания, которые
///    SF даёт на всех кеглях Dynamic Type.
/// 2. Роли привязаны к стилям текста iOS, а не к пикселям веба. Перенести `text-sm`
///    как 14 pt значило бы сделать приложение мельче всего остального на телефоне и
///    лишить его Dynamic Type — требования приёмки фазы.
///
/// Правило «не больше трёх уровней на экран» переносится без изменений: заголовок
/// страницы, заголовок блока, текст. Остальное — вес и цвет.
enum Typography {
    /// Заголовок экрана. Веб: `text-lg font-bold`.
    static let pageTitle = Font.system(.title3, weight: .bold)
    /// Заголовок секции и диалога. Веб: `text-base font-semibold`.
    static let sectionTitle = Font.system(.headline)
    /// Заголовок карточки. Веб: `text-base font-medium`.
    static let cardTitle = Font.system(.body, weight: .medium)
    /// Основной текст: тело карточек, строки списков, поля. Веб: `text-sm`.
    static let body = Font.system(.body)
    /// Вторичный и мета-текст: даты, счётчики, подписи. Веб: `text-xs`.
    static let meta = Font.system(.footnote)
    /// Крупное число в плитке. Веб: `text-2xl font-semibold`.
    static let metric = Font.system(.title2, weight: .semibold)

    // MARK: Текст с разметкой — пузырь сообщения и статья (IOS_RULES 7.5.12)
    // Одна таблица на все поверхности: при первой правке типографики пузырь, статья и
    // предпросмотр в редакторе иначе разошлись бы.

    /// Код в пузыре сообщения: моноширинный, на ступень мельче текста — строки кода длинные.
    static let messageCode = Font.system(.subheadline, design: .monospaced)
    /// Код в статье: блок прокручивается вбок, кегль ещё мельче.
    static let articleCode = Font.system(.footnote, design: .monospaced)
    /// Подпись языка и значок «скопировать» над блоком кода — текстовый стиль, без
    /// ручных размеров (7.6.15).
    static let codeLabel = Font.caption.weight(.semibold)

    /// Заголовок статьи по числу `#`: первый уровень крупнее заголовка экрана — это
    /// заголовок текста, а не интерфейса.
    static func articleHeading(level: Int) -> Font {
        switch level {
        case ...1: .title2.weight(.bold)
        case 2: .title3.weight(.semibold)
        default: .headline
        }
    }

    /// Моноширинные цифры для колонок и счётчиков: иначе числа «пляшут» при
    /// обновлении. Одиночное крупное число — наоборот, пропорциональными.
    static func tabular(_ font: Font) -> Font { font.monospacedDigit() }
}

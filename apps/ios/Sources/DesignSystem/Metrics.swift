import CoreGraphics

/// Отступы (DESIGN_SYSTEM §4). База — 4 pt, лестница 1 · 1.5 · 2 · 3 · 4 · 6.
/// Промежуточных значений в системе нет; нужен зазор между `lg` и `xl` — значит,
/// неверно выбран один из них.
enum Spacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 6
    static let md: CGFloat = 8
    static let lg: CGFloat = 12
    static let xl: CGFloat = 16
    static let xxl: CGFloat = 24
}

/// Высота контролов (DESIGN_SYSTEM §4). Ровно четыре размера: одинаковый размер
/// означает одинаковую высоту у кнопки, поля и селекта. Ширину задаёт содержимое.
enum ControlHeight {
    static let sm: CGFloat = 32
    static let md: CGFloat = 36
    /// По умолчанию.
    static let lg: CGFloat = 40
    /// Совпадает с минимальной целью касания Apple HIG — 44 pt.
    static let xl: CGFloat = 44

    /// Плавающие острова у нижнего края: нижняя навигация, её меню и поиск.
    static let island: CGFloat = 56
    /// Панель ввода чата — осознанное исключение из высоты островов: нижняя
    /// навигация в открытом чате скрыта, совпадать ей не с чем, а 56 pt рядом с
    /// телеграмным эталоном в голове у человека читаются как непомерные.
    static let chatInput: CGFloat = 48
}

/// Радиусы (DESIGN_SYSTEM §5.1). Вся шкала считается от корня: менять производные
/// по отдельности нельзя, форма системы задаётся одним числом.
enum Radius {
    /// `--radius: 0.625rem`.
    static let root: CGFloat = 10

    /// Мелкое: чекбокс, скелетон.
    static let sm: CGFloat = root * 0.6
    /// Вложенное в контрол: активная вкладка, квадрат ведущей иконки, пункт меню.
    static let md: CGFloat = root * 0.8
    static let lg: CGFloat = root
    /// Контролы и поверхности: кнопка, поле, карточка, поповер.
    static let xl: CGFloat = root * 1.4
    /// Модалка и нижний лист.
    static let xxl: CGFloat = root * 1.8
    static let xxxl: CGFloat = root * 2.2

    /// Правило вложенности: внутренний элемент скругляется на ступень меньше
    /// внешнего — иначе угол выглядит «съеденным».
    static func nested(_ outer: CGFloat) -> CGFloat { max(outer - 4, sm) }
}

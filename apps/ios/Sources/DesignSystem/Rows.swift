import SwiftUI

/// Строки списков: настройки, сервисы, пункты профиля.
///
/// Ведущая иконка — белый символ на цветном квадрате, как в системных «Настройках»
/// и Telegram: по цвету пункт находят глазами раньше, чем прочитают подпись. Цвет —
/// подсказка, а не единственный носитель смысла: подпись есть всегда.
struct IconTile: View {
    let symbol: String
    var tint: Color = Palette.primary
    var size: CGFloat = 30

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.5, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(tint.gradient, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Строка «иконка — подпись — значение». Значение справа приглушено и не переносит
/// подпись: длинное ФИО или название уходит под подпись строкой ниже.
struct IconRow: View {
    let title: String
    let symbol: String
    var tint: Color = Palette.primary
    var subtitle: String?
    var value: String?

    var body: some View {
        HStack(spacing: Spacing.lg) {
            IconTile(symbol: symbol, tint: tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: Spacing.md)
            if let value, !value.isEmpty {
                Text(value)
                    .font(Typography.body)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Пара «подпись — значение» для карточек сведений: занятие, профиль, заявка.
/// Значение переносится целиком: обрезанная аудитория или ФИО бесполезны.
struct DetailRow: View {
    let title: String
    let value: String
    var symbol: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.lg) {
            if let symbol {
                Image(systemName: symbol)
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(width: 22)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                Text(value)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Цвета ведущих иконок. Набор закрытый: десятый оттенок уже не различается, а
/// одинаковые разделы в разных списках должны быть одного цвета.
enum TileTint {
    static let blue = Palette.primary
    static let green = Palette.success
    static let orange = Palette.warning
    static let red = Palette.destructive
    static let teal = Palette.chart3
    static let yellow = Palette.chart4
    static let indigo = Color.indigo
    static let purple = Color.purple
    static let gray = Color.gray
    static let pink = Color.pink
}

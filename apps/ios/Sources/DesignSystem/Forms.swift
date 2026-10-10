import SwiftUI

/// Контролы формы (DESIGN_SYSTEM §8 «Состояния», §10.3 «Форма»).
///
/// Здесь ровно то, из чего собирается форма входа, и ни элементом больше: кнопка
/// действия, тихая кнопка, рамка поля и две строки ошибки. Правила взяты из системы
/// веба, а не придуманы заново — иначе второй экран начнёт выглядеть иначе, чем
/// первый.

/// Главное действие формы. Загрузка — не `disabled`: заливка гаснет до `muted`, а
/// подпись сменяется индикатором, чтобы кнопка не выглядела сломанной.
struct PrimaryButtonStyle: ButtonStyle {
    var isLoading = false

    func makeBody(configuration: Configuration) -> some View {
        StyledLabel(configuration: configuration, isLoading: isLoading)
    }

    private struct StyledLabel: View {
        let configuration: ButtonStyleConfiguration
        let isLoading: Bool
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            ZStack {
                configuration.label.opacity(isLoading ? 0 : 1)
                if isLoading {
                    ProgressView().tint(Palette.mutedForeground)
                }
            }
            .font(Typography.body.weight(.medium))
            .frame(maxWidth: .infinity, minHeight: ControlHeight.xl)
            .background(isLoading ? Palette.muted : Palette.primary, in: RoundedRectangle(cornerRadius: Radius.xl))
            .foregroundStyle(isLoading ? Palette.mutedForeground : Palette.primaryForeground)
            .opacity(isEnabled || isLoading ? 1 : 0.5)
            // §8: нажатие сдвигает кнопку на пиксель вниз — тот же отклик, что в вебе.
            .offset(y: configuration.isPressed ? 1 : 0)
            .animation(
                Motion.respecting(.easeOut(duration: Motion.Duration.feedback), reduceMotion: reduceMotion),
                value: configuration.isPressed
            )
        }
    }
}

/// Второстепенное действие: «Назад», «Отмена». Без заливки — чтобы в паре с главной
/// кнопкой было видно, какая из двух основная.
struct QuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typography.body)
            .frame(maxWidth: .infinity, minHeight: ControlHeight.xl)
            .foregroundStyle(Palette.foreground)
            .background(
                configuration.isPressed ? Palette.muted : Color.clear,
                in: RoundedRectangle(cornerRadius: Radius.xl)
            )
    }
}

/// Рамка поля ввода. Состояния ровно три: покой, фокус, ошибка — и у каждого свой
/// цвет рамки плюс кольцо снаружи (§8). Кольцо рисуется с отрицательным отступом,
/// иначе оно съедает рамку вместо того, чтобы лежать вокруг неё.
struct FormFieldModifier: ViewModifier {
    var isFocused = false
    var isInvalid = false

    func body(content: Content) -> some View {
        content
            .font(Typography.body)
            .foregroundStyle(Palette.foreground)
            .padding(.horizontal, Spacing.lg)
            .frame(minHeight: ControlHeight.xl)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.xl))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.xl)
                    .strokeBorder(borderColor, lineWidth: isFocused || isInvalid ? 1.5 : 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Radius.xl)
                    .strokeBorder(ringColor, lineWidth: 4)
                    .padding(-4)
            )
    }

    private var borderColor: Color {
        if isInvalid { return Palette.destructive }
        return isFocused ? Palette.ring : Palette.border
    }

    private var ringColor: Color {
        if isInvalid { return Palette.destructive.opacity(0.15) }
        return isFocused ? Palette.ring.opacity(0.2) : .clear
    }
}

extension View {
    func formField(isFocused: Bool = false, isInvalid: Bool = false) -> some View {
        modifier(FormFieldModifier(isFocused: isFocused, isInvalid: isInvalid))
    }
}

/// Ошибка под полем. Пустое значение не рисует ничего, поэтому ставится безусловно —
/// так форма не прыгает между «есть ошибка» и «нет».
struct FieldError: View {
    let message: String?

    var body: some View {
        if let message {
            Text(message)
                .font(Typography.meta)
                .foregroundStyle(Palette.destructive)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(Text(message))
        }
    }
}

/// Ошибка всей формы: та, что не привязана к полю, — нет связи, вход заблокирован,
/// сессия протухла. Для ошибки конкретного поля есть `FieldError` (§10.3).
struct FormAlert: View {
    let message: String?

    var body: some View {
        if let message {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Palette.destructive)
                    .accessibilityHidden(true)
                Text(message)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.foreground)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(Spacing.lg)
            .background(Palette.destructive.opacity(0.1), in: RoundedRectangle(cornerRadius: Radius.xl))
        }
    }
}

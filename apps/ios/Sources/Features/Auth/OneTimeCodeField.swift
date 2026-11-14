import SwiftUI

/// Код по ячейкам, как поле пин-кода: на каждый символ — своя ячейка, у текущей —
/// мигающий курсор и рамка фирменного цвета.
///
/// Под ячейками — одно настоящее поле ввода, невидимое: через него идут клавиатура,
/// подстановка кода из «Паролей» и SMS (`.oneTimeCode`), вставка и VoiceOver. Ячейки
/// только показывают его текст, поэтому стирание, вставка целиком и подстановка работают
/// как в обычном поле, без перескоков фокуса между шестью полями.
struct OneTimeCodeField<Accessory: View>: View {
    @Binding var code: String
    let length: Int
    /// Зазор пошире после каждых `groupSize` ячеек: резервный код читается как «XXXX XXXX».
    var groupSize: Int?
    var keyboard: UIKeyboardType = .numberPad
    var placeholder: String
    var error: String?
    var isFocused: FocusState<Bool>.Binding
    var isDisabled = false
    var submit: () -> Void
    @ViewBuilder var accessory: () -> Accessory

    @Environment(\.motionReduced) private var reduceMotion
    @ScaledMetric(relativeTo: .title2) private var cellHeight: CGFloat = 54

    private var characters: [Character] { Array(code.prefix(length)) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.md) {
                ZStack {
                    input
                    cells
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
                .onTapGesture { isFocused.wrappedValue = true }
                accessory()
            }
            FieldError(message: error)
        }
        .sensoryFeedback(.error, trigger: error) { old, new in old == nil && new != nil }
        .onChange(of: error) { old, new in
            if old == nil, let new { AccessibilityNotification.Announcement(new).post() }
        }
    }

    /// Настоящее поле: невидимый текст и курсор, но живое для клавиатуры и VoiceOver.
    private var input: some View {
        TextField(text: $code, prompt: Text(verbatim: "")) {
            Text(placeholder)
        }
        .keyboardType(keyboard)
        .textContentType(.oneTimeCode)
        .textInputAutocapitalization(keyboard == .numberPad ? .never : .characters)
        .autocorrectionDisabled()
        .foregroundStyle(.clear)
        .tint(.clear)
        .submitLabel(.go)
        .focused(isFocused)
        .onSubmit(submit)
        .disabled(isDisabled)
        .frame(height: cellHeight)
        .accessibilityIdentifier("auth.code")
    }

    private var cells: some View {
        HStack(spacing: Spacing.sm) {
            ForEach(0..<length, id: \.self) { index in
                cell(at: index)
                if let groupSize, (index + 1) % groupSize == 0, index + 1 < length {
                    Capsule()
                        .fill(Palette.mutedForeground.opacity(0.4))
                        .frame(width: 8, height: 2)
                }
            }
        }
    }

    private func cell(at index: Int) -> some View {
        let character = index < characters.count ? characters[index] : nil
        let isCurrent = isFocused.wrappedValue && !isDisabled
            && index == min(characters.count, length - 1)
            && (characters.count < length || index == length - 1)
        let shape = RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
        return ZStack {
            if let character {
                Text(String(character))
                    .font(Typography.tabular(.title2).weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                    .transition(
                        reduceMotion
                            ? .opacity
                            : .scale(scale: 0.6).combined(with: .opacity)
                    )
            } else if isCurrent {
                CodeCaret()
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: cellHeight)
        .background(AuthPalette.field, in: shape)
        .overlay(shape.strokeBorder(borderColor(isCurrent: isCurrent), lineWidth: borderWidth(isCurrent: isCurrent)))
        .animation(Motion.respecting(Motion.snappy, reduceMotion: reduceMotion), value: character)
        .animation(Motion.respecting(Motion.snappy, reduceMotion: reduceMotion), value: isCurrent)
    }

    private func borderColor(isCurrent: Bool) -> Color {
        if error != nil { return Palette.destructive }
        return isCurrent ? Palette.primary : .clear
    }

    private func borderWidth(isCurrent: Bool) -> CGFloat {
        error != nil || isCurrent ? 1.5 : 0
    }
}

extension OneTimeCodeField where Accessory == EmptyView {
    init(
        code: Binding<String>,
        length: Int,
        groupSize: Int? = nil,
        keyboard: UIKeyboardType = .numberPad,
        placeholder: String,
        error: String? = nil,
        isFocused: FocusState<Bool>.Binding,
        isDisabled: Bool = false,
        submit: @escaping () -> Void
    ) {
        self.init(
            code: code, length: length, groupSize: groupSize, keyboard: keyboard, placeholder: placeholder,
            error: error, isFocused: isFocused, isDisabled: isDisabled, submit: submit, accessory: { EmptyView() }
        )
    }
}

/// Мигающий курсор пустой текущей ячейки — плавно, как системный.
private struct CodeCaret: View {
    @Environment(\.motionReduced) private var reduceMotion
    @State private var visible = true

    var body: some View {
        Capsule()
            .fill(Palette.primary)
            .frame(width: 2, height: 24)
            .opacity(visible ? 1 : 0)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) { visible = false }
            }
    }
}

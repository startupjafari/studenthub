import SwiftUI

/// Панель emoji на месте клавиатуры — как в Telegram.
///
/// Встаёт под поле ввода той же высоты, что была у клавиатуры: поле не прыгает ни при
/// открытии, ни при возврате к клавиатуре. Сетка — во всю высоту, сверху у неё свой
/// поиск; внизу справа плавает «стереть».
struct ExpressionPanel: View {
    let onEmoji: (String) -> Void
    let onBackspace: () -> Void

    /// Запас под плавающей кнопкой «стереть»: последний ряд прокручивается из-под неё.
    private static let barClearance: CGFloat = ControlHeight.xl + Spacing.md * 2

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            EmojiBrowser(columns: 8, bottomInset: Self.barClearance, onPick: pickEmoji)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            backspaceButton
                .padding(.horizontal, Spacing.lg)
                .padding(.bottom, Spacing.md)
        }
        .padding(.top, Spacing.xs)
        .background { PanelSurface() }
    }

    private var backspaceButton: some View {
        Button(action: onBackspace) {
            Image(systemName: "delete.left")
                .font(.body.weight(.medium))
                .foregroundStyle(Palette.foreground)
                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .floatingGlass(in: Circle())
        .accessibilityLabel(Text(String(localized: "chats.panel.backspace", defaultValue: "Стереть")))
    }

    private func pickEmoji(_ emoji: String) {
        RecentEmoji.shared.use(emoji)
        onEmoji(emoji)
    }
}

/// Подложка панели — как клавиатура iOS 26 и панель Telegram: стеклянный лист со
/// скруглёнными верхними углами, а не плоская серая плита с резкой границей у переписки.
/// До iOS 26 — системный материал той же формы.
private struct PanelSurface: View {
    private let shape = UnevenRoundedRectangle(
        topLeadingRadius: 26,
        topTrailingRadius: 26,
        style: .continuous
    )

    var body: some View {
        Group {
            #if compiler(>=6.2)
                if #available(iOS 26, *) {
                    Color.clear.glassEffect(.regular, in: shape)
                } else {
                    shape.fill(.regularMaterial)
                }
            #else
                shape.fill(.regularMaterial)
            #endif
        }
        .ignoresSafeArea(edges: .bottom)
    }
}

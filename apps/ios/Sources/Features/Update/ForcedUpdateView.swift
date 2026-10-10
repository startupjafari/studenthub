import SwiftUI
import UIKit

/// Экран «обновите приложение».
///
/// Он один на весь запуск и стоит до входа: со старой сборкой не работает и форма
/// входа, и человек иначе упёрся бы в непонятную ошибку вместо прямого ответа.
/// Выхода с экрана нет намеренно — «продолжить всё равно» означало бы предложить
/// пользоваться тем, что не работает.
struct ForcedUpdateView: View {
    let storeURL: URL?
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: Spacing.xl) {
            Image(systemName: "arrow.down.circle")
                .font(.system(size: 44))
                .foregroundStyle(Palette.primary)
                .accessibilityHidden(true)

            Text(String(localized: "update.title", defaultValue: "Обновите приложение"))
                .font(Typography.pageTitle)
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.center)

            Text(String(
                localized: "update.hint",
                defaultValue: """
                    Эта версия StudentHub больше не поддерживается. \
                    Обновите приложение, чтобы продолжить.
                    """
            ))
            .font(Typography.body)
            .foregroundStyle(Palette.mutedForeground)
            .multilineTextAlignment(.center)

            if let storeURL {
                Button {
                    UIApplication.shared.open(storeURL)
                } label: {
                    Text(String(localized: "update.action", defaultValue: "Обновить"))
                }
                .buttonStyle(PrimaryButtonStyle())
            }

            // Кнопка нужна и тогда, когда человек обновился, а приложение этого ещё
            // не спросило: без неё остаётся только убить процесс.
            Button(action: onRetry) {
                Text(String(localized: "update.retry", defaultValue: "Проверить снова"))
            }
            .buttonStyle(QuietButtonStyle())
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
        .accessibilityElement(children: .contain)
    }
}

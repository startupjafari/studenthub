import SwiftUI

/// Роль, которой эта сборка не знает: сервер завёл её раньше, чем человек обновил
/// приложение. Пустая оболочка была бы хуже, чем прямой ответ: обновите приложение или
/// откройте веб.
struct UnsupportedRoleView: View {
    let session: AppSessionModel

    var body: some View {
        VStack(spacing: Spacing.xl) {
            Image(systemName: "laptopcomputer")
                .font(.system(size: 36))
                .foregroundStyle(Palette.primary)
                .accessibilityHidden(true)

            Text(String(
                localized: "session.roleUnknownTitle",
                defaultValue: "Эта роль пока не поддерживается"
            ))
            .font(Typography.sectionTitle)
            .foregroundStyle(Palette.foreground)
            .multilineTextAlignment(.center)

            Text(String(
                localized: "session.roleUnknownHint",
                defaultValue: """
                    Обновите приложение до последней версии \
                    или откройте платформу в браузере.
                    """
            ))
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
            .multilineTextAlignment(.center)

            Button {
                Task { await session.signOut() }
            } label: {
                Text(String(localized: "session.signOut", defaultValue: "Выйти"))
            }
            .buttonStyle(QuietButtonStyle())
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
    }
}

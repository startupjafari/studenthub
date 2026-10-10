import SwiftUI

/// Роль вне MVP: деканат, администраторы вуза и платформы, работодатели.
///
/// Приложение дополняет веб, а не заменяет его (план, «Допущения»). Показать таким
/// пользователям пустую оболочку было бы хуже, чем сказать прямо: их разделы живут
/// в браузере, и там всё работает.
struct UnsupportedRoleView: View {
    let session: AppSessionModel

    var body: some View {
        VStack(spacing: Spacing.xl) {
            Image(systemName: "laptopcomputer")
                .font(.system(size: 36))
                .foregroundStyle(Palette.primary)
                .accessibilityHidden(true)

            Text(String(
                localized: "session.roleInWebTitle",
                defaultValue: "Эта роль работает в браузере"
            ))
            .font(Typography.sectionTitle)
            .foregroundStyle(Palette.foreground)
            .multilineTextAlignment(.center)

            Text(String(
                localized: "session.roleInWebHint",
                defaultValue: """
                    Приложение сделано для студентов, старост и преподавателей. \
                    Остальные разделы платформы откройте в браузере.
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

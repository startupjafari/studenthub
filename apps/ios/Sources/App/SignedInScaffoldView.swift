import SwiftUI

/// Временный экран за входом — до задачи 0.6, где его сменит оболочка с вкладками.
///
/// Нужен не для красоты: без него нечем проверить ворота фазы — живую сессию после
/// перезапуска, подтверждение входа по QR и выход.
struct SignedInScaffoldView: View {
    let session: AppSessionModel

    @State private var showsQRApprove = false

    var body: some View {
        VStack(spacing: Spacing.xl) {
            Text(verbatim: "StudentHub")
                .font(Typography.pageTitle)
                .foregroundStyle(Palette.foreground)
            Text(String(localized: "session.active", defaultValue: "Сессия активна"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)

            Button {
                showsQRApprove = true
            } label: {
                Text(String(localized: "auth.qrApproveTitle", defaultValue: "Вход на другом устройстве"))
            }
            .buttonStyle(PrimaryButtonStyle())

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
        .sheet(isPresented: $showsQRApprove) {
            QRApproveView()
        }
    }
}

import SwiftUI

/// Корневая сцена: вход, пока сессии нет, и приложение, когда она есть.
///
/// Настоящая оболочка — пять вкладок с составом по роли — появится в задаче 0.6;
/// до неё за входом стоит временный экран, с которого достижимы выход и
/// подтверждение входа по QR.
struct RootView: View {
    @State private var session = AppSessionModel()

    var body: some View {
        content
            .background(Palette.background)
            .animation(Motion.calm, value: session.state)
            .task {
                await session.restore()
            }
    }

    @ViewBuilder
    private var content: some View {
        switch session.state {
        case .restoring:
            RestoringView()
        case .signedOut:
            LoginView(session: session)
        case .signedIn:
            SignedInScaffoldView(session: session)
        }
    }
}

/// Холодный старт: признак сессии есть, токен ещё едет. Показываем имя приложения,
/// а не спиннер во весь экран — ожидание здесь обычно короче, чем заметно глазу.
private struct RestoringView: View {
    var body: some View {
        VStack(spacing: Spacing.md) {
            Text(verbatim: "StudentHub")
                .font(Typography.pageTitle)
                .foregroundStyle(Palette.foreground)
            ProgressView()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
    }
}

import SwiftUI

/// Корневая сцена: вход, пока сессии нет, и приложение, когда она есть.
///
/// За входом — оболочка с пятью вкладками; роль для неё берётся из токена, а не из
/// ответа сервера: решение о доступе всё равно принимает API, а приложению роль
/// нужна только для того, чтобы не рисовать разделы, которых у человека нет.
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
        case .signedIn(let token):
            // Роли вне MVP приложение не ведёт: им честнее сказать про браузер,
            // чем показать оболочку с пятью пустыми вкладками.
            if token.role.isSupportedOnPhone {
                AppShellView(session: session, role: token.role)
            } else {
                UnsupportedRoleView(session: session)
            }
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

import SwiftUI

/// Корневая сцена: проверка версии, вход, пока сессии нет, и приложение, когда она
/// есть.
///
/// За входом — оболочка с пятью вкладками; роль для неё берётся из токена, а не из
/// ответа сервера: решение о доступе всё равно принимает API, а приложению роль
/// нужна только для того, чтобы не рисовать разделы, которых у человека нет.
struct RootView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    @State private var session = AppSessionModel()
    @State private var update = UpdateGateModel()
    /// Ссылка из письма (новый пароль, приглашение), пришедшая до входа.
    @State private var authLink: AuthLink?

    var body: some View {
        content
            .background(Palette.background)
            // Смена экрана — движение, а не украшение, но человеку с включённым
            // «уменьшением движения» оно показывается сразу конечным состоянием.
            .animation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion), value: session.state)
            .animation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion), value: update.state)
            // Экран загрузки — поверх содержимого, а не веткой в нём: так его уход
            // анимируется сам по себе, а смена экранов под ним идёт прежним порядком.
            .overlay {
                if isLaunching {
                    LaunchLoadingView()
                        .transition(LaunchLoadingView.exitTransition(reduceMotion: reduceMotion))
                }
            }
            .animation(LaunchLoadingView.exitAnimation(reduceMotion: reduceMotion), value: isLaunching)
            .task {
                // База (открытие и миграции) поднимается фоном, пока идёт восстановление
                // сессии: иначе её открывал бы первый кадр оболочки на главном потоке.
                AppServices.databaseHolder.prewarm()
                // Версию и сессию спрашиваем разом: они не зависят друг от друга, а
                // по очереди это лишняя секунда к запуску.
                async let version: Void = update.check()
                async let restored: Void = session.restore()
                _ = await (version, restored)
                Observability.identify(userID: session.token?.subject)
                Observability.launchFinished()
            }
            // Ссылки внутрь приложения разбирает оболочка (`AppShellView`); здесь — только
            // ссылки экранов до входа. Вошедшему человеку они ни к чему: регистрироваться
            // второй раз незачем, а пароль меняется в настройках.
            .onOpenURL { url in
                guard let link = AuthLink(url: url), session.token == nil else { return }
                authLink = link
            }
            .onChange(of: session.state) { _, state in
                if case .signedIn = state { authLink = nil }
            }
            // Вернулись в приложение — возможно, уже со связью: выход, отложенный без
            // сети, досылаем сразу, а не при следующем запуске.
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task { await session.completePendingLogouts() }
            }
    }

    /// Экран загрузки держится, пока корневому экрану нечего показать: сессия ещё
    /// поднимается, а блокировки по версии нет. Ни секунды сверх этого — анимация
    /// знака запуск не задерживает.
    private var isLaunching: Bool {
        if case .blocked = update.state { return false }
        return session.state == .restoring
    }

    @ViewBuilder
    private var content: some View {
        // Проверка версии стоит перед сессией: со сборкой старше контракта не
        // работает и вход, и человек упёрся бы в непонятную ошибку вместо прямого
        // ответа.
        if case .blocked(let storeURL) = update.state {
            ForcedUpdateView(storeURL: storeURL) {
                Task { await update.check() }
            }
        } else {
            signedState
        }
    }

    @ViewBuilder
    private var signedState: some View {
        switch session.state {
        case .restoring:
            // Пока сессия поднимается, поверх лежит экран загрузки (`isLaunching`);
            // под ним — тот же фон, чтобы при его уходе не мелькнул другой цвет.
            LaunchPalette.background
                .ignoresSafeArea()
        case .signedOut:
            LoginView(session: session, pendingLink: $authLink)
        case .signedIn(let token):
            // Роли вне MVP приложение не ведёт: им честнее сказать про браузер,
            // чем показать оболочку с пятью пустыми вкладками.
            if token.role.isSupportedOnPhone {
                AppShellView(session: session, viewer: token)
            } else {
                UnsupportedRoleView(session: session)
            }
        }
    }
}

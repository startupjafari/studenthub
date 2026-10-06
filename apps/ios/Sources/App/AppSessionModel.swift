import Observation

/// Состояние сессии для интерфейса.
///
/// Хранилище сессии — актор: к нему нельзя обратиться из `body` и нельзя подписаться
/// на изменения. Эта обёртка держит то единственное, что нужно корневому экрану, —
/// вошёл ли человек и с какой ролью, — и живёт на главном потоке.
///
/// `restoring` — не косметика. Без третьего состояния холодный старт на долю секунды
/// показывает экран входа уже вошедшему человеку: признак сессии лежит в связке
/// ключей, а токен приходит из сети.
@Observable
final class AppSessionModel {
    enum State: Equatable {
        case restoring
        case signedOut
        case signedIn(AccessToken)
    }

    private(set) var state: State = .restoring

    private let store: SessionStore

    init(store: SessionStore = AppServices.session) {
        self.store = store
    }

    /// Токен текущей сессии или `nil`, если человек не вошёл.
    var token: AccessToken? {
        if case .signedIn(let token) = state { return token }
        return nil
    }

    @MainActor
    func restore() async {
        let restored = await store.restoredToken()
        state = restored.map(State.signedIn) ?? .signedOut
    }

    /// Принять сессию, выданную входом. `false` означает, что токен не разобрался:
    /// доверять такой сессии нельзя — ни роли, ни срока жизни из неё не прочитать.
    @MainActor
    @discardableResult
    func adopt(_ session: AuthSession) async -> Bool {
        guard let token = await store.adopt(session) else { return false }
        state = .signedIn(token)
        return true
    }

    @MainActor
    func signOut() async {
        // Сначала рвём реальное время: сокет с погашенным токеном сервер всё равно
        // отключит, но уже со своей стороны и с ошибкой в логе.
        await AppServices.realtime.stop()
        await store.signOut()
        state = .signedOut
    }
}

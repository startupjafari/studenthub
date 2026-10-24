import Foundation
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
        if let restored {
            await LocalData.claim(for: restored.subject)
        } else {
            // Сессия не поднялась — отложенная ссылка из пуша никому не адресована.
            AppServices.router.reset()
        }
        state = restored.map(State.signedIn) ?? .signedOut
    }

    /// Принять сессию, выданную входом. `false` означает, что токен не разобрался:
    /// доверять такой сессии нельзя — ни роли, ни срока жизни из неё не прочитать.
    @MainActor
    @discardableResult
    func adopt(_ session: AuthSession) async -> Bool {
        guard let token = await store.adopt(session) else { return false }
        // Вошёл другой человек, чем тот, чьи данные лежат на устройстве (прежний не
        // выходил, а сессия у него истекла), — его чаты и расписание стираются.
        await LocalData.claim(for: token.subject)
        // Сбои этого человека — под его id, а не под id того, кто входил до него.
        Observability.identify(userID: token.subject)
        state = .signedIn(token)
        return true
    }

    @MainActor
    func signOut() async {
        // Сначала рвём реальное время: сокет с погашенным токеном сервер всё равно
        // отключит, но уже со своей стороны и с ошибкой в логе.
        await AppServices.realtime.stop()
        // И отвязываем устройство: иначе следующему человеку на этом телефоне
        // прилетят чужие уведомления.
        await PushRegistrar().unregister()
        await store.signOut()
        // Данные прежнего человека не должны достаться следующему (как clearAllTables
        // в Android): список чатов читается из базы и только дописывается.
        await LocalData.erase()
        // Память — тоже данные прежнего человека: открытый чат в стеке навигации и
        // его id в трекере ошибок.
        AppServices.router.reset()
        Observability.identify(userID: nil)
        state = .signedOut
    }
}

/// Данные человека на устройстве: база чатов и расписания, отметка синхронизации,
/// подписанные ссылки, бейдж. Чьи они — помнит `ownerKey`.
enum LocalData {
    private static let ownerKey = "storage.owner"

    /// Вошёл `userID`. База заполнена кем-то другим (или чья она — неизвестно: сборка
    /// до этой отметки) — стираем, сервер вернёт своё.
    @MainActor
    static func claim(for userID: String) async {
        if UserDefaults.standard.string(forKey: ownerKey) != userID {
            await erase()
        }
        UserDefaults.standard.set(userID, forKey: ownerKey)
    }

    @MainActor
    static func erase() async {
        try? await AppServices.database.eraseAll()
        await AppServices.attachmentURLs.clear()
        UserDefaults.standard.removeObject(forKey: ScheduleModel.syncedKey)
        UserDefaults.standard.removeObject(forKey: ownerKey)
        await BadgeCounter().refresh()
    }
}

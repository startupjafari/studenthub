import Foundation

/// Признак установки приложения (IOS_RULES 10.1.12).
///
/// Связка ключей переживает удаление приложения, а `UserDefaults` и файлы контейнера —
/// нет. Люди часто удаляют приложение, чтобы «выйти»: без признака новая установка
/// открывала бы прежнюю сессию. Признак говорит `SessionStore.restore`, что эта
/// установка ещё не проверяла связку ключей, — тогда оставшаяся там сессия стирается.
protocol InstallationMarker: Sendable {
    /// Запуск процесса — до первого обращения к базе. Решает раз на установку, ждёт ли
    /// связка ключей проверки; `containerHasData` — база уже лежит в контейнере.
    func prepare(containerHasData: Bool)
    /// Эта установка ещё не проверила сессию, оставшуюся в связке ключей от прежней.
    var isSessionCheckPending: Bool { get }
    /// Проверка сделана — до следующей установки не спрашивать.
    func markSessionChecked()
}

/// Признака нет: связку ключей не трогаем. Тесты, превью и UI-тесты со своей сессией.
struct SettledInstallation: InstallationMarker {
    func prepare(containerHasData: Bool) {}
    var isSessionCheckPending: Bool { false }
    func markSessionChecked() {}
}

/// Признак в `UserDefaults`: они удаляются вместе с приложением.
///
/// `@unchecked Sendable`: `UserDefaults` потокобезопасно, но Sendable не помечено.
struct DefaultsInstallationMarker: InstallationMarker, @unchecked Sendable {
    private static let key = "installation.session-check"
    private static let pending = "pending"
    private static let checked = "checked"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// Признака нет — это первый запуск новой установки или обновление со сборки, где
    /// признака ещё не было. Различает их база: она в контейнере приложения и удаляется
    /// с ним. Без этого обновление выкинуло бы на вход всех, кто уже вошёл.
    ///
    /// «Ждёт проверки» хранится, а не держится в памяти: запуск фоном (до открытия
    /// экрана) мог не дойти до `restore`, а следующий уже увидит базу.
    func prepare(containerHasData: Bool) {
        guard defaults.string(forKey: Self.key) == nil else { return }
        defaults.set(containerHasData ? Self.checked : Self.pending, forKey: Self.key)
    }

    var isSessionCheckPending: Bool {
        defaults.string(forKey: Self.key) == Self.pending
    }

    func markSessionChecked() {
        defaults.set(Self.checked, forKey: Self.key)
    }
}

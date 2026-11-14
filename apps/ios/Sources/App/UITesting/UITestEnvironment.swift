import Foundation

/// Режим UI-тестов: что раннер XCUITest попросил у приложения через окружение процесса.
///
/// Переменные (`XCUIApplication.launchEnvironment`):
/// - `SH_UITEST_MOCK=1` — сеть отвечает из фикстур (`MockAPIProtocol`), реального
///   времени и запроса пушей нет, состояние на старте чистое;
/// - `SH_UITEST_SCENARIO` — `signedOut` (экран входа, по умолчанию) или `student`
///   (сразу вошёл студентом); неизвестное имя роняет запуск;
/// - `SH_UITEST_LARGE=1` — большие фикстуры для замеров прокрутки: сотни чатов, тысячи
///   сообщений, сотни постов;
/// - `SH_UITEST_REDUCE_MOTION=1` — уменьшение движения, не трогая настройки симулятора;
/// - `SH_UITEST_VOICEOVER=1` — раскладка «как под VoiceOver» (`VoiceOver.forced`):
///   симулятор VoiceOver не запускает.
///
/// Тип есть и в релизной сборке — его читают `Motion` и места подключения, — но там
/// всё выключено: окружение процесса не читается вовсе, а кода mock в сборке нет.
struct UITestEnvironment: Sendable {
    enum Scenario: String, CaseIterable, Sendable {
        case signedOut
        case student
    }

    let isMock: Bool
    let scenario: Scenario
    let isLarge: Bool
    let reduceMotion: Bool

    static let off = UITestEnvironment(isMock: false, scenario: .signedOut, isLarge: false, reduceMotion: false)

    static let current: UITestEnvironment = {
        #if DEBUG
            let environment = ProcessInfo.processInfo.environment
            let isMock = environment["SH_UITEST_MOCK"] == "1"
            return UITestEnvironment(
                isMock: isMock,
                scenario: UITestEnvironment.scenario(environment["SH_UITEST_SCENARIO"]),
                isLarge: isMock && environment["SH_UITEST_LARGE"] == "1",
                reduceMotion: environment["SH_UITEST_REDUCE_MOTION"] == "1"
            )
        #else
            return .off
        #endif
    }()

    /// Имя сценария — контракт с тестами. Нет переменной — экран входа; опечатка роняет
    /// запуск с перечнем известных имён: иначе тест молча проверял бы экран входа, а
    /// падение выглядело бы багом продукта (`docs/IOS_RULES.md` 2.7.8).
    static func scenario(_ raw: String?) -> Scenario {
        guard let raw, !raw.isEmpty else { return .signedOut }
        if let scenario = Scenario(rawValue: raw) { return scenario }
        let known = Scenario.allCases.map(\.rawValue).joined(separator: ", ")
        preconditionFailure("SH_UITEST_SCENARIO=\"\(raw)\" неизвестен, известны: \(known)")
    }
}

/// Точки подключения тестового режима к сборке зависимостей. В Release — настоящие
/// реализации без единой проверки окружения.
enum UITestHooks {
    /// Подготовить процесс до первого обращения к `AppServices`: стереть следы прошлых
    /// прогонов и подменить сеть. Вызывается из `StudentHubApp.init`.
    static func prepareIfNeeded() {
        #if DEBUG
            guard UITestEnvironment.current.isMock else { return }
            UITestBootstrap.prepare()
        #endif
    }

    /// Классы перехвата для `APIClient.session`: у неё своя конфигурация, и общий
    /// `URLProtocol.registerClass` до неё не доходит.
    static var protocolClasses: [AnyClass] {
        #if DEBUG
            if UITestEnvironment.current.isMock { return [MockAPIProtocol.self] }
        #endif
        return []
    }

    /// Хранилище секретов сессии: в тестах — словарь в памяти, засеянный сценарием.
    /// Связка ключей симулятора без подписи сборки ненадёжна и переживает прогоны.
    static var secretStore: SecretStore {
        #if DEBUG
            if UITestEnvironment.current.isMock { return UITestBootstrap.secrets }
        #endif
        return Keychain()
    }

    /// Признак установки: в тестах сессия засеяна сценарием, и стирать её как
    /// оставшуюся от прежней установки нельзя.
    static var installationMarker: InstallationMarker {
        #if DEBUG
            if UITestEnvironment.current.isMock { return SettledInstallation() }
        #endif
        return DefaultsInstallationMarker()
    }

    /// Транспорт реального времени: в тестах сокета нет — сервер mock его не держит.
    static func realtimeTransport() -> RealtimeTransport {
        #if DEBUG
            if UITestEnvironment.current.isMock { return MockRealtimeTransport() }
        #endif
        return SocketIORealtimeTransport()
    }

    /// Системный запрос разрешения на уведомления перекрыл бы экран в каждом сценарии.
    static var suppressesPushPrompt: Bool {
        UITestEnvironment.current.isMock
    }
}

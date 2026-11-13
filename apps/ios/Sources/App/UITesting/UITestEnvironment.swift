import Foundation

/// Режим UI-тестов: что раннер XCUITest попросил у приложения через окружение процесса.
///
/// Переменные (`XCUIApplication.launchEnvironment`):
/// - `SH_UITEST_MOCK=1` — сеть отвечает из фикстур (`MockAPIProtocol`), реального
///   времени и запроса пушей нет, состояние на старте чистое;
/// - `SH_UITEST_SCENARIO` — `signedOut` (экран входа, по умолчанию) или `student`
///   (сразу вошёл студентом);
/// - `SH_UITEST_LARGE=1` — большие фикстуры для замеров прокрутки: сотни чатов, тысячи
///   сообщений, сотни постов;
/// - `SH_UITEST_REDUCE_MOTION=1` — уменьшение движения, не трогая настройки симулятора.
///
/// Тип есть и в релизной сборке — его читают `Motion` и места подключения, — но там
/// всё выключено: окружение процесса не читается вовсе, а кода mock в сборке нет.
struct UITestEnvironment: Sendable {
    enum Scenario: String, Sendable {
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
                scenario: environment["SH_UITEST_SCENARIO"].flatMap(Scenario.init(rawValue:)) ?? .signedOut,
                isLarge: isMock && environment["SH_UITEST_LARGE"] == "1",
                reduceMotion: environment["SH_UITEST_REDUCE_MOTION"] == "1"
            )
        #else
            return .off
        #endif
    }()
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

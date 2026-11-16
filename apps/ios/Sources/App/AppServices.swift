import Foundation
import os

/// Сборка зависимостей приложения в одном месте.
///
/// Порядок здесь не случайный: клиент API спрашивает токен у хранилища сессии, а
/// хранилище обновляет сессию через собственный клиент без авторизации. Если
/// перепутать и дать ему общий клиент, обновление токена уйдёт в рекурсию.
enum AppServices {
    static let auth = AuthAPI()
    /// Признак установки (10.1.12). В UI-тестах его нет: сессию сценария не трогаем.
    static let installation = UITestHooks.installationMarker
    static let session = SessionStore(
        auth: auth,
        secrets: UITestHooks.secretStore,
        background: UIKitBackgroundActivity(),
        installation: installation
    )
    static let api = APIClient(authorization: session)
    /// Подтверждение входа по QR — наоборот, только с авторизацией: пользователя
    /// сервер берёт из токена.
    static let qrLogin = QRLoginAPI(client: api)

    /// Навигация. Общая, а не у каждого экрана своя: по нажатию на уведомление
    /// переход делает делегат приложения, у которого своего состояния нет.
    @MainActor static let router = AppRouter()

    /// Что делать по тихому пушу.
    static let pushSync = PushSync()
    /// Регистрация пушей с настоящей системной частью (`UIApplication`); в ядре она за
    /// протоколом `RemoteNotificationRegistration`.
    static let pushRegistrar = PushRegistrar(client: api, system: UIKitRemoteNotifications())

    /// Непрочитанные уведомления: одно число для колокольчика, бейджа иконки и догона
    /// по пушу (п. 18 аудита).
    static let unreadNotifications = UnreadNotificationsCounter()

    /// Ссылки на вложения: кэш по id файла, а не по адресу.
    static let attachmentURLs = AttachmentURLProvider()

    /// Результаты опросов: один запрос на опрос и дроссель при прокрутке (IOS_RULES 9.8.22).
    @MainActor static let pollResults = PollResultsCache()

    /// Реальное время. Транспорт — единственное место, знающее про socket.io.
    static let realtime = RealtimeCoordinator(transport: UITestHooks.realtimeTransport())

    /// Досылка неотправленных сообщений, не привязанная к открытому чату.
    static let outbox = OutboxService.live()

    /// Локальная база чатов — через явного держателя (`DatabaseHolder`): база не
    /// открывается, пока данные устройства заперты до первой разблокировки, и
    /// открывается по разблокировке (`AppDelegate`).
    static let databaseHolder = DatabaseHolder()

    /// База для экранов и хранилищ. Интерфейс есть только после разблокировки, так что
    /// к их первому обращению база открыта или открывается сразу.
    static var database: AppDatabase { databaseHolder.database }
}

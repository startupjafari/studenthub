import Foundation
import os

/// Сборка зависимостей приложения в одном месте.
///
/// Порядок здесь не случайный: клиент API спрашивает токен у хранилища сессии, а
/// хранилище обновляет сессию через собственный клиент без авторизации. Если
/// перепутать и дать ему общий клиент, обновление токена уйдёт в рекурсию.
enum AppServices {
    static let auth = AuthAPI()
    static let session = SessionStore(auth: auth, background: UIKitBackgroundActivity())
    static let api = APIClient(authorization: session)
    /// Подтверждение входа по QR — наоборот, только с авторизацией: пользователя
    /// сервер берёт из токена.
    static let qrLogin = QRLoginAPI(client: api)

    /// Навигация. Общая, а не у каждого экрана своя: по нажатию на уведомление
    /// переход делает делегат приложения, у которого своего состояния нет.
    static let router = AppRouter()

    /// Что делать по тихому пушу.
    static let pushSync = PushSync()

    /// Ссылки на вложения: кэш по id файла, а не по адресу.
    static let attachmentURLs = AttachmentURLProvider()

    /// Реальное время. Транспорт — единственное место, знающее про socket.io.
    static let realtime = RealtimeCoordinator(transport: SocketIORealtimeTransport())

    /// Локальная база чатов — через явного держателя (`DatabaseHolder`): база не
    /// открывается, пока данные устройства заперты до первой разблокировки, и
    /// открывается по разблокировке (`AppDelegate`).
    static let databaseHolder = DatabaseHolder()

    /// База для экранов и хранилищ. Интерфейс есть только после разблокировки, так что
    /// к их первому обращению база открыта или открывается сразу.
    static var database: AppDatabase { databaseHolder.database }
}

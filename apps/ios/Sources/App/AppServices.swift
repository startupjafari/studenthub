import Foundation
import os

/// Сборка зависимостей приложения в одном месте.
///
/// Порядок здесь не случайный: клиент API спрашивает токен у хранилища сессии, а
/// хранилище обновляет сессию через собственный клиент без авторизации. Если
/// перепутать и дать ему общий клиент, обновление токена уйдёт в рекурсию.
enum AppServices {
    /// Транспорт у всех клиентов один. В обычной сборке это общий `URLSession`,
    /// в прогоне интерфейсных тестов — он же, но с подменой ответов: обход экранов
    /// не должен зависеть ни от сети, ни от состояния стенда.
    private static let urlSession: URLSession = {
        #if DEBUG
            if UITestMode.isActive {
                let configuration = URLSessionConfiguration.ephemeral
                configuration.protocolClasses = [UITestStubProtocol.self]
                return URLSession(configuration: configuration)
            }
        #endif
        return .shared
    }()

    static let auth = AuthAPI(client: APIClient(session: urlSession, authorization: nil))
    static let session = SessionStore(auth: auth)
    static let api = APIClient(session: urlSession, authorization: session)
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

    /// Локальная база чатов. Создаётся лениво, но до первого экрана, которому она
    /// нужна: миграции обязаны пройти раньше первого чтения.
    ///
    /// Файл не открылся (повреждение, нет места) — удаляем и заводим заново, а если
    /// и это не вышло, работаем в памяти. Приложение без базы бесполезно, но падение
    /// на старте бесполезно вдвойне: человек не увидит даже причины.
    static let database: AppDatabase = {
        let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "kz.studenthub.app", category: "storage")
        do {
            return try AppDatabase.onDisk()
        } catch {
            log.error("Не открылась база чатов, пробуем завести заново: \(error.localizedDescription, privacy: .public)")
        }
        do {
            try AppDatabase.removeStore()
            return try AppDatabase.onDisk()
        } catch {
            log.error("База чатов недоступна, работаем в памяти: \(error.localizedDescription, privacy: .public)")
        }
        do {
            return try AppDatabase.inMemory()
        } catch {
            // Память не открылась — это уже не про хранилище, а про нехватку ресурсов
            // процесса, и работать дальше всё равно нечем.
            preconditionFailure("Не удалось создать базу даже в памяти: \(error)")
        }
    }()
}

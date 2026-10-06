import Foundation

/// Сборка зависимостей приложения в одном месте.
///
/// Порядок здесь не случайный: клиент API спрашивает токен у хранилища сессии, а
/// хранилище обновляет сессию через собственный клиент без авторизации. Если
/// перепутать и дать ему общий клиент, обновление токена уйдёт в рекурсию.
enum AppServices {
    static let auth = AuthAPI()
    static let session = SessionStore(auth: auth)
    static let api = APIClient(authorization: session)
    /// Подтверждение входа по QR — наоборот, только с авторизацией: пользователя
    /// сервер берёт из токена.
    static let qrLogin = QRLoginAPI(client: api)
}

import Foundation

/// Реестр кодов ошибок API (PROJECT.md §8.2).
///
/// Клиент реагирует на код, а не на текст: тексты сервер отдаёт по-русски и меняет,
/// когда захочет. Незнакомый код не роняет разбор — он попадает в `unknown`, и
/// экран показывает серверное сообщение как есть. Это важно для старых сборок:
/// новый код на сервере появится раньше, чем все обновят приложение.
enum APIErrorCode: Equatable {
    case badRequest
    case unauthorized
    case tokenExpired
    case forbidden
    case wrongScope
    case notFound
    case conflict
    case inviteExpired
    case inviteUsed
    case inviteRevoked
    case fileTypeNotAllowed
    case fileTooLarge
    case fileDirectUploadRequired
    case validationError
    case rateLimit
    case internalError
    case invalidTwoFactorCode
    case twoFactorSetupRequired
    case usernameTaken
    case maintenance
    case loginLocked
    case unknown(String)

    init(rawValue: String) {
        switch rawValue {
        case "BAD_REQUEST": self = .badRequest
        case "UNAUTHORIZED": self = .unauthorized
        case "TOKEN_EXPIRED": self = .tokenExpired
        case "FORBIDDEN": self = .forbidden
        case "WRONG_SCOPE": self = .wrongScope
        case "NOT_FOUND": self = .notFound
        case "CONFLICT": self = .conflict
        case "INVITE_EXPIRED": self = .inviteExpired
        case "INVITE_USED": self = .inviteUsed
        case "INVITE_REVOKED": self = .inviteRevoked
        case "FILE_TYPE_NOT_ALLOWED": self = .fileTypeNotAllowed
        case "FILE_TOO_LARGE": self = .fileTooLarge
        case "FILE_DIRECT_UPLOAD_REQUIRED": self = .fileDirectUploadRequired
        case "VALIDATION_ERROR": self = .validationError
        case "RATE_LIMIT": self = .rateLimit
        case "INTERNAL_ERROR": self = .internalError
        case "INVALID_2FA_CODE": self = .invalidTwoFactorCode
        case "TWO_FACTOR_SETUP_REQUIRED": self = .twoFactorSetupRequired
        case "USERNAME_TAKEN": self = .usernameTaken
        case "MAINTENANCE": self = .maintenance
        case "LOGIN_LOCKED": self = .loginLocked
        default: self = .unknown(rawValue)
        }
    }

    /// Токен протух или не принят: единственный повод попробовать обновить сессию.
    /// `forbidden` сюда не входит — прав нет, и повтор ничего не изменит.
    var meansSessionExpired: Bool {
        self == .unauthorized || self == .tokenExpired
    }
}

/// Всё, чем может закончиться запрос.
enum APIError: Error {
    /// Сеть не дала ответа: нет связи, таймаут, обрыв.
    case transport(URLError)
    /// Сервер ответил ошибкой по контракту.
    case server(code: APIErrorCode, message: String, details: [APIErrorDetail], statusCode: Int)
    /// Ответ пришёл, но прочитать его не удалось — расхождение контракта.
    /// Чинится не повтором, а правкой модели, поэтому не глушим.
    case decoding(underlying: Error, statusCode: Int)
    /// Ответ без тела там, где оно обязано быть, или нечитаемый статус.
    case malformedResponse(statusCode: Int)

    /// Текст для человека. Серверное сообщение уже на языке платформы, поэтому
    /// показываем его; свои строки — только там, где сервер ничего не сказал.
    var displayMessage: String {
        switch self {
        case .server(_, let message, _, _):
            return message
        case .transport:
            return String(localized: "error.network", defaultValue: "Нет связи с сервером")
        case .decoding, .malformedResponse:
            return String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }

    var code: APIErrorCode? {
        if case .server(let code, _, _, _) = self { return code }
        return nil
    }
}

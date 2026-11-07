import Foundation

/// Каналы и темы уведомлений (`UpdateNotificationSettingsSchema`). Все поля
/// необязательны: PATCH уходит только с тем, что поменяли, а схема строгая — чужое
/// поле в теле означает `400`.
struct NotificationPreferencesDTO: Codable, Equatable {
    var pushEnabled: Bool?
    var emailEnabled: Bool?
    var scheduleChangeEnabled: Bool?
    var messageEnabled: Bool?
    var postEnabled: Bool?
    var eventEnabled: Bool?
    var appUpdateEnabled: Bool?
    var systemEnabled: Bool?
}

/// Ответ `POST /auth/2fa/setup`: секрет для приложения-аутентификатора и та же ссылка
/// QR-картинкой (`data:` URL).
struct TwoFactorSetupDTO: Decodable, Equatable {
    let secret: String
    let otpauthUrl: String
    let qr: String?
}

struct BackupCodesDTO: Decodable, Equatable {
    let backupCodes: [String]
}

/// Можно ли удалить аккаунт прямо сейчас. Книги на руках не дают удалиться — сервер
/// отвечает `409`, поэтому проверяем заранее и объясняем, а не отказываем после пароля.
struct DeletionCheckDTO: Decodable, Equatable {
    let canDelete: Bool
    let blockers: [String]
}

/// Обращение в поддержку открывает чат с командой платформы — его и показываем.
struct SupportTicketDTO: Decodable, Equatable {
    let id: String
    let created: Bool?
}

/// Поля профиля, которые человек правит сам (`UpdateProfileSchema`). `nil` — поле не
/// трогаем; пустая строка — очистить. Какие поля разрешены роли, решает сервер:
/// экран показывает только разрешённые, иначе PATCH вернул бы `400`.
struct ProfileUpdate: Encodable, Equatable {
    var firstName: String?
    var lastName: String?
    var middleName: String?
    var headline: String?
    var bio: String?
    var phone: String?
    var telegram: String?
    var instagram: String?
    var website: String?
    var skills: [String]?
    var interests: [String]?
    var showEmail: Bool?
    var showPhone: Bool?
    var profileVisibility: String?
    var locale: String?
    var officeRoom: String?
    var officeHours: String?
    var department: String?
}

protocol AccountFetching: Sendable {
    func updateProfile(_ update: ProfileUpdate) async throws -> UserProfileDTO
    func uploadCover(_ data: Data, mime: String) async throws -> UserProfileDTO
    func removeCover() async throws -> UserProfileDTO
    func removeAvatar() async throws -> UserProfileDTO
    func changeUsername(_ username: String) async throws -> UserProfileDTO
    func notificationPreferences() async throws -> NotificationPreferencesDTO
    func updateNotificationPreferences(_ change: NotificationPreferencesDTO) async throws -> NotificationPreferencesDTO
    func changePassword(current: String, new: String) async throws
    func setupTwoFactor() async throws -> TwoFactorSetupDTO
    func enableTwoFactor(code: String) async throws -> BackupCodesDTO
    func disableTwoFactor(code: String) async throws
    func regenerateBackupCodes(code: String) async throws -> BackupCodesDTO
    func deletionCheck() async throws -> DeletionCheckDTO
    func deleteAccount(password: String, code: String?) async throws
    func exportData(locale: String) async throws -> Data
    func contactSupport(text: String) async throws -> SupportTicketDTO
}

struct AccountAPI: AccountFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func updateProfile(_ update: ProfileUpdate) async throws -> UserProfileDTO {
        try await client.send(
            Endpoint(method: .patch, path: "users/me", body: try JSONCoding.encoder.encode(update)),
            as: UserProfileDTO.self
        )
    }

    /// Обложка — multipart, как и аватар: маршрут принимает файл, а не ссылку.
    func uploadCover(_ data: Data, mime: String) async throws -> UserProfileDTO {
        var form = MultipartForm()
        form.append(data, name: "file", filename: "cover.jpg", mime: mime)
        return try await client.send(.multipart("users/me/cover", form: form), as: UserProfileDTO.self)
    }

    func removeCover() async throws -> UserProfileDTO {
        try await client.send(Endpoint(method: .delete, path: "users/me/cover"), as: UserProfileDTO.self)
    }

    func removeAvatar() async throws -> UserProfileDTO {
        try await client.send(Endpoint(method: .delete, path: "users/me/avatar"), as: UserProfileDTO.self)
    }

    func changeUsername(_ username: String) async throws -> UserProfileDTO {
        struct Body: Encodable { let username: String }
        return try await client.send(
            Endpoint(method: .patch, path: "users/me/username", body: try JSONCoding.encoder.encode(Body(username: username))),
            as: UserProfileDTO.self
        )
    }

    func notificationPreferences() async throws -> NotificationPreferencesDTO {
        try await client.send(.get("notifications/settings"), as: NotificationPreferencesDTO.self)
    }

    func updateNotificationPreferences(_ change: NotificationPreferencesDTO) async throws -> NotificationPreferencesDTO {
        try await client.send(
            Endpoint(method: .patch, path: "notifications/settings", body: try JSONCoding.encoder.encode(change)),
            as: NotificationPreferencesDTO.self
        )
    }

    /// Смена пароля гасит все сессии, включая эту: после ответа приложение выходит.
    func changePassword(current: String, new: String) async throws {
        struct Body: Encodable {
            let currentPassword: String
            let newPassword: String
        }
        try await client.send(
            Endpoint(
                method: .patch,
                path: "users/me/password",
                body: try JSONCoding.encoder.encode(Body(currentPassword: current, newPassword: new))
            )
        )
    }

    func setupTwoFactor() async throws -> TwoFactorSetupDTO {
        try await client.send(.post("auth/2fa/setup"), as: TwoFactorSetupDTO.self)
    }

    func enableTwoFactor(code: String) async throws -> BackupCodesDTO {
        try await client.send(.post("auth/2fa/enable", json: CodeBody(code: code)), as: BackupCodesDTO.self)
    }

    func disableTwoFactor(code: String) async throws {
        try await client.send(.post("auth/2fa/disable", json: CodeBody(code: code)))
    }

    func regenerateBackupCodes(code: String) async throws -> BackupCodesDTO {
        try await client.send(.post("auth/2fa/backup-codes", json: CodeBody(code: code)), as: BackupCodesDTO.self)
    }

    func deletionCheck() async throws -> DeletionCheckDTO {
        try await client.send(.get("users/me/deletion-check"), as: DeletionCheckDTO.self)
    }

    func deleteAccount(password: String, code: String?) async throws {
        struct Body: Encodable {
            let password: String
            let code: String?
        }
        try await client.send(
            Endpoint(
                method: .delete,
                path: "users/me",
                body: try JSONCoding.encoder.encode(Body(password: password, code: code))
            )
        )
    }

    /// Выгрузка персональных данных — файл JSON телом ответа, не в конверте.
    func exportData(locale: String) async throws -> Data {
        try await client.data(.get("me/export", query: [URLQueryItem(name: "locale", value: locale)]))
    }

    func contactSupport(text: String) async throws -> SupportTicketDTO {
        struct Body: Encodable { let text: String }
        return try await client.send(.post("support", json: Body(text: text)), as: SupportTicketDTO.self)
    }

    private struct CodeBody: Encodable {
        let code: String
    }
}

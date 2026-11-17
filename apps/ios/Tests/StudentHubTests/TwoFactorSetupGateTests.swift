import XCTest

@testable import StudentHub

/// Обязательная 2FA сразу после входа: кого ведём на настройку и как экран её проводит.
@MainActor
final class TwoFactorSetupGateTests: XCTestCase {
    // MARK: - Кому обязательна

    /// Тот же список, что `TWO_FACTOR_REQUIRED_ROLES` в shared-types: разойдутся — либо
    /// человек упрётся в отказы сервера в оболочке, либо его зря не пустят дальше настройки.
    func testRequiredRolesMatchServerList() {
        let required = Set(Role.allCases.filter(\.requiresTwoFactor))
        XCTAssertEqual(
            required,
            [.platformAdmin, .platformModerator, .universityAdmin, .universityModerator, .dean, .securityGuard, .librarian]
        )
    }

    func testTokenNeedsSetupOnlyForRequiredRoleWithout2FA() throws {
        XCTAssertTrue(try token(role: "PLATFORM_ADMIN", tfa: false).needsTwoFactorSetup)
        XCTAssertTrue(try token(role: "DEAN", tfa: nil).needsTwoFactorSetup)
        XCTAssertFalse(try token(role: "PLATFORM_ADMIN", tfa: true).needsTwoFactorSetup)
        XCTAssertFalse(try token(role: "STUDENT", tfa: false).needsTwoFactorSetup)
        XCTAssertFalse(try token(role: "TEACHER", tfa: false).needsTwoFactorSetup)
    }

    // MARK: - Экран настройки

    func testEnableShowsBackupCodesThenContinueRefreshesSession() async {
        let api = FakeTwoFactorAPI()
        var completions = 0
        let model = TwoFactorSetupGateModel(api: api) {
            completions += 1
            return true
        }

        await model.load()
        XCTAssertEqual(model.phase, .enroll(FakeTwoFactorAPI.setup))

        model.code = "123456"
        await model.enable()
        XCTAssertEqual(api.enabledWith, ["123456"])
        XCTAssertEqual(model.phase, .backupCodes(["AAAA1111", "BBBB2222"]))
        XCTAssertEqual(model.code, "")
        XCTAssertEqual(completions, 0, "коды показываются до входа в приложение")

        await model.finish()
        XCTAssertEqual(completions, 1)
        XCTAssertNil(model.formError)
    }

    func testWrongCodeStaysOnEnrollWithFieldError() async {
        let api = FakeTwoFactorAPI()
        api.enableError = APIError.server(code: .invalidTwoFactorCode, message: "Неверный код", details: [], statusCode: 401)
        let model = TwoFactorSetupGateModel(api: api) { true }

        await model.load()
        model.code = "000000"
        await model.enable()

        XCTAssertEqual(model.phase, .enroll(FakeTwoFactorAPI.setup))
        XCTAssertNotNil(model.codeError)
        XCTAssertNil(model.formError)
        XCTAssertEqual(model.code, "")
    }

    func testShortCodeIsNotSent() async {
        let api = FakeTwoFactorAPI()
        let model = TwoFactorSetupGateModel(api: api) { true }

        await model.load()
        model.code = "123"
        await model.enable()

        XCTAssertTrue(api.enabledWith.isEmpty)
        XCTAssertNotNil(model.codeError)
    }

    /// 2FA уже включена (в вебе), а токен старый: настраивать нечего — сразу продление.
    func testAlreadyEnabledSkipsStraightToSession() async {
        let api = FakeTwoFactorAPI()
        api.setupError = APIError.server(code: .conflict, message: "Уже включена", details: [], statusCode: 409)
        var completions = 0
        let model = TwoFactorSetupGateModel(api: api) {
            completions += 1
            return true
        }

        await model.load()

        XCTAssertEqual(completions, 1)
        XCTAssertNil(model.formError)
    }

    /// Продление не дошло — экран кодов остаётся, повтор той же кнопкой.
    func testFailedRefreshKeepsCodesAndShowsError() async {
        let api = FakeTwoFactorAPI()
        let model = TwoFactorSetupGateModel(api: api) { false }

        await model.load()
        model.code = "123456"
        await model.enable()
        await model.finish()

        XCTAssertEqual(model.phase, .backupCodes(["AAAA1111", "BBBB2222"]))
        XCTAssertNotNil(model.formError)
    }

    func testSetupFailureShowsRetryableError() async {
        let api = FakeTwoFactorAPI()
        api.setupError = APIError.transport(URLError(.notConnectedToInternet))
        let model = TwoFactorSetupGateModel(api: api) { true }

        await model.load()

        XCTAssertEqual(model.phase, .loading)
        XCTAssertNotNil(model.formError)
        XCTAssertTrue(model.formErrorIsOffline)

        api.setupError = nil
        await model.load()
        XCTAssertEqual(model.phase, .enroll(FakeTwoFactorAPI.setup))
        XCTAssertNil(model.formError)
    }

    // MARK: - Внутреннее

    private func token(role: String, tfa: Bool?) throws -> AccessToken {
        let tfaPart = tfa.map { #","tfa":\#($0)"# } ?? ""
        let payload = #"{"sub":"u-1","role":"\#(role)"\#(tfaPart),"exp":4102444800}"#
        let encoded = Data(payload.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return try XCTUnwrap(AccessToken(raw: "header.\(encoded).signature"))
    }
}

/// Аккаунт с одной настройкой 2FA; остальное экрану не нужно.
private final class FakeTwoFactorAPI: AccountFetching, @unchecked Sendable {
    static let setup = TwoFactorSetupDTO(secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/StudentHub:a?secret=JBSWY3DPEHPK3PXP", qr: nil)

    var setupError: Error?
    var enableError: Error?
    private(set) var enabledWith: [String] = []

    func setupTwoFactor() async throws -> TwoFactorSetupDTO {
        if let setupError { throw setupError }
        return Self.setup
    }

    func enableTwoFactor(code: String) async throws -> BackupCodesDTO {
        if let enableError { throw enableError }
        enabledWith.append(code)
        return BackupCodesDTO(backupCodes: ["AAAA1111", "BBBB2222"])
    }

    func updateProfile(_ update: ProfileUpdate) async throws -> UserProfileDTO { throw unused }
    func uploadCover(_ data: Data, mime: String) async throws -> UserProfileDTO { throw unused }
    func removeCover() async throws -> UserProfileDTO { throw unused }
    func removeAvatar() async throws -> UserProfileDTO { throw unused }
    func changeUsername(_ username: String) async throws -> UserProfileDTO { throw unused }
    func notificationPreferences() async throws -> NotificationPreferencesDTO { throw unused }
    func updateNotificationPreferences(_ change: NotificationPreferencesDTO) async throws -> NotificationPreferencesDTO {
        throw unused
    }
    func changePassword(current: String, new: String) async throws { throw unused }
    func disableTwoFactor(code: String) async throws { throw unused }
    func regenerateBackupCodes(code: String) async throws -> BackupCodesDTO { throw unused }
    func deletionCheck() async throws -> DeletionCheckDTO { throw unused }
    func deleteAccount(password: String, code: String?) async throws { throw unused }
    func exportData(locale: String) async throws -> Data { throw unused }
    func contactSupport(text: String) async throws -> SupportTicketDTO { throw unused }

    private var unused: Error { URLError(.unsupportedURL) }
}

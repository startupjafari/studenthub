import Foundation
import Observation

/// Состояние экрана входа.
///
/// Два шага живут в одной модели, а не в двух: между ними переносится challenge,
/// и разделение потребовало бы передавать его экранами. Поля очищаются сразу после
/// успеха — пароль и код не должны пережить вход даже в памяти формы.
@Observable
final class LoginModel {
    enum Step: Equatable {
        case credentials
        case twoFactor
    }

    var identifier = ""
    var password = ""
    var code = ""

    private(set) var step: Step = .credentials
    private(set) var isBusy = false
    /// Ошибка всей формы: неверная пара логин-пароль, блокировка, нет связи.
    private(set) var formError: String?
    private(set) var identifierError: String?
    private(set) var passwordError: String?
    private(set) var codeError: String?

    private var challengeToken: String?
    private let auth: SessionIssuing

    init(auth: SessionIssuing = AppServices.auth) {
        self.auth = auth
    }

    /// Первый шаг. Пустые поля ловим на клиенте: гонять заведомо негодный запрос
    /// незачем, а лимит входов на сервере общий — пять попыток за 15 минут.
    @MainActor
    func signIn(into session: AppSessionModel) async {
        guard !isBusy else { return }
        clearErrors()

        let login = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        if login.isEmpty {
            identifierError = String(
                localized: "auth.error.identifierRequired",
                defaultValue: "Введите email или имя пользователя"
            )
        }
        if password.isEmpty {
            passwordError = String(localized: "auth.error.passwordRequired", defaultValue: "Введите пароль")
        }
        guard identifierError == nil, passwordError == nil else { return }

        isBusy = true
        defer { isBusy = false }

        do {
            switch try await auth.signIn(identifier: login, password: password) {
            case .session(let issued):
                await adopt(issued, into: session)
            case .twoFactorRequired(let challenge):
                challengeToken = challenge
                code = ""
                step = .twoFactor
            }
        } catch {
            handle(error)
        }
    }

    /// Второй шаг. Шесть цифр из приложения-аутентификатора или резервный код —
    /// какой именно, сервер разберёт сам.
    @MainActor
    func verifyTwoFactor(into session: AppSessionModel) async {
        guard !isBusy, let challengeToken else { return }
        codeError = nil
        formError = nil

        let entered = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard entered.count >= 6 else {
            codeError = String(localized: "auth.error.codeTooShort", defaultValue: "Код из 6 цифр или резервный код")
            return
        }

        isBusy = true
        defer { isBusy = false }

        do {
            let issued = try await auth.verifyTwoFactor(challengeToken: challengeToken, code: entered)
            await adopt(issued, into: session)
        } catch {
            handle(error)
        }
    }

    /// Назад к логину и паролю. Challenge при этом выбрасываем: он одноразовый и
    /// живёт считаные минуты — возвращаться к нему всё равно нельзя.
    @MainActor
    func startOver() {
        step = .credentials
        challengeToken = nil
        code = ""
        password = ""
        clearErrors()
    }

    // MARK: - Внутреннее

    @MainActor
    private func adopt(_ issued: AuthSession, into session: AppSessionModel) async {
        guard await session.adopt(issued) else {
            formError = String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
            return
        }
        password = ""
        code = ""
        challengeToken = nil
        step = .credentials
    }

    /// Куда попадает текст ошибки, решает её код, а не экран: сообщение про код 2FA
    /// под полем кода, всё остальное — над формой (§10.3). Серверные тексты уже на
    /// языке платформы, поэтому показываем их как есть.
    @MainActor
    private func handle(_ error: Error) {
        guard let apiError = error as? APIError else {
            formError = String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
            return
        }

        guard case .server(let code, let message, let details, _) = apiError else {
            formError = apiError.displayMessage
            return
        }

        for detail in details {
            switch detail.field {
            case "identifier": identifierError = detail.message
            case "password": passwordError = detail.message
            case "code": codeError = detail.message
            default: formError = detail.message
            }
        }
        guard details.isEmpty else { return }

        if code == .invalidTwoFactorCode {
            codeError = message
        } else {
            formError = message
        }
    }

    @MainActor
    private func clearErrors() {
        formError = nil
        identifierError = nil
        passwordError = nil
        codeError = nil
    }
}

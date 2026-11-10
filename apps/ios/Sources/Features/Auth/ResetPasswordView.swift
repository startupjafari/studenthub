import Observation
import SwiftUI

/// Новый пароль по ссылке из письма (`/reset-password?token=…`).
///
/// Сессию сброс не выдаёт: после него гаснут все сессии, и человек входит сам — так новый
/// пароль сразу проверяется на деле, а 2FA не обходится ссылкой из почты.
@MainActor
@Observable
final class ResetPasswordModel {
    enum Phase: Equatable {
        case form
        case done
        /// Ссылка обрезана, устарела или уже использована. Сервер эти случаи не различает,
        /// и выход у них один — запросить новую.
        case invalid
    }

    var password = ""
    private(set) var phase: Phase
    private(set) var isSaving = false
    private(set) var passwordError: String?
    private(set) var formError: String?
    private(set) var formErrorIsOffline = false

    let token: String
    private let api: AuthRecovering

    init(token: String, api: AuthRecovering = AuthRecoveryAPI()) {
        self.token = token
        self.api = api
        // Ссылку, обрезанную почтовым клиентом, видно сразу: токен не проходит ту же
        // границу длины, что проверит сервер (`ResetPasswordSchema`, 16…200).
        phase = Self.isPlausible(token) ? .form : .invalid
    }

    static func isPlausible(_ token: String) -> Bool {
        token.count >= 16 && AuthLink.isWellFormed(token)
    }

    /// Пароль исправляют — прежняя ошибка к нему уже не относится.
    func clearPasswordError() {
        passwordError = nil
    }

    func save() async {
        guard !isSaving, phase == .form else { return }
        formError = nil
        formErrorIsOffline = false
        if let problem = PasswordPolicy.problem(password) {
            passwordError = problem
            return
        }
        passwordError = nil
        isSaving = true
        defer { isSaving = false }
        do {
            try await api.resetPassword(token: token, password: password)
            password = ""
            phase = .done
        } catch let error as APIError where error.code == .badRequest {
            phase = .invalid
        } catch let error as APIError where error.code == .validationError {
            passwordError = error.displayMessage
        } catch {
            formError = error.userMessage
            formErrorIsOffline = error.isOffline
        }
    }
}

struct ResetPasswordView: View {
    let token: String
    /// Пароль изменён — назад к форме входа.
    let backToLogin: () -> Void
    /// Ссылка не работает — на экран «Восстановление пароля».
    let requestNewLink: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model: ResetPasswordModel
    @State private var showsPassword = false
    @FocusState private var isPasswordFocused: Bool

    init(token: String, backToLogin: @escaping () -> Void, requestNewLink: @escaping () -> Void) {
        self.token = token
        self.backToLogin = backToLogin
        self.requestNewLink = requestNewLink
        _model = State(initialValue: ResetPasswordModel(token: token))
    }

    var body: some View {
        AuthScaffold {
            StudentHubBrandHeader(
                title: String(localized: "auth.resetTitle", defaultValue: "Новый пароль"),
                subtitle: String(
                    localized: "auth.resetSubtitle",
                    defaultValue: "После смены пароля выйдем на всех устройствах — войдите заново."
                ),
                showsWordmark: false,
                subtitleIsEssential: true
            )
        } panel: {
            switch model.phase {
            case .form:
                form
            case .done:
                AuthNotice(
                    kind: .success,
                    title: String(localized: "auth.resetDoneTitle", defaultValue: "Пароль изменён"),
                    message: String(localized: "auth.resetDoneText", defaultValue: "Войдите с новым паролем.")
                )
                StudentHubPrimaryButton(
                    title: String(localized: "auth.backToLogin", defaultValue: "Вернуться ко входу"),
                    action: backToLogin
                )
            case .invalid:
                AuthNotice(
                    kind: .expired,
                    title: String(localized: "auth.resetInvalidTitle", defaultValue: "Ссылка не работает"),
                    message: String(
                        localized: "auth.resetInvalidText",
                        defaultValue: "Она устарела или уже использована. Запросите новую — она придёт на почту."
                    )
                )
                StudentHubPrimaryButton(
                    title: String(localized: "auth.resetRequestAgain", defaultValue: "Запросить новую ссылку"),
                    action: requestNewLink
                )
                AuthTextLink(title: String(localized: "auth.backToLogin", defaultValue: "Вернуться ко входу"), action: backToLogin)
                    .frame(maxWidth: .infinity)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .animation(AuthMotion.layout(reduceMotion: reduceMotion), value: model.phase)
        .onAppear {
            if model.phase == .form { isPasswordFocused = true }
        }
    }

    @ViewBuilder
    private var form: some View {
        AuthFormError(message: model.formError, isOffline: model.formErrorIsOffline, retry: submit)

        NewPasswordField(
            label: String(localized: "auth.newPassword", defaultValue: "Новый пароль"),
            password: $model.password,
            isVisible: $showsPassword,
            error: model.passwordError,
            focus: $isPasswordFocused,
            submitLabel: .go,
            submit: submit
        )
        .disabled(model.isSaving)
        .onChange(of: model.password) { model.clearPasswordError() }

        StudentHubPrimaryButton(
            title: String(localized: "auth.resetSubmit", defaultValue: "Сохранить пароль"),
            isLoading: model.isSaving,
            action: submit
        )
        .onChange(of: model.isSaving) { _, saving in
            if saving { isPasswordFocused = false }
        }
    }

    private func submit() {
        Task {
            await model.save()
            if model.passwordError != nil { isPasswordFocused = true }
        }
    }
}

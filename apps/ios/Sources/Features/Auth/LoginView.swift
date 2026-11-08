import SwiftUI

/// Экран входа: фирменная шапка сверху, форма — в нижней панели.
///
/// Логика входа не здесь, а в `LoginModel` (два шага: пароль и код 2FA) и в
/// `AppSessionModel` (сессия, связка ключей). Экран отвечает только за подачу и за
/// переходы: вход по QR, восстановление пароля, документы.
///
/// Тексты — как в вебе (`apps/web/messages/*.json`, раздел `Auth`): один продукт не
/// должен здороваться по-разному на телефоне и в браузере.
struct LoginView: View {
    let session: AppSessionModel

    @State private var model = LoginModel()
    @State private var path: [AuthRoute] = []
    @State private var showsEmployerSignup = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack(path: $path) {
            AuthScaffold {
                StudentHubBrandHeader(
                    title: [
                        String(localized: "auth.hero.education", defaultValue: "Образование."),
                        String(localized: "auth.hero.communication", defaultValue: "Общение."),
                        String(localized: "auth.hero.opportunities", defaultValue: "Возможности."),
                    ].joined(separator: " "),
                    subtitle: String(
                        localized: "auth.brandSubtitle",
                        defaultValue: "Единая платформа для студентов и преподавателей вашего университета"
                    )
                )
            } panel: {
                switch model.step {
                case .credentials:
                    CredentialsStepView(
                        model: model,
                        session: session,
                        forgotPassword: { path.append(.forgotPassword) },
                        qrSignIn: { path.append(.qrSignIn) }
                    )
                    StudentHubLegalLinks()
                case .twoFactor:
                    TwoFactorStepView(model: model, session: session)
                }
            }
            .animation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion), value: model.step)
            .toolbar { toolbarItems }
            .navigationDestination(for: AuthRoute.self) { route in
                switch route {
                case .qrSignIn:
                    QRSignInView(session: session)
                case .forgotPassword:
                    ForgotPasswordView(prefill: model.identifier)
                case .legal(let document):
                    LegalDocumentView(document: document)
                }
            }
        }
        .sheet(isPresented: $showsEmployerSignup) {
            CareerSignupSheet(session: session)
        }
    }

    /// Регистрация работодателя — единственный вход без инвайта вуза — кнопкой в верхней
    /// панели: она нужна немногим, и место в форме ей не по чину.
    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                showsEmployerSignup = true
            } label: {
                Text(String(localized: "auth.employerShort", defaultValue: "Работодателям"))
            }
            .accessibilityHint(Text(String(localized: "career.signup.entry", defaultValue: "Я работодатель — зарегистрироваться")))
        }
    }
}

/// Первый шаг: идентификатор и пароль.
private struct CredentialsStepView: View {
    @Bindable var model: LoginModel
    let session: AppSessionModel
    let forgotPassword: () -> Void
    let qrSignIn: () -> Void

    @FocusState private var focus: Field?
    @State private var showsPassword = false

    private enum Field {
        case identifier
        case password
    }

    var body: some View {
        AuthPanelTitle(title: String(localized: "auth.panelTitle", defaultValue: "Вход в аккаунт"))

        AuthFormError(message: model.formError, isOffline: model.formErrorIsOffline, retry: submit)

        StudentHubField(
            label: nil,
            error: model.identifierError,
            isFocused: focus == .identifier
        ) {
            TextField(
                text: $model.identifier,
                prompt: Text(String(localized: "auth.identifier", defaultValue: "Email или имя пользователя"))
            ) {
                Text(String(localized: "auth.identifier", defaultValue: "Email или имя пользователя"))
            }
            // Автозаполнение паролей: логин и пароль — пара `.username`/`.password`, по
            // ней iOS предлагает сохранённую учётную запись.
            .textContentType(.username)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.next)
            .focused($focus, equals: .identifier)
            .onSubmit { focus = .password }
        }

        StudentHubField(
            label: nil,
            error: model.passwordError,
            isFocused: focus == .password
        ) {
            passwordField
        } accessory: {
            PasswordVisibilityToggle(isVisible: $showsPassword)
        }

        HStack {
            Spacer(minLength: 0)
            AuthTextLink(title: String(localized: "auth.forgotPassword", defaultValue: "Забыли пароль?"), action: forgotPassword)
        }
        .padding(.vertical, -Spacing.md)

        StudentHubPrimaryButton(
            title: model.isBusy
                ? String(localized: "auth.signingIn", defaultValue: "Входим…")
                : String(localized: "auth.signIn", defaultValue: "Войти"),
            isLoading: model.isBusy,
            action: submit
        )
        .accessibilityIdentifier("auth.signIn")

        StudentHubSecondaryButton(
            title: String(localized: "auth.qrTab", defaultValue: "Войти по QR-коду"),
            systemImage: "qrcode",
            action: qrSignIn
        )
        .accessibilityIdentifier("auth.qrSignIn")
    }

    /// Два поля вместо одного с флагом: `SecureField` и `TextField` — разные типы, и
    /// переключать видимость иначе нельзя. Тип содержимого у обоих `.password` —
    /// автозаполнение работает в любом режиме.
    @ViewBuilder
    private var passwordField: some View {
        Group {
            if showsPassword {
                TextField(text: $model.password, prompt: Text(passwordLabel)) { Text(passwordLabel) }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } else {
                SecureField(text: $model.password, prompt: Text(passwordLabel)) { Text(passwordLabel) }
            }
        }
        .textContentType(.password)
        .submitLabel(.go)
        .focused($focus, equals: .password)
        .onSubmit(submit)
    }

    private var passwordLabel: String {
        String(localized: "auth.password", defaultValue: "Пароль")
    }

    private func submit() {
        focus = nil
        Task { await model.signIn(into: session) }
    }
}

/// Подпись над полем (§10.3): ярлык, поле, ошибка — в этом порядке.
struct FieldLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
    }
}

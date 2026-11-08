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
    #if DEBUG
        @State private var showsTokenGallery = false
    #endif

    var body: some View {
        NavigationStack(path: $path) {
            AuthScaffold {
                StudentHubBrandHeader(
                    title: [
                        String(localized: "auth.hero.education", defaultValue: "Образование."),
                        String(localized: "auth.hero.communication", defaultValue: "Общение."),
                        String(localized: "auth.hero.opportunities", defaultValue: "Возможности."),
                    ].joined(separator: "\n"),
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
                    secondaryLinks
                case .twoFactor:
                    TwoFactorStepView(model: model, session: session)
                }
            }
            .animation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion), value: model.step)
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

    /// Регистрация работодателя — единственный вход без инвайта вуза, и юридические
    /// документы.
    @ViewBuilder
    private var secondaryLinks: some View {
        AuthTextLink(title: String(localized: "career.signup.entry", defaultValue: "Я работодатель — зарегистрироваться")) {
            showsEmployerSignup = true
        }
        .frame(maxWidth: .infinity)
        StudentHubLegalLinks()
        #if DEBUG
            // Витрина дизайн-ядра — на экране входа: до сервера дотягивается не всякая
            // отладочная сборка, а токены смотреть надо.
            Button {
                showsTokenGallery = true
            } label: {
                Text(verbatim: "Дизайн-ядро").font(.caption)
            }
            .frame(maxWidth: .infinity)
            .sheet(isPresented: $showsTokenGallery) {
                TokenGalleryView()
            }
        #endif
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
        AuthPanelTitle(
            title: String(localized: "auth.panelTitle", defaultValue: "Вход в аккаунт"),
            subtitle: String(localized: "auth.panelSubtitle", defaultValue: "Войдите, чтобы продолжить")
        )

        FormAlert(message: model.formError)

        StudentHubField(
            label: String(localized: "auth.identifier", defaultValue: "Email или имя пользователя"),
            error: model.identifierError,
            isFocused: focus == .identifier
        ) {
            TextField(
                text: $model.identifier,
                prompt: Text(verbatim: String(
                    localized: "auth.identifierPlaceholder",
                    defaultValue: "you@example.com или username"
                ))
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
            label: String(localized: "auth.password", defaultValue: "Пароль"),
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
        .padding(.top, -Spacing.md)

        StudentHubPrimaryButton(
            title: model.isBusy
                ? String(localized: "auth.signingIn", defaultValue: "Входим…")
                : String(localized: "auth.signIn", defaultValue: "Войти"),
            isLoading: model.isBusy,
            action: submit
        )
        .accessibilityIdentifier("auth.signIn")

        AuthOrDivider()

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
                TextField(text: $model.password) { Text(passwordLabel) }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } else {
                SecureField(text: $model.password) { Text(passwordLabel) }
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

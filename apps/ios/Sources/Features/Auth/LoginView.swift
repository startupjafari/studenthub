import SwiftUI

/// Экран входа: фирменная шапка сверху, форма — в нижней панели.
///
/// Логика входа не здесь, а в `LoginModel` (два шага: пароль и код 2FA) и в
/// `AppSessionModel` (сессия, связка ключей). Экран отвечает только за подачу и за
/// переходы: вход по QR, восстановление пароля, документы, а также ссылки из писем —
/// новый пароль и регистрация по приглашению (`AuthLink`).
///
/// Тексты — как в вебе (`apps/web/messages/*.json`, раздел `Auth`): один продукт не
/// должен здороваться по-разному на телефоне и в браузере.
struct LoginView: View {
    let session: AppSessionModel
    /// Ссылка из письма, с которой открыли приложение: экран открывает её и обнуляет.
    @Binding var pendingLink: AuthLink?

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
                        qrSignIn: { path.append(.qrSignIn) },
                        pasteLink: { path.append(.pasteLink) }
                    )
                    StudentHubLegalLinks()
                case .twoFactor:
                    TwoFactorStepView(model: model, session: session)
                }
            }
            .animation(AuthMotion.layout(reduceMotion: reduceMotion), value: model.step)
            .toolbar { toolbarItems }
            .navigationDestination(for: AuthRoute.self) { route in
                switch route {
                case .qrSignIn:
                    QRSignInView(session: session)
                case .forgotPassword:
                    ForgotPasswordView(prefill: model.identifier)
                case .legal(let document):
                    LegalDocumentView(document: document)
                case .pasteLink:
                    PasteLinkView { open($0) }
                case .resetPassword(let token):
                    ResetPasswordView(
                        token: token,
                        backToLogin: { path.removeAll() },
                        requestNewLink: { path = [.forgotPassword] }
                    )
                case .register(let token):
                    RegisterView(token: token, session: session) { path.removeAll() }
                }
            }
        }
        // `initial` — ссылка могла прийти до появления экрана: холодный старт по ссылке.
        .onChange(of: pendingLink, initial: true) { _, link in
            guard let link else { return }
            pendingLink = nil
            open(link)
        }
        .sheet(isPresented: $showsEmployerSignup) {
            CareerSignupSheet(session: session)
        }
    }

    /// Ссылка из письма открывается поверх формы входа: «назад» ведёт ко входу, а не
    /// на экран, откуда ссылку вставили.
    private func open(_ link: AuthLink) {
        showsEmployerSignup = false
        switch link {
        case .resetPassword(let token):
            path = [.resetPassword(token: token)]
        case .register(let token):
            path = [.register(token: token)]
        }
    }

    /// Регистрация работодателя — единственный вход без инвайта вуза — кнопкой в верхней
    /// панели: она нужна немногим, и место в форме ей не по чину. На шаге кода её нет:
    /// там слева «Назад» — тот же шеврон, что у остальных экранов до входа.
    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        if model.step == .twoFactor {
            ToolbarItem(placement: .topBarLeading) {
                AuthBackButton(
                    accessibilityLabel: String(localized: "auth.twoFactorBack", defaultValue: "Назад ко входу")
                ) {
                    model.startOver()
                }
                .disabled(model.isBusy)
            }
        } else {
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
}

/// Первый шаг: идентификатор и пароль.
private struct CredentialsStepView: View {
    @Bindable var model: LoginModel
    let session: AppSessionModel
    let forgotPassword: () -> Void
    let qrSignIn: () -> Void
    let pasteLink: () -> Void

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
            isFocused: focus == .identifier,
            focus: { focus = .identifier }
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
            .disabled(model.isBusy)
            .onChange(of: model.identifier) { model.clearError(for: .identifier) }
        }

        StudentHubField(
            label: nil,
            error: model.passwordError,
            isFocused: focus == .password,
            focus: { focus = .password }
        ) {
            passwordField
        } accessory: {
            PasswordVisibilityToggle(isVisible: $showsPassword)
        }

        // Приглашение — в одной строке с «Забыли пароль?»: ссылка нужна раз в жизни, и
        // отдельная строка отняла бы у формы высоту на низком экране. Не влезли в ширину
        // (казахский, крупный шрифт) — встают друг под другом.
        ViewThatFits(in: .horizontal) {
            HStack {
                inviteLink
                Spacer(minLength: Spacing.md)
                forgotLink
            }
            VStack(alignment: .leading, spacing: 0) {
                forgotLink
                inviteLink
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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
        // Клавиатура уходит, когда запрос действительно ушёл: при пустом поле она
        // остаётся, а фокус встаёт в поле с ошибкой (`submit`).
        .onChange(of: model.isBusy) { _, busy in
            if busy { focus = nil }
        }

        StudentHubSecondaryButton(
            title: String(localized: "auth.qrTab", defaultValue: "Войти по QR-коду"),
            systemImage: "qrcode",
            action: qrSignIn
        )
        .disabled(model.isBusy)
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
        .disabled(model.isBusy)
        .onChange(of: model.password) { model.clearError(for: .password) }
    }

    private var inviteLink: some View {
        AuthTextLink(title: String(localized: "auth.haveInvite", defaultValue: "Есть приглашение?"), action: pasteLink)
            .accessibilityIdentifier("auth.pasteLink")
    }

    private var forgotLink: some View {
        AuthTextLink(title: String(localized: "auth.forgotPassword", defaultValue: "Забыли пароль?"), action: forgotPassword)
    }

    private var passwordLabel: String {
        String(localized: "auth.password", defaultValue: "Пароль")
    }

    private func submit() {
        Task {
            await model.signIn(into: session)
            if model.identifierError != nil {
                focus = .identifier
            } else if model.passwordError != nil {
                focus = .password
            }
        }
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

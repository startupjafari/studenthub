import SwiftUI

/// Экран входа: оболочка и первый шаг.
///
/// Тексты повторяют веб слово в слово (`apps/web/messages/ru.json`, раздел `Auth`):
/// один продукт не должен здороваться по-разному на телефоне и в браузере.
struct LoginView: View {
    let session: AppSessionModel

    @State private var model = LoginModel()
    #if DEBUG
        @State private var showsTokenGallery = false
    #endif

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xxl) {
                header
                switch model.step {
                case .credentials:
                    CredentialsStepView(model: model, session: session)
                case .twoFactor:
                    TwoFactorStepView(model: model, session: session)
                }
                #if DEBUG
                    galleryLink
                #endif
            }
            .padding(Spacing.xl)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.background)
        .scrollDismissesKeyboard(.interactively)
        .animation(Motion.calm, value: model.step)
    }

    private var header: some View {
        VStack(spacing: Spacing.md) {
            Text(String(localized: "auth.loginTitle", defaultValue: "Вход"))
                .font(Typography.pageTitle)
                .foregroundStyle(Palette.foreground)
            Text(String(localized: "auth.welcomeSubtitle", defaultValue: "Войдите в свой аккаунт"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
        }
        .padding(.top, Spacing.xxl)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    #if DEBUG
        /// Витрина дизайн-ядра держится на экране входа, а не за ним: до сервера
        /// дотягивается не всякая отладочная сборка, а токены смотреть надо.
        private var galleryLink: some View {
            Button {
                showsTokenGallery = true
            } label: {
                Text(verbatim: "Дизайн-ядро")
            }
            .buttonStyle(QuietButtonStyle())
            .sheet(isPresented: $showsTokenGallery) {
                TokenGalleryView()
            }
        }
    #endif
}

/// Первый шаг: идентификатор и пароль.
private struct CredentialsStepView: View {
    @Bindable var model: LoginModel
    let session: AppSessionModel

    @FocusState private var focus: Field?
    @State private var showsPassword = false

    private enum Field {
        case identifier
        case password
    }

    var body: some View {
        VStack(spacing: Spacing.xl) {
            FormAlert(message: model.formError)

            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel(text: String(localized: "auth.identifier", defaultValue: "Email или имя пользователя"))
                TextField(
                    text: $model.identifier,
                    prompt: Text(verbatim: String(
                        localized: "auth.identifierPlaceholder",
                        defaultValue: "you@example.com или username"
                    ))
                ) {
                    Text(verbatim: String(localized: "auth.identifier", defaultValue: "Email или имя пользователя"))
                }
                .labelsHidden()
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .submitLabel(.next)
                .accessibilityIdentifier("login.identifier")
                .focused($focus, equals: .identifier)
                .formField(isFocused: focus == .identifier, isInvalid: model.identifierError != nil)
                FieldError(message: model.identifierError)
            }

            VStack(alignment: .leading, spacing: Spacing.md) {
                FieldLabel(text: String(localized: "auth.password", defaultValue: "Пароль"))
                HStack(spacing: Spacing.md) {
                    passwordField
                    Button {
                        showsPassword.toggle()
                    } label: {
                        Image(systemName: showsPassword ? "eye.slash" : "eye")
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(showsPassword
                        ? String(localized: "auth.hidePassword", defaultValue: "Скрыть пароль")
                        : String(localized: "auth.showPassword", defaultValue: "Показать пароль")))
                }
                .formField(isFocused: focus == .password, isInvalid: model.passwordError != nil)
                FieldError(message: model.passwordError)
            }

            Button {
                submit()
            } label: {
                Text(model.isBusy
                    ? String(localized: "auth.signingIn", defaultValue: "Входим…")
                    : String(localized: "auth.signIn", defaultValue: "Войти"))
            }
            .buttonStyle(PrimaryButtonStyle(isLoading: model.isBusy))
            .accessibilityIdentifier("login.submit")
        }
        .onSubmit {
            if focus == .identifier {
                focus = .password
            } else {
                submit()
            }
        }
    }

    /// Два поля вместо одного с флагом: `SecureField` и `TextField` — разные типы,
    /// и переключать видимость иначе нельзя.
    @ViewBuilder
    private var passwordField: some View {
        if showsPassword {
            TextField(text: $model.password) { Text(verbatim: passwordLabel) }
                .labelsHidden()
                .textContentType(.password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .accessibilityIdentifier("login.password")
                .focused($focus, equals: .password)
        } else {
            SecureField(text: $model.password) { Text(verbatim: passwordLabel) }
                .labelsHidden()
                .textContentType(.password)
                .submitLabel(.go)
                .accessibilityIdentifier("login.password")
                .focused($focus, equals: .password)
        }
    }

    /// Ярлык поля скрыт на экране, но остаётся у VoiceOver: без него поле
    /// читается как «текстовое поле», и вслепую не понять, какое из двух.
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

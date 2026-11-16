import Observation
import SwiftUI

/// Регистрация по приглашению вуза (`/register?token=…`).
///
/// Роль и область (вуз, факультет, группа) — из приглашения, форма их не спрашивает.
/// Сначала превью: по нему видно, жива ли ссылка и нужен ли email, — иначе человек
/// заполнил бы форму и узнал про истёкшее приглашение только по кнопке.
///
/// Фото профиля, в отличие от веба, здесь не выбирается: загрузка идёт уже после входа,
/// а экран входа в этот момент исчезает. Фото ставится в профиле.
@MainActor
@Observable
final class RegisterModel {
    enum Phase: Equatable {
        case loading
        case form(InvitePreview)
        /// Приглашение не годится: код отказа решает текст (истекло, использовано,
        /// отозвано, слишком много попыток).
        case invalid(APIErrorCode?)
        /// Превью не загрузилось по другой причине — можно повторить.
        case failed(message: String, isOffline: Bool)
    }

    enum Field: Hashable {
        case firstName, lastName, username, email, birthDate, password, consent, guardianConsent
    }

    var firstName = ""
    var lastName = ""
    var username = ""
    var email = ""
    var birthDate: Date?
    var password = ""
    var consent = false
    var guardianConsent = false

    private(set) var phase: Phase = .loading
    private(set) var errors: [Field: String] = [:]
    private(set) var formError: String?
    private(set) var formErrorIsOffline = false
    private(set) var isSubmitting = false

    let token: String
    private let api: InviteRegistering

    init(token: String, api: InviteRegistering = InviteRegistrationAPI()) {
        self.token = token
        self.api = api
        if !AuthLink.isWellFormed(token) { phase = .invalid(nil) }
    }

    var preview: InvitePreview? {
        if case .form(let preview) = phase { return preview }
        return nil
    }

    /// До 18 лет согласие даёт законный представитель — тогда нужна вторая галочка.
    var needsGuardian: Bool {
        guard let birthDate else { return false }
        return !ConsentGateModel.isAdult(birthDate)
    }

    func load() async {
        guard AuthLink.isWellFormed(token) else { return }
        if case .form = phase { return }
        phase = .loading
        do {
            phase = .form(try await api.preview(token: token))
        } catch let error as APIError where Self.refusals.contains(error.code) {
            phase = .invalid(error.code)
        } catch {
            phase = .failed(message: error.userMessage, isOffline: error.isOffline)
        }
    }

    /// Отказы, при которых ссылка не заработает и после повтора.
    private static let refusals: [APIErrorCode?] = [
        .notFound, .badRequest, .validationError, .inviteExpired, .inviteUsed, .inviteRevoked, .forbidden, .rateLimit,
    ]

    func submit(into session: AppSessionModel) async {
        guard let preview, !isSubmitting else { return }
        formError = nil
        formErrorIsOffline = false
        errors = validate(emailRequired: preview.emailRequired)
        guard errors.isEmpty, let birthDate else { return }

        let guardian = needsGuardian
        let form = InviteRegistration(
            token: token,
            username: Self.normalizedUsername(username),
            firstName: firstName.trimmingCharacters(in: .whitespacesAndNewlines),
            lastName: lastName.trimmingCharacters(in: .whitespacesAndNewlines),
            password: password,
            email: preview.emailRequired ? email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() : nil,
            birthDate: ConsentGateModel.day(birthDate),
            consent: true,
            guardianConsent: guardian ? true : nil
        )

        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let issued = try await api.register(form)
            password = ""
            let adopted = await session.adopt(issued)
            if !adopted {
                formError = String(localized: "error.generic", defaultValue: "Что-то пошло не так. Попробуйте ещё раз")
            }
        } catch let error as APIError {
            apply(error, emailRequired: preview.emailRequired)
        } catch {
            formError = error.userMessage
            formErrorIsOffline = error.isOffline
        }
    }

    /// Поле исправляют — его ошибка снимается, остальные остаются до отправки.
    func clearError(_ field: Field) {
        errors[field] = nil
    }

    /// Занятые имя и адрес — ошибки поля, а не общая плашка: по «конфликт данных» не
    /// понять, что исправлять. Ошибки схемы — тоже у своих полей.
    private func apply(_ error: APIError, emailRequired: Bool) {
        guard case .server(let code, _, let details, _) = error else {
            formError = error.userMessage
            formErrorIsOffline = error.isOffline
            return
        }
        switch code {
        case .usernameTaken:
            errors[.username] = String(localized: "auth.usernameTaken", defaultValue: "Это имя пользователя уже занято")
        case .conflict where emailRequired && details.contains(where: { $0.field == "email" }):
            errors[.email] = String(localized: "auth.emailTaken", defaultValue: "Пользователь с таким email уже есть")
        case .inviteExpired, .inviteUsed, .inviteRevoked, .notFound:
            // Приглашение погасло, пока человек заполнял форму.
            phase = .invalid(code)
        case .validationError:
            var fieldErrors: [Field: String] = [:]
            for detail in details {
                if let field = Self.field(named: detail.field) { fieldErrors[field] = detail.displayMessage }
            }
            if fieldErrors.isEmpty {
                formError = error.userMessage
            } else {
                errors = fieldErrors
            }
        default:
            formError = error.userMessage
        }
    }

    private static func field(named name: String) -> Field? {
        switch name {
        case "firstName": return .firstName
        case "lastName": return .lastName
        case "username": return .username
        case "email": return .email
        case "birthDate": return .birthDate
        case "password": return .password
        case "consent": return .consent
        case "guardianConsent": return .guardianConsent
        default: return nil
        }
    }

    /// Проверка до запроса — те же границы, что у `RegisterByInviteSchema`.
    func validate(emailRequired: Bool, now: Date = Date()) -> [Field: String] {
        var found: [Field: String] = [:]
        let nameError = String(localized: "auth.nameInvalid", defaultValue: "Заполните поле — до 100 символов")
        if !Self.isValidName(firstName) { found[.firstName] = nameError }
        if !Self.isValidName(lastName) { found[.lastName] = nameError }
        if !Self.isValidUsername(username) {
            found[.username] = String(localized: "auth.usernameInvalid", defaultValue: "Только латиница, цифры и _, 3–32 символа")
        }
        if emailRequired {
            let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if address.isEmpty {
                found[.email] = String(localized: "auth.emailRequired", defaultValue: "Укажите email")
            } else if !ForgotPasswordModel.isValidEmail(address) {
                found[.email] = String(localized: "auth.emailInvalid", defaultValue: "Введите корректный email")
            }
        }
        if !Self.isPlausibleBirthDate(birthDate, now: now) {
            found[.birthDate] = String(localized: "auth.birthDateInvalid", defaultValue: "Проверьте дату рождения")
        }
        if let problem = PasswordPolicy.problem(password) {
            found[.password] = problem
        }
        if !consent {
            found[.consent] = String(localized: "auth.consentRequired", defaultValue: "Без согласия зарегистрироваться нельзя")
        }
        if needsGuardian, !guardianConsent {
            found[.guardianConsent] = String(localized: "auth.guardianRequired", defaultValue: "Нужно согласие законного представителя")
        }
        return found
    }

    static func normalizedUsername(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// `UsernameSchema`: 3–32 символа, латиница, цифры и подчёркивание.
    static func isValidUsername(_ value: String) -> Bool {
        let normalized = normalizedUsername(value)
        return (3...32).contains(normalized.count) && normalized.unicodeScalars.allSatisfy { scalar in
            switch scalar {
            case "a"..."z", "0"..."9", "_": return true
            default: return false
            }
        }
    }

    static func isValidName(_ value: String) -> Bool {
        (1...100).contains(value.trimmingCharacters(in: .whitespacesAndNewlines).count)
    }

    /// Верхняя граница — защита от опечатки в годе, а не от долгожителей; дата из
    /// будущего — тоже опечатка.
    static func isPlausibleBirthDate(_ date: Date?, now: Date = Date(), calendar: Calendar = .current) -> Bool {
        guard let date, date <= now else { return false }
        let years = calendar.dateComponents([.year], from: date, to: now).year ?? 0
        return years <= 120
    }
}

struct RegisterView: View {
    let session: AppSessionModel
    let backToLogin: () -> Void

    @Environment(\.motionReduced) private var reduceMotion
    @State private var model: RegisterModel
    @State private var showsPassword = false
    @State private var picksBirthDate = false
    @FocusState private var focus: RegisterModel.Field?
    @FocusState private var isPasswordFocused: Bool

    init(token: String, session: AppSessionModel, backToLogin: @escaping () -> Void) {
        self.session = session
        self.backToLogin = backToLogin
        _model = State(initialValue: RegisterModel(token: token))
    }

    /// Форма длинная: над клавиатурой держим поле в фокусе, а не кнопку в самом низу.
    private var focusedField: AnyHashable? {
        if isPasswordFocused { return AnyHashable(RegisterModel.Field.password) }
        return focus.map { AnyHashable($0) }
    }

    var body: some View {
        AuthScaffold(keyboardTarget: focusedField, keyboardAnchor: .center) {
            StudentHubBrandHeader(
                title: String(localized: "auth.createAccountTitle", defaultValue: "Создание аккаунта"),
                subtitle: String(
                    localized: "auth.createAccountSubtitle",
                    defaultValue: "Заполните данные для активации аккаунта"
                ),
                showsWordmark: false
            )
        } panel: {
            switch model.phase {
            case .loading:
                VStack(spacing: Spacing.md) {
                    ProgressView()
                    Text(String(localized: "common.loading", defaultValue: "Загрузка"))
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                }
                .frame(maxWidth: .infinity, minHeight: 160)
                .accessibilityElement(children: .combine)
            case .form(let preview):
                form(preview)
            case .invalid(let code):
                invalid(code)
            case .failed(let message, let isOffline):
                if isOffline {
                    AuthNotice.offline(retry: reload)
                } else {
                    AuthNotice(
                        kind: .error,
                        title: message,
                        actionTitle: String(localized: "common.retry", defaultValue: "Повторить"),
                        action: reload
                    )
                }
                AuthTextLink(title: String(localized: "auth.backToLogin", defaultValue: "Вернуться ко входу"), action: backToLogin)
                    .frame(maxWidth: .infinity)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .animation(AuthMotion.layout(reduceMotion: reduceMotion), value: model.phase)
        .task { await model.load() }
        .sheet(isPresented: $picksBirthDate) {
            BirthDateSheet(date: model.birthDate) {
                model.birthDate = $0
                model.clearError(.birthDate)
            }
        }
    }

    // MARK: Форма

    @ViewBuilder
    private func form(_ preview: InvitePreview) -> some View {
        InviteScopeBadges(preview: preview)

        StudentHubField(
            label: String(localized: "auth.firstName", defaultValue: "Имя"),
            error: model.errors[.firstName],
            isFocused: focus == .firstName,
            focus: { focus = .firstName }
        ) {
            TextField(text: $model.firstName, prompt: Text(namePlaceholder)) {
                Text(String(localized: "auth.firstName", defaultValue: "Имя"))
            }
            .textContentType(.givenName)
            .textInputAutocapitalization(.words)
            .submitLabel(.next)
            .focused($focus, equals: .firstName)
            .onSubmit { focus = .lastName }
            .onChange(of: model.firstName) { model.clearError(.firstName) }
        }
        .id(RegisterModel.Field.firstName)

        StudentHubField(
            label: String(localized: "auth.lastName", defaultValue: "Фамилия"),
            error: model.errors[.lastName],
            isFocused: focus == .lastName,
            focus: { focus = .lastName }
        ) {
            TextField(text: $model.lastName, prompt: Text(namePlaceholder)) {
                Text(String(localized: "auth.lastName", defaultValue: "Фамилия"))
            }
            .textContentType(.familyName)
            .textInputAutocapitalization(.words)
            .submitLabel(.next)
            .focused($focus, equals: .lastName)
            .onSubmit { focus = .username }
            .onChange(of: model.lastName) { model.clearError(.lastName) }
        }
        .id(RegisterModel.Field.lastName)

        VStack(alignment: .leading, spacing: Spacing.xs) {
            StudentHubField(
                label: String(localized: "auth.username", defaultValue: "Имя пользователя"),
                error: model.errors[.username],
                isFocused: focus == .username,
                focus: { focus = .username }
            ) {
                TextField(text: $model.username, prompt: Text(verbatim: "username")) {
                    Text(String(localized: "auth.username", defaultValue: "Имя пользователя"))
                }
                // Пара `.username` + `.newPassword`: iOS предложит надёжный пароль и
                // сохранит учётную запись в «Пароли» под этим именем.
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focus, equals: .username)
                .onSubmit {
                    if preview.emailRequired {
                        focus = .email
                    } else {
                        focus = nil
                        isPasswordFocused = true
                    }
                }
                .onChange(of: model.username) { model.clearError(.username) }
            }
            if model.errors[.username] == nil {
                FieldHint(String(
                    localized: "auth.usernameHint",
                    defaultValue: "Латиница, цифры и _, 3–32 символа. По нему можно входить и упоминать в чате."
                ))
            }
        }
        .id(RegisterModel.Field.username)

        if preview.emailRequired {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                StudentHubField(
                    label: String(localized: "auth.email", defaultValue: "Email"),
                    error: model.errors[.email],
                    isFocused: focus == .email,
                    focus: { focus = .email }
                ) {
                    TextField(text: $model.email, prompt: Text(verbatim: "name@example.com")) {
                        Text(String(localized: "auth.email", defaultValue: "Email"))
                    }
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focus, equals: .email)
                    .onSubmit {
                        focus = nil
                        isPasswordFocused = true
                    }
                    .onChange(of: model.email) { model.clearError(.email) }
                }
                if model.errors[.email] == nil {
                    FieldHint(String(
                        localized: "auth.emailInviteHint",
                        defaultValue: "Приглашение пришло без адреса — укажите email, он станет логином и адресом для восстановления пароля."
                    ))
                }
            }
            .id(RegisterModel.Field.email)
        }

        birthDateField

        NewPasswordField(
            label: String(localized: "auth.password", defaultValue: "Пароль"),
            password: $model.password,
            isVisible: $showsPassword,
            error: model.errors[.password],
            focus: $isPasswordFocused,
            submit: { isPasswordFocused = false }
        )
        .id(RegisterModel.Field.password)
        .onChange(of: model.password) { model.clearError(.password) }

        consentToggles

        AuthFormError(message: model.formError, isOffline: model.formErrorIsOffline, retry: submit)

        StudentHubPrimaryButton(
            title: String(localized: "auth.createAccount", defaultValue: "Создать аккаунт"),
            isLoading: model.isSubmitting,
            action: submit
        )
        .onChange(of: model.isSubmitting) { _, submitting in
            if submitting {
                focus = nil
                isPasswordFocused = false
            }
        }

        FieldHint(String(
            localized: "auth.oneTimeTokenNote",
            defaultValue: "Токен одноразовый и станет недействителен после регистрации."
        ))
        .frame(maxWidth: .infinity)
        .multilineTextAlignment(.center)
    }

    /// Подсказка в полях имени и фамилии: подпись над полем уже говорит, что вводить,
    /// подсказка — в каком виде.
    private var namePlaceholder: String {
        String(localized: "auth.namePlaceholder", defaultValue: "Как в документах")
    }

    /// Дата рождения — листом с колесом, а не полем: так её нельзя «заполнить» случайно
    /// значением по умолчанию, а от неё зависит, чьё согласие нужно.
    private var birthDateField: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            StudentHubField(
                label: String(localized: "auth.birthDate", defaultValue: "Дата рождения"),
                error: model.errors[.birthDate],
                focus: { openBirthDate() }
            ) {
                Button(action: openBirthDate) {
                    HStack {
                        if let date = model.birthDate {
                            Text(date.formatted(date: .long, time: .omitted))
                                .foregroundStyle(Palette.foreground)
                        } else {
                            Text(String(localized: "auth.birthDatePick", defaultValue: "Выбрать дату"))
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "calendar")
                            .foregroundStyle(Palette.mutedForeground)
                            .accessibilityHidden(true)
                    }
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(String(localized: "auth.birthDate", defaultValue: "Дата рождения")))
                .accessibilityValue(Text(model.birthDate?.formatted(date: .long, time: .omitted) ?? ""))
            }
            if model.errors[.birthDate] == nil {
                FieldHint(String(
                    localized: "auth.birthDateHint",
                    defaultValue: "Нужна, чтобы определить, требуется ли согласие законного представителя"
                ))
            }
        }
    }

    /// Согласие — явным действием, а не мелким шрифтом под кнопкой: нужно доказуемое
    /// «да». Документы — тут же, нативным экраном.
    @ViewBuilder
    private var consentToggles: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Toggle(isOn: $model.consent) {
                Text(String(
                    localized: "consent.agree",
                    defaultValue: "Я принимаю политику конфиденциальности и пользовательское соглашение"
                ))
                .font(.subheadline)
                .foregroundStyle(Palette.foreground)
            }
            .tint(Palette.primary)
            .onChange(of: model.consent) { model.clearError(.consent) }
            FieldError(message: model.errors[.consent])
            StudentHubLegalLinks()
        }

        if model.needsGuardian {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Toggle(isOn: $model.guardianConsent) {
                    Text(String(
                        localized: "consent.guardian",
                        defaultValue: """
                            Мне нет 18 лет, и мой законный представитель дал согласие на \
                            обработку моих персональных данных
                            """
                    ))
                    .font(.subheadline)
                    .foregroundStyle(Palette.foreground)
                }
                .tint(Palette.primary)
                .onChange(of: model.guardianConsent) { model.clearError(.guardianConsent) }
                FieldError(message: model.errors[.guardianConsent])
            }
            .transition(.opacity)
        }
    }

    // MARK: Отказ

    @ViewBuilder
    private func invalid(_ code: APIErrorCode?) -> some View {
        AuthNotice(
            kind: code == .inviteExpired || code == .rateLimit ? .expired : .error,
            title: code == .rateLimit
                ? String(localized: "auth.inviteRateLimitTitle", defaultValue: "Слишком много попыток")
                : String(localized: "auth.inviteInvalidTitle", defaultValue: "Приглашение недействительно"),
            message: Self.reason(code)
        )
        StudentHubPrimaryButton(
            title: String(localized: "auth.backToLogin", defaultValue: "Вернуться ко входу"),
            action: backToLogin
        )
    }

    /// Текст — по коду отказа: истёкшее просят выдать заново, по использованному входят,
    /// лимит проходит сам. Общая фраза не говорила бы, что делать.
    private static func reason(_ code: APIErrorCode?) -> String {
        switch code {
        case .inviteExpired:
            return String(localized: "auth.inviteExpiredText", defaultValue: "Срок приглашения истёк — оно действует 48 часов. Попросите выдать новое.")
        case .inviteUsed:
            return String(localized: "auth.inviteUsedText", defaultValue: "По этому приглашению уже зарегистрировались. Если это были вы — просто войдите.")
        case .inviteRevoked:
            return String(localized: "auth.inviteRevokedText", defaultValue: "Приглашение отозвано. Запросите новое у того, кто его выдал.")
        case .rateLimit:
            return String(localized: "auth.inviteRateLimitText", defaultValue: "Приглашение открывали слишком часто. Попробуйте снова через час.")
        default:
            return String(
                localized: "auth.inviteInvalidText",
                defaultValue: "Ссылка приглашения неверна или повреждена. Запросите новое приглашение у администратора."
            )
        }
    }

    private func openBirthDate() {
        focus = nil
        isPasswordFocused = false
        picksBirthDate = true
    }

    private func reload() {
        Task { await model.load() }
    }

    /// Ошибки проверки — без запроса: клавиатура остаётся, фокус встаёт в первое
    /// поле с ошибкой, и экран докручивает до него.
    private func submit() {
        Task {
            await model.submit(into: session)
            let order: [RegisterModel.Field] = [.firstName, .lastName, .username, .email]
            if let first = order.first(where: { model.errors[$0] != nil }) {
                isPasswordFocused = false
                focus = first
            } else if model.errors[.password] != nil {
                focus = nil
                isPasswordFocused = true
            }
        }
    }
}

/// Роль и область из приглашения: кем человек станет, решает не он.
private struct InviteScopeBadges: View {
    let preview: InvitePreview

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            FlowChips(chips: chips)
            let until = DisplayFormat.dateTime(preview.expiresAt)
            Text(String(localized: "auth.inviteValidUntil", defaultValue: "Приглашение действует до \(until)"))
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var chips: [FlowChips.Chip] {
        var result = [FlowChips.Chip(title: preview.role.title, isPrimary: true)]
        if preview.universityId != nil {
            result.append(FlowChips.Chip(title: String(localized: "auth.scopeUniversity", defaultValue: "Университет")))
        }
        if preview.facultyId != nil {
            result.append(FlowChips.Chip(title: String(localized: "auth.scopeFaculty", defaultValue: "Факультет")))
        }
        if preview.groupId != nil {
            result.append(FlowChips.Chip(title: String(localized: "auth.scopeGroup", defaultValue: "Группа")))
        }
        return result
    }
}

/// Значки в строку; не влезли — переносятся. Первый (роль) — фирменного цвета.
private struct FlowChips: View {
    struct Chip: Hashable {
        let title: String
        var isPrimary = false
    }

    let chips: [Chip]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Spacing.sm) { items }
            VStack(alignment: .leading, spacing: Spacing.sm) { items }
        }
    }

    private var items: some View {
        ForEach(chips, id: \.self) { chip in
            Text(chip.title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(chip.isPrimary ? Palette.primary : Palette.mutedForeground)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.xs)
                .background(chip.isPrimary ? Palette.primary.opacity(0.12) : AuthPalette.field, in: Capsule())
        }
    }
}

/// Подсказка под полем формы.
private struct FieldHint: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(Palette.mutedForeground)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Выбор даты рождения колесом. Дата уходит в форму только по «Готово».
private struct BirthDateSheet: View {
    let commit: (Date) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var date: Date

    init(date: Date?, commit: @escaping (Date) -> Void) {
        self.commit = commit
        // Колесо открывается на восемнадцати годах назад — середина тех, кто учится.
        let start = date ?? Calendar.current.date(byAdding: .year, value: -18, to: Date()) ?? Date()
        _date = State(initialValue: start)
    }

    var body: some View {
        NavigationStack {
            DatePicker(
                selection: $date,
                in: Self.range,
                displayedComponents: .date
            ) {
                Text(String(localized: "auth.birthDate", defaultValue: "Дата рождения"))
            }
            .datePickerStyle(.wheel)
            .labelsHidden()
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Spacing.xl)
            .navigationTitle(Text(String(localized: "auth.birthDate", defaultValue: "Дата рождения")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "common.done", defaultValue: "Готово")) {
                        commit(date)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.height(340), .medium])
    }

    /// Не раньше 120 лет назад и не позже сегодняшнего дня — как проверяет сервер.
    private static var range: ClosedRange<Date> {
        let now = Date()
        let earliest = Calendar.current.date(byAdding: .year, value: -120, to: now) ?? now
        return earliest...now
    }
}

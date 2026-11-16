import SwiftUI

// Саморегистрация работодателя — единственный путь на платформу без инвайта вуза. Всё здесь
// происходит до входа: регистрация компании, подтверждение почты по ссылке из письма,
// повторное письмо и вступление в команду компании по приглашению коллеги.

/// Лист «Я работодатель» с экрана входа.
struct CareerSignupSheet: View {
    let session: AppSessionModel

    @Environment(\.dismiss) private var dismiss
    @State private var resending = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HeroHeader(
                        visual: .symbol("building.2.fill", tint: TileTint.purple),
                        title: String(localized: "career.signup.slogan", defaultValue: "Студенты и выпускники — напрямую из вузов"),
                        subtitle: String(
                            localized: "career.signup.brand",
                            defaultValue: "Вы публикуете вакансии и стажировки, а университеты открывают компании доступ к своим студентам."
                        )
                    )
                }

                Section {
                    NavigationLink {
                        CareerSignupForm()
                    } label: {
                        IconRow(
                            title: String(localized: "career.signup.title", defaultValue: "Регистрация работодателя"),
                            symbol: "building.2",
                            tint: TileTint.purple,
                            subtitle: String(localized: "career.signup.subtitle", defaultValue: "Создайте аккаунт компании и подайте заявку в университет")
                        )
                    }
                    NavigationLink {
                        CareerJoinView(session: session) { dismiss() }
                    } label: {
                        IconRow(
                            title: String(localized: "career.signup.join", defaultValue: "У меня приглашение в команду"),
                            symbol: "person.badge.plus",
                            tint: TileTint.blue,
                            subtitle: String(localized: "career.signup.joinHint", defaultValue: "Коллега пригласил вас в компанию по почте")
                        )
                    }
                    NavigationLink {
                        CareerVerifyView()
                    } label: {
                        IconRow(
                            title: String(localized: "career.signup.verify", defaultValue: "Подтвердить email"),
                            symbol: "envelope.badge",
                            tint: TileTint.green,
                            subtitle: String(localized: "career.signup.verifyHint", defaultValue: "По ссылке из письма после регистрации")
                        )
                    }
                    Button {
                        resending = true
                    } label: {
                        IconRow(
                            title: String(localized: "career.signup.resend", defaultValue: "Отправить письмо ещё раз"),
                            symbol: "arrow.clockwise",
                            tint: TileTint.orange
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Text(String(localized: "career.signup.employer", defaultValue: "Работодателям")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .sheet(isPresented: $resending) {
                CareerResendForm(lookUpEmail: false)
            }
        }
    }
}

/// Пароль по политике платформы (`PasswordSchema`): 8+ символов, буква, цифра, спецсимвол.
private func careerPasswordProblem(_ password: String) -> String? {
    if password.count < 8 {
        return String(localized: "career.signup.passwordShort", defaultValue: "Пароль — не короче 8 символов")
    }
    if !password.contains(where: \.isLetter) {
        return String(localized: "career.signup.passwordLetter", defaultValue: "В пароле нужна буква")
    }
    if !password.contains(where: \.isNumber) {
        return String(localized: "career.signup.passwordDigit", defaultValue: "В пароле нужна цифра")
    }
    if !password.contains(where: { !$0.isLetter && !$0.isNumber }) {
        return String(localized: "career.signup.passwordSpecial", defaultValue: "В пароле нужен спецсимвол")
    }
    return nil
}

private func careerEmailValid(_ email: String) -> Bool {
    let value = email.trimmingCharacters(in: .whitespaces)
    guard let at = value.firstIndex(of: "@") else { return false }
    return value[value.index(after: at)...].contains(".") && value.count <= 160
}

/// Токен из вставленной ссылки письма или сам токен.
private func careerToken(from text: String) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if let components = URLComponents(string: trimmed),
       let token = components.queryItems?.first(where: { $0.name == "token" })?.value {
        return token
    }
    return trimmed
}

// MARK: - Регистрация компании

private struct CareerSignupForm: View {
    @State private var companyName = ""
    @State private var website = ""
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var failure: String?
    @State private var busy = false
    @State private var sentTo: String?

    private var problem: String? {
        if !(2...120).contains(companyName.trimmingCharacters(in: .whitespaces).count) {
            return String(localized: "career.signup.errCompany", defaultValue: "Название — от 2 до 120 символов")
        }
        let site = website.trimmingCharacters(in: .whitespaces)
        if !site.isEmpty, !(site.hasPrefix("http://") || site.hasPrefix("https://")) {
            return String(localized: "career.signup.errWebsite", defaultValue: "Ссылка должна начинаться с http:// или https://")
        }
        if firstName.trimmingCharacters(in: .whitespaces).isEmpty {
            return String(localized: "career.signup.errFirstName", defaultValue: "Укажите имя")
        }
        if lastName.trimmingCharacters(in: .whitespaces).isEmpty {
            return String(localized: "career.signup.errLastName", defaultValue: "Укажите фамилию")
        }
        if !careerEmailValid(email) {
            return String(localized: "career.signup.errEmail", defaultValue: "Введите корректный email")
        }
        return careerPasswordProblem(password)
    }

    var body: some View {
        Form {
            if let sentTo {
                Section {
                    HeroHeader(
                        visual: .symbol("envelope.open.fill", tint: TileTint.green),
                        title: String(localized: "career.signup.sentTitle", defaultValue: "Проверьте почту"),
                        subtitle: String(
                            localized: "career.signup.sentText",
                            defaultValue: "Письмо со ссылкой подтверждения отправлено на \(sentTo). Ссылка действует сутки."
                        )
                    )
                }
                Section {
                    NavigationLink {
                        CareerVerifyView()
                    } label: {
                        Text(String(localized: "career.signup.verify", defaultValue: "Подтвердить email"))
                    }
                }
            } else {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    TextField(String(localized: "career.signup.company", defaultValue: "Название компании"), text: $companyName)
                        .textContentType(.organizationName)
                    TextField(String(localized: "career.signup.website", defaultValue: "Сайт (необязательно)"), text: $website)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section {
                    TextField(String(localized: "career.signup.firstName", defaultValue: "Имя"), text: $firstName)
                        .textContentType(.givenName)
                    TextField(String(localized: "career.signup.lastName", defaultValue: "Фамилия"), text: $lastName)
                        .textContentType(.familyName)
                    TextField(String(localized: "career.signup.email", defaultValue: "Рабочий email"), text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField(String(localized: "career.signup.password", defaultValue: "Пароль"), text: $password)
                        .textContentType(.newPassword)
                } footer: {
                    Text(problem ?? String(
                        localized: "career.signup.note",
                        defaultValue: "После регистрации подтвердите email, затем подайте заявку в университет. Доступ к студентам открывает вуз."
                    ))
                }
                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        Text(String(localized: "career.signup.submit", defaultValue: "Создать аккаунт"))
                    }
                    .buttonStyle(PrimaryButtonStyle(isLoading: busy))
                    .disabled(problem != nil || busy)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
        }
        .navigationTitle(Text(String(localized: "career.signup.title", defaultValue: "Регистрация работодателя")))
        .navigationBarTitleDisplayMode(.inline)
    }

    @MainActor
    private func submit() async {
        busy = true
        defer { busy = false }
        let address = email.trimmingCharacters(in: .whitespaces).lowercased()
        do {
            try await CareerAPI().signup(CareerSignupInput(
                email: address,
                password: password,
                firstName: firstName.trimmingCharacters(in: .whitespaces),
                lastName: lastName.trimmingCharacters(in: .whitespaces),
                companyName: companyName.trimmingCharacters(in: .whitespaces),
                website: website.trimmingCharacters(in: .whitespaces)
            ))
            password = ""
            failure = nil
            sentTo = address
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Подтверждение почты

private struct CareerVerifyView: View {
    @State private var link = ""
    @State private var failure: String?
    @State private var busy = false
    @State private var verified = false
    @State private var resending = false

    var body: some View {
        Group {
            if verified {
                Form {
                    Section {
                        HeroHeader(
                            visual: .symbol("checkmark.seal.fill", tint: TileTint.green),
                            title: String(localized: "career.signup.verifiedTitle", defaultValue: "Email подтверждён"),
                            subtitle: String(localized: "career.signup.verifiedText", defaultValue: "Войдите в аккаунт и подайте заявку в университет.")
                        )
                    }
                }
                .transition(.opacity)
            } else {
                CareerLinkStep(
                    symbol: "envelope.badge",
                    tint: TileTint.green,
                    title: String(localized: "career.signup.verify", defaultValue: "Подтвердить email"),
                    hint: String(
                        localized: "career.signup.linkHint",
                        defaultValue: "Откройте письмо, скопируйте ссылку подтверждения и вставьте её сюда."
                    ),
                    actionTitle: String(localized: "career.signup.verify", defaultValue: "Подтвердить email"),
                    link: $link,
                    failure: failure,
                    busy: busy,
                    submit: { Task { await verify() } }
                ) {
                    AuthTextLink(title: String(localized: "career.signup.resend", defaultValue: "Отправить письмо ещё раз")) {
                        resending = true
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .animation(Motion.calm, value: verified)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $resending) {
            CareerResendForm(lookUpEmail: false)
        }
    }

    @MainActor
    private func verify() async {
        busy = true
        defer { busy = false }
        do {
            try await CareerAPI().verifyEmail(token: careerToken(from: link))
            verified = true
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Вступление в команду по приглашению

private struct CareerJoinView: View {
    let session: AppSessionModel
    let joined: () -> Void

    @State private var link = ""
    @State private var token = ""
    @State private var preview: CareerInvitePreview?
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var password = ""
    @State private var failure: String?
    @State private var busy = false

    private var problem: String? {
        if firstName.trimmingCharacters(in: .whitespaces).isEmpty {
            return String(localized: "career.signup.errFirstName", defaultValue: "Укажите имя")
        }
        if lastName.trimmingCharacters(in: .whitespaces).isEmpty {
            return String(localized: "career.signup.errLastName", defaultValue: "Укажите фамилию")
        }
        return careerPasswordProblem(password)
    }

    var body: some View {
        Group {
            if preview != nil {
                inviteForm
                    .transition(.opacity)
            } else {
                CareerLinkStep(
                    symbol: "person.badge.plus",
                    tint: TileTint.blue,
                    title: String(localized: "career.signup.join", defaultValue: "У меня приглашение в команду"),
                    hint: String(
                        localized: "career.join.linkHint",
                        defaultValue: "Скопируйте ссылку из письма-приглашения и вставьте её сюда."
                    ),
                    actionTitle: String(localized: "career.join.open", defaultValue: "Открыть приглашение"),
                    link: $link,
                    failure: failure,
                    busy: busy,
                    submit: { Task { await open() } }
                )
            }
        }
        .animation(Motion.calm, value: preview == nil)
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Приглашение открыто: компания, срок и данные нового аккаунта.
    private var inviteForm: some View {
        Form {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if let preview {
                Section {
                    let company = preview.companyName
                    let email = preview.email
                    let until = DisplayFormat.dateTime(preview.expiresAt)
                    CareerNotice(
                        title: String(localized: "career.join.title", defaultValue: "Приглашение в команду «\(company)»"),
                        text: String(
                            localized: "career.join.subtitle",
                            defaultValue: "Аккаунт будет создан на адрес \(email). Ссылка действует до \(until)."
                        ),
                        symbol: "person.badge.plus"
                    )
                }
                Section {
                    TextField(String(localized: "career.signup.firstName", defaultValue: "Имя"), text: $firstName)
                        .textContentType(.givenName)
                    TextField(String(localized: "career.signup.lastName", defaultValue: "Фамилия"), text: $lastName)
                        .textContentType(.familyName)
                    SecureField(String(localized: "career.signup.password", defaultValue: "Пароль"), text: $password)
                        .textContentType(.newPassword)
                } footer: {
                    Text(problem ?? String(
                        localized: "career.join.note",
                        defaultValue: "Почта и компания берутся из приглашения. Студентов вы увидите в тех университетах, куда у компании открыт доступ."
                    ))
                }
                Section {
                    Button {
                        Task { await accept() }
                    } label: {
                        Text(String(localized: "career.join.submit", defaultValue: "Присоединиться к команде"))
                    }
                    .buttonStyle(PrimaryButtonStyle(isLoading: busy))
                    .disabled(problem != nil || busy)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
        }
        .navigationTitle(Text(String(localized: "career.signup.join", defaultValue: "У меня приглашение в команду")))
    }

    @MainActor
    private func open() async {
        busy = true
        defer { busy = false }
        let value = careerToken(from: link)
        do {
            preview = try await CareerAPI().invitePreview(token: value)
            token = value
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func accept() async {
        busy = true
        defer { busy = false }
        do {
            let issued = try await CareerAPI().acceptInvite(
                token: token,
                password: password,
                firstName: firstName.trimmingCharacters(in: .whitespaces),
                lastName: lastName.trimmingCharacters(in: .whitespaces)
            )
            password = ""
            if await session.adopt(issued) {
                joined()
            } else {
                failure = String(localized: "error.generic", defaultValue: "Что-то пошло не так. Попробуйте ещё раз")
            }
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Ссылка из письма

/// Шаг «вставить ссылку из письма» — общий для подтверждения почты и приглашения в
/// команду: знак и пояснение сверху, поле со значком вставки внутри, главная кнопка.
/// Заголовок — в шапке экрана, а не в панели навигации: там длинный заголовок ужимался
/// рядом со стрелкой «назад».
private struct CareerLinkStep<Extra: View>: View {
    let symbol: String
    let tint: Color
    let title: String
    let hint: String
    let actionTitle: String
    @Binding var link: String
    let failure: String?
    let busy: Bool
    let submit: () -> Void
    @ViewBuilder var extra: () -> Extra

    @FocusState private var isFocused: Bool
    @Environment(\.motionReduced) private var reduceMotion

    private var canSubmit: Bool { careerToken(from: link).count >= 16 && !busy }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                HeroHeader(visual: .symbol(symbol, tint: tint), title: title, subtitle: hint)
                    .padding(.top, Spacing.md)
                if let failure {
                    FormAlert(message: failure)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
                StudentHubField(
                    label: nil,
                    isFocused: isFocused,
                    focus: { isFocused = true },
                    fill: Palette.card
                ) {
                    TextField(
                        text: $link,
                        prompt: Text(String(localized: "career.signup.linkPlaceholder", defaultValue: "Ссылка из письма или код")),
                        axis: .vertical
                    ) {
                        Text(String(localized: "career.signup.linkPlaceholder", defaultValue: "Ссылка из письма или код"))
                    }
                    .lineLimit(1...4)
                    .padding(.vertical, Spacing.lg)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($isFocused)
                    .onSubmit { if canSubmit { submit() } }
                } accessory: {
                    // Системный элемент вставки не спрашивает разрешения на чтение буфера.
                    ClipboardPasteButton { pasted in
                        link = pasted
                        if canSubmit { submit() }
                    }
                    .frame(width: 44, height: 44)
                }
                StudentHubPrimaryButton(title: actionTitle, isLoading: busy) {
                    isFocused = false
                    submit()
                }
                .disabled(!canSubmit)
                extra()
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.xl)
            .animation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion), value: failure)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.background)
    }
}

extension CareerLinkStep where Extra == EmptyView {
    init(
        symbol: String,
        tint: Color,
        title: String,
        hint: String,
        actionTitle: String,
        link: Binding<String>,
        failure: String?,
        busy: Bool,
        submit: @escaping () -> Void
    ) {
        self.init(
            symbol: symbol, tint: tint, title: title, hint: hint, actionTitle: actionTitle, link: link,
            failure: failure, busy: busy, submit: submit, extra: { EmptyView() }
        )
    }
}

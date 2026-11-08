import SwiftUI

/// Люди в охвате роли: платформа — все, вуз — свой вуз. `role` задан — экран одной роли
/// («Студенты», «Преподаватели», «Деканы»), иначе роль выбирается фильтром.
struct AdminUsersView: View {
    let role: String?

    @Environment(\.viewerRole) private var viewerRole
    @State private var search = ""
    @State private var roleFilter: String?
    @State private var onlyBlocked = false
    @State private var loader: PagedLoader<AdminUserDTO>
    @State private var exported: AdminExportedFile?
    @State private var isExporting = false
    @State private var actionFailure: String?

    init(role: String?) {
        self.role = role
        _loader = State(initialValue: PagedLoader(limit: 50) { request in
            try await AdminAPI().users(role: role, search: nil, request: request)
        })
    }

    private var effectiveRole: String? { role ?? roleFilter }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "admin.users.empty", defaultValue: "Пользователей нет"),
                symbol: "person.2"
            )
        ) { user in
            NavigationLink(value: AppRoute.admin(.user(id: user.id))) {
                AdminUserRow(user: user)
            }
        }
        .navigationTitle(Text(AdminScreen.users(role: role).title))
        .debouncedSearch($search, prompt: String(localized: "admin.users.search", defaultValue: "Поиск по имени или email")) { _ in
            await refilter()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if role == nil {
                        Picker(String(localized: "admin.users.role", defaultValue: "Роль"), selection: $roleFilter) {
                            Text(String(localized: "admin.users.allRoles", defaultValue: "Все роли")).tag(String?.none)
                            ForEach(AdminRoles.filterRoles(for: viewerRole), id: \.self) { value in
                                Text(AdminRoles.title(value)).tag(Optional(value))
                            }
                        }
                    }
                    Toggle(String(localized: "admin.users.onlyBlocked", defaultValue: "Только заблокированные"), isOn: $onlyBlocked)
                } label: {
                    Image(systemName: roleFilter == nil && !onlyBlocked
                        ? "line.3.horizontal.decrease.circle"
                        : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel(Text(String(localized: "admin.users.filters", defaultValue: "Фильтры")))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        Task { await export("xlsx") }
                    } label: {
                        Label(String(localized: "admin.users.exportXlsx", defaultValue: "Выгрузить в Excel"), systemImage: "tablecells")
                    }
                    Button {
                        Task { await export("csv") }
                    } label: {
                        Label(String(localized: "admin.users.exportCsv", defaultValue: "Выгрузить в CSV"), systemImage: "doc.plaintext")
                    }
                } label: {
                    if isExporting {
                        ProgressView()
                    } else {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
                .disabled(isExporting || loader.total == 0)
                .accessibilityLabel(Text(String(localized: "admin.users.export", defaultValue: "Экспорт")))
            }
        }
        .onChange(of: roleFilter) { _, _ in Task { await refilter() } }
        .onChange(of: onlyBlocked) { _, _ in Task { await refilter() } }
        .onAppear { if loader.isLoaded { Task { await loader.reload() } } }
        .sheet(item: $exported) { file in
            AdminShareSheet(items: [file.url])
        }
        .actionFailureAlert($actionFailure)
    }

    private func refilter() async {
        let role = effectiveRole
        let needle = search.trimmingCharacters(in: .whitespaces)
        let blocked: Bool? = onlyBlocked ? true : nil
        await loader.replace { request in
            try await AdminAPI().users(
                role: role,
                search: needle.isEmpty ? nil : String(needle.prefix(100)),
                blocked: blocked,
                request: request
            )
        }
    }

    @MainActor
    private func export(_ format: String) async {
        isExporting = true
        defer { isExporting = false }
        let needle = search.trimmingCharacters(in: .whitespaces)
        do {
            let data = try await AdminAPI().exportUsers(
                role: effectiveRole,
                search: needle.isEmpty ? nil : needle,
                format: format
            )
            let stamp = Date().formatted(.iso8601.year().month().day())
            exported = try AdminExportedFile.write(data, name: "users-\(stamp).\(format)")
        } catch {
            // В книгу Excel помещается до 5000 строк; CSV отдаётся потоком без предела.
            if (error as? APIError)?.code == .unknown("EXPORT_TOO_LARGE") {
                actionFailure = String(localized: "admin.users.exportTooLarge", defaultValue: "Слишком много строк для Excel — выгрузите список в CSV.")
            } else {
                actionFailure = error.userMessage
            }
        }
    }
}

struct AdminUserRow: View {
    let user: AdminUserDTO

    var body: some View {
        HStack(spacing: Spacing.md) {
            PersonRow(
                name: user.name,
                subtitle: [AdminRoles.title(user.role), user.email].compactMap { $0 }.joined(separator: " · "),
                avatarURL: user.avatarThumbUrl ?? user.avatarUrl
            )
            if user.isBlocked == true {
                StatusBadge(text: String(localized: "admin.users.blocked", defaultValue: "Заблокирован"), tint: Palette.destructive)
            }
        }
    }
}

/// Карточка человека для администратора и модератора: сведения профиля, доступ и история
/// нарушений, действия по правам смотрящего — блокировка со сроком, завершение сессий,
/// сброс 2FA, учебные данные студента.
struct AdminUserView: View {
    let id: String

    @Environment(\.viewerRole) private var viewerRole
    @Environment(\.viewerID) private var viewerID

    @State private var profile: JSONValue?
    @State private var card: AdminModerationCardDTO?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var notice: String?
    @State private var isWorking = false

    @State private var blocking = false
    @State private var confirmUnblock = false
    @State private var confirmSessions = false
    @State private var resettingTwoFactor = false
    @State private var twoFactorCode = ""
    @State private var editingAcademic = false

    private let api = AdminAPI()

    private var canModerate: Bool {
        [.platformAdmin, .platformModerator, .universityAdmin, .universityModerator].contains(viewerRole)
    }

    private var canEditAcademic: Bool { viewerRole == .dean || viewerRole == .universityAdmin }

    private var targetRole: String {
        card?.role ?? profile?["role"]?.string ?? ""
    }

    private var name: String {
        if let card { return DisplayFormat.name(first: card.firstName, last: card.lastName) }
        return DisplayFormat.name(
            first: profile?["firstName"]?.string,
            last: profile?["lastName"]?.string,
            middle: profile?["middleName"]?.string
        )
    }

    var body: some View {
        Group {
            if profile != nil || card != nil {
                content
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(AdminScreen.user(id: id).title))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .actionFailureAlert($actionFailure)
        .alert(
            notice ?? "",
            isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .confirmationDialog(
            String(localized: "admin.user.blockTitle", defaultValue: "Заблокировать \(name)?"),
            isPresented: $blocking,
            titleVisibility: .visible
        ) {
            ForEach(AdminText.blockTerms, id: \.self) { days in
                Button(blockButtonTitle(days), role: .destructive) {
                    Task { await block(days: days) }
                }
            }
        } message: {
            Text(String(localized: "admin.user.blockMessage", defaultValue: "Все сессии пользователя будут закрыты. Временная блокировка снимется сама."))
        }
        .confirmationDialog(
            String(localized: "admin.user.unblockTitle", defaultValue: "Разблокировать \(name)?"),
            isPresented: $confirmUnblock,
            titleVisibility: .visible
        ) {
            Button(String(localized: "admin.user.unblock", defaultValue: "Разблокировать")) {
                Task { await unblock() }
            }
        }
        .confirmationDialog(
            String(localized: "admin.user.sessionsTitle", defaultValue: "Завершить сессии?"),
            isPresented: $confirmSessions,
            titleVisibility: .visible
        ) {
            Button(String(localized: "admin.user.sessionsConfirm", defaultValue: "Завершить"), role: .destructive) {
                Task { await endSessions() }
            }
        } message: {
            Text(String(localized: "admin.user.sessionsMessage", defaultValue: "\(name) выйдет на всех устройствах. Доступ к аккаунту сохранится — войти можно заново. Помогает, если аккаунт угнали."))
        }
        .reasonPrompt(
            $resettingTwoFactor,
            title: String(localized: "admin.user.resetTitle", defaultValue: "Сбросить 2FA"),
            message: String(localized: "admin.user.resetMessage", defaultValue: "У пользователя \(name) отключится двухфакторная аутентификация и завершатся все сеансы, на почту придёт письмо. Подтвердите своим кодом из приложения или резервным кодом."),
            placeholder: String(localized: "admin.user.resetCode", defaultValue: "Ваш код подтверждения"),
            actionTitle: String(localized: "admin.user.resetConfirm", defaultValue: "Сбросить"),
            text: $twoFactorCode
        ) {
            await resetTwoFactor()
        }
        .sheet(isPresented: $editingAcademic) {
            if let profile {
                AdminAcademicForm(userID: id, profile: profile) { await load() }
            }
        }
    }

    private var content: some View {
        List {
            Section {
                PersonRow(
                    name: name,
                    subtitle: targetRole.isEmpty ? nil : AdminRoles.title(targetRole),
                    avatarURL: profile?["avatarThumbUrl"]?.string ?? profile?["avatarUrl"]?.string,
                    size: 56
                )
                NavigationLink(value: AppRoute.profile(id: id)) {
                    Label(String(localized: "admin.user.openProfile", defaultValue: "Открыть профиль"), systemImage: "person.crop.circle")
                }
            }
            .listRowBackground(Palette.card)

            if let card {
                Section {
                    if card.isBlocked {
                        DetailRow(
                            title: String(localized: "admin.user.status", defaultValue: "Статус"),
                            value: card.blockedUntil.map {
                                String(localized: "admin.user.blockedUntil", defaultValue: "Заблокирован до \(DisplayFormat.dateTime($0))")
                            } ?? String(localized: "admin.user.blockedForever", defaultValue: "Заблокирован бессрочно")
                        )
                    } else {
                        DetailRow(
                            title: String(localized: "admin.user.status", defaultValue: "Статус"),
                            value: String(localized: "admin.user.active", defaultValue: "Активен")
                        )
                    }
                    if let university = card.university {
                        DetailRow(title: String(localized: "admin.user.university", defaultValue: "Вуз"), value: university.name)
                    }
                    if let complaints = card.complaints {
                        DetailRow(
                            title: String(localized: "admin.user.complaints", defaultValue: "Жалоб на пользователя"),
                            value: String(localized: "admin.user.complaintsValue", defaultValue: "\(complaints.total.formatted()), подтверждено \(complaints.upheld.formatted())")
                        )
                    }
                    if let warnings = card.warnings {
                        DetailRow(title: String(localized: "admin.user.warnings", defaultValue: "Предупреждений"), value: warnings.formatted())
                    }
                    if let created = card.createdAt {
                        DetailRow(title: String(localized: "admin.user.createdAt", defaultValue: "Регистрация"), value: DisplayFormat.date(created))
                    }
                } header: {
                    Text(String(localized: "admin.user.access", defaultValue: "Доступ"))
                }
                .listRowBackground(Palette.card)
            }

            if let profile {
                JSONDetailsSection(
                    title: String(localized: "admin.user.details", defaultValue: "Сведения"),
                    value: profile,
                    keys: Self.profileKeys
                )
            }

            actionsSection
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await load() }
    }

    @ViewBuilder
    private var actionsSection: some View {
        let isSelf = id == viewerID
        let higher = AdminRoles.isHigher(viewerRole, than: targetRole)
        let isStudent = targetRole == "STUDENT" || targetRole == "STAROSTA"
        if (canModerate && higher && !isSelf) || (canEditAcademic && isStudent) {
            Section {
                if canEditAcademic && isStudent && profile != nil {
                    Button {
                        editingAcademic = true
                    } label: {
                        Label(String(localized: "admin.user.academic", defaultValue: "Учебные данные"), systemImage: "graduationcap")
                    }
                }
                if canModerate && higher && !isSelf {
                    if card?.isBlocked == true {
                        Button {
                            confirmUnblock = true
                        } label: {
                            Label(String(localized: "admin.user.unblock", defaultValue: "Разблокировать"), systemImage: "lock.open")
                        }
                    } else {
                        Button(role: .destructive) {
                            blocking = true
                        } label: {
                            Label(String(localized: "admin.user.block", defaultValue: "Заблокировать"), systemImage: "nosign")
                        }
                    }
                    Button {
                        confirmSessions = true
                    } label: {
                        Label(String(localized: "admin.user.endSessions", defaultValue: "Завершить сессии"), systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    Button {
                        twoFactorCode = ""
                        resettingTwoFactor = true
                    } label: {
                        Label(String(localized: "admin.user.resetTwoFactor", defaultValue: "Сбросить 2FA"), systemImage: "key")
                    }
                }
            } header: {
                Text(String(localized: "admin.user.actions", defaultValue: "Действия"))
            } footer: {
                if canModerate && higher && !isSelf {
                    Text(String(localized: "admin.user.resetHint", defaultValue: "Сброс 2FA подтверждается вашим собственным кодом двухфакторной аутентификации."))
                }
            }
            .disabled(isWorking)
            .listRowBackground(Palette.card)
        }
    }

    private static let profileKeys: [(key: String, title: String)] = [
        ("email", String(localized: "admin.user.field.email", defaultValue: "Email")),
        ("phone", String(localized: "admin.user.field.phone", defaultValue: "Телефон")),
        ("headline", String(localized: "admin.user.field.headline", defaultValue: "О себе")),
        ("course", String(localized: "admin.academic.course", defaultValue: "Курс")),
        ("specialty", String(localized: "admin.academic.specialty", defaultValue: "Специальность")),
        ("educationLevel", String(localized: "admin.academic.educationLevel", defaultValue: "Уровень образования")),
        ("studyForm", String(localized: "admin.academic.studyForm", defaultValue: "Форма обучения")),
        ("fundingType", String(localized: "admin.academic.fundingType", defaultValue: "Финансирование")),
        ("academicStatus", String(localized: "admin.academic.status", defaultValue: "Академ. статус")),
        ("enrollmentYear", String(localized: "admin.academic.enrollmentYear", defaultValue: "Год поступления")),
        ("graduationYear", String(localized: "admin.academic.graduationYear", defaultValue: "Год выпуска")),
        ("gpa", String(localized: "admin.academic.gpa", defaultValue: "Средний балл")),
        ("dormitory", String(localized: "admin.academic.dormitory", defaultValue: "Общежитие")),
        ("createdAt", String(localized: "admin.user.field.createdAt", defaultValue: "Создан")),
    ]

    private func blockButtonTitle(_ days: Int) -> String {
        switch days {
        case 0: return String(localized: "admin.user.blockForever", defaultValue: "Заблокировать навсегда")
        case 7: return String(localized: "admin.user.blockWeek", defaultValue: "Заблокировать на неделю")
        case 30: return String(localized: "admin.user.blockMonth", defaultValue: "Заблокировать на месяц")
        default: return AdminText.blockTerm(days)
        }
    }

    // MARK: Загрузка и действия

    @MainActor
    private func load() async {
        // Профиль виден всем ролям; карточка модератора — только модерации. Падение одной
        // половины не прячет вторую.
        async let profileResult = fetchProfile()
        var cardError: Error?
        if canModerate {
            do { card = try await api.moderationCard(id: id) } catch { cardError = error }
        }
        switch await profileResult {
        case .success(let value):
            profile = value
        case .failure(let error):
            cardError = cardError ?? error
        }
        if profile == nil && card == nil, let cardError {
            failure = cardError.userMessage
            isOffline = cardError.isOffline
        }
    }

    private func fetchProfile() async -> Result<JSONValue, Error> {
        do {
            return .success(try await api.userProfile(id: id))
        } catch {
            return .failure(error)
        }
    }

    @MainActor
    private func perform(_ done: String, _ action: () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await action()
            notice = done
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }

    private func block(days: Int) async {
        await perform(String(localized: "admin.user.updated", defaultValue: "Обновлено")) {
            try await api.block(userID: id, days: days > 0 ? days : nil)
        }
    }

    private func unblock() async {
        await perform(String(localized: "admin.user.updated", defaultValue: "Обновлено")) {
            try await api.unblock(userID: id)
        }
    }

    private func endSessions() async {
        await perform(String(localized: "admin.user.sessionsDone", defaultValue: "Сессии завершены")) {
            try await api.endSessions(userID: id)
        }
    }

    private func resetTwoFactor() async {
        let code = twoFactorCode.trimmingCharacters(in: .whitespaces)
        guard code.count >= 6 else {
            actionFailure = String(localized: "admin.user.resetCodeShort", defaultValue: "Введите код из приложения-аутентификатора или резервный код")
            return
        }
        await perform(String(localized: "admin.user.resetDone", defaultValue: "2FA сброшена, пользователю отправлено письмо")) {
            try await api.resetTwoFactor(userID: id, code: code)
        }
    }
}

/// Учебные данные студента — ведёт вуз (декан факультета, админ вуза). Уходят только
/// изменённые поля: номер студенческого чужому в профиль не приходит, и пустое поле
/// здесь значит «не знаю», а не «стереть».
private struct AdminAcademicForm: View {
    let userID: String
    let profile: JSONValue
    let saved: () async -> Void

    private enum Kind { case number, decimal, text, choice([String]) }

    private struct Field: Identifiable {
        let key: String
        let title: String
        let kind: Kind
        var id: String { key }
    }

    // Справочники — значения в том написании, в каком они лежат в базе (shared-types,
    // `profile-enums.ts` веба): это данные, а не подписи интерфейса.
    private static let educationLevels = [
        "Среднее", "Среднее специальное", "Бакалавриат", "Специалитет", "Магистратура", "Аспирантура", "Докторантура",
    ]
    private static let studyForms = ["Очная", "Заочная", "Очно-заочная", "Дистанционная"]
    private static let fundingTypes = ["Бюджетное", "Платное", "Грант", "Целевое"]
    private static let academicStatuses = ["Обучающийся", "Академический отпуск", "Выпускник", "Отчислен", "Переведён"]
    private static let dormitory = ["Да", "Нет"]

    private static let fields: [Field] = [
        Field(key: "course", title: String(localized: "admin.academic.course", defaultValue: "Курс"), kind: .number),
        Field(key: "specialty", title: String(localized: "admin.academic.specialty", defaultValue: "Специальность"), kind: .text),
        Field(key: "educationLevel", title: String(localized: "admin.academic.educationLevel", defaultValue: "Уровень образования"), kind: .choice(educationLevels)),
        Field(key: "studyForm", title: String(localized: "admin.academic.studyForm", defaultValue: "Форма обучения"), kind: .choice(studyForms)),
        Field(key: "fundingType", title: String(localized: "admin.academic.fundingType", defaultValue: "Финансирование"), kind: .choice(fundingTypes)),
        Field(key: "academicStatus", title: String(localized: "admin.academic.status", defaultValue: "Академ. статус"), kind: .choice(academicStatuses)),
        Field(key: "enrollmentYear", title: String(localized: "admin.academic.enrollmentYear", defaultValue: "Год поступления"), kind: .number),
        Field(key: "graduationYear", title: String(localized: "admin.academic.graduationYear", defaultValue: "Год выпуска"), kind: .number),
        Field(key: "gpa", title: String(localized: "admin.academic.gpa", defaultValue: "Средний балл"), kind: .decimal),
        Field(key: "studentCardNumber", title: String(localized: "admin.academic.cardNumber", defaultValue: "Номер студенческого"), kind: .text),
        Field(key: "dormitory", title: String(localized: "admin.academic.dormitory", defaultValue: "Общежитие"), kind: .choice(dormitory)),
    ]

    @State private var initial: [String: String] = [:]
    @State private var values: [String: String] = [:]

    init(userID: String, profile: JSONValue, saved: @escaping () async -> Void) {
        self.userID = userID
        self.profile = profile
        self.saved = saved
        var start: [String: String] = [:]
        for field in Self.fields {
            if let value = profile[field.key], !value.isNull { start[field.key] = value.string ?? "" }
        }
        _initial = State(initialValue: start)
        _values = State(initialValue: start)
    }

    private var changed: [Field] {
        Self.fields.filter { (values[$0.key] ?? "") != (initial[$0.key] ?? "") }
    }

    var body: some View {
        FormSheet(
            title: String(localized: "admin.academic.title", defaultValue: "Учебные данные студента"),
            canSave: !changed.isEmpty,
            save: save,
            saved: saved
        ) {
            Section {
                ForEach(Self.fields) { field in
                    control(field)
                }
            } footer: {
                Text(String(localized: "admin.academic.hint", defaultValue: "Пустое поле — номер не меняется"))
            }
            .listRowBackground(Palette.card)
        }
    }

    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { values[key] ?? "" }, set: { values[key] = $0 })
    }

    @ViewBuilder
    private func control(_ field: Field) -> some View {
        switch field.kind {
        case .number:
            TextField(field.title, text: binding(field.key))
                .keyboardType(.numberPad)
        case .decimal:
            TextField(field.title, text: binding(field.key))
                .keyboardType(.decimalPad)
        case .text:
            TextField(field.title, text: binding(field.key))
        case .choice(let options):
            let current = values[field.key] ?? ""
            Picker(field.title, selection: binding(field.key)) {
                Text(verbatim: "—").tag("")
                // Значение вне справочника (старый импорт) остаётся выбираемым, иначе
                // форма молча подменила бы его.
                if !current.isEmpty && !options.contains(current) {
                    Text(verbatim: current).tag(current)
                }
                ForEach(options, id: \.self) { Text(verbatim: $0).tag($0) }
            }
        }
    }

    private func save() async throws {
        var body: [String: JSONValue] = [:]
        for field in changed {
            let raw = (values[field.key] ?? "").trimmingCharacters(in: .whitespaces)
            switch field.kind {
            case .number:
                body[field.key] = raw.isEmpty ? .null : .int(Int(raw))
            case .decimal:
                body[field.key] = raw.isEmpty ? .null : (Double(raw.replacingOccurrences(of: ",", with: ".")).map(JSONValue.number) ?? .null)
            default:
                body[field.key] = .string(raw)
            }
        }
        try await AdminAPI().updateAcademic(userID: userID, fields: body)
    }
}

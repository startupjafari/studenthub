import QuickLook
import SwiftUI

// Общее для экранов карьеры: подписи перечислений сервера, область данных платформенных
// ролей (выбранный вуз), названия городов из КАТО, облако навыков, показ скачанного файла.

// MARK: - Подписи

enum CareerText {
    static let employmentTypes = ["INTERNSHIP", "PART_TIME", "FULL_TIME", "CONTRACT", "FREELANCE"]
    static let workFormats = ["ONSITE", "HYBRID", "REMOTE"]
    static let experienceLevels = ["NO_EXPERIENCE", "INTERN", "JUNIOR", "MIDDLE"]
    static let currencies = ["KZT", "USD", "EUR", "RUB"]
    static let eventKinds = ["CAREER_FAIR", "WORKSHOP", "INTERVIEW_DAY", "COMPANY_PRESENTATION", "HACKATHON"]
    static let employmentStatuses = ["LOOKING", "OPEN", "NOT_LOOKING"]
    static let companySizes = ["1_10", "11_50", "51_200", "201_1000", "1000_PLUS"]
    static let consentFields = ["GPA", "PHONE", "EMAIL"]
    /// Статусы, которые вправе ставить компания (`EMPLOYER_APPLICATION_STATUSES`).
    static let employerStatuses: Set<String> = ["VIEWED", "SHORTLISTED", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]
    static let applicationStatuses = ["SUBMITTED", "VIEWED", "SHORTLISTED", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"]

    /// Граф переходов отклика (`CAREER_APPLICATION_TRANSITIONS`).
    static func transitions(from status: String) -> [String] {
        switch status {
        case "SUBMITTED": return ["VIEWED", "SHORTLISTED", "REJECTED", "WITHDRAWN"]
        case "VIEWED": return ["SHORTLISTED", "REJECTED", "WITHDRAWN"]
        case "SHORTLISTED": return ["INTERVIEW", "REJECTED", "WITHDRAWN"]
        case "INTERVIEW": return ["OFFER", "REJECTED", "WITHDRAWN"]
        case "OFFER": return ["HIRED", "REJECTED", "WITHDRAWN"]
        default: return []
        }
    }

    static func isFinal(_ status: String) -> Bool { transitions(from: status).isEmpty }

    /// Варианты полосы фильтров: «все» и значения перечисления.
    static func chips(_ allTitle: String, _ values: [String], _ label: (String) -> String) -> [(value: String?, title: String)] {
        var options: [(value: String?, title: String)] = [(value: nil, title: allTitle)]
        for value in values {
            options.append((value: value, title: label(value)))
        }
        return options
    }

    static var allTitle: String { String(localized: "career.filter.all", defaultValue: "Все") }

    static func employment(_ raw: String?) -> String {
        switch raw {
        case "INTERNSHIP": return String(localized: "career.employment.internship", defaultValue: "Стажировка")
        case "PART_TIME": return String(localized: "career.employment.partTime", defaultValue: "Частичная")
        case "FULL_TIME": return String(localized: "career.employment.fullTime", defaultValue: "Полная")
        case "CONTRACT": return String(localized: "career.employment.contract", defaultValue: "Проект")
        case "FREELANCE": return String(localized: "career.employment.freelance", defaultValue: "Фриланс")
        default: return raw ?? "—"
        }
    }

    static func format(_ raw: String?) -> String {
        switch raw {
        case "ONSITE": return String(localized: "career.format.onsite", defaultValue: "В офисе")
        case "HYBRID": return String(localized: "career.format.hybrid", defaultValue: "Гибрид")
        case "REMOTE": return String(localized: "career.format.remote", defaultValue: "Удалённо")
        default: return raw ?? "—"
        }
    }

    static func experience(_ raw: String?) -> String {
        switch raw {
        case "NO_EXPERIENCE": return String(localized: "career.experience.none", defaultValue: "Без опыта")
        case "INTERN": return String(localized: "career.experience.intern", defaultValue: "Стажёр")
        case "JUNIOR": return "Junior"
        case "MIDDLE": return "Middle"
        default: return raw ?? "—"
        }
    }

    static func applicationStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "SUBMITTED": return (String(localized: "career.app.submitted", defaultValue: "Отправлен"), Palette.info)
        case "VIEWED": return (String(localized: "career.app.viewed", defaultValue: "Просмотрен"), Palette.info)
        case "SHORTLISTED": return (String(localized: "career.app.shortlisted", defaultValue: "В шорт-листе"), Palette.primary)
        case "INTERVIEW": return (String(localized: "career.app.interview", defaultValue: "Интервью"), Palette.warning)
        case "OFFER": return (String(localized: "career.app.offer", defaultValue: "Оффер"), Palette.success)
        case "HIRED": return (String(localized: "career.app.hired", defaultValue: "Принят"), Palette.success)
        case "REJECTED": return (String(localized: "career.app.rejected", defaultValue: "Отказ"), Palette.destructive)
        case "WITHDRAWN": return (String(localized: "career.app.withdrawn", defaultValue: "Отозван"), Palette.mutedForeground)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func vacancyStatus(_ raw: String?) -> (text: String, tint: Color) {
        switch raw {
        case "DRAFT": return (String(localized: "career.vacancyStatus.draft", defaultValue: "Черновик"), Palette.mutedForeground)
        case "PUBLISHED": return (String(localized: "career.vacancyStatus.published", defaultValue: "Опубликована"), Palette.success)
        case "PAUSED": return (String(localized: "career.vacancyStatus.paused", defaultValue: "Снята"), Palette.warning)
        case "CLOSED": return (String(localized: "career.vacancyStatus.closed", defaultValue: "Закрыта"), Palette.mutedForeground)
        default: return (raw ?? "—", Palette.mutedForeground)
        }
    }

    /// Решение вуза по вакансии — в очереди модерации.
    static func reviewStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "PENDING": return (String(localized: "career.review.pending", defaultValue: "На модерации"), Palette.warning)
        case "APPROVED": return (String(localized: "career.review.approved", defaultValue: "Допущены"), Palette.success)
        case "REJECTED": return (String(localized: "career.review.rejected", defaultValue: "Отказано"), Palette.destructive)
        default: return (raw, Palette.mutedForeground)
        }
    }

    /// То же решение глазами компании.
    static func employerReviewStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "PENDING": return (String(localized: "career.employerReview.pending", defaultValue: "на модерации"), Palette.warning)
        case "APPROVED": return (String(localized: "career.employerReview.approved", defaultValue: "показывается"), Palette.success)
        case "REJECTED": return (String(localized: "career.employerReview.rejected", defaultValue: "отклонена"), Palette.destructive)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func accessStatus(_ raw: String, expired: Bool = false) -> (text: String, tint: Color) {
        switch raw {
        case "APPROVED" where expired:
            return (String(localized: "career.access.expired", defaultValue: "Срок доступа истёк"), Palette.mutedForeground)
        case "APPROVED": return (String(localized: "career.access.approved", defaultValue: "Доступ открыт"), Palette.success)
        case "REQUESTED": return (String(localized: "career.access.requested", defaultValue: "На рассмотрении"), Palette.warning)
        case "REJECTED": return (String(localized: "career.access.rejected", defaultValue: "Отказано"), Palette.destructive)
        case "REVOKED": return (String(localized: "career.access.revoked", defaultValue: "Доступ отозван"), Palette.mutedForeground)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func eventKind(_ raw: String?) -> String {
        switch raw {
        case "CAREER_FAIR": return String(localized: "career.kind.fair", defaultValue: "Ярмарка вакансий")
        case "WORKSHOP": return String(localized: "career.kind.workshop", defaultValue: "Воркшоп")
        case "INTERVIEW_DAY": return String(localized: "career.kind.interviewDay", defaultValue: "День собеседований")
        case "COMPANY_PRESENTATION": return String(localized: "career.kind.presentation", defaultValue: "Презентация компании")
        case "HACKATHON": return String(localized: "career.kind.hackathon", defaultValue: "Хакатон")
        default: return raw ?? "—"
        }
    }

    static func employmentStatus(_ raw: String?) -> String {
        switch raw {
        case "LOOKING": return String(localized: "career.seeking.looking", defaultValue: "Ищу работу")
        case "OPEN": return String(localized: "career.seeking.open", defaultValue: "Открыт к предложениям")
        case "NOT_LOOKING": return String(localized: "career.seeking.notLooking", defaultValue: "Не ищу")
        default: return raw ?? "—"
        }
    }

    static func companySize(_ raw: String?) -> String {
        switch raw {
        case "1_10": return String(localized: "career.size.1to10", defaultValue: "1–10 сотрудников")
        case "11_50": return String(localized: "career.size.11to50", defaultValue: "11–50 сотрудников")
        case "51_200": return String(localized: "career.size.51to200", defaultValue: "51–200 сотрудников")
        case "201_1000": return String(localized: "career.size.201to1000", defaultValue: "201–1000 сотрудников")
        case "1000_PLUS": return String(localized: "career.size.1000plus", defaultValue: "Больше 1000 сотрудников")
        default: return raw ?? String(localized: "career.size.none", defaultValue: "Не указана")
        }
    }

    static func memberRole(_ raw: String) -> String {
        switch raw {
        case "OWNER": return String(localized: "career.member.owner", defaultValue: "Владелец")
        case "RECRUITER": return String(localized: "career.member.recruiter", defaultValue: "Рекрутёр")
        default: return raw
        }
    }

    static func consent(_ raw: String) -> String {
        switch raw {
        case "GPA": return String(localized: "career.consent.gpa", defaultValue: "Показывать GPA")
        case "PHONE": return String(localized: "career.consent.phone", defaultValue: "Показывать телефон")
        case "EMAIL": return String(localized: "career.consent.email", defaultValue: "Показывать email")
        default: return raw
        }
    }

    static func readinessPart(_ raw: String) -> String {
        switch raw {
        case "education": return String(localized: "career.part.education", defaultValue: "Образование")
        case "skills": return String(localized: "career.part.skills", defaultValue: "Навыки")
        case "portfolio": return String(localized: "career.part.portfolio", defaultValue: "Портфолио")
        case "preferences": return String(localized: "career.part.preferences", defaultValue: "Предпочтения")
        case "about": return String(localized: "career.part.about", defaultValue: "О себе")
        default: return raw
        }
    }

    /// «от 200 000 до 400 000 KZT».
    static func salary(min: Int?, max: Int?, currency: String?) -> String? {
        guard min != nil || max != nil else { return nil }
        var parts: [String] = []
        if let min {
            let value = min.formatted()
            parts.append(String(localized: "career.salary.from", defaultValue: "от \(value)"))
        }
        if let max {
            let value = max.formatted()
            parts.append(String(localized: "career.salary.to", defaultValue: "до \(value)"))
        }
        if let currency { parts.append(currency) }
        return parts.joined(separator: " ")
    }

    static func salary(_ vacancy: CareerVacancy) -> String? {
        salary(min: vacancy.salaryMin, max: vacancy.salaryMax, currency: vacancy.salaryCurrency)
    }

    static func list(_ items: [String]?) -> [String] {
        (items ?? []).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// Строка через запятую → список без пустых и повторов.
    static func split(_ text: String) -> [String] {
        var seen = Set<String>()
        return text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter {
            !$0.isEmpty && seen.insert($0.lowercased()).inserted
        }
    }
}

// MARK: - Область данных платформенных ролей

/// Вуз, в чьих данных работает карьерный центр. У сотрудника вуза он в токене, и запросы
/// уходят без параметра; платформенные роли выбирают его вручную — без выбора сервер
/// отвечает `WRONG_SCOPE`. Выбор один на все разделы и переживает перезапуск.
@MainActor
@Observable
final class CareerScope {
    static let shared = CareerScope()

    private(set) var universityID: String?
    private(set) var universityName: String?

    private init() {
        universityID = UserDefaults.standard.string(forKey: "career.scope.universityId")
        universityName = UserDefaults.standard.string(forKey: "career.scope.universityName")
    }

    func select(_ university: CareerUniversityRef) {
        universityID = university.id
        universityName = university.shortName ?? university.name
        UserDefaults.standard.set(university.id, forKey: "career.scope.universityId")
        UserDefaults.standard.set(universityName, forKey: "career.scope.universityName")
    }

    /// Параметр `universityId` для роли: только у платформенных.
    func parameter(for role: Role) -> String? {
        role.isPlatform ? universityID : nil
    }

    func isMissing(for role: Role) -> Bool {
        role.isPlatform && universityID == nil
    }
}

/// Пока платформенная роль не выбрала вуз, раздел показывает выбор, а не отказ сервера.
struct CareerScopeGate<Content: View>: View {
    @ViewBuilder let content: (String?) -> Content

    @Environment(\.viewerRole) private var role
    @State private var scope = CareerScope.shared
    @State private var picking = false

    var body: some View {
        Group {
            if scope.isMissing(for: role) {
                EmptyStateView(
                    title: String(localized: "career.scope.pick", defaultValue: "Выберите университет"),
                    symbol: "building.columns",
                    hint: String(
                        localized: "career.scope.hint",
                        defaultValue: "Разделы карьерного центра показывают данные одного вуза."
                    ),
                    actionTitle: String(localized: "career.scope.choose", defaultValue: "Выбрать"),
                    action: { picking = true }
                )
                .background(Palette.background)
            } else {
                content(scope.parameter(for: role))
                    .id(scope.universityID ?? "own")
            }
        }
        .toolbar {
            if role.isPlatform {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        picking = true
                    } label: {
                        Image(systemName: "building.columns")
                    }
                    .accessibilityLabel(Text(scope.universityName ?? String(localized: "career.scope.pick", defaultValue: "Выберите университет")))
                }
            }
        }
        .sheet(isPresented: $picking) {
            CareerUniversityPicker { scope.select($0) }
        }
    }
}

/// Поиск вуза по названию — вузов больше, чем помещается в один список.
struct CareerUniversityPicker: View {
    let picked: (CareerUniversityRef) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var items: [CareerUniversityRef]?
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            List {
                if let items {
                    if items.isEmpty {
                        EmptyStateView(
                            title: String(localized: "career.scope.empty", defaultValue: "Университеты не найдены"),
                            symbol: "magnifyingglass"
                        )
                        .listRowBackground(Color.clear)
                    }
                    ForEach(items) { item in
                        Button {
                            picked(item)
                            dismiss()
                        } label: {
                            ListCardRow(title: item.name, subtitle: item.shortName)
                        }
                        .listRowBackground(Palette.card)
                    }
                } else if let failure {
                    ErrorStateView(message: failure) { await load(search) }
                        .listRowBackground(Color.clear)
                } else {
                    LoadingStateView().listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(Text(String(localized: "career.scope.pick", defaultValue: "Выберите университет")))
            .navigationBarTitleDisplayMode(.inline)
            .debouncedSearch($search, prompt: String(localized: "career.scope.search", defaultValue: "Поиск университета")) {
                await load($0)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "common.cancel", defaultValue: "Отмена")) { dismiss() }
                }
            }
            .task { await load("") }
        }
    }

    @MainActor
    private func load(_ text: String) async {
        do {
            items = try await CareerAPI().universities(search: text)
            failure = nil
        } catch is CancellationError {
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Города из КАТО

/// Названия городов по кодам КАТО. Коды со всего экрана собираются в один запрос:
/// по запросу на строку список из двадцати вакансий ушёл бы двадцатью запросами.
@MainActor
@Observable
final class CareerKatoNames {
    static let shared = CareerKatoNames()

    private(set) var names: [String: String] = [:]
    @ObservationIgnored private var pending: Set<String> = []
    @ObservationIgnored private var requested: Set<String> = []
    @ObservationIgnored private var flush: Task<Void, Never>?

    func name(_ code: String?) -> String? {
        guard let code, !code.isEmpty else { return nil }
        // Старые записи хранят город текстом, а не кодом: показываем как есть.
        guard code.count == 9, code.allSatisfy(\.isNumber) else { return code }
        return names[code]
    }

    func request(_ codes: [String?]) {
        for code in codes.compactMap({ $0 }) where code.count == 9 && code.allSatisfy(\.isNumber) {
            if names[code] == nil, !requested.contains(code) {
                pending.insert(code)
            }
        }
        guard !pending.isEmpty, flush == nil else { return }
        flush = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(60))
            await self?.resolvePending()
        }
    }

    func remember(_ unit: CareerKatoUnit) {
        names[unit.code] = unit.nameRu
    }

    private func resolvePending() async {
        let batch = Array(pending.prefix(100))
        pending.subtract(batch)
        requested.formUnion(batch)
        flush = nil
        if let units = try? await CareerAPI().katoResolve(batch) {
            for unit in units { names[unit.code] = unit.nameRu }
        }
        if !pending.isEmpty { request([]) }
    }
}

/// Выбор города из справочника КАТО: в вакансии и профиле компании хранится код.
struct CareerCityField: View {
    let title: String
    @Binding var code: String

    @State private var kato = CareerKatoNames.shared
    @State private var picking = false

    var body: some View {
        Button {
            picking = true
        } label: {
            HStack {
                Text(title).foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                Text(code.isEmpty
                    ? String(localized: "career.city.none", defaultValue: "Не указан")
                    : (kato.name(code) ?? code))
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
            }
        }
        .task(id: code) { kato.request([code]) }
        .sheet(isPresented: $picking) {
            CareerCityPicker(selected: $code)
        }
    }
}

private struct CareerCityPicker: View {
    @Binding var selected: String

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var items: [CareerKatoUnit]?
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button(String(localized: "career.city.clear", defaultValue: "Без города")) {
                        selected = ""
                        dismiss()
                    }
                }
                .listRowBackground(Palette.card)
                if let items {
                    Section {
                        ForEach(items) { unit in
                            Button {
                                CareerKatoNames.shared.remember(unit)
                                selected = unit.code
                                dismiss()
                            } label: {
                                ListCardRow(title: unit.nameRu, subtitle: unit.regionNameRu)
                            }
                        }
                    }
                    .listRowBackground(Palette.card)
                } else if let failure {
                    ErrorStateView(message: failure) { await load(search) }
                        .listRowBackground(Color.clear)
                } else {
                    LoadingStateView().listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(Text(String(localized: "career.city.title", defaultValue: "Город")))
            .navigationBarTitleDisplayMode(.inline)
            .debouncedSearch($search, prompt: String(localized: "career.city.search", defaultValue: "Название города")) {
                await load($0)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "common.cancel", defaultValue: "Отмена")) { dismiss() }
                }
            }
            .task { await load("") }
        }
    }

    @MainActor
    private func load(_ text: String) async {
        do {
            items = try await CareerAPI().katoSearch(text)
            failure = nil
        } catch is CancellationError {
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Облако меток

/// Навыки и языки капсулами с переносом строк.
struct CareerTags: View {
    let items: [String]
    var tint: Color = Palette.mutedForeground

    var body: some View {
        CareerFlowLayout(spacing: Spacing.sm) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                Text(item)
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, 3)
                    .foregroundStyle(tint == Palette.mutedForeground ? Palette.foreground : tint)
                    .background((tint == Palette.mutedForeground ? Palette.muted : tint.opacity(0.12)), in: Capsule())
            }
        }
    }
}

struct CareerFlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var line: CGFloat = 0
        var widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += line + spacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

// MARK: - Файл из ответа API

/// Показ файла, который API отдаёт телом (PDF резюме, выгрузка отчёта): системный
/// просмотр с кнопкой «Поделиться».
@MainActor
@Observable
final class CareerFileExport {
    var url: URL?
    var isLoading = false
    var failure: String?

    func run(name: String, load: @escaping () async throws -> Data) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let data = try await load()
            let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let target = folder.appending(path: name)
            try data.write(to: target)
            url = target
        } catch {
            failure = error.userMessage
        }
    }
}

struct CareerFileExportModifier: ViewModifier {
    @Bindable var export: CareerFileExport

    func body(content: Content) -> some View {
        content
            .quickLookPreview($export.url)
            .actionFailureAlert($export.failure)
            .overlay {
                if export.isLoading {
                    ProgressView()
                        .padding(Spacing.xl)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.xl))
                }
            }
    }
}

// MARK: - Мелкие общие куски

/// Плашка-предупреждение в начале экрана: блокировка, неподтверждённая почта.
struct CareerNotice: View {
    let title: String
    let text: String
    var symbol: String = "info.circle"
    var tint: Color = Palette.info

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .font(.title3)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(title).font(Typography.cardTitle).foregroundStyle(Palette.foreground)
                Text(text)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

/// Подзаголовок-пояснение под заголовком секции.
struct CareerSectionHeader: View {
    let title: String
    var hint: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            if let hint, !hint.isEmpty {
                Text(hint)
                    .font(.caption)
                    .textCase(nil)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
    }
}

/// Число из JSON-сводки без падения на отсутствующем поле.
enum CareerJSON {
    static func int(_ value: JSONValue?, _ path: String...) -> Int {
        var current = value
        for key in path { current = current?[key] }
        return current?.int ?? 0
    }

    static func optional(_ value: JSONValue?, _ path: String...) -> Double? {
        var current = value
        for key in path { current = current?[key] }
        guard let current, !current.isNull else { return nil }
        return current.double
    }

    /// Сумма значений словаря счётчиков (`funnel`, `vacancies`).
    static func sum(_ value: JSONValue?) -> Int {
        value?.object?.values.reduce(0) { $0 + ($1.int ?? 0) } ?? 0
    }
}

import PhotosUI
import SwiftUI

// Кабинет работодателя: обзор, вакансии компании (создание, правка, публикация, закрытие),
// кандидаты (воронка откликов и карточка студента), доступ к вузам, команда и профиль
// компании. Своего вуза у работодателя нет: студентов он видит только в вузах, которые
// одобрили его заявку, поэтому обзор ведёт к заявкам, пока доступа нет.

// MARK: - Обзор

private struct CareerEmployerSummary {
    var company: CareerCompany
    var access: [CareerAccess]
    var metrics: JSONValue?
}

struct CareerEmployerHomeView: View {
    @State private var token = 0
    @State private var resending = false

    var body: some View {
        RemoteContent(reloadToken: token, load: load) { summary in
            let company = summary.company
            let active = summary.access.filter(\.isActive).count
            let pending = summary.access.filter { $0.status == "REQUESTED" }.count
            List {
                if company.status == "BLOCKED" {
                    Section {
                        CareerNotice(
                            title: String(localized: "career.employer.blocked", defaultValue: "Компания заблокирована"),
                            text: company.blockedReason ?? String(localized: "career.employer.blockedText", defaultValue: "Обратитесь в поддержку платформы."),
                            symbol: "exclamationmark.shield",
                            tint: Palette.destructive
                        )
                    }
                    .listRowBackground(Palette.card)
                }
                if company.status == "PENDING_EMAIL" {
                    Section {
                        CareerNotice(
                            title: String(localized: "career.employer.unverified", defaultValue: "Подтвердите email"),
                            text: String(
                                localized: "career.employer.unverifiedText",
                                defaultValue: "Пока адрес не подтверждён, компанию не видит ни один университет. Письмо со ссылкой отправлено при регистрации."
                            ),
                            symbol: "clock",
                            tint: Palette.warning
                        )
                        Button(String(localized: "career.signup.resend", defaultValue: "Отправить письмо ещё раз")) { resending = true }
                    }
                    .listRowBackground(Palette.card)
                }

                Section {
                    StatGrid {
                        NavigationLink(value: AppRoute.career(.access)) {
                            StatTile(
                                title: String(localized: "career.employer.approved", defaultValue: "Университетов открыто"),
                                value: active.formatted(),
                                symbol: "graduationcap",
                                tint: Palette.success
                            )
                        }
                        .buttonStyle(.plain)
                        NavigationLink(value: AppRoute.career(.access)) {
                            StatTile(
                                title: String(localized: "career.employer.pending", defaultValue: "Заявок на рассмотрении"),
                                value: pending.formatted(),
                                symbol: "clock",
                                tint: Palette.warning
                            )
                        }
                        .buttonStyle(.plain)
                        if let metrics = summary.metrics {
                            NavigationLink(value: AppRoute.career(.employerVacancies)) {
                                StatTile(
                                    title: String(localized: "career.employer.published", defaultValue: "Вакансий опубликовано"),
                                    value: CareerJSON.int(metrics, "vacancies", "PUBLISHED").formatted(),
                                    symbol: "briefcase"
                                )
                            }
                            .buttonStyle(.plain)
                            StatTile(
                                title: String(localized: "career.employer.views", defaultValue: "Просмотров вакансий"),
                                value: CareerJSON.int(metrics, "views").formatted(),
                                symbol: "eye",
                                tint: Palette.info
                            )
                            NavigationLink(value: AppRoute.career(.candidates)) {
                                StatTile(
                                    title: String(localized: "career.employer.applications", defaultValue: "Откликов"),
                                    value: CareerJSON.sum(metrics["funnel"]).formatted(),
                                    symbol: "person.3"
                                )
                            }
                            .buttonStyle(.plain)
                            StatTile(
                                title: String(localized: "career.employer.hired", defaultValue: "Нанято"),
                                value: CareerJSON.int(metrics, "funnel", "HIRED").formatted(),
                                symbol: "checkmark.seal",
                                tint: Palette.success
                            )
                        }
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                if let rates = summary.metrics?["rates"] {
                    Section {
                        rateBar(String(localized: "career.employer.rateApply", defaultValue: "Просмотр → отклик"), CareerJSON.optional(rates, "apply"))
                        rateBar(String(localized: "career.staff.rateInterview", defaultValue: "До интервью"), CareerJSON.optional(rates, "interview"))
                        rateBar(String(localized: "career.staff.rateHired", defaultValue: "До найма"), CareerJSON.optional(rates, "hired"))
                    } header: {
                        Text(String(localized: "career.staff.rates", defaultValue: "Конверсия воронки"))
                    }
                    .listRowBackground(Palette.card)
                }

                if active == 0, company.status == "ACTIVE" {
                    Section {
                        CareerNotice(
                            title: String(localized: "career.employer.noAccess", defaultValue: "Доступа к студентам пока нет"),
                            text: String(
                                localized: "career.employer.noAccessText",
                                defaultValue: "Доступ открывает университет. Подайте заявку — после одобрения вам станут доступны студенты этого вуза."
                            ),
                            symbol: "graduationcap"
                        )
                        NavigationLink(value: AppRoute.career(.access)) {
                            Text(String(localized: "career.access.request", defaultValue: "Подать заявку"))
                        }
                    }
                    .listRowBackground(Palette.card)
                }

                Section {
                    NavigationLink(value: AppRoute.career(.companyProfile)) {
                        PersonRow(
                            name: company.name,
                            subtitle: String(
                                localized: "career.employer.companyText",
                                defaultValue: "Название, описание и сайт — это то, что увидит студент в карточке вакансии."
                            ),
                            avatarURL: company.logoUrl
                        )
                    }
                    ForEach([CareerScreen.employerVacancies, .candidates, .access, .team], id: \.self) { screen in
                        NavigationLink(value: AppRoute.career(screen)) {
                            IconRow(title: screen.title, symbol: screen.symbol, tint: TileTint.purple)
                        }
                    }
                }
                .listRowBackground(Palette.card)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .refreshable { token += 1 }
            .navigationTitle(Text(company.name))
        }
        .navigationTitle(Text(CareerScreen.employerHome.title))
        .sheet(isPresented: $resending) {
            CareerResendForm()
        }
    }

    private func rateBar(_ title: String, _ value: Double?) -> some View {
        ShareBar(
            title: title,
            fraction: (value ?? 0) / 100,
            valueText: value.map { "\(Int($0.rounded()))%" } ?? "—"
        )
    }

    private func load() async throws -> CareerEmployerSummary {
        let api = CareerAPI()
        let company = try await api.myCompany()
        let access = (try? await api.myAccess()) ?? []
        // Пока почта не подтверждена или компания заблокирована, считать нечего.
        let metrics = company.status == "ACTIVE" ? try? await api.companyAnalytics() : nil
        return CareerEmployerSummary(company: company, access: access, metrics: metrics)
    }
}

// MARK: - Вакансии компании

struct CareerEmployerVacanciesView: View {
    @State private var loader = PagedLoader<CareerVacancy>(limit: 20) { request in
        try await CareerAPI().myVacancies(request)
    }
    @State private var creating = false

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "career.employerVacancies.empty", defaultValue: "Вакансий нет"),
                symbol: "briefcase",
                hint: String(
                    localized: "career.employerVacancies.emptyHint",
                    defaultValue: "Создайте вакансию и отправьте её на модерацию в допустившие вас университеты."
                ),
                actionTitle: String(localized: "career.employerVacancies.create", defaultValue: "Новая вакансия"),
                action: { creating = true }
            ),
            header: {
                Text(String(
                    localized: "career.employerVacancies.subtitle",
                    defaultValue: "Публикация не равна показу: каждый вуз решает отдельно"
                ))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .listRowBackground(Color.clear)
            },
            row: { vacancy in
                NavigationLink(value: AppRoute.career(.employerVacancy(id: vacancy.id))) {
                    CareerEmployerVacancyRow(vacancy: vacancy)
                }
            }
        )
        .navigationTitle(Text(CareerScreen.employerVacancies.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    creating = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel(Text(String(localized: "career.employerVacancies.create", defaultValue: "Новая вакансия")))
            }
        }
        .sheet(isPresented: $creating) {
            CareerVacancyForm(vacancy: nil) { await loader.reload() }
        }
    }
}

private struct CareerEmployerVacancyRow: View {
    let vacancy: CareerVacancy

    var body: some View {
        let status = CareerText.vacancyStatus(vacancy.status)
        let views = (vacancy.views ?? 0).formatted()
        let reviews = (vacancy.reviews ?? []).map { review in
            "\(review.university.name): \(CareerText.employerReviewStatus(review.status).text)"
        }
        ListCardRow(
            title: vacancy.title,
            subtitle: [vacancy.employmentType.map(CareerText.employment), vacancy.workFormat.map(CareerText.format), CareerText.salary(vacancy)]
                .compactMap { $0 }.joined(separator: " · "),
            status: (status.text, status.tint),
            lines: [
                String(localized: "career.employerVacancies.views", defaultValue: "Просмотров: \(views)"),
                reviews.prefix(3).joined(separator: ", "),
            ]
        )
    }
}

/// Вакансия компании: решения вузов, действия по статусу и отклики на неё.
struct CareerEmployerVacancyView: View {
    let id: String

    @Environment(\.dismiss) private var dismiss
    @State private var token = 0
    @State private var editing: CareerVacancy?
    @State private var confirming: CareerVacancyAction?
    @State private var failure: String?
    @State private var busy = false
    @State private var kato = CareerKatoNames.shared

    private struct Content {
        var vacancy: CareerVacancy
        var applications: [CareerApplication]
    }

    var body: some View {
        RemoteContent(reloadToken: token, load: load) { content in
            let vacancy = content.vacancy
            List {
                Section {
                    let status = CareerText.vacancyStatus(vacancy.status)
                    let views = (vacancy.views ?? 0).formatted()
                    ListCardRow(
                        title: vacancy.title,
                        subtitle: CareerText.salary(vacancy),
                        status: (status.text, status.tint),
                        lines: [String(localized: "career.employerVacancies.views", defaultValue: "Просмотров: \(views)")]
                    )
                    DetailRow(title: String(localized: "career.vacancy.employment", defaultValue: "Занятость"), value: CareerText.employment(vacancy.employmentType))
                    DetailRow(title: String(localized: "career.vacancy.format", defaultValue: "Формат работы"), value: CareerText.format(vacancy.workFormat))
                    DetailRow(title: String(localized: "career.vacancy.experience", defaultValue: "Опыт"), value: CareerText.experience(vacancy.experienceLevel))
                    if let city = kato.name(vacancy.city) {
                        DetailRow(title: String(localized: "career.vacancy.city", defaultValue: "Город"), value: city)
                    }
                    if let deadline = vacancy.deadline {
                        DetailRow(title: String(localized: "career.vacancy.deadline", defaultValue: "Принимать отклики до"), value: DisplayFormat.date(deadline))
                    }
                    if !CareerText.list(vacancy.skills).isEmpty {
                        CareerTags(items: CareerText.list(vacancy.skills))
                    }
                    if !CareerText.list(vacancy.languages).isEmpty {
                        DetailRow(
                            title: String(localized: "career.vacancy.languages", defaultValue: "Языки"),
                            value: CareerText.list(vacancy.languages).joined(separator: ", ")
                        )
                    }
                }
                .listRowBackground(Palette.card)

                if let reviews = vacancy.reviews, !reviews.isEmpty {
                    Section {
                        ForEach(Array(reviews.enumerated()), id: \.offset) { _, review in
                            let status = CareerText.employerReviewStatus(review.status)
                            ListCardRow(
                                title: review.university.name,
                                status: (status.text, status.tint),
                                lines: [review.reason.map { "\(String(localized: "common.reason", defaultValue: "Причина")): \($0)" } ?? ""]
                            )
                        }
                    } header: {
                        Text(String(localized: "career.employerVacancies.byUniversity", defaultValue: "Решения университетов"))
                    }
                    .listRowBackground(Palette.card)
                }

                Section {
                    actionButtons(vacancy)
                }
                .listRowBackground(Palette.card)

                if let description = vacancy.description, !description.isEmpty {
                    Section {
                        Text(description).textSelection(.enabled)
                    } header: {
                        Text(String(localized: "career.vacancy.description", defaultValue: "Описание"))
                    }
                    .listRowBackground(Palette.card)
                }

                Section {
                    if content.applications.isEmpty {
                        Text(String(localized: "career.candidates.empty", defaultValue: "Откликов нет"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(content.applications) { application in
                        if let student = application.student {
                            NavigationLink(value: AppRoute.career(.candidate(id: student.id))) {
                                let status = CareerText.applicationStatus(application.status)
                                PersonRow(
                                    name: student.name,
                                    subtitle: student.headline ?? student.specialty,
                                    avatarURL: student.avatarThumbUrl,
                                    trailing: status.text
                                )
                            }
                        }
                    }
                    NavigationLink(value: AppRoute.career(.candidates)) {
                        Text(CareerScreen.candidates.title)
                    }
                } header: {
                    Text(String(localized: "career.employerVacancies.applications", defaultValue: "Отклики"))
                }
                .listRowBackground(Palette.card)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .refreshable { token += 1 }
            .task(id: vacancy.city) { kato.request([vacancy.city]) }
            .toolbar {
                // Закрытая вакансия — конечное состояние: ни правки, ни публикации.
                if vacancy.status != "CLOSED" {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(String(localized: "career.employerVacancies.edit", defaultValue: "Изменить")) { editing = vacancy }
                    }
                }
            }
        }
        .navigationTitle(Text(CareerScreen.employerVacancy(id: id).title))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editing) { vacancy in
            CareerVacancyForm(vacancy: vacancy) { token += 1 }
        }
        .confirmationDialog(
            confirming?.confirmTitle ?? "",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            titleVisibility: .visible,
            presenting: confirming
        ) { action in
            Button(action.title, role: .destructive) {
                Task { await perform(action) }
            }
        } message: { action in
            Text(action.confirmText)
        }
        .actionFailureAlert($failure)
    }

    @ViewBuilder
    private func actionButtons(_ vacancy: CareerVacancy) -> some View {
        let status = vacancy.status ?? ""
        if status == "DRAFT" || status == "PAUSED" {
            Button(CareerVacancyAction.publish.title) { Task { await perform(.publish) } }.disabled(busy)
        }
        if status == "PUBLISHED" {
            // Повторная публикация отправляет вакансию вузам, где её ещё нет или её отклонили.
            Button(CareerVacancyAction.republish.title) { Task { await perform(.republish) } }.disabled(busy)
            Text(String(
                localized: "career.employerVacancies.republishHint",
                defaultValue: "Отправить на модерацию в университеты, где вакансии ещё нет или её отклонили. Одобрения других университетов сохранятся"
            ))
            .font(.caption)
            .foregroundStyle(Palette.mutedForeground)
            Button(CareerVacancyAction.pause.title) { Task { await perform(.pause) } }.disabled(busy)
        }
        if status != "CLOSED" {
            Button(CareerVacancyAction.close.title, role: .destructive) { confirming = .close }.disabled(busy)
        }
        if status == "DRAFT" {
            Button(CareerVacancyAction.delete.title, role: .destructive) { confirming = .delete }.disabled(busy)
        }
    }

    private func load() async throws -> Content {
        let api = CareerAPI()
        let vacancy = try await api.myVacancy(id: id)
        let applications = (try? await api.pipeline(PageRequest(cursor: nil, page: 1, limit: 20), params: ["vacancyId": id]).items) ?? []
        return Content(vacancy: vacancy, applications: applications)
    }

    @MainActor
    private func perform(_ action: CareerVacancyAction) async {
        busy = true
        defer { busy = false }
        do {
            switch action {
            case .delete:
                try await CareerAPI().deleteVacancy(id: id)
                dismiss()
                return
            case .publish, .republish:
                try await CareerAPI().vacancyAction(id: id, action: "publish")
            case .pause:
                try await CareerAPI().vacancyAction(id: id, action: "pause")
            case .close:
                try await CareerAPI().vacancyAction(id: id, action: "close")
            }
            token += 1
        } catch {
            failure = error.userMessage
        }
    }
}

private enum CareerVacancyAction: Hashable {
    case publish, republish, pause, close, delete

    var title: String {
        switch self {
        case .publish: return String(localized: "career.employerVacancies.publish", defaultValue: "Опубликовать")
        case .republish: return String(localized: "career.employerVacancies.republish", defaultValue: "Опубликовать повторно")
        case .pause: return String(localized: "career.employerVacancies.pause", defaultValue: "Снять с публикации")
        case .close: return String(localized: "career.employerVacancies.close", defaultValue: "Закрыть")
        case .delete: return String(localized: "career.employerVacancies.delete", defaultValue: "Удалить")
        }
    }

    var confirmTitle: String {
        switch self {
        case .delete: return String(localized: "career.employerVacancies.deleteConfirm", defaultValue: "Удалить черновик?")
        default: return String(localized: "career.employerVacancies.closeConfirm", defaultValue: "Закрыть вакансию?")
        }
    }

    var confirmText: String {
        switch self {
        case .delete:
            return String(
                localized: "career.employerVacancies.deleteText",
                defaultValue: "Черновик удалится насовсем, восстановить его не получится."
            )
        default:
            return String(
                localized: "career.employerVacancies.closeText",
                defaultValue: "Вакансия пропадёт с витрин университетов. Закрытую вакансию нельзя изменить или опубликовать снова."
            )
        }
    }
}

/// Форма вакансии. Новая уходит черновиком: публикует её компания отдельным шагом.
private struct CareerVacancyForm: View {
    let vacancy: CareerVacancy?
    let saved: () async -> Void

    @State private var title: String
    @State private var description: String
    @State private var employment: String
    @State private var format: String
    @State private var experience: String
    @State private var city: String
    @State private var salaryMin: String
    @State private var salaryMax: String
    @State private var currency: String
    @State private var skills: String
    @State private var languages: String
    @State private var hasDeadline: Bool
    @State private var deadline: Date

    init(vacancy: CareerVacancy?, saved: @escaping () async -> Void) {
        self.vacancy = vacancy
        self.saved = saved
        _title = State(initialValue: vacancy?.title ?? "")
        _description = State(initialValue: vacancy?.description ?? "")
        _employment = State(initialValue: vacancy?.employmentType ?? "INTERNSHIP")
        _format = State(initialValue: vacancy?.workFormat ?? "ONSITE")
        _experience = State(initialValue: vacancy?.experienceLevel ?? "NO_EXPERIENCE")
        _city = State(initialValue: vacancy?.city ?? "")
        _salaryMin = State(initialValue: vacancy?.salaryMin.map(String.init) ?? "")
        _salaryMax = State(initialValue: vacancy?.salaryMax.map(String.init) ?? "")
        _currency = State(initialValue: vacancy?.salaryCurrency ?? "KZT")
        _skills = State(initialValue: CareerText.list(vacancy?.skills).joined(separator: ", "))
        _languages = State(initialValue: CareerText.list(vacancy?.languages).joined(separator: ", "))
        _hasDeadline = State(initialValue: vacancy?.deadline != nil)
        _deadline = State(initialValue: vacancy?.deadline ?? Calendar.current.date(byAdding: .month, value: 1, to: Date()) ?? Date())
    }

    private var minValue: Int? { Int(salaryMin.filter(\.isNumber)) }
    private var maxValue: Int? { Int(salaryMax.filter(\.isNumber)) }

    private var problem: String? {
        if title.trimmingCharacters(in: .whitespaces).count < 3 {
            return String(localized: "career.vacancyForm.titleShort", defaultValue: "Должность — не короче 3 символов")
        }
        if description.trimmingCharacters(in: .whitespacesAndNewlines).count < 30 {
            return String(localized: "career.vacancyForm.descriptionShort", defaultValue: "Описание — не короче 30 символов")
        }
        if let min = minValue, let max = maxValue, min > max {
            return String(localized: "career.vacancyForm.salaryRange", defaultValue: "Минимальная зарплата больше максимальной")
        }
        return nil
    }

    var body: some View {
        FormSheet(
            title: vacancy == nil
                ? String(localized: "career.employerVacancies.create", defaultValue: "Новая вакансия")
                : String(localized: "career.vacancyForm.editTitle", defaultValue: "Изменить вакансию"),
            canSave: problem == nil,
            save: save,
            saved: saved
        ) {
            if vacancy?.status == "PUBLISHED" {
                Section {
                    CareerNotice(
                        title: String(localized: "career.vacancyForm.reReview", defaultValue: "Вакансия вернётся на модерацию"),
                        text: String(
                            localized: "career.vacancyForm.reReviewText",
                            defaultValue: "Изменения в тексте или условиях вернут вакансию на модерацию: пока университет не одобрит её снова, студенты её не увидят."
                        ),
                        symbol: "exclamationmark.triangle",
                        tint: Palette.warning
                    )
                }
                .listRowBackground(Palette.card)
            }
            Section {
                TextField(String(localized: "career.vacancyForm.title", defaultValue: "Должность"), text: $title)
                TextField(String(localized: "career.vacancy.description", defaultValue: "Описание"), text: $description, axis: .vertical)
                    .lineLimit(5...14)
            } footer: {
                if let problem { Text(problem).foregroundStyle(Palette.destructive) }
            }
            .listRowBackground(Palette.card)
            Section {
                Picker(String(localized: "career.vacancy.employment", defaultValue: "Занятость"), selection: $employment) {
                    ForEach(CareerText.employmentTypes, id: \.self) { Text(CareerText.employment($0)).tag($0) }
                }
                Picker(String(localized: "career.vacancy.format", defaultValue: "Формат работы"), selection: $format) {
                    ForEach(CareerText.workFormats, id: \.self) { Text(CareerText.format($0)).tag($0) }
                }
                Picker(String(localized: "career.vacancy.experience", defaultValue: "Опыт"), selection: $experience) {
                    ForEach(CareerText.experienceLevels, id: \.self) { Text(CareerText.experience($0)).tag($0) }
                }
                CareerCityField(title: String(localized: "career.vacancy.city", defaultValue: "Город"), code: $city)
            }
            .listRowBackground(Palette.card)
            Section {
                TextField(String(localized: "career.profile.salaryFrom", defaultValue: "Зарплата от"), text: $salaryMin)
                    .keyboardType(.numberPad)
                TextField(String(localized: "career.profile.salaryTo", defaultValue: "Зарплата до"), text: $salaryMax)
                    .keyboardType(.numberPad)
                Picker(String(localized: "career.profile.currency", defaultValue: "Валюта"), selection: $currency) {
                    ForEach(CareerText.currencies, id: \.self) { Text(verbatim: $0).tag($0) }
                }
            } header: {
                Text(String(localized: "career.profile.salary", defaultValue: "Зарплата"))
            }
            .listRowBackground(Palette.card)
            Section {
                TextField(String(localized: "career.vacancyForm.skills", defaultValue: "Навыки через запятую"), text: $skills, axis: .vertical)
                TextField(String(localized: "career.vacancyForm.languages", defaultValue: "Языки через запятую"), text: $languages)
                Toggle(String(localized: "career.vacancyForm.hasDeadline", defaultValue: "Срок приёма откликов"), isOn: $hasDeadline)
                if hasDeadline {
                    DatePicker(
                        String(localized: "career.vacancy.deadline", defaultValue: "Принимать отклики до"),
                        selection: $deadline,
                        displayedComponents: .date
                    )
                }
            }
            .listRowBackground(Palette.card)
        }
    }

    private func save() async throws {
        // Отклики принимаются до конца выбранного дня.
        let end = hasDeadline ? Calendar.current.date(bySettingHour: 23, minute: 59, second: 59, of: deadline) : nil
        let fields: [String: JSONValue] = [
            "title": .string(title.trimmingCharacters(in: .whitespaces)),
            "description": .string(description.trimmingCharacters(in: .whitespacesAndNewlines)),
            "employmentType": .string(employment),
            "workFormat": .string(format),
            "experienceLevel": .string(experience),
            "city": .text(city),
            "salaryMin": .int(minValue),
            "salaryMax": .int(maxValue),
            "salaryCurrency": (minValue == nil && maxValue == nil) ? .null : .string(currency),
            "skills": .strings(Array(CareerText.split(skills).prefix(30))),
            "languages": .strings(Array(CareerText.split(languages).prefix(10))),
            "deadline": .date(end),
        ]
        if let vacancy {
            try await CareerAPI().updateVacancy(id: vacancy.id, fields)
        } else {
            try await CareerAPI().createVacancy(fields)
        }
    }
}

// MARK: - Кандидаты

struct CareerCandidatesView: View {
    @State private var loader = PagedLoader<CareerApplication>(limit: 20) { request in
        try await CareerAPI().pipeline(request, params: [:])
    }
    @State private var status: String?
    @State private var changing: CareerApplication?
    @State private var confirming: (application: CareerApplication, status: String)?
    @State private var rejecting: CareerApplication?
    @State private var comment = ""
    @State private var history: CareerApplication?
    @State private var failure: String?

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "career.candidates.empty", defaultValue: "Откликов нет"),
                symbol: "person.3",
                hint: String(localized: "career.candidates.emptyHint", defaultValue: "Отклики появятся, когда студенты увидят опубликованные вакансии.")
            ),
            header: {
                FilterChipsRow(
                    options: CareerText.chips(CareerText.allTitle, CareerText.applicationStatuses) { CareerText.applicationStatus($0).text },
                    selection: $status
                )
            },
            row: { application in
                NavigationLink(value: AppRoute.career(.candidate(id: application.student?.id ?? ""))) {
                    CareerPipelineRow(application: application)
                }
                .disabled(application.student == nil)
                .swipeActions {
                    if !next(application).isEmpty {
                        Button {
                            changing = application
                        } label: {
                            Label(String(localized: "career.candidates.status", defaultValue: "Статус"), systemImage: "arrow.right.circle")
                        }
                        .tint(Palette.primary)
                    }
                }
                .contextMenu {
                    ForEach(next(application), id: \.self) { target in
                        Button(CareerText.applicationStatus(target).text) { pick(application, target) }
                    }
                    Button {
                        history = application
                    } label: {
                        Label(String(localized: "career.apps.history", defaultValue: "История"), systemImage: "clock.arrow.circlepath")
                    }
                }
            }
        )
        .navigationTitle(Text(CareerScreen.candidates.title))
        .onChange(of: status) {
            let filter = status
            Task {
                await loader.replace { request in
                    try await CareerAPI().pipeline(request, params: ["status": filter])
                }
            }
        }
        .confirmationDialog(
            String(localized: "career.candidates.status", defaultValue: "Статус"),
            isPresented: Binding(get: { changing != nil }, set: { if !$0 { changing = nil } }),
            presenting: changing
        ) { application in
            ForEach(next(application), id: \.self) { target in
                Button(CareerText.applicationStatus(target).text, role: target == "REJECTED" ? .destructive : nil) {
                    pick(application, target)
                }
            }
            Button(String(localized: "career.apps.history", defaultValue: "История")) { history = application }
        }
        .confirmationDialog(
            confirming.map { pair in
                let status = CareerText.applicationStatus(pair.status).text
                return String(localized: "career.candidates.confirm", defaultValue: "Перевести в «\(status)»? Студент сразу увидит новый статус. Вернуть прежний нельзя.")
            } ?? "",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            titleVisibility: .visible
        ) {
            if let pair = confirming {
                Button(CareerText.applicationStatus(pair.status).text) {
                    Task { await change(pair.application, to: pair.status, comment: nil) }
                }
            }
        }
        .reasonPrompt(
            Binding(get: { rejecting != nil }, set: { if !$0 { rejecting = nil } }),
            title: String(localized: "career.candidates.rejectReason", defaultValue: "Причина отказа"),
            message: String(localized: "career.candidates.rejectHint", defaultValue: "Её увидит студент — без неё отказ выглядит как молчание"),
            actionTitle: String(localized: "career.app.rejected", defaultValue: "Отказ"),
            text: $comment
        ) {
            guard let application = rejecting else { return }
            let text = comment.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else {
                failure = String(localized: "career.reasonRequired", defaultValue: "Укажите причину")
                return
            }
            await change(application, to: "REJECTED", comment: text)
        }
        .sheet(item: $history) { application in
            CareerHistorySheet(application: application)
        }
        .actionFailureAlert($failure)
    }

    /// Переходы из графа, которые вправе делать компания.
    private func next(_ application: CareerApplication) -> [String] {
        CareerText.transitions(from: application.status).filter(CareerText.employerStatuses.contains)
    }

    private func pick(_ application: CareerApplication, _ target: String) {
        switch target {
        case "REJECTED":
            comment = ""
            rejecting = application
        case "OFFER", "HIRED":
            // Оффер и найм студент видит сразу и вернуть их нельзя — спрашиваем.
            confirming = (application, target)
        default:
            Task { await change(application, to: target, comment: nil) }
        }
    }

    @MainActor
    private func change(_ application: CareerApplication, to status: String, comment: String?) async {
        do {
            try await CareerAPI().changeStatus(applicationID: application.id, status: status, comment: comment)
            await loader.reload()
        } catch {
            failure = error.userMessage
        }
    }
}

private struct CareerPipelineRow: View {
    let application: CareerApplication

    var body: some View {
        let status = CareerText.applicationStatus(application.status)
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .top, spacing: Spacing.md) {
                PersonRow(
                    name: application.student?.name ?? "—",
                    subtitle: application.vacancy.title,
                    avatarURL: application.student?.avatarThumbUrl
                )
                StatusBadge(text: status.text, tint: status.tint)
            }
            let meta = [application.student?.headline, application.student?.specialty, application.student?.course.map { course in
                let value = String(course)
                return String(localized: "career.candidate.course", defaultValue: "\(value) курс")
            }].compactMap { $0 }.filter { !$0.isEmpty }
            if !meta.isEmpty {
                Text(meta.joined(separator: " · ")).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
            }
            if !CareerText.list(application.student?.skills).isEmpty {
                CareerTags(items: Array(CareerText.list(application.student?.skills).prefix(8)))
            }
            if let letter = application.coverLetter, !letter.isEmpty {
                Text(letter).font(Typography.meta).foregroundStyle(Palette.foreground).lineLimit(3)
            }
            Text(DisplayFormat.dateTime(application.createdAt)).font(.caption).foregroundStyle(Palette.mutedForeground)
        }
        .padding(.vertical, Spacing.xs)
    }
}

private struct CareerHistorySheet: View {
    let application: CareerApplication
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            RemoteContent(load: { try await CareerAPI().history(applicationID: application.id) }) { events in
                List {
                    if events.isEmpty {
                        Text(String(localized: "career.apps.historyEmpty", defaultValue: "Изменений пока не было"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(events) { CareerHistoryRow(event: $0) }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Palette.background)
            }
            .navigationTitle(Text(String(localized: "career.apps.history", defaultValue: "История")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "common.ok", defaultValue: "Понятно")) { dismiss() }
                }
            }
        }
    }
}

/// Карточка кандидата. Сервер отвечает 404 и на чужой id, и на скрытый профиль.
struct CareerCandidateView: View {
    let id: String

    @State private var card: CareerCandidateCard?
    @State private var failure: String?
    @State private var hidden = false

    var body: some View {
        Group {
            if let card {
                content(card)
            } else if hidden {
                EmptyStateView(
                    title: String(localized: "career.candidate.hidden", defaultValue: "Студент скрыл профиль от работодателей"),
                    symbol: "person.crop.circle.badge.xmark"
                )
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(CareerScreen.candidate(id: id).title))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @MainActor
    private func load() async {
        do {
            card = try await CareerAPI().candidate(studentID: id)
        } catch let error as APIError where error.code == .notFound {
            hidden = true
        } catch {
            failure = error.userMessage
        }
    }

    private func content(_ card: CareerCandidateCard) -> some View {
        let notShared = String(localized: "career.candidate.notShared", defaultValue: "не открыто студентом")
        return List {
            Section {
                PersonRow(name: card.name, subtitle: card.headline, avatarURL: card.avatarUrl, size: 56)
                let meta = [
                    card.university, card.specialty,
                    card.course.map { course in
                        let value = String(course)
                        return String(localized: "career.candidate.course", defaultValue: "\(value) курс")
                    },
                    card.graduationYear.map { year in
                        let value = String(year)
                        return String(localized: "career.candidate.graduation", defaultValue: "выпуск \(value)")
                    },
                ].compactMap { $0 }
                if !meta.isEmpty {
                    Text(meta.joined(separator: " · ")).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                }
                if let status = card.employmentStatus {
                    DetailRow(title: String(localized: "career.profile.status", defaultValue: "Статус"), value: CareerText.employmentStatus(status))
                }
                if let score = card.readinessScore {
                    ShareBar(
                        title: String(localized: "career.profile.readiness", defaultValue: "Готовность профиля"),
                        fraction: Double(score) / 100,
                        valueText: "\(score)%"
                    )
                }
            }
            .listRowBackground(Palette.card)

            if let about = card.about, !about.isEmpty {
                Section {
                    Text(about).textSelection(.enabled)
                } header: {
                    Text(String(localized: "career.candidate.about", defaultValue: "О себе"))
                }
                .listRowBackground(Palette.card)
            }

            Section {
                DetailRow(
                    title: String(localized: "career.profile.positions", defaultValue: "Желаемые позиции"),
                    value: CareerText.list(card.desiredPositions).isEmpty ? "—" : CareerText.list(card.desiredPositions).joined(separator: ", ")
                )
                DetailRow(
                    title: String(localized: "career.profile.employmentTypes", defaultValue: "Формат занятости"),
                    value: (card.employmentTypes ?? []).isEmpty ? "—" : (card.employmentTypes ?? []).map(CareerText.employment).joined(separator: ", ")
                )
                DetailRow(
                    title: String(localized: "career.profile.workFormats", defaultValue: "Где готовы работать"),
                    value: (card.workFormats ?? []).isEmpty ? "—" : (card.workFormats ?? []).map(CareerText.format).joined(separator: ", ")
                )
                if card.relocationReady == true {
                    Text(String(localized: "career.profile.relocation", defaultValue: "Готов(а) к переезду"))
                }
            } header: {
                Text(String(localized: "career.candidate.wanted", defaultValue: "Ищет"))
            }
            .listRowBackground(Palette.card)

            if !CareerText.list(card.skills).isEmpty || !CareerText.list(card.languages).isEmpty {
                Section {
                    if !CareerText.list(card.skills).isEmpty {
                        CareerTags(items: CareerText.list(card.skills))
                    }
                    if !CareerText.list(card.languages).isEmpty {
                        DetailRow(
                            title: String(localized: "career.vacancy.languages", defaultValue: "Языки"),
                            value: CareerText.list(card.languages).joined(separator: ", ")
                        )
                    }
                } header: {
                    Text(String(localized: "career.candidate.skills", defaultValue: "Навыки и языки"))
                }
                .listRowBackground(Palette.card)
            }

            if let certificates = card.verifiedCertificates, !certificates.isEmpty {
                Section {
                    ForEach(certificates) { certificate in
                        ListCardRow(
                            title: certificate.title,
                            subtitle: certificate.issuedBy,
                            lines: [certificate.issuedAt.map(DisplayFormat.date) ?? ""]
                        )
                    }
                } header: {
                    Text(String(localized: "career.candidate.certificates", defaultValue: "Сертификаты, подтверждённые университетом"))
                }
                .listRowBackground(Palette.card)
            }

            if let portfolio = card.portfolio, !portfolio.isEmpty {
                Section {
                    ForEach(portfolio) { item in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            ListCardRow(
                                title: item.title,
                                subtitle: item.organization,
                                lines: [
                                    [item.startDate.map(DisplayFormat.date), item.endDate.map(DisplayFormat.date)]
                                        .compactMap { $0 }.joined(separator: " — "),
                                    item.description ?? "",
                                ]
                            )
                            if let link = item.url, let url = URL(string: link) {
                                Link(link, destination: url).font(Typography.meta)
                            }
                        }
                    }
                } header: {
                    Text(String(localized: "career.candidate.portfolio", defaultValue: "Портфолио"))
                }
                .listRowBackground(Palette.card)
            }

            Section {
                if let email = card.email, let url = URL(string: "mailto:\(email)") {
                    Link(destination: url) {
                        DetailRow(title: String(localized: "career.company.email", defaultValue: "Email"), value: email, symbol: "envelope")
                    }
                } else {
                    DetailRow(title: String(localized: "career.company.email", defaultValue: "Email"), value: notShared, symbol: "envelope")
                }
                if let phone = card.phone, let url = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
                    Link(destination: url) {
                        DetailRow(title: String(localized: "career.company.phone", defaultValue: "Телефон"), value: phone, symbol: "phone")
                    }
                } else {
                    DetailRow(title: String(localized: "career.company.phone", defaultValue: "Телефон"), value: notShared, symbol: "phone")
                }
                DetailRow(
                    title: "GPA",
                    value: card.gpa.map { $0.formatted(.number.precision(.fractionLength(0...2))) } ?? notShared,
                    symbol: "graduationcap"
                )
            } header: {
                Text(String(localized: "career.candidate.contacts", defaultValue: "Контакты и успеваемость"))
            }
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await load() }
    }
}

// MARK: - Доступ к вузам

struct CareerAccessView: View {
    @State private var loader = PagedLoader<CareerUniversityOption>(limit: 20) { request in
        try await CareerAPI().universityOptions(request, params: [:])
    }
    @State private var filter: String?
    @State private var search = ""
    @State private var isOwner: Bool?
    @State private var requesting: CareerUniversityOption?
    @State private var kato = CareerKatoNames.shared

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "career.access.empty", defaultValue: "Университеты не найдены"),
                symbol: "graduationcap",
                hint: String(localized: "career.access.emptyHint", defaultValue: "Измените запрос или очистите поиск.")
            ),
            header: {
                FilterChipsRow(
                    options: [
                        (value: String?.none, title: CareerText.allTitle),
                        (value: Optional("APPROVED"), title: String(localized: "career.access.approved", defaultValue: "Доступ открыт")),
                        (value: Optional("REQUESTED"), title: String(localized: "career.access.requested", defaultValue: "На рассмотрении")),
                        (value: Optional("NONE"), title: String(localized: "career.access.none", defaultValue: "Без доступа")),
                    ],
                    selection: $filter
                )
                if isOwner == false {
                    Text(String(localized: "career.access.ownerOnly", defaultValue: "Заявки в университеты подаёт владелец компании."))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .listRowBackground(Color.clear)
                }
            },
            row: { option in
                CareerUniversityOptionRow(option: option, cityName: kato.name(option.city))
                    .task(id: option.id) { kato.request([option.city]) }
                    .swipeActions {
                        if isOwner == true, option.canRequest {
                            Button {
                                requesting = option
                            } label: {
                                Label(String(localized: "career.access.request", defaultValue: "Подать заявку"), systemImage: "paperplane")
                            }
                            .tint(Palette.primary)
                        }
                    }
                    .contextMenu {
                        if isOwner == true, option.canRequest {
                            Button {
                                requesting = option
                            } label: {
                                Label(
                                    option.access == nil
                                        ? String(localized: "career.access.request", defaultValue: "Подать заявку")
                                        : String(localized: "career.access.requestAgain", defaultValue: "Подать снова"),
                                    systemImage: "paperplane"
                                )
                            }
                        }
                    }
            }
        )
        .navigationTitle(Text(CareerScreen.access.title))
        .debouncedSearch($search, prompt: String(localized: "career.scope.search", defaultValue: "Поиск университета")) { _ in
            await refilter()
        }
        .onChange(of: filter) { Task { await refilter() } }
        .task {
            if isOwner == nil { isOwner = (try? await CareerAPI().myCompany())?.isOwner }
        }
        .sheet(item: $requesting) { option in
            CareerAccessRequestForm(option: option) { await loader.reload() }
        }
    }

    private func refilter() async {
        let params: [String: String?] = ["access": filter, "search": search.trimmingCharacters(in: .whitespaces)]
        await loader.replace { request in
            try await CareerAPI().universityOptions(request, params: params)
        }
    }
}

private struct CareerUniversityOptionRow: View {
    let option: CareerUniversityOption
    let cityName: String?

    var body: some View {
        let status: (text: String, tint: Color)? = option.access.map {
            CareerText.accessStatus($0.status, expired: $0.status == "APPROVED" && !$0.isActive)
        }
        let until: String = {
            guard let access = option.access, access.isActive, let expires = access.expiresAt else { return "" }
            let date = DisplayFormat.date(expires)
            return String(localized: "career.companies.until", defaultValue: "Допуск до \(date)")
        }()
        ListCardRow(
            title: option.name,
            subtitle: [option.shortName, cityName].compactMap { $0 }.joined(separator: " · "),
            status: status,
            lines: [
                until,
                option.access?.reason.map { "\(String(localized: "common.reason", defaultValue: "Причина")): \($0)" } ?? "",
            ]
        )
    }
}

private struct CareerAccessRequestForm: View {
    let option: CareerUniversityOption
    let saved: () async -> Void
    @State private var message = ""

    var body: some View {
        FormSheet(
            title: option.shortName ?? option.name,
            saveTitle: String(localized: "career.access.send", defaultValue: "Отправить заявку"),
            canSave: message.count <= 1000,
            save: {
                let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
                try await CareerAPI().requestAccess(universityID: option.id, message: text.isEmpty ? nil : text)
            },
            saved: saved
        ) {
            Section {
                TextField(
                    String(localized: "career.access.messagePlaceholder", defaultValue: "Расскажите, кого вы ищете и зачем нужен доступ"),
                    text: $message,
                    axis: .vertical
                )
                .lineLimit(4...10)
            } header: {
                Text(String(localized: "career.access.message", defaultValue: "Сообщение вузу"))
            } footer: {
                Text(option.name)
            }
            .listRowBackground(Palette.card)
        }
    }
}

// MARK: - Команда

struct CareerTeamView: View {
    @State private var token = 0
    @State private var inviting = false
    @State private var removing: CareerTeam.Member?
    @State private var revoking: CareerTeam.Invite?
    @State private var failure: String?
    @State private var notice: String?

    private struct Content {
        var isOwner: Bool
        var team: CareerTeam?
    }

    var body: some View {
        RemoteContent(reloadToken: token, load: load) { content in
            if let team = content.team, content.isOwner {
                List {
                    Section {
                        Button {
                            inviting = true
                        } label: {
                            Label(String(localized: "career.team.invite", defaultValue: "Пригласить коллегу"), systemImage: "person.badge.plus")
                        }
                    } footer: {
                        Text(String(
                            localized: "career.team.inviteText",
                            defaultValue: "Придёт письмо со ссылкой на регистрацию. Коллега станет рекрутёром: вакансии и кандидаты — да, допуски к вузам и команда — нет."
                        ))
                    }
                    .listRowBackground(Palette.card)

                    Section {
                        ForEach(team.members) { member in
                            PersonRow(
                                name: member.name,
                                subtitle: member.isMe == true
                                    ? "\(member.email) · \(String(localized: "career.team.you", defaultValue: "это вы"))"
                                    : member.email,
                                trailing: CareerText.memberRole(member.role)
                            )
                            .swipeActions {
                                if member.isMe != true {
                                    Button(role: .destructive) {
                                        removing = member
                                    } label: {
                                        Label(String(localized: "career.team.remove", defaultValue: "Исключить"), systemImage: "person.badge.minus")
                                    }
                                }
                            }
                        }
                    } header: {
                        CareerSectionHeader(
                            title: String(localized: "career.team.members", defaultValue: "Участники"),
                            hint: String(
                                localized: "career.team.membersHint",
                                defaultValue: "Владелец управляет компанией и командой, рекрутёры работают с вакансиями и кандидатами"
                            )
                        )
                    }
                    .listRowBackground(Palette.card)

                    if !team.invites.isEmpty {
                        Section {
                            ForEach(team.invites) { invite in
                                let until = DisplayFormat.dateTime(invite.expiresAt)
                                ListCardRow(
                                    title: invite.email,
                                    subtitle: invite.expired == true
                                        ? String(localized: "career.team.expired", defaultValue: "Срок ссылки истёк")
                                        : String(localized: "career.team.until", defaultValue: "Ссылка действует до \(until)")
                                )
                                .swipeActions {
                                    Button(role: .destructive) {
                                        revoking = invite
                                    } label: {
                                        Label(String(localized: "career.team.revoke", defaultValue: "Отозвать"), systemImage: "xmark")
                                    }
                                    Button {
                                        Task { await resend(invite) }
                                    } label: {
                                        Label(String(localized: "career.team.resend", defaultValue: "Отправить ещё раз"), systemImage: "arrow.clockwise")
                                    }
                                    .tint(Palette.primary)
                                }
                            }
                        } header: {
                            CareerSectionHeader(
                                title: String(localized: "career.team.invites", defaultValue: "Приглашения"),
                                hint: String(localized: "career.team.invitesHint", defaultValue: "Ещё не приняты. Ссылка действует двое суток")
                            )
                        }
                        .listRowBackground(Palette.card)
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Palette.background)
                .refreshable { token += 1 }
            } else {
                // Рекрутёр командой не управляет — говорим, к кому идти, а не показываем пустой список.
                EmptyStateView(
                    title: String(localized: "career.team.ownerOnly", defaultValue: "Командой управляет владелец компании"),
                    symbol: "person.3",
                    hint: String(
                        localized: "career.team.ownerOnlyText",
                        defaultValue: "Чтобы пригласить коллегу или исключить участника, обратитесь к владельцу компании."
                    )
                )
                .background(Palette.background)
            }
        }
        .navigationTitle(Text(CareerScreen.team.title))
        .sheet(isPresented: $inviting) {
            CareerInviteForm { email in
                notice = String(localized: "career.team.invited", defaultValue: "Приглашение отправлено на \(email)")
                token += 1
            }
        }
        .confirmDestructive(
            $removing,
            title: { member in
                let name = member.name
                return String(
                    localized: "career.team.removeConfirm",
                    defaultValue: "Исключить \(name)? Человек сразу потеряет доступ к вакансиям и кандидатам компании."
                )
            },
            actionTitle: String(localized: "career.team.remove", defaultValue: "Исключить")
        ) { member in
            await run { try await CareerAPI().removeMember(userID: member.userId) }
        }
        .confirmDestructive(
            $revoking,
            title: { invite in invite.email },
            actionTitle: String(localized: "career.team.revoke", defaultValue: "Отозвать")
        ) { invite in
            await run { try await CareerAPI().revokeInvite(id: invite.id) }
        }
        .actionFailureAlert($failure)
        .alert(
            notice ?? "",
            isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
    }

    private func load() async throws -> Content {
        let api = CareerAPI()
        let company = try await api.myCompany()
        guard company.isOwner else { return Content(isOwner: false, team: nil) }
        return Content(isOwner: true, team: try await api.team())
    }

    @MainActor
    private func resend(_ invite: CareerTeam.Invite) async {
        await run { try await CareerAPI().invite(email: invite.email) }
        if failure == nil {
            let email = invite.email
            notice = String(localized: "career.team.invited", defaultValue: "Приглашение отправлено на \(email)")
        }
    }

    @MainActor
    private func run(_ action: () async throws -> Void) async {
        do {
            try await action()
            token += 1
        } catch {
            failure = error.userMessage
        }
    }
}

private struct CareerInviteForm: View {
    let invited: (String) -> Void
    @State private var email = ""

    private var isValid: Bool {
        let value = email.trimmingCharacters(in: .whitespaces)
        return value.contains("@") && value.contains(".") && value.count <= 160
    }

    var body: some View {
        FormSheet(
            title: String(localized: "career.team.invite", defaultValue: "Пригласить коллегу"),
            saveTitle: String(localized: "career.team.inviteAction", defaultValue: "Пригласить"),
            canSave: isValid,
            save: {
                let value = email.trimmingCharacters(in: .whitespaces).lowercased()
                try await CareerAPI().invite(email: value)
                invited(value)
            }
        ) {
            Section {
                TextField("colleague@company.kz", text: $email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.emailAddress)
            } header: {
                Text(String(localized: "career.team.email", defaultValue: "Email коллеги"))
            }
            .listRowBackground(Palette.card)
        }
    }
}

// MARK: - Профиль компании

struct CareerCompanyProfileView: View {
    @State private var token = 0
    @State private var editing: CareerCompany?
    @State private var logoItem: PhotosPickerItem?
    @State private var coverItem: PhotosPickerItem?
    @State private var uploading = false
    @State private var failure: String?
    @State private var kato = CareerKatoNames.shared

    var body: some View {
        RemoteContent(reloadToken: token, load: { try await CareerAPI().myCompany() }) { company in
            List {
                Section {
                    HStack(spacing: Spacing.lg) {
                        AvatarView(url: company.logoUrl, name: company.name, size: 56)
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(company.name).font(Typography.pageTitle).foregroundStyle(Palette.foreground)
                            Text([company.industry, kato.name(company.city), company.size.map(CareerText.companySize)]
                                .compactMap { $0 }.joined(separator: " · "))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                            if let role = company.memberRole {
                                StatusBadge(text: CareerText.memberRole(role), tint: Palette.info)
                            }
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                    NavigationLink(value: AppRoute.career(.company(id: company.id))) {
                        Label(String(localized: "career.company.badge", defaultValue: "Страница компании"), systemImage: "building.2")
                    }
                }
                .listRowBackground(Palette.card)

                if company.isOwner {
                    Section {
                        Button(String(localized: "career.company.edit", defaultValue: "Изменить")) { editing = company }
                        PhotosPicker(selection: $logoItem, matching: .images) {
                            Label(String(localized: "career.company.logo", defaultValue: "Загрузить логотип"), systemImage: "photo")
                        }
                        if company.logoUrl != nil {
                            Button(String(localized: "career.company.removeLogo", defaultValue: "Удалить логотип"), role: .destructive) {
                                Task { await run { try await CareerAPI().removeCompanyImage(kind: "logo") } }
                            }
                        }
                        PhotosPicker(selection: $coverItem, matching: .images) {
                            Label(String(localized: "career.company.cover", defaultValue: "Загрузить обложку"), systemImage: "photo.on.rectangle")
                        }
                        if company.coverUrl != nil {
                            Button(String(localized: "career.company.removeCover", defaultValue: "Удалить обложку"), role: .destructive) {
                                Task { await run { try await CareerAPI().removeCompanyImage(kind: "cover") } }
                            }
                        }
                    }
                    .listRowBackground(Palette.card)
                    .disabled(uploading)
                } else {
                    Section {
                        Text(String(localized: "career.company.ownerOnly", defaultValue: "Профиль компании меняет её владелец."))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    .listRowBackground(Palette.card)
                }

                if let description = company.description, !description.isEmpty {
                    Section {
                        Text(description).textSelection(.enabled)
                    } header: {
                        Text(String(localized: "career.company.about", defaultValue: "О компании"))
                    }
                    .listRowBackground(Palette.card)
                }
                CareerCompanyDetailsSection(company: company)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .refreshable { token += 1 }
            .task(id: company.city) { kato.request([company.city]) }
        }
        .navigationTitle(Text(CareerScreen.companyProfile.title))
        .overlay {
            if uploading {
                ProgressView()
                    .padding(Spacing.xl)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.xl))
            }
        }
        .sheet(item: Binding(
            get: { editing.map(CareerCompanyBox.init) },
            set: { editing = $0?.company }
        )) { box in
            CareerCompanyForm(company: box.company) { token += 1 }
        }
        .onChange(of: logoItem) { Task { await upload(kind: "logo") } }
        .onChange(of: coverItem) { Task { await upload(kind: "cover") } }
        .actionFailureAlert($failure)
    }

    @MainActor
    private func upload(kind: String) async {
        guard let item = kind == "logo" ? logoItem : coverItem else { return }
        if kind == "logo" { logoItem = nil } else { coverItem = nil }
        uploading = true
        defer { uploading = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            // Сервер принимает до 10 МБ: снимок с камеры пережимаем в JPEG.
            let jpeg = UIImage(data: data).flatMap { Self.downscaled($0, maxSide: kind == "logo" ? 1024 : 2048).jpegData(compressionQuality: 0.85) } ?? data
            try await CareerAPI().uploadCompanyImage(kind: kind, data: jpeg)
            token += 1
        } catch {
            failure = error.userMessage
        }
    }

    private static func downscaled(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let side = max(image.size.width, image.size.height)
        guard side > maxSide else { return image }
        let scale = maxSide / side
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }

    @MainActor
    private func run(_ action: () async throws -> Void) async {
        do {
            try await action()
            token += 1
        } catch {
            failure = error.userMessage
        }
    }
}

private struct CareerCompanyBox: Identifiable {
    let company: CareerCompany
    var id: String { company.id }
}

private struct CareerCompanyForm: View {
    let saved: () async -> Void

    @State private var name: String
    @State private var industry: String
    @State private var size: String
    @State private var city: String
    @State private var description: String
    @State private var website: String
    @State private var foundedYear: String
    @State private var email: String
    @State private var phone: String
    @State private var address: String
    @State private var telegram: String
    @State private var instagram: String
    @State private var linkedin: String

    init(company: CareerCompany, saved: @escaping () async -> Void) {
        self.saved = saved
        _name = State(initialValue: company.name)
        _industry = State(initialValue: company.industry ?? "")
        _size = State(initialValue: company.size ?? "")
        _city = State(initialValue: company.city ?? "")
        _description = State(initialValue: company.description ?? "")
        _website = State(initialValue: company.website ?? "")
        _foundedYear = State(initialValue: company.foundedYear.map { String($0) } ?? "")
        _email = State(initialValue: company.contactEmail ?? "")
        _phone = State(initialValue: company.contactPhone ?? "")
        _address = State(initialValue: company.address ?? "")
        _telegram = State(initialValue: company.telegram ?? "")
        _instagram = State(initialValue: company.instagram ?? "")
        _linkedin = State(initialValue: company.linkedin ?? "")
    }

    var body: some View {
        FormSheet(
            title: String(localized: "career.screen.companyProfile", defaultValue: "Профиль компании"),
            canSave: (2...120).contains(name.trimmingCharacters(in: .whitespaces).count) && description.count <= 2000,
            save: save,
            saved: saved
        ) {
            Section {
                TextField(String(localized: "career.company.name", defaultValue: "Название"), text: $name)
                TextField(String(localized: "career.company.industry", defaultValue: "Отрасль"), text: $industry)
                Picker(String(localized: "career.company.size", defaultValue: "Численность"), selection: $size) {
                    Text(CareerText.companySize(nil)).tag("")
                    ForEach(CareerText.companySizes, id: \.self) { Text(CareerText.companySize($0)).tag($0) }
                }
                CareerCityField(title: String(localized: "career.vacancy.city", defaultValue: "Город"), code: $city)
            }
            .listRowBackground(Palette.card)
            Section {
                TextField(String(localized: "career.company.about", defaultValue: "О компании"), text: $description, axis: .vertical)
                    .lineLimit(4...12)
            }
            .listRowBackground(Palette.card)
            Section {
                TextField(String(localized: "career.company.website", defaultValue: "Сайт"), text: $website)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField(String(localized: "career.company.founded", defaultValue: "Год основания"), text: $foundedYear)
                    .keyboardType(.numberPad)
                TextField(String(localized: "career.company.email", defaultValue: "Email"), text: $email)
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField(String(localized: "career.company.phone", defaultValue: "Телефон"), text: $phone)
                    .keyboardType(.phonePad)
                TextField(String(localized: "career.company.address", defaultValue: "Адрес"), text: $address)
                TextField(String(localized: "career.company.telegram", defaultValue: "Telegram: @имя или https://t.me/…"), text: $telegram)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Instagram", text: $instagram)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("LinkedIn", text: $linkedin)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            .listRowBackground(Palette.card)
        }
    }

    private func save() async throws {
        try await CareerAPI().updateMyCompany([
            "name": .string(name.trimmingCharacters(in: .whitespaces)),
            "industry": .text(industry),
            "size": size.isEmpty ? .null : .string(size),
            "city": .text(city),
            "description": .text(description),
            "website": .text(website),
            "foundedYear": .int(Int(foundedYear.filter(\.isNumber))),
            "contactEmail": .text(email),
            "contactPhone": .text(phone),
            "address": .text(address),
            "telegram": .text(telegram),
            "instagram": .text(instagram),
            "linkedin": .text(linkedin),
        ])
    }
}

// MARK: - Повторное письмо подтверждения

/// Новая ссылка подтверждения взамен истёкшей. Ответ сервера одинаков для любого адреса.
struct CareerResendForm: View {
    var initialEmail: String = ""
    /// До входа своей почты у приложения нет — спрашивать сервер незачем.
    var lookUpEmail = true
    @State private var email = ""

    var body: some View {
        FormSheet(
            title: String(localized: "career.signup.resend", defaultValue: "Отправить письмо ещё раз"),
            saveTitle: String(localized: "career.signup.send", defaultValue: "Отправить"),
            canSave: email.contains("@"),
            save: { try await CareerAPI().resendVerification(email: email.trimmingCharacters(in: .whitespaces).lowercased()) }
        ) {
            Section {
                TextField("you@company.kz", text: $email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } header: {
                Text(String(localized: "career.signup.resendEmail", defaultValue: "Email, указанный при регистрации"))
            } footer: {
                Text(String(
                    localized: "career.signup.resendHint",
                    defaultValue: "Если компания с этим адресом ждёт подтверждения, мы отправим на него новую ссылку. Она действует сутки."
                ))
            }
            .listRowBackground(Palette.card)
        }
        .task {
            if email.isEmpty {
                email = initialEmail
                if email.isEmpty, lookUpEmail, let mine = try? await CareerAPI().myEmail() { email = mine }
            }
        }
    }
}

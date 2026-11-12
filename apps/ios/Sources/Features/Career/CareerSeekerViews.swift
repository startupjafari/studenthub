import SwiftUI

// Карьера студента и старосты: обзор, витрина вакансий с откликом, мои отклики, карьерный
// профиль, резюме и карьерные мероприятия. Витрину и мероприятия смотрят также
// преподаватель и сотрудники вуза — им недоступны только действия соискателя.

private extension Role {
    /// Откликаться и вести профиль может только студент (`APPLICANT_ROLES`).
    var careerApplicant: Bool { self == .student || self == .starosta }
}

// MARK: - Обзор

/// Обзор карьеры: студенту — его сводка, сотрудникам — карьерный центр вуза.
struct CareerHomeView: View {
    @Environment(\.viewerRole) private var role

    var body: some View {
        if role.isStaff {
            CareerStaffHomeView()
        } else {
            CareerSeekerHomeView()
        }
    }
}

private struct CareerSeekerSummary {
    /// `nil` — отклики не загрузились: плитки с прочерком, а не с нулями.
    var applications: [CareerApplication]?
    var vacancies: [CareerVacancy] = []
    /// `nil` — мероприятия не загрузились: не «Мероприятий пока нет».
    var events: [CareerEvent]?
    var eventsFailure: String?
    var resume: CareerResumeSettings?
    /// Сводка соискателя (отклики или резюме) пришла не целиком.
    var applicantFailure: String?
    var applicantOffline = false
}

private struct CareerSeekerHomeView: View {
    @Environment(\.viewerRole) private var role
    @State private var token = 0

    var body: some View {
        RemoteContent(reloadToken: token, load: load) { summary in
            List {
                if role.careerApplicant {
                    Section {
                        if let failure = summary.applicantFailure {
                            StaleDataBanner(message: failure, isOffline: summary.applicantOffline) { token += 1 }
                        }
                        StatGrid {
                            StatTile(
                                title: String(localized: "career.home.active", defaultValue: "Активные отклики"),
                                value: count(summary) { !CareerText.isFinal($0.status) },
                                symbol: "paperplane"
                            )
                            StatTile(
                                title: String(localized: "career.home.interview", defaultValue: "Интервью и офферы"),
                                value: count(summary) { $0.status == "INTERVIEW" || $0.status == "OFFER" },
                                symbol: "person.2.wave.2",
                                tint: Palette.warning
                            )
                            StatTile(
                                title: String(localized: "career.home.hired", defaultValue: "Приглашений на работу"),
                                value: count(summary) { $0.status == "HIRED" },
                                symbol: "checkmark.seal",
                                tint: Palette.success
                            )
                            NavigationLink(value: AppRoute.career(.resume)) {
                                StatTile(
                                    title: String(localized: "career.home.resume", defaultValue: "Резюме"),
                                    value: summary.resume.map { resume in
                                        resume.published == true
                                            ? String(localized: "career.home.resumePublic", defaultValue: "По ссылке")
                                            : String(localized: "career.home.resumePrivate", defaultValue: "Только у вас")
                                    } ?? "—",
                                    symbol: "doc.text",
                                    tint: Palette.info
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                Section {
                    if summary.vacancies.isEmpty {
                        Text(String(localized: "career.home.noVacancies", defaultValue: "Вакансий пока нет"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(summary.vacancies) { vacancy in
                        NavigationLink(value: AppRoute.career(.vacancy(id: vacancy.id))) {
                            CareerVacancyRow(vacancy: vacancy)
                        }
                    }
                    NavigationLink(value: AppRoute.career(.vacancies)) {
                        Text(String(localized: "career.home.allVacancies", defaultValue: "Все вакансии"))
                    }
                } header: {
                    CareerSectionHeader(
                        title: String(localized: "career.home.fresh", defaultValue: "Свежие вакансии"),
                        hint: String(localized: "career.home.freshHint", defaultValue: "Одобренные вашим университетом")
                    )
                }

                Section {
                    if let failure = summary.eventsFailure {
                        DashboardFailurePlaceholder(message: failure) { token += 1 }
                    } else if summary.events?.isEmpty == true {
                        Text(String(localized: "career.home.noEvents", defaultValue: "Мероприятий пока нет"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(summary.events ?? []) { event in
                        NavigationLink(value: AppRoute.event(id: event.id)) {
                            CareerEventRow(event: event)
                        }
                    }
                    NavigationLink(value: AppRoute.career(.events)) {
                        Text(String(localized: "career.home.allEvents", defaultValue: "Все мероприятия"))
                    }
                } header: {
                    CareerSectionHeader(
                        title: String(localized: "career.home.events", defaultValue: "Ближайшие мероприятия"),
                        hint: String(localized: "career.home.eventsHint", defaultValue: "Ярмарки, воркшопы, дни собеседований")
                    )
                }

                if role.careerApplicant {
                    Section {
                        ForEach([CareerScreen.applications, .profile, .resume], id: \.self) { screen in
                            NavigationLink(value: AppRoute.career(screen)) {
                                IconRow(title: screen.title, symbol: screen.symbol, tint: TileTint.purple)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .pullToRefresh { token += 1 }
        }
        .navigationTitle(Text(CareerScreen.home.title))
    }

    /// Число откликов для плитки; отклики не загрузились — прочерк, а не «0».
    private func count(_ summary: CareerSeekerSummary, _ predicate: (CareerApplication) -> Bool) -> String {
        summary.applications.map { $0.filter(predicate).count.formatted() } ?? "—"
    }

    private func load() async throws -> CareerSeekerSummary {
        let api = CareerAPI()
        let applicant = role.careerApplicant
        async let vacancies = api.vacancies(PageRequest(cursor: nil, page: 1, limit: 5), params: [:])
        async let events = api.events(PageRequest(cursor: nil, page: 1, limit: 3), params: ["past": "false"])
        var summary = CareerSeekerSummary()
        summary.vacancies = try await vacancies.items
        do {
            summary.events = try await events.items
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            summary.eventsFailure = error.userMessage
        }
        if applicant {
            // Сводка — по всем откликам, а не по первой странице. Сбой не прячет витрину,
            // но и не выдаёт себя за нули: над плитками — полоса с «Повторить».
            do {
                summary.applications = try await api.myApplications(PageRequest(cursor: nil, page: 1, limit: 100)).items
                summary.resume = try await api.resume()
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                summary.applicantFailure = error.userMessage
                summary.applicantOffline = error.isOffline
            }
        }
        return summary
    }
}

// MARK: - Витрина вакансий

struct CareerVacanciesView: View {
    var body: some View {
        CareerScopeGate { universityID in
            CareerVacancyList(universityID: universityID)
        }
        .navigationTitle(Text(CareerScreen.vacancies.title))
    }
}

private struct CareerVacancyList: View {
    let universityID: String?

    @State private var loader: PagedLoader<CareerVacancy>
    @State private var search = ""
    @State private var employment: String?
    @State private var format: String?
    @State private var sort = "publishedAt"

    init(universityID: String?) {
        self.universityID = universityID
        _loader = State(initialValue: PagedLoader(limit: 20) { request in
            try await CareerAPI().vacancies(request, params: ["universityId": universityID])
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "career.vacancies.empty", defaultValue: "Вакансий пока нет"),
                symbol: "briefcase",
                hint: String(
                    localized: "career.vacancies.emptyHint",
                    defaultValue: "Компании появятся здесь после того, как университет откроет им доступ и одобрит их вакансии."
                )
            ),
            header: {
                FilterChipsRow(
                    options: CareerText.chips(
                        String(localized: "career.vacancies.anyEmployment", defaultValue: "Любая занятость"),
                        CareerText.employmentTypes,
                        CareerText.employment
                    ),
                    selection: $employment
                )
                FilterChipsRow(
                    options: CareerText.chips(
                        String(localized: "career.vacancies.anyFormat", defaultValue: "Любой формат"),
                        CareerText.workFormats,
                        CareerText.format
                    ),
                    selection: $format
                )
            },
            row: { vacancy in
                NavigationLink(value: AppRoute.career(.vacancy(id: vacancy.id))) {
                    CareerVacancyRow(vacancy: vacancy)
                }
            }
        )
        .debouncedSearch(
            $search,
            prompt: String(localized: "career.vacancies.search", defaultValue: "Должность, компания, технология")
        ) { _ in await refilter() }
        .onChange(of: employment) { Task { await refilter() } }
        .onChange(of: format) { Task { await refilter() } }
        .onChange(of: sort) { Task { await refilter() } }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(String(localized: "career.vacancies.sort", defaultValue: "Сортировка"), selection: $sort) {
                        Text(String(localized: "career.vacancies.sortFresh", defaultValue: "Сначала новые")).tag("publishedAt")
                        Text(String(localized: "career.vacancies.sortSalary", defaultValue: "По зарплате")).tag("salary")
                        Text(String(localized: "career.vacancies.sortDeadline", defaultValue: "По сроку отклика")).tag("deadline")
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                }
                .accessibilityLabel(Text(String(localized: "career.vacancies.sort", defaultValue: "Сортировка")))
            }
        }
    }

    private func refilter() async {
        let params: [String: String?] = [
            "universityId": universityID,
            "search": search.trimmingCharacters(in: .whitespaces),
            "employmentType": employment,
            "workFormat": format,
            "sort": sort,
            // Срок отклика — ближайший первым, остальное — по убыванию.
            "order": sort == "deadline" ? "asc" : "desc",
        ]
        await loader.replace { request in
            try await CareerAPI().vacancies(request, params: params)
        }
    }
}

/// Строка вакансии — как строка чата: логотип компании, должность полужирным, компания,
/// условия, внизу — зарплата и совпадение с профилем.
struct CareerVacancyRow: View {
    let vacancy: CareerVacancy
    @State private var kato = CareerKatoNames.shared

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            if let company = vacancy.company {
                AvatarView(url: company.logoUrl, name: company.name, size: 44)
            } else {
                RowSymbol(symbol: "briefcase.fill", tint: TileTint.purple)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(vacancy.title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(2)
                    Spacer(minLength: Spacing.sm)
                    if let published = vacancy.publishedAt {
                        Text(DisplayFormat.relative(published))
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(1)
                    }
                }
                if let company = vacancy.company {
                    Text(company.name)
                        .font(.subheadline)
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(1)
                }
                let meta = [
                    vacancy.employmentType.map(CareerText.employment),
                    vacancy.workFormat.map(CareerText.format),
                    kato.name(vacancy.city),
                    vacancy.deadline.map { date in
                        let day = DisplayFormat.date(date)
                        return String(localized: "career.vacancy.deadlineShort", defaultValue: "отклик до \(day)")
                    },
                ].compactMap { $0 }
                if !meta.isEmpty {
                    Text(meta.joined(separator: " · "))
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                }
                let salary = CareerText.salary(vacancy)
                if salary != nil || vacancy.match != nil {
                    HStack(spacing: Spacing.sm) {
                        if let salary {
                            Text(salary)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Palette.foreground)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        if let match = vacancy.match {
                            StatusBadge(
                                text: "\(match.score)%",
                                tint: CareerVacancyRow.matchTint(match.score)
                            )
                        }
                    }
                    .padding(.top, 1)
                }
            }
        }
        .padding(.vertical, 4)
        .task(id: vacancy.city) { kato.request([vacancy.city]) }
        .accessibilityElement(children: .combine)
    }

    static func matchTint(_ score: Int) -> Color {
        score >= 70 ? Palette.success : (score >= 40 ? Palette.warning : Palette.mutedForeground)
    }
}

// MARK: - Карточка вакансии

private struct CareerVacancyDetails {
    var vacancy: CareerVacancy
    var application: CareerApplication?
    /// Не удалось узнать, есть ли свой отклик: кнопку «Откликнуться» не предлагаем —
    /// повторный отклик сервер отклонит, а человек решит, что первый потерялся.
    var applicationFailure: String?
    var applicationOffline = false
    var profile: CareerProfile?
}

struct CareerVacancyView: View {
    let id: String

    var body: some View {
        CareerScopeGate { universityID in
            CareerVacancyCard(id: id, universityID: universityID)
        }
        .navigationTitle(Text(CareerScreen.vacancy(id: id).title))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct CareerVacancyCard: View {
    let id: String
    let universityID: String?

    @Environment(\.viewerRole) private var role
    @State private var token = 0
    @State private var applying = false
    @State private var openCompanyID: String?
    @State private var kato = CareerKatoNames.shared

    var body: some View {
        RemoteContent(reloadToken: token, load: load) { details in
            let vacancy = details.vacancy
            List {
                Section {
                    HeroHeader(
                        visual: vacancy.company.map { HeroVisual.avatar(url: $0.logoUrl, name: $0.name) } ?? .symbol("briefcase.fill", tint: TileTint.purple),
                        title: vacancy.title,
                        subtitle: vacancy.company?.name,
                        actions: heroActions(details)
                    ) {
                        VStack(spacing: Spacing.sm) {
                            if let salary = CareerText.salary(vacancy) {
                                Text(salary)
                                    .font(.headline)
                                    .foregroundStyle(Palette.foreground)
                                    .multilineTextAlignment(.center)
                            }
                            HStack(spacing: Spacing.xs) {
                                if let application = details.application {
                                    let status = CareerText.applicationStatus(application.status)
                                    StatusBadge(text: status.text, tint: status.tint)
                                }
                                if let match = vacancy.match {
                                    StatusBadge(
                                        text: String(localized: "career.vacancy.matchBadge", defaultValue: "Совпадение \(DisplayFormat.percent(Double(match.score)))"),
                                        tint: CareerVacancyRow.matchTint(match.score)
                                    )
                                }
                            }
                        }
                    }
                }

                if let failure = details.applicationFailure {
                    Section {
                        StaleDataBanner(message: failure, isOffline: details.applicationOffline) { token += 1 }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                if let company = vacancy.company {
                    Section {
                        // Витрина видна только вузу с допуском компании — значит, видна и её страница.
                        NavigationLink(value: AppRoute.career(.company(id: company.id))) {
                            PersonRow(name: company.name, subtitle: kato.name(company.city), avatarURL: company.logoUrl)
                        }
                    }
                }

                Section {
                    DetailRow(
                        title: String(localized: "career.vacancy.employment", defaultValue: "Занятость"),
                        value: CareerText.employment(vacancy.employmentType),
                        symbol: "clock"
                    )
                    DetailRow(
                        title: String(localized: "career.vacancy.format", defaultValue: "Формат работы"),
                        value: CareerText.format(vacancy.workFormat),
                        symbol: "building.2"
                    )
                    if let experience = vacancy.experienceLevel {
                        DetailRow(
                            title: String(localized: "career.vacancy.experience", defaultValue: "Опыт"),
                            value: CareerText.experience(experience),
                            symbol: "chart.line.uptrend.xyaxis"
                        )
                    }
                    if let city = kato.name(vacancy.city) {
                        DetailRow(title: String(localized: "career.vacancy.city", defaultValue: "Город"), value: city, symbol: "mappin")
                    }
                    if let deadline = vacancy.deadline {
                        DetailRow(
                            title: String(localized: "career.vacancy.deadline", defaultValue: "Принимать отклики до"),
                            value: DisplayFormat.date(deadline),
                            symbol: "calendar"
                        )
                    }
                    if let published = vacancy.publishedAt {
                        DetailRow(
                            title: String(localized: "career.vacancy.published", defaultValue: "Опубликована"),
                            value: DisplayFormat.date(published),
                            symbol: "clock.arrow.circlepath"
                        )
                    }
                }

                if let match = vacancy.match {
                    Section {
                        ShareBar(
                            title: String(localized: "career.vacancy.match", defaultValue: "Совпадение с профилем"),
                            fraction: Double(match.score) / 100,
                            tint: Palette.success
                        )
                        if !CareerText.list(match.matchedSkills).isEmpty {
                            VStack(alignment: .leading, spacing: Spacing.sm) {
                                Text(String(localized: "career.vacancy.matched", defaultValue: "Есть у вас"))
                                    .font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                                CareerTags(items: CareerText.list(match.matchedSkills), tint: Palette.success)
                            }
                        }
                        if !CareerText.list(match.missingSkills).isEmpty {
                            VStack(alignment: .leading, spacing: Spacing.sm) {
                                Text(String(localized: "career.vacancy.missing", defaultValue: "Стоит подтянуть"))
                                    .font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                                CareerTags(items: CareerText.list(match.missingSkills))
                            }
                        }
                    }
                }

                if !CareerText.list(vacancy.skills).isEmpty || !CareerText.list(vacancy.languages).isEmpty {
                    Section {
                        if !CareerText.list(vacancy.skills).isEmpty {
                            CareerTags(items: CareerText.list(vacancy.skills))
                        }
                        if !CareerText.list(vacancy.languages).isEmpty {
                            DetailRow(
                                title: String(localized: "career.vacancy.languages", defaultValue: "Языки"),
                                value: CareerText.list(vacancy.languages).joined(separator: ", ")
                            )
                        }
                    } header: {
                        Text(String(localized: "career.vacancy.skills", defaultValue: "Навыки"))
                    }
                }

                if let description = vacancy.description, !description.isEmpty {
                    Section {
                        Text(description)
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                            .textSelection(.enabled)
                    } header: {
                        Text(String(localized: "career.vacancy.description", defaultValue: "Описание"))
                    }
                }

                if role.careerApplicant, details.application != nil {
                    Section {
                        NavigationLink(value: AppRoute.career(.applications)) {
                            IconRow(
                                title: CareerScreen.applications.title,
                                symbol: "paperplane.fill",
                                tint: TileTint.blue,
                                subtitle: String(localized: "career.vacancy.alreadyApplied", defaultValue: "Вы откликнулись:")
                                    + " " + CareerText.applicationStatus(details.application?.status ?? "").text
                            )
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .pullToRefresh { token += 1 }
            .task(id: vacancy.id) { kato.request([vacancy.city, vacancy.company?.city]) }
            .sheet(isPresented: $applying) {
                CareerApplySheet(vacancy: vacancy, profile: details.profile) { token += 1 }
            }
        }
        .navigationDestination(item: $openCompanyID) { companyID in
            CareerCompanyView(id: companyID)
        }
    }

    /// Круглые кнопки под шапкой: откликнуться (кто может и ещё не откликался) и страница
    /// компании.
    private func heroActions(_ details: CareerVacancyDetails) -> [HeroAction] {
        var actions: [HeroAction] = []
        if role.careerApplicant, details.application == nil, details.applicationFailure == nil {
            actions.append(HeroAction(
                title: String(localized: "career.vacancy.apply", defaultValue: "Откликнуться"),
                symbol: "paperplane.fill"
            ) { applying = true })
        }
        if let company = details.vacancy.company {
            actions.append(HeroAction(
                title: String(localized: "career.vacancy.companyAction", defaultValue: "Компания"),
                symbol: "building.2.fill"
            ) { openCompanyID = company.id })
        }
        return actions
    }

    private func load() async throws -> CareerVacancyDetails {
        let api = CareerAPI()
        var details = CareerVacancyDetails(vacancy: try await api.vacancy(id: id, universityID: universityID))
        if role.careerApplicant {
            do {
                details.application = try await api.myApplication(vacancyID: id)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                details.applicationFailure = error.userMessage
                details.applicationOffline = error.isOffline
            }
            details.profile = try? await api.profile()
        }
        return details
    }
}

/// Отклик: сопроводительное письмо и одна кнопка. Скрытый профиль отклик не раскрывает —
/// форма предупреждает об этом и даёт открыть его только этой компании.
private struct CareerApplySheet: View {
    let vacancy: CareerVacancy
    let profile: CareerProfile?
    let applied: () async -> Void

    @State private var letter = ""
    @State private var share = false

    var body: some View {
        FormSheet(
            title: String(localized: "career.vacancy.apply", defaultValue: "Откликнуться"),
            saveTitle: String(localized: "career.apply.send", defaultValue: "Отправить"),
            canSave: letter.count <= 4000,
            save: {
                let text = letter.trimmingCharacters(in: .whitespacesAndNewlines)
                try await CareerAPI().apply(vacancyID: vacancy.id, coverLetter: text.isEmpty ? nil : text, shareProfile: share)
            },
            saved: applied
        ) {
            Section {
                TextField(
                    String(localized: "career.apply.letterPlaceholder", defaultValue: "Необязательно: почему вам интересна эта вакансия"),
                    text: $letter,
                    axis: .vertical
                )
                .lineLimit(4...10)
            } header: {
                Text(String(localized: "career.apply.letter", defaultValue: "Сопроводительное письмо"))
            } footer: {
                if letter.count > 4000 {
                    Text(String(localized: "career.apply.tooLong", defaultValue: "Не больше 4000 символов"))
                        .foregroundStyle(Palette.destructive)
                }
            }

            if let profile {
                Section {
                    if profile.isVisible {
                        Text(String(
                            localized: "career.apply.visible",
                            defaultValue: "Компания увидит ваш карьерный профиль: он открыт работодателям."
                        ))
                        .foregroundStyle(Palette.mutedForeground)
                    } else if profile.profileGrants.contains(where: { $0.companyId == vacancy.company?.id }) {
                        Text(String(localized: "career.apply.shared", defaultValue: "Ваш профиль уже открыт этой компании."))
                            .foregroundStyle(Palette.mutedForeground)
                    } else {
                        CareerNotice(
                            title: String(localized: "career.apply.hiddenTitle", defaultValue: "Профиль скрыт от работодателей"),
                            text: String(
                                localized: "career.apply.hiddenText",
                                defaultValue: "Компания получит отклик с вашим именем, специальностью и навыками, но не увидит карьерный профиль: о себе, что вы ищете, портфолио."
                            ),
                            symbol: "eye.slash",
                            tint: Palette.warning
                        )
                        Toggle(isOn: $share) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(String(localized: "career.apply.share", defaultValue: "Открыть профиль только этой компании"))
                                Text(String(
                                    localized: "career.apply.shareHint",
                                    defaultValue: "Другие компании его не увидят. Закрыть доступ можно в «Моих откликах» или в карьерном профиле."
                                ))
                                .font(.caption)
                                .foregroundStyle(Palette.mutedForeground)
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Мои отклики

struct CareerApplicationsView: View {
    @State private var loader = PagedLoader<CareerApplication>(limit: 20) { request in
        try await CareerAPI().myApplications(request)
    }
    @State private var status: String?
    @State private var opened: CareerApplication?
    @State private var withdrawing: CareerApplication?
    @State private var failure: String?

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "career.apps.empty", defaultValue: "Откликов пока нет"),
                symbol: "paperplane",
                hint: String(localized: "career.apps.emptyHint", defaultValue: "Найдите вакансию и откликнитесь — статус появится здесь.")
            ),
            header: {
                FilterChipsRow(
                    options: CareerText.chips(CareerText.allTitle, CareerText.applicationStatuses) {
                        CareerText.applicationStatus($0).text
                    },
                    selection: $status
                )
            },
            row: { application in
                Button {
                    opened = application
                } label: {
                    CareerStudentApplicationRow(application: application)
                }
                .buttonStyle(.plain)
                .swipeActions {
                    if !CareerText.isFinal(application.status) {
                        Button(role: .destructive) {
                            withdrawing = application
                        } label: {
                            Label(String(localized: "career.apps.withdraw", defaultValue: "Отозвать"), systemImage: "arrow.uturn.backward")
                        }
                    }
                }
            }
        )
        .navigationTitle(Text(CareerScreen.applications.title))
        .onChange(of: status) {
            let filter = status
            Task {
                await loader.replace { request in
                    try await CareerAPI().myApplications(request, params: ["status": filter])
                }
            }
        }
        .sheet(item: $opened) { application in
            CareerApplicationSheet(application: application) { await loader.reload() }
        }
        .confirmDestructive(
            $withdrawing,
            title: { _ in String(localized: "career.apps.withdrawConfirm", defaultValue: "Отозвать отклик? Компания увидит, что отклик отозван. Вернуть его нельзя.") },
            actionTitle: String(localized: "career.apps.withdraw", defaultValue: "Отозвать")
        ) { application in
            do {
                try await CareerAPI().withdraw(applicationID: application.id)
                await loader.reload()
            } catch {
                failure = error.userMessage
            }
        }
        .actionFailureAlert($failure)
    }
}

/// Отклик — как строка чата: логотип компании, должность, день отклика справа, компания
/// и условия ниже, статус — плашкой.
private struct CareerStudentApplicationRow: View {
    let application: CareerApplication

    var body: some View {
        let status = CareerText.applicationStatus(application.status)
        let terms = [application.vacancy.employmentType.map(CareerText.employment), application.vacancy.workFormat.map(CareerText.format)]
            .compactMap { $0 }
            .joined(separator: " · ")
        TelegramStyleRow(
            title: application.vacancy.title,
            subtitle: [application.vacancy.company?.name, terms.isEmpty ? nil : terms]
                .compactMap { $0 }
                .joined(separator: "\n"),
            meta: DisplayFormat.date(application.createdAt)
        ) {
            if let company = application.vacancy.company {
                AvatarView(url: company.logoUrl, name: company.name, size: 44)
            } else {
                RowSymbol(symbol: "briefcase.fill", tint: TileTint.purple)
            }
        } accessory: {
            StatusBadge(text: status.text, tint: status.tint)
        }
        .contentShape(Rectangle())
    }
}

private enum CareerProfileAccessText {
    static func text(_ raw: String?) -> String? {
        switch raw {
        case "COMPANY": return String(localized: "career.apps.sharedWithCompany", defaultValue: "Компания видит ваш профиль")
        case "HIDDEN": return String(localized: "career.apps.hiddenFromCompany", defaultValue: "Компания не видит ваш профиль")
        default: return nil
        }
    }
}

/// Отклик целиком: вакансия, письмо, история статусов, отзыв и доступ компании к профилю.
private struct CareerApplicationSheet: View {
    let application: CareerApplication
    let changed: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var history: [CareerApplicationEvent]?
    @State private var historyFailure: String?
    @State private var access: String?
    @State private var confirmWithdraw = false
    @State private var failure: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    let status = CareerText.applicationStatus(application.status)
                    HeroHeader(
                        visual: application.vacancy.company.map { HeroVisual.avatar(url: $0.logoUrl, name: $0.name) }
                            ?? .symbol("briefcase.fill", tint: TileTint.purple),
                        title: application.vacancy.title,
                        subtitle: application.vacancy.company?.name,
                        actions: applicationActions
                    ) {
                        VStack(spacing: Spacing.xs) {
                            StatusBadge(text: status.text, tint: status.tint)
                            Text(DisplayFormat.dateTime(application.createdAt))
                                .font(.caption)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                }

                if let letter = application.coverLetter, !letter.isEmpty {
                    Section {
                        Text(letter).textSelection(.enabled)
                    } header: {
                        Text(String(localized: "career.apply.letter", defaultValue: "Сопроводительное письмо"))
                    }
                }

                if let current = access ?? application.profileAccess, current != "EMPLOYERS", let companyID = application.vacancy.company?.id {
                    Section {
                        Text(CareerProfileAccessText.text(current) ?? "")
                            .foregroundStyle(Palette.mutedForeground)
                        Button(current == "COMPANY"
                            ? String(localized: "career.apps.unshare", defaultValue: "Закрыть профиль")
                            : String(localized: "career.apps.share", defaultValue: "Открыть ей профиль")
                        ) {
                            Task { await toggleShare(companyID: companyID, shared: current == "COMPANY") }
                        }
                        .disabled(busy)
                    }
                }

                Section {
                    if let history {
                        if history.isEmpty {
                            Text(String(localized: "career.apps.historyEmpty", defaultValue: "Изменений пока не было"))
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        ForEach(history) { event in
                            CareerHistoryRow(event: event)
                        }
                    } else if let historyFailure {
                        DashboardFailurePlaceholder(message: historyFailure) { await loadHistory() }
                    } else {
                        ProgressView()
                    }
                } header: {
                    Text(String(localized: "career.apps.history", defaultValue: "История"))
                }

                if !CareerText.isFinal(application.status) {
                    Section {
                        Button(role: .destructive) {
                            confirmWithdraw = true
                        } label: {
                            Label(String(localized: "career.apps.withdraw", defaultValue: "Отозвать"), systemImage: "arrow.uturn.backward")
                                .foregroundStyle(Palette.destructive)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Text(String(localized: "career.apps.one", defaultValue: "Отклик")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .alert(
                String(localized: "career.apps.withdrawConfirm", defaultValue: "Отозвать отклик? Компания увидит, что отклик отозван. Вернуть его нельзя."),
                isPresented: $confirmWithdraw
            ) {
                Button(String(localized: "career.apps.withdraw", defaultValue: "Отозвать"), role: .destructive) {
                    Task { await withdraw() }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            }
            .actionFailureAlert($failure)
            .task { await loadHistory() }
        }
    }

    @Environment(\.openURL) private var openURL

    /// Сайт компании — кругом под шапкой, если он есть.
    private var applicationActions: [HeroAction] {
        guard let website = application.vacancy.company?.website, let url = URL(string: website) else { return [] }
        return [HeroAction(title: String(localized: "career.company.siteShort", defaultValue: "Сайт"), symbol: "globe") { openURL(url) }]
    }

    @MainActor
    private func loadHistory() async {
        do {
            history = try await CareerAPI().history(applicationID: application.id)
            historyFailure = nil
        } catch is CancellationError {
            return
        } catch {
            historyFailure = error.userMessage
        }
    }

    @MainActor
    private func toggleShare(companyID: String, shared: Bool) async {
        busy = true
        defer { busy = false }
        do {
            if shared {
                try await CareerAPI().unshare(companyID: companyID)
                access = "HIDDEN"
            } else {
                try await CareerAPI().share(companyID: companyID)
                access = "COMPANY"
            }
            await changed()
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func withdraw() async {
        do {
            try await CareerAPI().withdraw(applicationID: application.id)
            await changed()
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}

struct CareerHistoryRow: View {
    let event: CareerApplicationEvent

    var body: some View {
        let to = CareerText.applicationStatus(event.toStatus)
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                if let from = event.fromStatus {
                    Text(CareerText.applicationStatus(from).text).foregroundStyle(Palette.mutedForeground)
                    Image(systemName: "arrow.right").font(.caption).foregroundStyle(Palette.mutedForeground)
                }
                StatusBadge(text: to.text, tint: to.tint)
                Spacer(minLength: Spacing.md)
                Text(DisplayFormat.dateTime(event.createdAt))
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
            }
            if let comment = event.comment, !comment.isEmpty {
                Text(comment).font(Typography.meta).foregroundStyle(Palette.foreground)
            }
        }
        .font(Typography.meta)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Карьерный профиль

struct CareerProfileView: View {
    @State private var token = 0
    @State private var editing: CareerProfile?
    @State private var failure: String?
    @State private var busy = false

    var body: some View {
        RemoteContent(reloadToken: token, load: { try await CareerAPI().profile() }) { profile in
            List {
                Section {
                    HeroHeader(
                        visual: .symbol(profile.isVisible ? "eye.fill" : "eye.slash.fill", tint: profile.isVisible ? TileTint.green : TileTint.gray),
                        title: profile.isVisible
                            ? String(localized: "career.profile.visibleTitle", defaultValue: "Профиль открыт работодателям")
                            : String(localized: "career.profile.hiddenTitle", defaultValue: "Профиль скрыт"),
                        subtitle: profile.isVisible
                            ? String(
                                localized: "career.profile.visibleText",
                                defaultValue: "Компании, допущенные вашим университетом, видят профиль и могут пригласить вас."
                            )
                            : String(
                                localized: "career.profile.hiddenText",
                                defaultValue: "Работодатели вас не видят. Откройте профиль, чтобы участвовать в подборе."
                            ),
                        actions: [
                            HeroAction(
                                title: profile.isVisible
                                    ? String(localized: "career.profile.hide", defaultValue: "Скрыть профиль")
                                    : String(localized: "career.profile.show", defaultValue: "Открыть профиль"),
                                symbol: profile.isVisible ? "eye.slash" : "eye"
                            ) {
                                guard !busy else { return }
                                Task { await update(["visibility": .string(profile.isVisible ? "HIDDEN" : "EMPLOYERS")]) }
                            },
                            HeroAction(title: String(localized: "career.profile.edit", defaultValue: "Изменить"), symbol: "pencil") {
                                editing = profile
                            },
                        ]
                    ) {
                        StatusBadge(
                            text: String(localized: "career.profile.readinessBadge", defaultValue: "Готовность \(DisplayFormat.percent(Double(profile.readiness.score)))"),
                            tint: profile.readiness.score >= 70 ? Palette.success : Palette.warning
                        )
                    }
                }

                if !profile.profileGrants.isEmpty {
                    Section {
                        ForEach(profile.profileGrants) { grant in
                            HStack(spacing: Spacing.lg) {
                                AvatarView(url: nil, name: grant.companyName, size: 36)
                                Text(grant.companyName)
                                    .font(.body.weight(.medium))
                                    .foregroundStyle(Palette.foreground)
                                Spacer(minLength: Spacing.md)
                                Button(String(localized: "career.profile.grantRevoke", defaultValue: "Закрыть")) {
                                    Task { await unshare(grant.companyId) }
                                }
                                .buttonStyle(.borderless)
                                .foregroundStyle(Palette.destructive)
                                .disabled(busy)
                            }
                            .swipeActions {
                                Button(role: .destructive) {
                                    Task { await unshare(grant.companyId) }
                                } label: {
                                    Label(String(localized: "career.profile.grantRevoke", defaultValue: "Закрыть"), systemImage: "eye.slash")
                                }
                            }
                        }
                    } header: {
                        Text(String(
                            localized: "career.profile.grants",
                            defaultValue: "Открыт адресно — эти компании видят профиль, даже когда он скрыт"
                        ))
                    }
                }

                Section {
                    ShareBar(
                        title: String(localized: "career.profile.score", defaultValue: "Всего"),
                        fraction: Double(profile.readiness.score) / 100,
                        valueText: "\(profile.readiness.score)%",
                        tint: Palette.success
                    )
                    ForEach(profile.readiness.parts, id: \.key) { part in
                        ShareBar(
                            title: CareerText.readinessPart(part.key),
                            fraction: part.max > 0 ? Double(part.earned) / Double(part.max) : 0,
                            valueText: "\(part.earned)/\(part.max)"
                        )
                    }
                } header: {
                    CareerSectionHeader(
                        title: String(localized: "career.profile.readiness", defaultValue: "Готовность профиля"),
                        hint: String(
                            localized: "career.profile.readinessHint",
                            defaultValue: "Это не оценка вас, а перечень того, что работодатель ещё не видит."
                        )
                    )
                }

                Section {
                    ForEach(CareerText.consentFields, id: \.self) { field in
                        Toggle(CareerText.consent(field), isOn: Binding(
                            get: { profile.consents.contains { $0.field == field } },
                            set: { granted in Task { await consent(field, granted) } }
                        ))
                        .disabled(busy)
                    }
                } header: {
                    CareerSectionHeader(
                        title: String(localized: "career.profile.consents", defaultValue: "Чувствительные данные"),
                        hint: String(
                            localized: "career.profile.consentsHint",
                            defaultValue: "По умолчанию не передаются никогда. Отметьте, что можно показать работодателю; отозвать можно в любой момент."
                        )
                    )
                }

                Section {
                    DetailRow(
                        title: String(localized: "career.profile.status", defaultValue: "Статус"),
                        value: CareerText.employmentStatus(profile.employmentStatus)
                    )
                    DetailRow(
                        title: String(localized: "career.profile.positions", defaultValue: "Желаемые позиции"),
                        value: orEmpty(profile.desiredPositions.joined(separator: ", "))
                    )
                    DetailRow(
                        title: String(localized: "career.profile.employmentTypes", defaultValue: "Формат занятости"),
                        value: orEmpty(profile.employmentTypes.map(CareerText.employment).joined(separator: ", "))
                    )
                    DetailRow(
                        title: String(localized: "career.profile.workFormats", defaultValue: "Где готовы работать"),
                        value: orEmpty(profile.workFormats.map(CareerText.format).joined(separator: ", "))
                    )
                    DetailRow(
                        title: String(localized: "career.profile.salary", defaultValue: "Зарплата"),
                        value: CareerText.salary(min: profile.desiredSalaryMin, max: profile.desiredSalaryMax, currency: profile.salaryCurrency)
                            ?? orEmpty("")
                    )
                    DetailRow(
                        title: String(localized: "career.profile.relocation", defaultValue: "Готов(а) к переезду"),
                        value: profile.relocationReady
                            ? String(localized: "common.yes", defaultValue: "Да")
                            : String(localized: "common.no", defaultValue: "Нет")
                    )
                    DetailRow(
                        title: String(localized: "career.profile.about", defaultValue: "О себе для работодателя"),
                        value: orEmpty(profile.about ?? "")
                    )
                    Button(String(localized: "career.profile.edit", defaultValue: "Изменить")) { editing = profile }
                } header: {
                    CareerSectionHeader(
                        title: String(localized: "career.profile.looking", defaultValue: "Чего вы ищете"),
                        hint: String(
                            localized: "career.profile.lookingHint",
                            defaultValue: "Работодатели видят это первым — здесь вы задаёте рамку поиска"
                        )
                    )
                }

                Section {
                    let inherited = profile.inherited
                    DetailRow(title: String(localized: "career.profile.university", defaultValue: "Университет"), value: orEmpty(inherited.universityName ?? ""))
                    DetailRow(title: String(localized: "career.profile.specialty", defaultValue: "Специальность"), value: orEmpty(inherited.specialty ?? ""))
                    DetailRow(
                        title: String(localized: "career.profile.course", defaultValue: "Курс"),
                        value: inherited.course.map { String($0) } ?? orEmpty("")
                    )
                    DetailRow(
                        title: String(localized: "career.profile.skills", defaultValue: "Навыки"),
                        value: orEmpty(CareerText.list(inherited.skills).joined(separator: ", "))
                    )
                    DetailRow(
                        title: String(localized: "career.profile.languages", defaultValue: "Языки"),
                        value: orEmpty(CareerText.list(inherited.languages).joined(separator: ", "))
                    )
                    DetailRow(
                        title: String(localized: "career.profile.portfolioCount", defaultValue: "Записей в портфолио"),
                        value: (inherited.portfolioCount ?? 0).formatted()
                    )
                } header: {
                    CareerSectionHeader(
                        title: String(localized: "career.profile.inherited", defaultValue: "Из профиля университета"),
                        hint: String(
                            localized: "career.profile.inheritedHint",
                            defaultValue: "Эти данные редактируются в обычном профиле — здесь они только показаны."
                        )
                    )
                }
            }
            .listStyle(.insetGrouped)
            .pullToRefresh { token += 1 }
        }
        .navigationTitle(Text(CareerScreen.profile.title))
        .sheet(item: Binding(
            get: { editing.map(CareerProfileDraftBox.init) },
            set: { editing = $0?.profile }
        )) { box in
            CareerProfileForm(profile: box.profile) { token += 1 }
        }
        .actionFailureAlert($failure)
    }

    private func orEmpty(_ value: String) -> String {
        value.isEmpty ? String(localized: "career.profile.empty", defaultValue: "не заполнено") : value
    }

    @MainActor
    private func update(_ fields: [String: JSONValue]) async {
        busy = true
        defer { busy = false }
        do {
            try await CareerAPI().updateProfile(fields)
            token += 1
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func consent(_ field: String, _ granted: Bool) async {
        busy = true
        defer { busy = false }
        do {
            try await CareerAPI().setConsent(field: field, granted: granted)
            token += 1
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func unshare(_ companyID: String) async {
        busy = true
        defer { busy = false }
        do {
            try await CareerAPI().unshare(companyID: companyID)
            token += 1
        } catch {
            failure = error.userMessage
        }
    }
}

private struct CareerProfileDraftBox: Identifiable {
    let profile: CareerProfile
    var id: String { "profile" }
}

private struct CareerProfileForm: View {
    let saved: () async -> Void

    @State private var status: String
    @State private var positions: String
    @State private var types: Set<String>
    @State private var formats: Set<String>
    @State private var salaryMin: String
    @State private var salaryMax: String
    @State private var currency: String
    @State private var relocation: Bool
    @State private var about: String

    init(profile: CareerProfile, saved: @escaping () async -> Void) {
        self.saved = saved
        _status = State(initialValue: profile.employmentStatus)
        _positions = State(initialValue: profile.desiredPositions.joined(separator: ", "))
        _types = State(initialValue: Set(profile.employmentTypes))
        _formats = State(initialValue: Set(profile.workFormats))
        _salaryMin = State(initialValue: profile.desiredSalaryMin.map(String.init) ?? "")
        _salaryMax = State(initialValue: profile.desiredSalaryMax.map(String.init) ?? "")
        _currency = State(initialValue: profile.salaryCurrency ?? "KZT")
        _relocation = State(initialValue: profile.relocationReady)
        _about = State(initialValue: profile.about ?? "")
    }

    var body: some View {
        FormSheet(
            title: String(localized: "career.profile.looking", defaultValue: "Чего вы ищете"),
            canSave: about.count <= 2000 && CareerText.split(positions).count <= 10,
            save: save,
            saved: saved
        ) {
            Section {
                Picker(String(localized: "career.profile.status", defaultValue: "Статус"), selection: $status) {
                    ForEach(CareerText.employmentStatuses, id: \.self) { Text(CareerText.employmentStatus($0)).tag($0) }
                }
                TextField(
                    String(localized: "career.profile.positionsPlaceholder", defaultValue: "Frontend-разработчик, аналитик данных"),
                    text: $positions
                )
            } footer: {
                Text(String(localized: "career.profile.positionsHint", defaultValue: "Желаемые позиции через запятую, до 10"))
            }

            Section {
                ForEach(CareerText.employmentTypes, id: \.self) { value in
                    Toggle(CareerText.employment(value), isOn: membership(value, in: $types))
                }
            } header: {
                Text(String(localized: "career.profile.employmentTypes", defaultValue: "Формат занятости"))
            }

            Section {
                ForEach(CareerText.workFormats, id: \.self) { value in
                    Toggle(CareerText.format(value), isOn: membership(value, in: $formats))
                }
                Toggle(String(localized: "career.profile.relocation", defaultValue: "Готов(а) к переезду"), isOn: $relocation)
            } header: {
                Text(String(localized: "career.profile.workFormats", defaultValue: "Где готовы работать"))
            }

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

            Section {
                TextField(
                    String(localized: "career.profile.aboutPlaceholder", defaultValue: "Чем занимаетесь, что уже делали, чему хотите научиться"),
                    text: $about,
                    axis: .vertical
                )
                .lineLimit(4...12)
            } header: {
                Text(String(localized: "career.profile.about", defaultValue: "О себе для работодателя"))
            }
        }
    }

    private func membership(_ value: String, in set: Binding<Set<String>>) -> Binding<Bool> {
        Binding(
            get: { set.wrappedValue.contains(value) },
            set: { on in
                if on { set.wrappedValue.insert(value) } else { set.wrappedValue.remove(value) }
            }
        )
    }

    private func save() async throws {
        let min = Int(salaryMin.filter(\.isNumber))
        let max = Int(salaryMax.filter(\.isNumber))
        try await CareerAPI().updateProfile([
            "employmentStatus": .string(status),
            "desiredPositions": .strings(CareerText.split(positions)),
            "employmentTypes": .strings(CareerText.employmentTypes.filter(types.contains)),
            "workFormats": .strings(CareerText.workFormats.filter(formats.contains)),
            "relocationReady": .bool(relocation),
            "desiredSalaryMin": .int(min),
            "desiredSalaryMax": .int(max),
            "salaryCurrency": (min == nil && max == nil) ? .null : .string(currency),
            "about": .text(about),
        ])
    }
}

// MARK: - Резюме

struct CareerResumeView: View {
    @State private var token = 0
    @State private var renaming = false
    @State private var failure: String?
    @State private var busy = false
    @State private var export = CareerFileExport()

    var body: some View {
        RemoteContent(reloadToken: token, load: { try await CareerAPI().resume() }) { resume in
            List {
                Section {
                    HeroHeader(
                        visual: .symbol("doc.text.fill", tint: TileTint.blue),
                        title: resume.title,
                        subtitle: resume.updatedAt.map {
                            String(localized: "career.resume.updatedShort", defaultValue: "Обновлено \(DisplayFormat.dateTime($0))")
                        },
                        actions: resumeActions(resume)
                    ) {
                        StatusBadge(
                            text: resume.published
                                ? String(localized: "career.resume.publicBadge", defaultValue: "По ссылке")
                                : String(localized: "career.resume.privateBadge", defaultValue: "Только у вас"),
                            tint: resume.published ? Palette.success : Palette.mutedForeground
                        )
                    }
                }

                Section {
                    CareerNotice(
                        title: resume.published
                            ? String(localized: "career.resume.publicTitle", defaultValue: "Резюме доступно по ссылке")
                            : String(localized: "career.resume.privateTitle", defaultValue: "Резюме только у вас"),
                        text: resume.published
                            ? String(
                                localized: "career.resume.publicText",
                                defaultValue: "Ссылку можно отправить работодателю, аккаунт для просмотра не нужен."
                            )
                            : String(
                                localized: "career.resume.privateText",
                                defaultValue: "Включите ссылку, чтобы делиться резюме за пределами платформы."
                            ),
                        symbol: resume.published ? "link" : "lock",
                        tint: resume.published ? Palette.success : Palette.mutedForeground
                    )
                    Toggle(String(localized: "career.resume.publish", defaultValue: "Ссылка включена"), isOn: Binding(
                        get: { resume.published },
                        set: { on in Task { await update(["published": .bool(on)]) } }
                    ))
                    .disabled(busy)
                    if resume.published, let slug = resume.publicSlug {
                        if let url = publicURL(slug) {
                            ShareLink(item: url) {
                                Label(String(localized: "career.resume.share", defaultValue: "Поделиться ссылкой"), systemImage: "square.and.arrow.up")
                            }
                            Button {
                                UIPasteboard.general.url = url
                            } label: {
                                Label(String(localized: "career.resume.copy", defaultValue: "Копировать"), systemImage: "doc.on.doc")
                            }
                        }
                        NavigationLink(value: AppRoute.career(.publicResume(slug: slug))) {
                            Label(String(localized: "career.resume.preview", defaultValue: "Как видят по ссылке"), systemImage: "eye")
                        }
                    }
                    Toggle(isOn: Binding(
                        get: { resume.includeContacts },
                        set: { on in Task { await update(["includeContacts": .bool(on)]) } }
                    )) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(String(localized: "career.resume.contacts", defaultValue: "Показывать контакты по ссылке"))
                            Text(String(
                                localized: "career.resume.contactsHint",
                                defaultValue: "По умолчанию выключено: ссылку могут переслать куда угодно."
                            ))
                            .font(.caption)
                            .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                    .disabled(busy)
                }

                Section {
                    Text(String(
                        localized: "career.resume.portfolioHint",
                        defaultValue: "В резюме по ссылке и в карточку для работодателей попадают только записи портфолио с видимостью «Все». Записи «Только я» и «Вуз» там не показываются — они есть только в PDF, который вы скачиваете сами."
                    ))
                    Text(String(
                        localized: "career.resume.sourceHint",
                        defaultValue: "Содержимое берётся из карьерного профиля, портфолио и подтверждённых вузом сертификатов. Чтобы изменить резюме, обновите профиль."
                    ))
                    NavigationLink(value: AppRoute.career(.profile)) {
                        Text(CareerScreen.profile.title)
                    }
                }
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            }
            .listStyle(.insetGrouped)
            .pullToRefresh { token += 1 }
            .sheet(isPresented: $renaming) {
                CareerResumeTitleForm(title: resume.title) { token += 1 }
            }
        }
        .navigationTitle(Text(CareerScreen.resume.title))
        .modifier(CareerFileExportModifier(export: export))
        .actionFailureAlert($failure)
    }

    private func publicURL(_ slug: String) -> URL? {
        AppConfiguration.webBaseURL?.appending(path: "r/resume/\(slug)")
    }

    /// Круги под шапкой: PDF, переименовать и — если ссылка включена — скопировать её.
    private func resumeActions(_ resume: CareerResumeSettings) -> [HeroAction] {
        var actions = [
            HeroAction(title: String(localized: "career.resume.pdfShort", defaultValue: "PDF"), symbol: "arrow.down.doc") {
                Task { await downloadPDF() }
            },
            HeroAction(title: String(localized: "career.resume.rename", defaultValue: "Переименовать"), symbol: "pencil") {
                renaming = true
            },
        ]
        if resume.published, let slug = resume.publicSlug, let url = publicURL(slug) {
            actions.append(HeroAction(title: String(localized: "career.resume.copy", defaultValue: "Копировать"), symbol: "link") {
                UIPasteboard.general.url = url
            })
        }
        return actions
    }

    @MainActor
    private func update(_ fields: [String: JSONValue]) async {
        busy = true
        defer { busy = false }
        do {
            try await CareerAPI().updateResume(fields)
            token += 1
        } catch {
            failure = error.userMessage
        }
    }

    private func downloadPDF() async {
        // Подписи разделов — на языке приложения: сервер переводов резюме не хранит.
        let labels = [
            "about": CareerResumeLabels.about,
            "education": CareerResumeLabels.education,
            "skills": CareerResumeLabels.skills,
            "languages": CareerResumeLabels.languages,
            "experience": CareerResumeLabels.experience,
            "projects": CareerResumeLabels.projects,
            "certificates": CareerResumeLabels.certificates,
            "verified": CareerResumeLabels.verified,
            "generated": CareerResumeLabels.generated,
        ]
        await export.run(name: String(localized: "career.resume.fileName", defaultValue: "Резюме.pdf")) {
            try await CareerAPI().resumePDF(labels: labels)
        }
    }
}

private enum CareerResumeLabels {
    static var about: String { String(localized: "career.resume.about", defaultValue: "О себе") }
    static var education: String { String(localized: "career.resume.education", defaultValue: "Образование") }
    static var skills: String { String(localized: "career.resume.skills", defaultValue: "Навыки") }
    static var languages: String { String(localized: "career.resume.languages", defaultValue: "Языки") }
    static var experience: String { String(localized: "career.resume.experience", defaultValue: "Опыт") }
    static var projects: String { String(localized: "career.resume.projects", defaultValue: "Проекты") }
    static var certificates: String { String(localized: "career.resume.certificates", defaultValue: "Сертификаты") }
    static var verified: String { String(localized: "career.resume.verified", defaultValue: "подтверждён вузом") }
    static var generated: String { String(localized: "career.resume.generated", defaultValue: "Резюме создано в StudentHub Карьера") }
}

private struct CareerResumeTitleForm: View {
    let saved: () async -> Void
    @State private var title: String

    init(title: String, saved: @escaping () async -> Void) {
        self.saved = saved
        _title = State(initialValue: title)
    }

    var body: some View {
        FormSheet(
            title: String(localized: "career.resume.titleField", defaultValue: "Название"),
            canSave: !title.trimmingCharacters(in: .whitespaces).isEmpty && title.count <= 120,
            save: { try await CareerAPI().updateResume(["title": .string(title.trimmingCharacters(in: .whitespaces))]) },
            saved: saved
        ) {
            Section {
                TextField(String(localized: "career.resume.titleField", defaultValue: "Название"), text: $title)
            }
        }
    }
}

/// Резюме так, как его видят по публичной ссылке.
struct CareerPublicResumeView: View {
    let slug: String

    var body: some View {
        RemoteContent(load: { try await CareerAPI().publicResume(slug: slug) }) { resume in
            List {
                Section {
                    HeroHeader(
                        visual: .avatar(url: nil, name: resume.fullName),
                        title: resume.fullName,
                        subtitle: resume.headline
                    ) {
                        Text(resume.title)
                            .font(.caption)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                if !CareerText.list(resume.contacts).isEmpty {
                    Section {
                        ForEach(CareerText.list(resume.contacts), id: \.self) { contact in
                            Label(contact, systemImage: contact.contains("@") ? "envelope" : "phone")
                                .textSelection(.enabled)
                        }
                    }
                }

                if let about = resume.about, !about.isEmpty {
                    textSection(CareerResumeLabels.about, about)
                }
                if !CareerText.list(resume.education).isEmpty {
                    textSection(CareerResumeLabels.education, CareerText.list(resume.education).joined(separator: "\n"))
                }
                if !CareerText.list(resume.skills).isEmpty {
                    Section {
                        CareerTags(items: CareerText.list(resume.skills))
                    } header: {
                        Text(CareerResumeLabels.skills)
                    }
                }
                itemsSection(CareerResumeLabels.experience, resume.experience)
                itemsSection(CareerResumeLabels.projects, resume.projects)
                itemsSection(CareerResumeLabels.certificates, resume.certificates)
                if !CareerText.list(resume.languages).isEmpty {
                    textSection(CareerResumeLabels.languages, CareerText.list(resume.languages).joined(separator: ", "))
                }
                Section {
                    Text(CareerResumeLabels.generated)
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                }
                .listRowBackground(Color.clear)
            }
            .listStyle(.insetGrouped)
        }
        .navigationTitle(Text(CareerScreen.resume.title))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func textSection(_ title: String, _ text: String) -> some View {
        Section {
            Text(text).textSelection(.enabled)
        } header: {
            Text(title)
        }
    }

    @ViewBuilder
    private func itemsSection(_ title: String, _ items: [CareerPublicResume.Item]?) -> some View {
        if let items, !items.isEmpty {
            Section {
                ForEach(items, id: \.self) { item in
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(item.title).font(Typography.cardTitle).foregroundStyle(Palette.foreground)
                            Spacer(minLength: Spacing.md)
                            if item.verified == true {
                                StatusBadge(text: CareerResumeLabels.verified, tint: Palette.success)
                            }
                        }
                        let meta = [item.organization, item.period].compactMap { $0 }.filter { !$0.isEmpty }
                        if !meta.isEmpty {
                            Text(meta.joined(separator: " · ")).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                        }
                        if let description = item.description, !description.isEmpty {
                            Text(description).font(Typography.meta).foregroundStyle(Palette.foreground)
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                }
            } header: {
                Text(title)
            }
        }
    }
}

// MARK: - Карьерные мероприятия

struct CareerEventsView: View {
    var body: some View {
        CareerScopeGate { universityID in
            CareerEventList(universityID: universityID)
        }
        .navigationTitle(Text(CareerScreen.events.title))
    }
}

private struct CareerEventList: View {
    let universityID: String?

    @Environment(\.viewerRole) private var role
    @State private var loader: PagedLoader<CareerEvent>
    @State private var past: Bool? = false
    @State private var kind: String?
    @State private var creating = false

    init(universityID: String?) {
        self.universityID = universityID
        _loader = State(initialValue: PagedLoader(limit: 20) { request in
            try await CareerAPI().events(request, params: ["past": "false", "universityId": universityID])
        })
    }

    /// Создать мероприятие может организатор событий вуза — у платформенной роли своего вуза нет.
    private var canCreate: Bool { role == .universityAdmin || role == .dean || role == .teacher }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "career.events.empty", defaultValue: "Мероприятий нет"),
                symbol: "calendar",
                hint: String(localized: "career.events.emptyHint", defaultValue: "Карьерный центр вуза публикует их вместе с обычными событиями.")
            ),
            header: {
                FilterChipsRow(
                    options: [
                        (value: Optional(false), title: String(localized: "career.events.upcoming", defaultValue: "Предстоящие")),
                        (value: Optional(true), title: String(localized: "career.events.past", defaultValue: "Прошедшие")),
                    ],
                    selection: $past
                )
                FilterChipsRow(
                    options: CareerText.chips(
                        String(localized: "career.events.allKinds", defaultValue: "Все типы"),
                        CareerText.eventKinds,
                        CareerText.eventKind
                    ),
                    selection: $kind
                )
            },
            row: { event in
                // Записаться можно только в карточке события.
                NavigationLink(value: AppRoute.event(id: event.id)) {
                    CareerEventRow(event: event)
                }
            }
        )
        .onChange(of: past) { Task { await refilter() } }
        .onChange(of: kind) { Task { await refilter() } }
        .overlay(alignment: .bottomTrailing) {
            if canCreate {
                Color.clear
                    .frame(width: 1, height: 1)
                    .floatingAction(String(localized: "career.events.create", defaultValue: "Новое мероприятие"), symbol: "calendar.badge.plus") {
                        creating = true
                    }
            }
        }
        .sheet(isPresented: $creating) {
            CareerEventForm(kind: kind ?? "CAREER_FAIR") { await loader.reload() }
        }
    }

    private func refilter() async {
        let params: [String: String?] = [
            "past": (past ?? false) ? "true" : "false",
            "kind": kind,
            "universityId": universityID,
        ]
        await loader.replace { request in
            try await CareerAPI().events(request, params: params)
        }
    }
}

/// Мероприятие — как строка чата, но слева листок календаря с днём: дату ищут глазами
/// первой. Время справа, тип и место ниже, «Вы записаны» — плашкой.
struct CareerEventRow: View {
    let event: CareerEvent

    var body: some View {
        let place = event.isOnline == true
            ? String(localized: "career.events.online", defaultValue: "Онлайн")
            : event.location
        let participants = event.participantsCount.map { count in
            let value = count.formatted()
            return String(localized: "career.events.participants", defaultValue: "Участников: \(value)")
        }
        TelegramStyleRow(
            title: event.title,
            subtitle: [
                [CareerText.eventKind(event.careerKind), place].compactMap { $0 }.filter { !$0.isEmpty && $0 != "—" }.joined(separator: " · "),
                participants,
            ]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: "\n"),
            meta: event.startsAt.formatted(.dateTime.hour().minute())
        ) {
            CareerDayTile(date: event.startsAt)
        } accessory: {
            if event.registered == true {
                StatusBadge(text: String(localized: "career.events.registered", defaultValue: "Вы записаны"), tint: Palette.success)
            }
        }
    }
}

/// Листок календаря: месяц сверху мелко, число крупно.
private struct CareerDayTile: View {
    let date: Date

    var body: some View {
        VStack(spacing: 0) {
            Text(date.formatted(.dateTime.month(.abbreviated)).uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(Palette.destructive)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(date.formatted(.dateTime.day()))
                .font(.title3.weight(.semibold).monospacedDigit())
                .foregroundStyle(Palette.foreground)
        }
        .frame(width: 44, height: 44)
        .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// Мероприятие создаётся обычным событием вуза с карьерным типом — без него оно не попало бы в раздел.
private struct CareerEventForm: View {
    let saved: () async -> Void

    @State private var kind: String
    @State private var title = ""
    @State private var description = ""
    @State private var location = ""
    @State private var isOnline = false
    @State private var startsAt = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    @State private var hasEnd = false
    @State private var endsAt = Calendar.current.date(byAdding: .hour, value: 26, to: Date()) ?? Date()

    init(kind: String, saved: @escaping () async -> Void) {
        self.saved = saved
        _kind = State(initialValue: kind)
    }

    var body: some View {
        FormSheet(
            title: String(localized: "career.events.create", defaultValue: "Новое мероприятие"),
            canSave: !title.trimmingCharacters(in: .whitespaces).isEmpty
                && !description.trimmingCharacters(in: .whitespaces).isEmpty
                && (!hasEnd || endsAt > startsAt),
            save: save,
            saved: saved
        ) {
            Section {
                Picker(String(localized: "career.events.kind", defaultValue: "Тип"), selection: $kind) {
                    ForEach(CareerText.eventKinds, id: \.self) { Text(CareerText.eventKind($0)).tag($0) }
                }
                TextField(String(localized: "career.events.titleField", defaultValue: "Название"), text: $title)
                TextField(String(localized: "career.events.description", defaultValue: "Описание"), text: $description, axis: .vertical)
                    .lineLimit(3...8)
            }
            Section {
                DatePicker(String(localized: "career.events.startsAt", defaultValue: "Начало"), selection: $startsAt)
                Toggle(String(localized: "career.events.hasEnd", defaultValue: "Указать окончание"), isOn: $hasEnd)
                if hasEnd {
                    DatePicker(String(localized: "career.events.endsAt", defaultValue: "Окончание"), selection: $endsAt, in: startsAt...)
                }
                Toggle(String(localized: "career.events.online", defaultValue: "Онлайн"), isOn: $isOnline)
                TextField(String(localized: "career.events.location", defaultValue: "Место"), text: $location)
            }
        }
    }

    private func save() async throws {
        var fields: [String: JSONValue] = [
            "audience": "UNIVERSITY",
            "careerKind": .string(kind),
            "title": .string(title.trimmingCharacters(in: .whitespaces)),
            "description": .string(description.trimmingCharacters(in: .whitespacesAndNewlines)),
            "isOnline": .bool(isOnline),
            "startsAt": .string(JSONCoding.isoString(startsAt)),
        ]
        let place = location.trimmingCharacters(in: .whitespaces)
        if !place.isEmpty { fields["location"] = .string(place) }
        if hasEnd { fields["endsAt"] = .string(JSONCoding.isoString(endsAt)) }
        try await CareerAPI().createEvent(fields)
    }
}

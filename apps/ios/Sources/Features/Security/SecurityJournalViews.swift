import SwiftUI

/// Журнал проходов студентов целиком: фильтр «пропущены / отказы», день и поиск.
struct SecurityPassesView: View {
    @State private var loader: PagedLoader<SecurityPassDTO>
    @State private var allowed: Bool?
    @State private var day: Date?
    @State private var search = ""

    private static let api = SecurityAPI()

    init() {
        _loader = State(initialValue: PagedLoader(limit: 30) { request in
            try await Self.api.passes(request)
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: isFiltered
                    ? String(localized: "security.nothingFound", defaultValue: "Ничего не найдено")
                    : String(localized: "security.passes.emptyTitle", defaultValue: "Проходов пока нет"),
                symbol: "checkmark.shield"
            ),
            header: {
                FilterChipsRow(
                    options: [
                        (nil, String(localized: "security.filter.all", defaultValue: "Все")),
                        (true, String(localized: "security.filter.allowed", defaultValue: "Пропущены")),
                        (false, String(localized: "security.filter.denied", defaultValue: "Отказы")),
                    ],
                    selection: $allowed
                )
                SecurityDayFilter(day: $day)
            },
            row: { pass in
                SecurityPassRow(pass: pass)
            }
        )
        .navigationTitle(Text(SecurityScreen.passes.title))
        .debouncedSearch($search, prompt: String(localized: "security.searchStudent", defaultValue: "Студент или группа")) { _ in
            await reload()
        }
        .onChange(of: allowed) { _, _ in Task { await reload() } }
        .onChange(of: day) { _, _ in Task { await reload() } }
    }

    private var isFiltered: Bool { allowed != nil || day != nil || !search.trimmingCharacters(in: .whitespaces).isEmpty }

    @MainActor
    private func reload() async {
        let allowed = allowed
        let date = day.map(SecurityText.dayString)
        let query = search.trimmingCharacters(in: .whitespaces)
        await loader.replace { request in
            try await Self.api.passes(request, date: date, allowed: allowed, query: query.isEmpty ? nil : query)
        }
    }
}

/// Журнал посетителей: кто в здании или все записи, день, поиск, отметка выхода.
struct SecurityVisitorsView: View {
    @State private var loader: PagedLoader<SecurityVisitorDTO>
    @State private var status: String? = "inside"
    @State private var day: Date?
    @State private var search = ""
    @State private var recording = false
    @State private var exiting: Set<String> = []
    @State private var actionFailure: String?

    private static let api = SecurityAPI()

    init() {
        _loader = State(initialValue: PagedLoader(limit: 30) { request in
            try await Self.api.visitors(request, status: "inside")
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: status == "inside"
                    ? String(localized: "security.visitors.empty", defaultValue: "В здании посетителей нет")
                    : String(localized: "security.visitors.journalEmpty", defaultValue: "Посетителей пока не записывали"),
                symbol: "person.2",
                actionTitle: String(localized: "security.recordVisitor", defaultValue: "Записать посетителя"),
                action: { recording = true }
            ),
            header: {
                FilterChipsRow(
                    options: [
                        ("inside", String(localized: "security.visitors.filterInside", defaultValue: "В здании")),
                        ("all", String(localized: "security.visitors.filterAll", defaultValue: "Все записи")),
                    ],
                    selection: $status
                )
                SecurityDayFilter(day: $day)
            },
            row: { visitor in
                HStack(spacing: Spacing.md) {
                    SecurityVisitorRow(visitor: visitor)
                    if visitor.exitedAt == nil {
                        if exiting.contains(visitor.id) {
                            ProgressView()
                        } else {
                            Button(String(localized: "security.markExit", defaultValue: "Вышел")) {
                                Task { await markExit(visitor) }
                            }
                            .glassButton()
                            .font(Typography.meta.weight(.semibold))
                        }
                    }
                }
            }
        )
        .navigationTitle(Text(SecurityScreen.visitors.title))
        .debouncedSearch($search, prompt: String(localized: "security.searchVisitor", defaultValue: "ФИО или цель визита")) { _ in
            await reload()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    recording = true
                } label: {
                    Image(systemName: "person.badge.plus")
                }
                .accessibilityLabel(Text(String(localized: "security.recordVisitor", defaultValue: "Записать посетителя")))
            }
        }
        .sheet(isPresented: $recording) {
            SecurityRecordVisitorSheet { _ in await loader.reload() }
        }
        .actionFailureAlert($actionFailure)
        .onChange(of: status) { _, _ in Task { await reload() } }
        .onChange(of: day) { _, _ in Task { await reload() } }
    }

    @MainActor
    private func reload() async {
        let status = status ?? "all"
        let date = day.map(SecurityText.dayString)
        let query = search.trimmingCharacters(in: .whitespaces)
        await loader.replace { request in
            try await Self.api.visitors(request, status: status, date: date, query: query.isEmpty ? nil : query)
        }
    }

    @MainActor
    private func markExit(_ visitor: SecurityVisitorDTO) async {
        guard !exiting.contains(visitor.id) else { return }
        exiting.insert(visitor.id)
        defer { exiting.remove(visitor.id) }
        do {
            _ = try await Self.api.markExit(visitorID: visitor.id)
            await loader.reload()
        } catch {
            if let api = error as? APIError, api.code == .conflict {
                actionFailure = String(localized: "security.visitorAlreadyExited", defaultValue: "Выход уже отметили — журнал обновлён")
                await loader.reload()
            } else {
                actionFailure = error.userMessage
            }
        }
    }
}

/// Фильтр журнала по дню: выключен — за всё время, включён — за выбранный день.
private struct SecurityDayFilter: View {
    @Binding var day: Date?

    var body: some View {
        Section {
            Toggle(
                String(localized: "security.filter.byDay", defaultValue: "За день"),
                isOn: Binding(get: { day != nil }, set: { day = $0 ? Calendar.current.startOfDay(for: Date()) : nil })
            )
            if let current = day {
                DatePicker(
                    String(localized: "security.filter.day", defaultValue: "День"),
                    selection: Binding(get: { current }, set: { day = $0 }),
                    in: ...Date(),
                    displayedComponents: .date
                )
            }
        }
    }
}

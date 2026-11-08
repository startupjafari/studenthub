import SwiftUI

// Журналы поста охраны у администратора вуза (веб — `SecurityHomeView readOnly`): сводка за
// сегодня, проходы студентов и посетители. Ведёт журналы охрана — здесь только чтение,
// зато посетители — весь журнал с временем выхода, а не только кто в здании.

enum StaffSecurityText {
    static func denyReason(_ raw: String?) -> String {
        switch raw {
        case "STATUS": return String(localized: "staff.sec.deny.status", defaultValue: "Не учится: отчислен, выпускник или переведён")
        case "BLOCKED": return String(localized: "staff.sec.deny.blocked", defaultValue: "Аккаунт заблокирован")
        case "OTHER_UNIVERSITY": return String(localized: "staff.sec.deny.otherUniversity", defaultValue: "Студент другого вуза")
        case "INVALID_QR": return String(localized: "staff.sec.deny.invalidQr", defaultValue: "Недействительный QR")
        case "EXPIRED_QR": return String(localized: "staff.sec.deny.expiredQr", defaultValue: "QR истёк")
        case "REUSED_QR": return String(localized: "staff.sec.deny.reusedQr", defaultValue: "QR уже проверен — скриншот")
        case nil: return String(localized: "staff.sec.denied", defaultValue: "Отказ")
        default: return raw ?? ""
        }
    }

    static func document(_ raw: String?) -> String? {
        switch raw {
        case "ID_CARD": return String(localized: "staff.sec.doc.idCard", defaultValue: "Удостоверение личности")
        case "PASSPORT": return String(localized: "staff.sec.doc.passport", defaultValue: "Паспорт")
        case "DRIVER_LICENSE": return String(localized: "staff.sec.doc.driver", defaultValue: "Водительские права")
        case "OTHER": return String(localized: "staff.sec.doc.other", defaultValue: "Другой")
        default: return nil
        }
    }

    /// Время записи: сегодняшнее — только часы, более раннее — с датой.
    static func time(_ date: Date) -> String {
        Calendar.current.isDateInToday(date)
            ? date.formatted(.dateTime.hour().minute())
            : DisplayFormat.dateTime(date)
    }
}

private enum StaffSecurityTab: String, CaseIterable, Identifiable {
    case passes, visitors

    var id: String { rawValue }

    var title: String {
        switch self {
        case .passes: return String(localized: "staff.sec.passes", defaultValue: "Проходы студентов")
        case .visitors: return String(localized: "staff.sec.visitors", defaultValue: "Посетители")
        }
    }
}

struct StaffSecurityJournalsView: View {
    @State private var tab: StaffSecurityTab = .passes
    @State private var summary: StaffSecuritySummary?
    @State private var result: String?
    @State private var search = ""
    @State private var useDate = false
    @State private var day = Date()
    @State private var insideOnly = false
    @State private var passes: PagedLoader<StaffPass>
    @State private var visitors: PagedLoader<StaffVisitor>

    private let api = StaffAPI()

    init() {
        let api = StaffAPI()
        _passes = State(initialValue: PagedLoader(limit: 30) { request in
            try await api.passes(allowed: nil, search: "", date: nil, request)
        })
        _visitors = State(initialValue: PagedLoader(limit: 30) { request in
            try await api.visitors(insideOnly: false, search: "", date: nil, request)
        })
    }

    var body: some View {
        Group {
            switch tab {
            case .passes:
                PagedList(
                    loader: passes,
                    empty: EmptyStateView(
                        title: String(localized: "staff.sec.passes.empty", defaultValue: "Проходов пока нет"),
                        symbol: "checkmark.shield",
                        hint: String(localized: "staff.sec.passes.empty.hint", defaultValue: "Проверенные студенческие появятся здесь — и пропущенные, и отказы")
                    ),
                    header: { header },
                    row: { passRow($0) }
                )
            case .visitors:
                PagedList(
                    loader: visitors,
                    empty: EmptyStateView(
                        title: String(localized: "staff.sec.visitors.empty", defaultValue: "Посетителей пока не записывали"),
                        symbol: "person.badge.clock"
                    ),
                    header: { header },
                    row: { visitorRow($0) }
                )
            }
        }
        .navigationTitle(Text(StaffScreen.securityJournals.title))
        .debouncedSearch($search, prompt: String(localized: "staff.sec.search", defaultValue: "ФИО")) { _ in
            await apply()
        }
        .onChange(of: result) { Task { await apply() } }
        .onChange(of: useDate) { Task { await apply() } }
        .onChange(of: day) { Task { await apply() } }
        .onChange(of: insideOnly) { Task { await apply() } }
        .refreshable { await loadSummary() }
        .task { await loadSummary() }
    }

    @ViewBuilder
    private var header: some View {
        Section {
            if let summary {
                StatGrid {
                    StatTile(
                        title: String(localized: "staff.sec.allowed", defaultValue: "Прошли"),
                        value: summary.passes.allowed.formatted(), symbol: "checkmark.shield", tint: Palette.success,
                        caption: String(localized: "staff.sec.today", defaultValue: "за сегодня")
                    )
                    StatTile(
                        title: String(localized: "staff.sec.deniedCount", defaultValue: "Отказано"),
                        value: summary.passes.denied.formatted(), symbol: "xmark.shield", tint: Palette.destructive,
                        caption: String(localized: "staff.sec.today", defaultValue: "за сегодня")
                    )
                    StatTile(
                        title: String(localized: "staff.sec.inside", defaultValue: "Посетителей в здании"),
                        value: summary.visitors.inside.formatted(), symbol: "person.2",
                        caption: String(localized: "staff.sec.visitorsToday", defaultValue: "за сегодня: \(summary.visitors.today.formatted())")
                    )
                }
            }
        } footer: {
            Text(String(localized: "staff.sec.subtitle", defaultValue: "Журналы ведёт охрана — здесь только чтение."))
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())

        Section {
            Picker(String(localized: "staff.sec.journal", defaultValue: "Журнал"), selection: $tab) {
                ForEach(StaffSecurityTab.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            if tab == .passes {
                Picker(String(localized: "staff.sec.result", defaultValue: "Результат"), selection: $result) {
                    Text(String(localized: "staff.sec.result.all", defaultValue: "Все")).tag(String?.none)
                    Text(String(localized: "staff.sec.allowedOne", defaultValue: "Пропущен")).tag(String?.some("true"))
                    Text(String(localized: "staff.sec.denied", defaultValue: "Отказ")).tag(String?.some("false"))
                }
            } else {
                Toggle(String(localized: "staff.sec.insideOnly", defaultValue: "Только кто в здании"), isOn: $insideOnly)
            }
            Toggle(String(localized: "staff.sec.byDay", defaultValue: "За день"), isOn: $useDate)
            if useDate {
                DatePicker(String(localized: "staff.sec.day", defaultValue: "День"), selection: $day, in: ...Date(), displayedComponents: .date)
            }
        }
    }

    private func passRow(_ pass: StaffPass) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(pass.student?.name ?? String(localized: "staff.sec.unknownStudent", defaultValue: "Не установлен"))
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                Text([pass.student?.group, StaffSecurityText.time(pass.createdAt), pass.guardName].compactMap { $0 }.joined(separator: " · "))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                if !pass.allowed {
                    Text(StaffSecurityText.denyReason(pass.denyReason))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.destructive)
                }
            }
            Spacer(minLength: Spacing.md)
            if pass.allowed {
                StatusBadge(text: String(localized: "staff.sec.allowedOne", defaultValue: "Пропущен"), tint: Palette.success)
            } else {
                StatusBadge(text: String(localized: "staff.sec.denied", defaultValue: "Отказ"), tint: Palette.destructive)
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    private func visitorRow(_ visitor: StaffVisitor) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(visitor.fullName).font(Typography.body).foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                if visitor.exitedAt == nil {
                    StatusBadge(text: String(localized: "staff.sec.stillInside", defaultValue: "В здании"), tint: Palette.info)
                }
            }
            Text(visitor.purpose).font(Typography.meta).foregroundStyle(Palette.foreground)
            Text([
                String(localized: "staff.sec.entered", defaultValue: "Вход \(StaffSecurityText.time(visitor.enteredAt))"),
                visitor.exitedAt.map { String(localized: "staff.sec.exited", defaultValue: "выход \(StaffSecurityText.time($0))") },
            ].compactMap { $0 }.joined(separator: " · "))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            let document = [StaffSecurityText.document(visitor.documentType), visitor.documentLast4.map { "••••\($0)" }]
                .compactMap { $0 }.joined(separator: " ")
            if !document.isEmpty || visitor.phone != nil || visitor.createdByName != nil {
                Text([document.isEmpty ? nil : document, visitor.phone, visitor.createdByName].compactMap { $0 }.joined(separator: " · "))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    @MainActor
    private func loadSummary() async {
        summary = try? await api.securitySummary()
        if passes.isLoaded { await passes.reload() }
        if visitors.isLoaded { await visitors.reload() }
    }

    private func apply() async {
        let needle = search
        let date = useDate ? StaffDay.string(day) : nil
        let allowed = result.map { $0 == "true" }
        let inside = insideOnly
        await passes.replace { request in try await api.passes(allowed: allowed, search: needle, date: date, request) }
        await visitors.replace { request in try await api.visitors(insideOnly: inside, search: needle, date: date, request) }
    }
}

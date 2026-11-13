import SwiftUI

/// Портфолио: записи по видам — учёба, опыт, проекты, сертификаты, достижения.
struct PortfolioView: View {
    var body: some View {
        CommunitySectionGate(section: "portfolio") { PortfolioContent() }
    }
}

private struct PortfolioContent: View {
    @State private var remote = RemoteValue<[PortfolioItemDTO]>()
    @State private var editing: PortfolioItemDTO?
    @State private var deleting: PortfolioItemDTO?
    @State private var actionFailure: String?
    @State private var creating = false

    private let api: UniversityServicesFetching = UniversityServicesAPI()

    private var items: [PortfolioItemDTO]? { remote.value }
    private var failure: String? { remote.failure }
    private var isOffline: Bool { remote.isOffline }

    var body: some View {
        List {
            if let items {
                if let failure, !items.isEmpty {
                    StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                ForEach(PortfolioText.kinds, id: \.self) { kind in
                    let group = items.filter { $0.kind == kind }
                    if !group.isEmpty {
                        Section {
                            ForEach(group) { item in
                                row(item)
                            }
                            .onMove { source, destination in move(kind: kind, from: source, to: destination) }
                        } header: {
                            Text(PortfolioText.kind(kind))
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(items?.isEmpty != false) {
            if items != nil {
                EmptyStateView(
                    title: String(localized: "portfolio.empty", defaultValue: "Портфолио пока пустое"),
                    symbol: "briefcase",
                    hint: String(localized: "portfolio.empty.hint", defaultValue: "Добавьте проекты, опыт и сертификаты — их увидят преподаватели и работодатели"),
                    actionTitle: String(localized: "portfolio.add", defaultValue: "Добавить запись"),
                    action: { creating = true }
                )
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(MoreSection.portfolio.title))
        .toolbar {
            // Порядок записей виден работодателю — переставляют его здесь.
            if (items?.count ?? 0) > 1 {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
            }
        }
        .floatingAction(String(localized: "portfolio.add", defaultValue: "Добавить запись")) {
            creating = true
        }
        .sheet(isPresented: $creating) {
            NewPortfolioItemView { await load() }
        }
        .sheet(item: $editing) { item in
            NewPortfolioItemView(existing: item) { await load() }
        }
        .confirmDestructive(
            $deleting,
            title: { item in
                PortfolioText.fill(
                    String(localized: "portfolio.delete.confirm", defaultValue: "Удалить «{title}» из портфолио?"),
                    item.title
                )
            },
            actionTitle: String(localized: "common.delete", defaultValue: "Удалить")
        ) { item in
            await delete(item)
        }
        .actionFailureAlert($actionFailure)
        .pullToRefresh { await load() }
        // Показ, возврат на экран и возврат приложения из фона — сохранённое на месте,
        // сеть обновляет фоном (`RemoteValue`).
        .task(id: AppLifecycle.shared.foregroundEpoch) { await load() }
    }

    private func row(_ item: PortfolioItemDTO) -> some View {
        Button {
            editing = item
        } label: {
            PortfolioRow(item: item)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                deleting = item
            } label: {
                Label(String(localized: "common.delete", defaultValue: "Удалить"), systemImage: "trash")
            }
        }
        .swipeActions(edge: .leading) {
            Button {
                editing = item
            } label: {
                Label(String(localized: "community.portfolio.edit", defaultValue: "Изменить запись"), systemImage: "pencil")
            }
            .tint(Palette.primary)
        }
        .contextMenu {
            Button {
                editing = item
            } label: {
                Label(String(localized: "community.portfolio.edit", defaultValue: "Изменить запись"), systemImage: "pencil")
            }
            if let link = item.url.flatMap(URL.init(string:)) {
                Link(destination: link) {
                    Label(String(localized: "portfolio.openLink", defaultValue: "Открыть ссылку"), systemImage: "safari")
                }
                ShareLink(item: link) {
                    Label(String(localized: "portfolio.shareLink", defaultValue: "Поделиться ссылкой"), systemImage: "square.and.arrow.up")
                }
            }
            Divider()
            Button(role: .destructive) {
                deleting = item
            } label: {
                Label(String(localized: "common.delete", defaultValue: "Удалить"), systemImage: "trash")
            }
        }
    }

    private func load() async {
        await remote.load { try await api.portfolio() }
    }

    /// Порядок общий для всех видов: собираем его в порядке показа — по видам, внутри
    /// вида с учётом перестановки.
    private func move(kind: String, from source: IndexSet, to destination: Int) {
        guard let current = items else { return }
        var group = current.filter { $0.kind == kind }
        group.move(fromOffsets: source, toOffset: destination)
        let ordered = PortfolioText.kinds.flatMap { name in name == kind ? group : current.filter { $0.kind == name } }
            + current.filter { !PortfolioText.kinds.contains($0.kind) }
        remote.value = ordered
        Task {
            do {
                remote.value = try await UniversityServicesAPI().reorderPortfolio(ids: ordered.map(\.id))
            } catch {
                remote.value = current
                actionFailure = error.userMessage
            }
        }
    }

    @MainActor
    private func delete(_ item: PortfolioItemDTO) async {
        let snapshot = items
        remote.value?.removeAll { $0.id == item.id }
        do {
            try await api.deletePortfolioItem(id: item.id)
        } catch {
            remote.value = snapshot
            actionFailure = error.userMessage
        }
    }
}

enum PortfolioText {
    static let kinds = ["EDUCATION", "EXPERIENCE", "PROJECT", "CERTIFICATE", "ACHIEVEMENT"]
    static let visibilities = ["PRIVATE", "UNIVERSITY", "PUBLIC"]

    static func kind(_ raw: String) -> String {
        switch raw {
        case "EDUCATION": return String(localized: "portfolio.kind.education", defaultValue: "Образование")
        case "EXPERIENCE": return String(localized: "portfolio.kind.experience", defaultValue: "Опыт")
        case "PROJECT": return String(localized: "portfolio.kind.project", defaultValue: "Проекты")
        case "CERTIFICATE": return String(localized: "portfolio.kind.certificate", defaultValue: "Сертификаты")
        default: return String(localized: "portfolio.kind.achievement", defaultValue: "Достижения")
        }
    }

    static func symbol(_ raw: String) -> String {
        switch raw {
        case "EDUCATION": return "graduationcap.fill"
        case "EXPERIENCE": return "briefcase.fill"
        case "PROJECT": return "hammer.fill"
        case "CERTIFICATE": return "rosette"
        default: return "trophy.fill"
        }
    }

    static func tint(_ raw: String) -> Color {
        switch raw {
        case "EDUCATION": return TileTint.blue
        case "EXPERIENCE": return TileTint.orange
        case "PROJECT": return TileTint.purple
        case "CERTIFICATE": return TileTint.teal
        default: return TileTint.yellow
        }
    }

    static func visibility(_ raw: String) -> String {
        switch raw {
        case "PRIVATE": return String(localized: "portfolio.visibility.private", defaultValue: "Только я")
        case "UNIVERSITY": return String(localized: "settings.visibility.university", defaultValue: "Мой вуз")
        default: return String(localized: "settings.visibility.public", defaultValue: "Все")
        }
    }

    static func visibilitySymbol(_ raw: String) -> String {
        switch raw {
        case "PRIVATE": return "lock.fill"
        case "UNIVERSITY": return "building.columns.fill"
        default: return "globe"
        }
    }

    /// Подстановка названия в шаблон с `{title}`: в локализованную строку — только строка.
    static func fill(_ template: String, _ title: String) -> String {
        template.replacingOccurrences(of: "{title}", with: title)
    }
}

/// Запись как строка чата: значок вида, название, годы справа, организация и описание
/// ниже; справа снизу — кто видит запись.
private struct PortfolioRow: View {
    let item: PortfolioItemDTO

    var body: some View {
        TelegramStyleRow(title: item.title, subtitle: details, meta: period) {
            RowSymbol(symbol: PortfolioText.symbol(item.kind), tint: PortfolioText.tint(item.kind))
        } accessory: {
            if let visibility = item.visibility {
                Image(systemName: PortfolioText.visibilitySymbol(visibility))
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
                    .accessibilityLabel(Text(PortfolioText.visibility(visibility)))
            }
        }
    }

    private var details: String {
        let link = item.url.flatMap(URL.init(string:)).flatMap { $0.host() }
        return [item.organization, item.description, link]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    /// Годы — коротко, чтобы мета справа не вытесняла название: «2023–2024», «с 2023».
    private var period: String? {
        let style = Date.FormatStyle.dateTime.year()
        switch (item.startDate, item.endDate) {
        case let (start?, end?):
            let from = start.formatted(style)
            let to = end.formatted(style)
            return from == to ? from : "\(from)–\(to)"
        case let (start?, nil): return String(localized: "portfolio.since", defaultValue: "с \(start.formatted(style))")
        case let (nil, end?): return end.formatted(style)
        default: return nil
        }
    }
}

/// Лист записи портфолио: что это, подробности, период и кто видит.
private struct NewPortfolioItemView: View {
    /// Правка существующей записи; `nil` — новая.
    var existing: PortfolioItemDTO? = nil
    let created: () async -> Void

    @State private var item = NewPortfolioItem(kind: "PROJECT", title: "", visibility: "UNIVERSITY")
    @State private var organization = ""
    @State private var details = ""
    @State private var link = ""
    @State private var hasDates = false
    @State private var start = Date()
    @State private var end = Date()
    @State private var didFill = false

    private var linkIsValid: Bool {
        let value = link.trimmingCharacters(in: .whitespaces)
        return value.isEmpty || value.hasPrefix("http://") || value.hasPrefix("https://")
    }

    var body: some View {
        FormSheet(
            title: existing == nil
                ? String(localized: "portfolio.add", defaultValue: "Добавить запись")
                : String(localized: "community.portfolio.edit", defaultValue: "Изменить запись"),
            canSave: !item.title.trimmingCharacters(in: .whitespaces).isEmpty && linkIsValid,
            save: save,
            saved: created
        ) {
            Section {
                Picker(String(localized: "portfolio.kind", defaultValue: "Вид"), selection: $item.kind) {
                    ForEach(PortfolioText.kinds, id: \.self) { kind in
                        Label(PortfolioText.kind(kind), systemImage: PortfolioText.symbol(kind)).tag(kind)
                    }
                }
                TextField(String(localized: "portfolio.title", defaultValue: "Название"), text: $item.title)
                TextField(String(localized: "portfolio.organization", defaultValue: "Организация"), text: $organization)
            }

            Section {
                TextField(String(localized: "portfolio.description", defaultValue: "Описание"), text: $details, axis: .vertical)
                    .lineLimit(3...8)
                TextField(String(localized: "portfolio.url", defaultValue: "Ссылка"), text: $link)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } footer: {
                if !linkIsValid {
                    FieldError(message: String(localized: "profile.website.invalid", defaultValue: "Адрес сайта должен начинаться с http:// или https://"))
                }
            }

            Section {
                Toggle(String(localized: "portfolio.dates", defaultValue: "Указать период"), isOn: $hasDates)
                if hasDates {
                    DatePicker(String(localized: "portfolio.start", defaultValue: "Начало"), selection: $start, displayedComponents: .date)
                    DatePicker(String(localized: "portfolio.end", defaultValue: "Окончание"), selection: $end, in: start..., displayedComponents: .date)
                }
            }

            Section {
                Picker(String(localized: "portfolio.visibility", defaultValue: "Кто видит"), selection: Binding(
                    get: { item.visibility ?? "UNIVERSITY" },
                    set: { item.visibility = $0 }
                )) {
                    ForEach(PortfolioText.visibilities, id: \.self) { value in
                        Label(PortfolioText.visibility(value), systemImage: PortfolioText.visibilitySymbol(value)).tag(value)
                    }
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear(perform: fill)
    }

    private func save() async throws {
        func optional(_ value: String) -> String? {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        var body = item
        body.title = String(item.title.trimmingCharacters(in: .whitespaces).prefix(200))
        body.organization = optional(organization).map { String($0.prefix(200)) }
        body.description = optional(details).map { String($0.prefix(2000)) }
        body.url = optional(link)
        body.startDate = hasDates ? start : nil
        body.endDate = hasDates ? end : nil
        if let existing {
            func value(_ text: String?) -> JSONValue { text.map(JSONValue.string) ?? .null }
            func date(_ value: Date?) -> JSONValue { value.map { .string(JSONCoding.isoString($0)) } ?? .null }
            _ = try await UniversityServicesAPI().updatePortfolioItem(id: existing.id, fields: [
                "kind": .string(body.kind),
                "title": .string(body.title),
                "organization": value(body.organization),
                "description": value(body.description),
                "url": value(body.url),
                "startDate": date(body.startDate),
                "endDate": date(body.endDate),
                "visibility": .string(body.visibility ?? "UNIVERSITY"),
            ])
        } else {
            try await UniversityServicesAPI().addPortfolioItem(body)
        }
    }

    private func fill() {
        guard !didFill, let existing else { return }
        didFill = true
        item = NewPortfolioItem(kind: existing.kind, title: existing.title, visibility: existing.visibility ?? "UNIVERSITY")
        organization = existing.organization ?? ""
        details = existing.description ?? ""
        link = existing.url ?? ""
        if let startDate = existing.startDate {
            hasDates = true
            start = startDate
            end = existing.endDate ?? startDate
        }
    }
}

import SwiftUI

/// Портфолио: записи по видам — учёба, опыт, проекты, сертификаты, достижения.
struct PortfolioView: View {
    var body: some View {
        CommunitySectionGate(section: "portfolio") { PortfolioContent() }
    }
}

private struct PortfolioContent: View {
    @State private var items: [PortfolioItemDTO]?
    @State private var editing: PortfolioItemDTO?
    @State private var failure: String?
    @State private var actionFailure: String?
    @State private var creating = false

    private let api: UniversityServicesFetching = UniversityServicesAPI()

    var body: some View {
        List {
            if let items {
                if items.isEmpty {
                    EmptyStateView(
                        title: String(localized: "portfolio.empty", defaultValue: "Портфолио пока пустое"),
                        symbol: "briefcase",
                        hint: String(localized: "portfolio.empty.hint", defaultValue: "Добавьте проекты, опыт и сертификаты — их увидят преподаватели и работодатели"),
                        actionTitle: String(localized: "portfolio.add", defaultValue: "Добавить запись"),
                        action: { creating = true }
                    )
                    .listRowBackground(Color.clear)
                }
                ForEach(PortfolioText.kinds, id: \.self) { kind in
                    let group = items.filter { $0.kind == kind }
                    if !group.isEmpty {
                        Section {
                            ForEach(group) { item in
                                Button {
                                    editing = item
                                } label: {
                                    PortfolioRow(item: item)
                                }
                                .buttonStyle(.plain)
                                    .swipeActions {
                                        Button(role: .destructive) {
                                            Task { await delete(item) }
                                        } label: {
                                            Label(String(localized: "common.delete", defaultValue: "Удалить"), systemImage: "trash")
                                        }
                                    }
                            }
                            .onMove { source, destination in move(kind: kind, from: source, to: destination) }
                        } header: {
                            Label(PortfolioText.kind(kind), systemImage: PortfolioText.symbol(kind))
                        }
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(MoreSection.portfolio.title))
        .toolbar {
            if (items?.count ?? 0) > 1 {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    creating = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel(Text(String(localized: "portfolio.add", defaultValue: "Добавить запись")))
            }
        }
        .sheet(isPresented: $creating) {
            NewPortfolioItemView { await load() }
        }
        .sheet(item: $editing) { item in
            NewPortfolioItemView(existing: item) { await load() }
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task { await load() }
    }

    @MainActor
    private func load() async {
        do {
            items = try await api.portfolio()
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    /// Порядок общий для всех видов: собираем его в порядке показа — по видам, внутри
    /// вида с учётом перестановки.
    private func move(kind: String, from source: IndexSet, to destination: Int) {
        guard let current = items else { return }
        var group = current.filter { $0.kind == kind }
        group.move(fromOffsets: source, toOffset: destination)
        let ordered = PortfolioText.kinds.flatMap { name in name == kind ? group : current.filter { $0.kind == name } }
            + current.filter { !PortfolioText.kinds.contains($0.kind) }
        items = ordered
        Task {
            do {
                items = try await UniversityServicesAPI().reorderPortfolio(ids: ordered.map(\.id))
            } catch {
                items = current
                actionFailure = error.userMessage
            }
        }
    }

    @MainActor
    private func delete(_ item: PortfolioItemDTO) async {
        let snapshot = items
        items?.removeAll { $0.id == item.id }
        do {
            try await api.deletePortfolioItem(id: item.id)
        } catch {
            items = snapshot
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
        case "EDUCATION": return "graduationcap"
        case "EXPERIENCE": return "briefcase"
        case "PROJECT": return "hammer"
        case "CERTIFICATE": return "rosette"
        default: return "trophy"
        }
    }

    static func visibility(_ raw: String) -> String {
        switch raw {
        case "PRIVATE": return String(localized: "portfolio.visibility.private", defaultValue: "Только я")
        case "UNIVERSITY": return String(localized: "settings.visibility.university", defaultValue: "Мой вуз")
        default: return String(localized: "settings.visibility.public", defaultValue: "Все")
        }
    }
}

private struct PortfolioRow: View {
    let item: PortfolioItemDTO

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(item.title)
                .font(Typography.cardTitle)
                .foregroundStyle(Palette.foreground)
            if let organization = item.organization, !organization.isEmpty {
                Text(organization).font(Typography.body).foregroundStyle(Palette.foreground)
            }
            if let period {
                Text(period)
            }
            if let description = item.description, !description.isEmpty {
                Text(description).lineLimit(4)
            }
            if let link = item.url.flatMap(URL.init(string:)) {
                Link(destination: link) {
                    Label(link.host() ?? link.absoluteString, systemImage: "link")
                }
            }
            if let visibility = item.visibility {
                Label(PortfolioText.visibility(visibility), systemImage: "eye")
            }
        }
        .font(Typography.meta)
        .foregroundStyle(Palette.mutedForeground)
        .padding(.vertical, Spacing.xs)
    }

    private var period: String? {
        let style = Date.FormatStyle.dateTime.month(.abbreviated).year()
        switch (item.startDate, item.endDate) {
        case let (start?, end?): return "\(start.formatted(style)) – \(end.formatted(style))"
        case let (start?, nil): return String(localized: "portfolio.since", defaultValue: "с \(start.formatted(style))")
        case let (nil, end?): return end.formatted(style)
        default: return nil
        }
    }
}

private struct NewPortfolioItemView: View {
    /// Правка существующей записи; `nil` — новая.
    var existing: PortfolioItemDTO? = nil
    let created: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var item = NewPortfolioItem(kind: "PROJECT", title: "", visibility: "UNIVERSITY")
    @State private var organization = ""
    @State private var details = ""
    @State private var link = ""
    @State private var hasDates = false
    @State private var start = Date()
    @State private var end = Date()
    @State private var failure: String?
    @State private var isSaving = false

    private var linkIsValid: Bool {
        let value = link.trimmingCharacters(in: .whitespaces)
        return value.isEmpty || value.hasPrefix("http://") || value.hasPrefix("https://")
    }

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure).listRowBackground(Color.clear)
                }
                Section {
                    Picker(String(localized: "portfolio.kind", defaultValue: "Вид"), selection: $item.kind) {
                        ForEach(PortfolioText.kinds, id: \.self) { Text(PortfolioText.kind($0)).tag($0) }
                    }
                    TextField(String(localized: "portfolio.title", defaultValue: "Название"), text: $item.title)
                    TextField(String(localized: "portfolio.organization", defaultValue: "Организация"), text: $organization)
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
                    Picker(String(localized: "portfolio.visibility", defaultValue: "Кто видит"), selection: Binding(
                        get: { item.visibility ?? "UNIVERSITY" },
                        set: { item.visibility = $0 }
                    )) {
                        ForEach(PortfolioText.visibilities, id: \.self) { Text(PortfolioText.visibility($0)).tag($0) }
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Palette.background)
            .navigationTitle(Text(existing == nil
                ? String(localized: "portfolio.add", defaultValue: "Добавить запись")
                : String(localized: "community.portfolio.edit", defaultValue: "Изменить запись")))
            .navigationBarTitleDisplayMode(.inline)
            .onAppear(perform: fill)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "common.save", defaultValue: "Сохранить")) {
                        Task { await save() }
                    }
                    .disabled(item.title.trimmingCharacters(in: .whitespaces).isEmpty || !linkIsValid || isSaving)
                }
            }
        }
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
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
        do {
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
            await created()
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }

    @State private var didFill = false

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

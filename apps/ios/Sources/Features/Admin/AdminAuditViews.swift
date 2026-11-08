import SwiftUI

/// Журнал действий по охвату роли: платформа — всё, вуз — свой вуз, модератор — свои
/// действия. Фильтр по действию — подстрокой, как в вебе; запись открывается целиком.
struct AdminAuditView: View {
    @State private var action = ""
    @State private var opened: AdminAuditEntryDTO?
    @State private var loader = PagedLoader<AdminAuditEntryDTO>(limit: 50) { request in
        try await AdminAPI().audit(action: nil, request: request)
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "admin.audit.empty", defaultValue: "Записей нет"),
                symbol: "scroll"
            )
        ) { entry in
            Button {
                opened = entry
            } label: {
                AdminAuditRow(entry: entry)
            }
            .buttonStyle(.plain)
        }
        .navigationTitle(Text(AdminScreen.audit.title))
        .debouncedSearch($action, prompt: String(localized: "admin.audit.filter", defaultValue: "Фильтр по действию")) { needle in
            await loader.replace { request in
                try await AdminAPI().audit(action: needle.isEmpty ? nil : String(needle.prefix(100)), request: request)
            }
        }
        .sheet(item: $opened) { entry in
            AdminAuditEntrySheet(entry: entry)
        }
    }
}

struct AdminAuditRow: View {
    let entry: AdminAuditEntryDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: entry.action)
                    .font(Typography.body.monospaced())
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                Spacer(minLength: Spacing.md)
                Text(DisplayFormat.dateTime(entry.createdAt))
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
            }
            if let entity = entry.entity {
                Text(verbatim: [entity, entry.entityId].compactMap { $0 }.joined(separator: " · "))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            if let user = entry.userId {
                Label {
                    Text(verbatim: user).lineLimit(1).truncationMode(.middle)
                } icon: {
                    Image(systemName: "person")
                }
                .font(.caption)
                .foregroundStyle(Palette.mutedForeground)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Запись журнала целиком: полные id (их копируют для поиска по логам), адрес, клиент и
/// метаданные действия.
private struct AdminAuditEntrySheet: View {
    let entry: AdminAuditEntryDTO

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    DetailRow(title: String(localized: "admin.audit.action", defaultValue: "Действие"), value: entry.action)
                    DetailRow(title: String(localized: "admin.audit.time", defaultValue: "Время"), value: DisplayFormat.dateTime(entry.createdAt))
                    if let entity = entry.entity {
                        DetailRow(title: String(localized: "admin.audit.entity", defaultValue: "Объект"), value: entity)
                    }
                    if let entityID = entry.entityId {
                        DetailRow(title: String(localized: "admin.audit.entityId", defaultValue: "ID объекта"), value: entityID)
                    }
                    if let ip = entry.ip {
                        DetailRow(title: String(localized: "admin.audit.ip", defaultValue: "IP-адрес"), value: ip)
                    }
                    if let agent = entry.userAgent {
                        DetailRow(title: String(localized: "admin.audit.userAgent", defaultValue: "Клиент"), value: agent)
                    }
                }
                .listRowBackground(Palette.card)
                .textSelection(.enabled)

                if let user = entry.userId {
                    Section {
                        DetailRow(title: String(localized: "admin.audit.user", defaultValue: "Пользователь"), value: user)
                            .textSelection(.enabled)
                    }
                    .listRowBackground(Palette.card)
                }

                if let metadata = entry.metadata, metadata.object?.isEmpty == false {
                    JSONDetailsSection(
                        title: String(localized: "admin.audit.metadata", defaultValue: "Подробности"),
                        value: metadata
                    )
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(Text(verbatim: entry.action))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(AdminText.close) { dismiss() }
                }
            }
        }
    }
}

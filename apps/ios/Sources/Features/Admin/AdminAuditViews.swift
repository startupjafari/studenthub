import SwiftUI
import UIKit

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
            .contextMenu {
                Button {
                    UIPasteboard.general.string = entry.entityId ?? entry.id
                } label: {
                    Label(String(localized: "admin.audit.copyId", defaultValue: "Скопировать ID объекта"), systemImage: "doc.on.doc")
                }
                if let user = entry.userId {
                    Button {
                        AdminNav.push(.admin(.user(id: user)))
                    } label: {
                        Label(String(localized: "admin.complaint.openUser", defaultValue: "Карточка пользователя"), systemImage: "person.crop.rectangle")
                    }
                }
            }
        }
        .navigationTitle(Text(AdminScreen.audit.title))
        .debouncedSearch($action, prompt: String(localized: "admin.audit.filter", defaultValue: "Фильтр по действию")) { needle in
            await loader.replace { request in
                try await AdminAPI().audit(action: needle.isEmpty ? nil : String(needle.prefix(100)), request: request)
            }
        }
        .sheet(item: $opened) { entry in
            AdminAuditEntrySheet(entry: entry)
                .presentationDetents([.medium, .large])
        }
    }
}

struct AdminAuditRow: View {
    let entry: AdminAuditEntryDTO

    var body: some View {
        TelegramStyleRow(
            title: entry.action,
            subtitle: subtitle,
            meta: DisplayFormat.dateTime(entry.createdAt)
        ) {
            RowSymbol(symbol: AdminAuditVisual.symbol(entry.action), tint: AdminAuditVisual.tint(entry.action), size: 40)
        }
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        let entity = [entry.entity, entry.entityId].compactMap { $0 }.joined(separator: " · ")
        let user = entry.userId.map { String(localized: "admin.audit.byUser", defaultValue: "Кто: \($0)") } ?? ""
        return [entity, user].filter { !$0.isEmpty }.joined(separator: "\n")
    }
}

/// Значок записи по глаголу действия: создание, правка, удаление, вход, блокировка.
enum AdminAuditVisual {
    static func symbol(_ action: String) -> String {
        let value = action.lowercased()
        if value.contains("delete") || value.contains("remove") { return "trash.fill" }
        if value.contains("block") || value.contains("ban") { return "hand.raised.fill" }
        if value.contains("login") || value.contains("auth") || value.contains("session") { return "key.fill" }
        if value.contains("create") || value.contains("invite") || value.contains("add") { return "plus" }
        if value.contains("update") || value.contains("edit") || value.contains("change") { return "pencil" }
        if value.contains("view") || value.contains("read") || value.contains("open") { return "eye.fill" }
        return "scroll.fill"
    }

    static func tint(_ action: String) -> Color {
        let value = action.lowercased()
        if value.contains("delete") || value.contains("remove") || value.contains("block") || value.contains("ban") { return TileTint.red }
        if value.contains("login") || value.contains("auth") || value.contains("session") { return TileTint.indigo }
        if value.contains("create") || value.contains("invite") || value.contains("add") { return TileTint.green }
        if value.contains("update") || value.contains("edit") || value.contains("change") { return TileTint.orange }
        if value.contains("view") || value.contains("read") || value.contains("open") { return TileTint.teal }
        return TileTint.gray
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
                    HeroHeader(
                        visual: .symbol(AdminAuditVisual.symbol(entry.action), tint: AdminAuditVisual.tint(entry.action)),
                        title: entry.action,
                        subtitle: DisplayFormat.dateTime(entry.createdAt)
                    )
                }
                Section {
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
                .textSelection(.enabled)

                if let user = entry.userId {
                    Section {
                        DetailRow(title: String(localized: "admin.audit.user", defaultValue: "Пользователь"), value: user, symbol: "person")
                            .textSelection(.enabled)
                        Button {
                            dismiss()
                            AdminNav.push(.admin(.user(id: user)))
                        } label: {
                            IconRow(title: String(localized: "admin.complaint.openUser", defaultValue: "Карточка пользователя"), symbol: "person.crop.rectangle", tint: TileTint.indigo)
                        }
                        .buttonStyle(.plain)
                    }
                }

                if let metadata = entry.metadata, metadata.object?.isEmpty == false {
                    JSONDetailsSection(
                        title: String(localized: "admin.audit.metadata", defaultValue: "Подробности"),
                        value: metadata
                    )
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.compact)
            .navigationTitle(Text(String(localized: "admin.audit.entryTitle", defaultValue: "Запись журнала")))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
        }
    }
}

import SwiftUI

/// Вкладка «Разделы»: всё меню роли из веба, по тем же группам, с поиском. Последняя
/// группа — «Аккаунт»: профиль, уведомления, документы, настройки.
struct WorkspaceView: View {
    let role: Role

    @State private var query = ""

    var body: some View {
        List {
            ForEach(visibleGroups) { group in
                Section {
                    ForEach(group.items) { item in
                        NavigationLink(value: item.route) {
                            IconRow(title: item.title, symbol: item.symbol, tint: item.tint, subtitle: query.isEmpty ? item.hint : nil)
                        }
                    }
                } header: {
                    Text(group.title)
                }
            }
            if visibleGroups.isEmpty {
                EmptyStateView(
                    title: String(localized: "services.notFound", defaultValue: "Ничего не нашлось"),
                    symbol: "magnifyingglass",
                    hint: String(localized: "services.notFound.hint", defaultValue: "Попробуйте другое слово")
                )
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(AppTab.workspace.title))
        .searchable(text: $query, prompt: Text(String(localized: "workspace.search", defaultValue: "Поиск раздела")))
    }

    private var visibleGroups: [WorkspaceGroup] {
        let groups = Workspace.groups(for: role) + [Workspace.accountGroup(for: role)]
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return groups.filter { !$0.items.isEmpty } }
        return groups.compactMap { group in
            let items = group.items.filter {
                $0.title.lowercased().contains(needle) || ($0.hint?.lowercased().contains(needle) ?? false)
            }
            return items.isEmpty ? nil : WorkspaceGroup(title: group.title, items: items)
        }
    }
}

import SwiftUI

/// Вкладка «Разделы»: всё меню роли из веба, по тем же группам, с поиском. Подача — как
/// «Настройки» Telegram и iOS: группы однострочных пунктов с цветными квадратами.
/// Последняя группа — «Аккаунт»: уведомления, настройки. Профиль — аватаром в панели
/// (`profileToolbarItem`), второй карточкой «я» в списке он не повторяется.
///
/// Пункт меню — `SettingsRow`, та же строка, что в настройках: одна плитка, высота и
/// шеврон на всё приложение.
struct WorkspaceView: View {
    let role: Role

    @State private var query = ""
    /// Включённые вузом модули: пункт выключенного не показываем вовсе.
    @State private var enabledModules: Set<MoreSection> = []

    var body: some View {
        List {
            if isSearching {
                if visibleGroups.isEmpty {
                    EmptyStateView(
                        title: String(localized: "services.notFound", defaultValue: "Ничего не нашлось"),
                        symbol: "magnifyingglass",
                        hint: String(localized: "services.notFound.hint", defaultValue: "Попробуйте другое слово")
                    )
                    .listRowBackground(Color.clear)
                }
            }
            ForEach(visibleGroups) { group in
                Section {
                    ForEach(group.items) { item in
                        NavigationLink(value: item.route) {
                            // Подсказка видна только в поиске: объясняет, почему пункт нашёлся.
                            SettingsRow(title: item.title, symbol: item.symbol, tint: item.tint, subtitle: isSearching ? item.hint : nil)
                        }
                    }
                } header: {
                    Text(group.title)
                }
            }
        }
        .listStyle(.insetGrouped)
        // Поиск и группы — плотно, без полос пустоты между ними.
        .listSectionSpacing(.compact)
        .contentMargins(.top, Spacing.xs, for: .scrollContent)
        .navigationTitle(Text(AppTab.workspace.title))
        .searchable(text: $query, prompt: Text(String(localized: "workspace.search", defaultValue: "Поиск раздела")))
        .task { await loadModules() }
    }

    private var needle: String {
        query.trimmingCharacters(in: .whitespaces)
    }

    private var isSearching: Bool { !needle.isEmpty }

    private var visibleGroups: [WorkspaceGroup] {
        let groups = Workspace.groups(for: role, modules: enabledModules) + [Workspace.accountGroup(for: role)]
        guard isSearching else {
            // Профиль открывается аватаром в панели — строкой в «Аккаунте» он не нужен.
            return groups.compactMap { group in
                let items = group.items.filter { $0.route != .section(.profile) }
                return items.isEmpty ? nil : WorkspaceGroup(title: group.title, items: items)
            }
        }
        return groups.compactMap { group in
            // Без учёта регистра и диакритики, по правилам языка: «е» находит «ё»,
            // казахские буквы сравниваются как казахские.
            let items = group.items.filter {
                $0.title.localizedStandardContains(needle) || ($0.hint?.localizedStandardContains(needle) ?? false)
            }
            return items.isEmpty ? nil : WorkspaceGroup(title: group.title, items: items)
        }
    }

    /// Спрашиваем при каждом показе вкладки: админ вуза включает модуль, когда
    /// захочет, и пункт должен появиться без перезапуска приложения. Отказ сети пункт
    /// не прячет — прошлое знание лучше мигания.
    private func loadModules() async {
        guard MoreSection.modules(for: role).contains(.library) else { return }
        guard let settings = try? await LibraryAPI().settings() else { return }
        if settings.enabled {
            enabledModules.insert(.library)
        } else {
            enabledModules.remove(.library)
        }
    }
}

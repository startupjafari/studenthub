import SwiftUI

/// Вкладка «Разделы»: всё меню роли из веба, по тем же группам, с поиском. Подача — как
/// «Настройки» Telegram и iOS: сверху карточка «я», ниже группы однострочных пунктов с
/// цветными квадратами. Последняя группа — «Аккаунт»: уведомления, документы, настройки.
struct WorkspaceView: View {
    let role: Role

    @State private var query = ""

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
            } else {
                Section {
                    WorkspaceProfileRow(role: role)
                }
            }
            ForEach(visibleGroups) { group in
                Section {
                    ForEach(group.items) { item in
                        NavigationLink(value: item.route) {
                            // Подсказка видна только в поиске: объясняет, почему пункт нашёлся.
                            IconRow(title: item.title, symbol: item.symbol, tint: item.tint, subtitle: isSearching ? item.hint : nil)
                        }
                    }
                } header: {
                    Text(group.title)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(AppTab.workspace.title))
        .searchable(text: $query, prompt: Text(String(localized: "workspace.search", defaultValue: "Поиск раздела")))
    }

    private var needle: String {
        query.trimmingCharacters(in: .whitespaces).lowercased()
    }

    private var isSearching: Bool { !needle.isEmpty }

    private var visibleGroups: [WorkspaceGroup] {
        let groups = Workspace.groups(for: role) + [Workspace.accountGroup(for: role)]
        guard isSearching else {
            // Профиль уже открыт карточкой сверху — второй строкой в «Аккаунте» он не нужен.
            return groups.compactMap { group in
                let items = group.items.filter { $0.route != .section(.profile) }
                return items.isEmpty ? nil : WorkspaceGroup(title: group.title, items: items)
            }
        }
        return groups.compactMap { group in
            let items = group.items.filter {
                $0.title.lowercased().contains(needle) || ($0.hint?.lowercased().contains(needle) ?? false)
            }
            return items.isEmpty ? nil : WorkspaceGroup(title: group.title, items: items)
        }
    }
}

/// Карточка «я» над списком разделов — как верхняя строка «Настроек»: аватар, имя, кто
/// я и где. Ведёт в профиль; общая для «Разделов» и «Сервисов».
struct WorkspaceProfileRow: View {
    let role: Role

    @Environment(ViewerProfileModel.self) private var viewer
    @ScaledMetric(relativeTo: .title) private var avatarSize: CGFloat = 60

    var body: some View {
        NavigationLink(value: AppRoute.section(.profile)) {
            HStack(spacing: Spacing.lg) {
                AvatarView(url: viewer.profile?.avatarUrl, name: viewer.profile?.name, size: min(avatarSize, 84))
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(2)
                    if !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(2)
                    }
                }
            }
            .padding(.vertical, Spacing.xs)
            .accessibilityElement(children: .combine)
        }
        .accessibilityIdentifier("workspace.profile")
    }

    private var name: String {
        let value = viewer.profile?.name.trimmingCharacters(in: .whitespaces) ?? ""
        return value.isEmpty ? String(localized: "more.profile", defaultValue: "Профиль") : value
    }

    /// «Студент · ИС-21» или «Преподаватель · Кафедра ИТ»: роль и то, что ближе всего к
    /// человеку, — группа, должность или вуз.
    private var subtitle: String {
        let profile = viewer.profile
        let place = [profile?.groupName, profile?.position, profile?.facultyName, profile?.universityName]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
        return [role.profileTitle, place].compactMap { $0 }.joined(separator: " · ")
    }
}

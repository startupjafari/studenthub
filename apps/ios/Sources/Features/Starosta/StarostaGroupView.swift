import SwiftUI

/// Своя группа старосты: все участники с ролями, отбор «только студенты» (это и есть
/// «Одногруппники» веба), поиск, переход в профиль.
struct StarostaGroupView: View {
    @Environment(ViewerProfileModel.self) private var viewer

    @State private var members: [GroupMemberDTO]?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var role: String?
    @State private var query = ""

    var body: some View {
        List {
            if !hasNoGroup, let members {
                if let failure {
                    StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if query.isEmpty {
                    Section {
                        HeroHeader(
                            visual: HeroVisual.symbol("person.3.fill", tint: TileTint.teal),
                            title: viewer.profile?.groupName ?? StarostaScreen.myGroup.title,
                            subtitle: Self.membersText(members.count),
                            actions: heroActions
                        )
                    }
                }
                FilterChipsRow(
                    options: [
                        (nil, String(localized: "starosta.group.all", defaultValue: "Все")),
                        (Role.student.rawValue, String(localized: "starosta.group.students", defaultValue: "Одногруппники")),
                    ],
                    selection: $role
                )
                let visible = filtered(members)
                if visible.isEmpty {
                    // Пусто под шапкой группы — строкой; при поиске шапки нет, и пустой
                    // результат встаёт по центру экрана (`screenState` ниже).
                    if query.isEmpty {
                        emptyMembers
                            .listRowBackground(Color.clear)
                    }
                } else {
                    Section {
                        ForEach(visible) { member in
                            NavigationLink(value: AppRoute.profile(id: member.id)) {
                                HStack(spacing: Spacing.md) {
                                    PersonRow(
                                        name: member.name,
                                        subtitle: member.role == Role.starosta.rawValue ? nil : roleTitle(member.role),
                                        avatarURL: member.avatarUrl,
                                        size: 44
                                    )
                                    if member.role == Role.starosta.rawValue {
                                        StatusBadge(text: String(localized: "starosta.role.starosta", defaultValue: "Староста"), tint: Palette.primary)
                                    }
                                }
                            }
                        }
                    } footer: {
                        Text(String(localized: "starosta.group.count", defaultValue: "Всего: \(visible.count.formatted())"))
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(hasNoGroup || members.map { !query.isEmpty && filtered($0).isEmpty } ?? true) {
            if hasNoGroup {
                EmptyStateView(
                    title: String(localized: "starosta.group.none", defaultValue: "Вы не привязаны к группе"),
                    symbol: "person.3"
                )
            } else if members != nil {
                emptyMembers
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(StarostaScreen.myGroup.title))
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text(String(localized: "starosta.group.search", defaultValue: "Найти по имени"))
        )
        .refreshable { await load() }
        .task(id: viewer.profile?.groupId) { await load() }
    }

    private var hasNoGroup: Bool {
        viewer.profile != nil && viewer.profile?.groupId == nil
    }

    private var emptyMembers: EmptyStateView {
        EmptyStateView(
            title: String(localized: "starosta.group.empty", defaultValue: "Участников нет"),
            symbol: "person.3"
        )
    }

    private static func membersText(_ count: Int) -> String {
        String(localized: "starosta.group.membersCount", defaultValue: "Участников: \(count.formatted())")
    }

    private var heroActions: [HeroAction] {
        let documents = HeroAction(title: String(localized: "starosta.group.documents", defaultValue: "Документы"), symbol: "tray.full.fill") {
            starostaPush(.starosta(.groupDocuments))
        }
        let invites = HeroAction(title: StarostaScreen.invites.title, symbol: "paperplane.fill") {
            starostaPush(.starosta(.invites))
        }
        return [documents, invites]
    }

    private func filtered(_ members: [GroupMemberDTO]) -> [GroupMemberDTO] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return members
            .filter { role == nil || $0.role == role }
            .filter { needle.isEmpty || $0.name.lowercased().contains(needle) }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    private func roleTitle(_ raw: String?) -> String? {
        switch raw {
        case Role.starosta.rawValue: return String(localized: "starosta.role.starosta", defaultValue: "Староста")
        case Role.student.rawValue: return String(localized: "starosta.role.student", defaultValue: "Студент")
        case Role.teacher.rawValue: return String(localized: "starosta.role.teacher", defaultValue: "Преподаватель")
        default: return raw
        }
    }

    @MainActor
    private func load() async {
        if viewer.profile == nil {
            // Профиль читаем сами, а не через `viewer.refresh()`: тот глушит ошибку, и без
            // профиля экран навсегда остался бы на крутилке.
            do {
                let profile = try await FeedAPI().me()
                viewer.adopt(profile)
            } catch is CancellationError {
                return
            } catch {
                failure = error.userMessage
                isOffline = error.isOffline
                return
            }
        }
        guard let groupID = viewer.profile?.groupId else { return }
        do {
            members = try await CoursesAPI().members(groupID: groupID)
            failure = nil
            isOffline = false
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

/// Открыть маршрут в стеке текущей вкладки — для круглых кнопок шапки.
@MainActor
private func starostaPush(_ route: AppRoute) {
    let router = AppServices.router
    router.stacks[router.selectedTab, default: []].append(route)
}

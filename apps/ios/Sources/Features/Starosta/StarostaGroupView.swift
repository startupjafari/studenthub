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
            if viewer.profile != nil, viewer.profile?.groupId == nil {
                EmptyStateView(
                    title: String(localized: "starosta.group.none", defaultValue: "Вы не привязаны к группе"),
                    symbol: "person.3"
                )
                .listRowBackground(Color.clear)
            } else if let members {
                FilterChipsRow(
                    options: [
                        (nil, String(localized: "starosta.group.all", defaultValue: "Все")),
                        (Role.student.rawValue, String(localized: "starosta.group.students", defaultValue: "Одногруппники")),
                    ],
                    selection: $role
                )
                let visible = filtered(members)
                if visible.isEmpty {
                    EmptyStateView(
                        title: String(localized: "starosta.group.empty", defaultValue: "Участников нет"),
                        symbol: "person.3"
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(visible) { member in
                            NavigationLink(value: AppRoute.profile(id: member.id)) {
                                PersonRow(
                                    name: member.name,
                                    subtitle: roleTitle(member.role),
                                    avatarURL: member.avatarUrl,
                                    size: 36
                                )
                            }
                        }
                    } header: {
                        if let group = viewer.profile?.groupName, !group.isEmpty { Text(group) }
                    } footer: {
                        Text(String(localized: "starosta.group.count", defaultValue: "Всего: \(visible.count.formatted())"))
                    }
                    .listRowBackground(Palette.card)
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(StarostaScreen.myGroup.title))
        .searchable(text: $query, prompt: Text(String(localized: "starosta.group.search", defaultValue: "Найти по имени")))
        .refreshable { await load() }
        .task(id: viewer.profile?.groupId) { await load() }
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
        if viewer.profile == nil { await viewer.refresh() }
        guard let groupID = viewer.profile?.groupId else { return }
        do {
            members = try await CoursesAPI().members(groupID: groupID)
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

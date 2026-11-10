import SwiftUI

/// Друзья: список, входящие и исходящие заявки, поиск людей, чтобы добавить.
///
/// Сервер отдаёт только свой список (`GET /friends` без `userId`), поэтому чужой
/// профиль показывает число друзей, а список — только свой.
struct CommunityFriendsView: View {
    let userID: String?

    @Environment(\.viewerID) private var viewerID
    @State private var tab: Tab = .friends
    @State private var friends = PagedLoader<CommunityFriendDTO> { try await CommunityAPI().friends(cursor: $0.cursor) }
    @State private var incoming = PagedLoader<CommunityFriendDTO> {
        try await CommunityAPI().friendRequests(direction: "incoming", cursor: $0.cursor)
    }
    @State private var outgoing = PagedLoader<CommunityFriendDTO> {
        try await CommunityAPI().friendRequests(direction: "outgoing", cursor: $0.cursor)
    }
    @State private var counts: CommunityFriendCountsDTO?
    @State private var query = ""
    @State private var found: [SearchResultsDTO.Person] = []
    @State private var isSearching = false
    /// Поиск не удался — не «Никого не нашли».
    @State private var searchFailure: String?
    @State private var searchOffline = false
    @State private var requested: Set<String> = []
    @State private var removing: CommunityFriendDTO?
    @State private var failure: String?

    private let api = CommunityAPI()

    enum Tab: Hashable {
        case friends, incoming, outgoing
    }

    var body: some View {
        Group {
            if isForeign {
                EmptyStateView(
                    title: String(localized: "community.friends.foreign", defaultValue: "Список друзей виден только владельцу"),
                    symbol: "person.2",
                    hint: String(localized: "community.friends.foreign.hint", defaultValue: "Число друзей показано в профиле человека")
                )
            } else if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                searchResults
            } else {
                PagedList(loader: loader, empty: emptyState) {
                    FilterChipsRow(
                        options: [
                            (value: Tab.friends, title: String(localized: "community.friends.all", defaultValue: "Друзья")),
                            (value: Tab.incoming, title: incomingTitle),
                            (value: Tab.outgoing, title: String(localized: "community.friends.outgoing", defaultValue: "Отправленные")),
                        ],
                        selection: Binding(get: { tab }, set: { if let next = $0 { tab = next } })
                    )
                } row: { item in
                    row(item)
                }
                .id(tab)
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(CommunityScreen.friends(userID: nil).title))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text(String(localized: "community.friends.search", defaultValue: "Найти людей"))
        )
        .task(id: query) { await search() }
        .task { counts = try? await api.friendCounts() }
        .confirmDestructive(
            $removing,
            title: { String(localized: "community.friends.remove.title", defaultValue: "Убрать \($0.user.name) из друзей?") },
            actionTitle: String(localized: "community.friends.remove", defaultValue: "Убрать из друзей")
        ) { item in
            await perform(item, in: friends) { try await api.removeFriendship(id: item.friendshipId) }
        }
        .actionFailureAlert($failure)
    }

    private var isForeign: Bool { userID != nil && userID != viewerID && !viewerID.isEmpty }

    private var loader: PagedLoader<CommunityFriendDTO> {
        switch tab {
        case .friends: return friends
        case .incoming: return incoming
        case .outgoing: return outgoing
        }
    }

    private var incomingTitle: String {
        let base = String(localized: "community.friends.incoming", defaultValue: "Заявки")
        guard let count = counts?.incomingRequests, count > 0 else { return base }
        return "\(base) \(count)"
    }

    private var emptyState: EmptyStateView {
        switch tab {
        case .friends:
            return EmptyStateView(
                title: String(localized: "community.friends.empty", defaultValue: "Друзей пока нет"),
                symbol: "person.2",
                hint: String(localized: "community.friends.empty.hint", defaultValue: "Найдите однокурсников поиском и отправьте заявку")
            )
        case .incoming:
            return EmptyStateView(
                title: String(localized: "community.friends.noIncoming", defaultValue: "Новых заявок нет"),
                symbol: "person.crop.circle.badge.plus"
            )
        case .outgoing:
            return EmptyStateView(
                title: String(localized: "community.friends.noOutgoing", defaultValue: "Вы никому не отправляли заявок"),
                symbol: "paperplane"
            )
        }
    }

    @ViewBuilder
    private func row(_ item: CommunityFriendDTO) -> some View {
        HStack(spacing: Spacing.md) {
            NavigationLink(value: AppRoute.profile(id: item.user.id)) {
                PersonRow(
                    name: item.user.name,
                    subtitle: item.user.headline ?? item.user.role.flatMap(Role.init(rawValue:))?.profileTitle,
                    avatarURL: item.user.avatar,
                    size: 44
                )
            }
            // Входящие заявки решаются прямо в строке, как в Telegram, — свайп остаётся
            // для тех, кто привык к нему.
            if tab == .incoming {
                Button {
                    Task { await perform(item, in: incoming) { try await api.removeFriendship(id: item.friendshipId) } }
                } label: {
                    Image(systemName: "xmark")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.mutedForeground)
                        .frame(width: ControlHeight.md, height: ControlHeight.md)
                        .background(Palette.muted, in: Circle())
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(Text(String(localized: "friends.decline", defaultValue: "Отклонить")))
                Button {
                    Task {
                        await perform(item, in: incoming) { try await api.acceptFriendship(id: item.friendshipId) }
                        await friends.reload()
                    }
                } label: {
                    Image(systemName: "checkmark")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.primaryForeground)
                        .frame(width: ControlHeight.md, height: ControlHeight.md)
                        .background(Palette.primary, in: Circle())
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(Text(String(localized: "friends.accept", defaultValue: "Принять")))
            }
        }
        .swipeActions {
            switch tab {
            case .friends:
                Button(role: .destructive) {
                    removing = item
                } label: {
                    Label(String(localized: "community.friends.remove", defaultValue: "Убрать из друзей"), systemImage: "person.badge.minus")
                }
            case .incoming:
                Button {
                    Task {
                        await perform(item, in: incoming) { try await api.acceptFriendship(id: item.friendshipId) }
                        await friends.reload()
                    }
                } label: {
                    Label(String(localized: "friends.accept", defaultValue: "Принять"), systemImage: "checkmark")
                }
                .tint(Palette.success)
                Button(role: .destructive) {
                    Task { await perform(item, in: incoming) { try await api.removeFriendship(id: item.friendshipId) } }
                } label: {
                    Label(String(localized: "friends.decline", defaultValue: "Отклонить"), systemImage: "xmark")
                }
            case .outgoing:
                Button(role: .destructive) {
                    Task { await perform(item, in: outgoing) { try await api.removeFriendship(id: item.friendshipId) } }
                } label: {
                    Label(String(localized: "community.friends.cancelRequest", defaultValue: "Отозвать"), systemImage: "xmark")
                }
            }
        }
        .contextMenu {
            if tab == .incoming {
                Button {
                    Task {
                        await perform(item, in: incoming) { try await api.acceptFriendship(id: item.friendshipId) }
                        await friends.reload()
                    }
                } label: {
                    Label(String(localized: "friends.accept", defaultValue: "Принять"), systemImage: "checkmark")
                }
            }
        }
    }

    private var searchResults: some View {
        List {
            if found.isEmpty, isSearching {
                LoadingStateView().listRowBackground(Color.clear)
            } else if found.isEmpty, let searchFailure {
                ErrorStateView(message: searchFailure, isOffline: searchOffline) { await runSearch() }
                    .listRowBackground(Color.clear)
            } else if found.isEmpty {
                EmptyStateView(
                    title: query.trimmingCharacters(in: .whitespaces).count < 2
                        ? String(localized: "search.hint", defaultValue: "Введите хотя бы две буквы")
                        : String(localized: "search.empty", defaultValue: "Никого не нашли"),
                    symbol: "magnifyingglass"
                )
                .listRowBackground(Color.clear)
            }
            ForEach(found.filter { $0.id != viewerID }) { person in
                HStack(spacing: Spacing.md) {
                    NavigationLink(value: AppRoute.profile(id: person.id)) {
                        PersonRow(name: person.name, subtitle: person.username.map { "@\($0)" }, avatarURL: person.avatarUrl, size: 44)
                    }
                    let isRequested = requested.contains(person.id)
                    Button {
                        Task { await add(person) }
                    } label: {
                        Image(systemName: isRequested ? "checkmark" : "person.badge.plus")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(isRequested ? Palette.mutedForeground : Palette.primaryForeground)
                            .frame(width: ControlHeight.md, height: ControlHeight.md)
                            .background(isRequested ? Palette.muted : Palette.primary, in: Circle())
                    }
                    .buttonStyle(.borderless)
                    .disabled(isRequested)
                    .sensoryFeedback(.success, trigger: isRequested)
                    .accessibilityLabel(Text(isRequested
                        ? String(localized: "profile.friends.pending", defaultValue: "Заявка отправлена")
                        : String(localized: "profile.friends.add", defaultValue: "Добавить")))
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    @MainActor
    private func search() async {
        searchFailure = nil
        guard query.trimmingCharacters(in: .whitespaces).count >= 2 else {
            found = []
            isSearching = false
            return
        }
        isSearching = true
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        await runSearch()
    }

    /// Сам запрос, без паузы — его же зовёт «Повторить». Ответ на устаревший запрос
    /// (человек допечатал) отбрасывается.
    @MainActor
    private func runSearch() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else { return }
        isSearching = true
        do {
            let people = try await FeedAPI().search(trimmed).people
            guard !Task.isCancelled else { return }
            found = people ?? []
            searchFailure = nil
        } catch {
            // Отменил новый ввод — его запрос и решит, что показать. Оборванное соединение
            // без отмены задачи — не повод крутить поиск вечно.
            guard !Task.isCancelled else { return }
            if error is CancellationError {
                isSearching = false
                return
            }
            found = []
            searchFailure = error.userMessage
            searchOffline = error.isOffline
        }
        isSearching = false
    }

    @MainActor
    private func add(_ person: SearchResultsDTO.Person) async {
        do {
            try await api.requestFriendship(userID: person.id)
            requested.insert(person.id)
            await outgoing.reload()
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func perform(_ item: CommunityFriendDTO, in loader: PagedLoader<CommunityFriendDTO>, _ action: () async throws -> Void) async {
        do {
            try await action()
            loader.remove(id: item.id)
            counts = try? await api.friendCounts()
        } catch {
            failure = error.userMessage
        }
    }
}

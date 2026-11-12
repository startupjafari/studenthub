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
    /// Принять, отклонить, отозвать, убрать — строка уходит из списка сразу и
    /// возвращается на место при отказе.
    @State private var rowSync = OptimisticSync<String, Bool>(label: "friends.row")
    /// Заявка из поиска — «отправлена» сразу.
    @State private var requestSync = OptimisticSync<String, Bool>(label: "friends.request")
    /// Принял заявку — тактильный отклик сразу, не по ответу сервера.
    @State private var acceptedTick = 0

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
                        selection: Binding(get: { tab }, set: { if let next = $0 { tab = next } }),
                        fillsWidth: true
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
        // Поле поиска не висит над списком всегда, а выезжает жестом вниз — как на
        // «Разделах»: главное на экране — сами друзья и заявки.
        .searchable(
            text: $query,
            prompt: Text(String(localized: "community.friends.search", defaultValue: "Найти людей"))
        )
        .task(id: query) { await search() }
        .task { counts = try? await api.friendCounts() }
        .confirmDestructive(
            $removing,
            title: { String(localized: "community.friends.remove.title", defaultValue: "Убрать \($0.user.name) из друзей?") },
            actionTitle: String(localized: "community.friends.remove", defaultValue: "Убрать из друзей")
        ) { item in
            await decline(item, in: friends)
        }
        .actionFailureAlert($failure)
        .sensoryFeedback(.success, trigger: acceptedTick)
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
                symbol: "person.crop.circle.badge.plus",
                hint: String(localized: "community.friends.noIncoming.hint", defaultValue: "Здесь появятся люди, которые хотят добавить вас в друзья")
            )
        case .outgoing:
            return EmptyStateView(
                title: String(localized: "community.friends.noOutgoing", defaultValue: "Вы никому не отправляли заявок"),
                symbol: "paperplane",
                hint: String(localized: "community.friends.noOutgoing.hint", defaultValue: "Найдите человека поиском и отправьте ему заявку")
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
                    Task { await decline(item, in: incoming) }
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
                    Task { await accept(item) }
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
                    Task { await accept(item) }
                } label: {
                    Label(String(localized: "friends.accept", defaultValue: "Принять"), systemImage: "checkmark")
                }
                .tint(Palette.success)
                Button(role: .destructive) {
                    Task { await decline(item, in: incoming) }
                } label: {
                    Label(String(localized: "friends.decline", defaultValue: "Отклонить"), systemImage: "xmark")
                }
            case .outgoing:
                Button(role: .destructive) {
                    Task { await decline(item, in: outgoing) }
                } label: {
                    Label(String(localized: "community.friends.cancelRequest", defaultValue: "Отозвать"), systemImage: "xmark")
                }
            }
        }
        .contextMenu {
            if tab == .incoming {
                Button {
                    Task { await accept(item) }
                } label: {
                    Label(String(localized: "friends.accept", defaultValue: "Принять"), systemImage: "checkmark")
                }
            }
        }
    }

    private var searchResults: some View {
        List {
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
        .compactListStyle()
        .screenState(found.isEmpty) {
            if isSearching {
                LoadingStateView()
            } else if let searchFailure {
                ErrorStateView(message: searchFailure, isOffline: searchOffline) { await runSearch() }
            } else {
                EmptyStateView(
                    title: query.trimmingCharacters(in: .whitespaces).count < 2
                        ? String(localized: "search.hint", defaultValue: "Введите хотя бы две буквы")
                        : String(localized: "search.empty", defaultValue: "Никого не нашли"),
                    symbol: "magnifyingglass"
                )
            }
        }
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

    /// Заявка из поиска: значок «отправлена» сразу. 409 — успех, только если заявка или
    /// дружба правда есть на сервере («уже отправлена»); «недавно отклонили» — откат с
    /// причиной.
    @MainActor
    private func add(_ person: SearchResultsDTO.Person) async {
        let settlement = await requestSync.set(
            person.id,
            to: true,
            current: requested.contains(person.id),
            apply: { on in
                if on { requested.insert(person.id) } else { requested.remove(person.id) }
            },
            send: { [api] _, _ in
                do {
                    try await api.requestFriendship(userID: person.id)
                } catch where error.isAlreadyApplied(turningOn: true) {
                    let truth = try await ProfileContentAPI().friendship(with: person.id)
                    guard ["PENDING_OUTGOING", "ACCEPTED"].contains(truth.status) else { throw error }
                }
                return nil
            },
            failed: { error in failure = error.rollbackMessage }
        )
        if settlement == .confirmed { await outgoing.reload() }
    }

    /// Принять входящую: строка уходит из заявок сразу, список друзей перечитывается
    /// после подтверждения.
    @MainActor
    private func accept(_ item: CommunityFriendDTO) async {
        acceptedTick += 1
        let confirmed = await removeRow(item, from: incoming) { [api] in
            do {
                try await api.acceptFriendship(id: item.friendshipId)
            } catch where error.isAlreadyApplied(turningOn: true) {}
        }
        if confirmed { await friends.reload() }
    }

    /// Отклонить входящую, отозвать исходящую, убрать из друзей — одно удаление
    /// дружбы. Уже удалённая (404) — успех.
    @MainActor
    private func decline(_ item: CommunityFriendDTO, in loader: PagedLoader<CommunityFriendDTO>) async {
        await removeRow(item, from: loader) { [api] in
            do {
                try await api.removeFriendship(id: item.friendshipId)
            } catch where error.isAlreadyApplied(turningOn: false) {}
        }
    }

    /// Строка уходит из списка сразу; отказ возвращает её на прежнее место. Счётчики
    /// вкладок — после подтверждения.
    @MainActor
    @discardableResult
    private func removeRow(
        _ item: CommunityFriendDTO,
        from loader: PagedLoader<CommunityFriendDTO>,
        _ action: @escaping @MainActor () async throws -> Void
    ) async -> Bool {
        guard let position = loader.items.firstIndex(where: { $0.id == item.id }) else { return false }
        let settlement = await rowSync.set(
            item.id,
            to: false,
            current: true,
            apply: { listed in
                if listed {
                    loader.insert(item, at: position)
                } else {
                    loader.remove(id: item.id)
                }
            },
            send: { _, _ in
                try await action()
                return nil
            },
            failed: { error in failure = error.rollbackMessage }
        )
        guard settlement == .confirmed else { return false }
        counts = try? await api.friendCounts()
        return true
    }
}

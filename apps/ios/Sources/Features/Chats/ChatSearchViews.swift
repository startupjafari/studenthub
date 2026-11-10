import SwiftUI

/// Результаты поиска в списке чатов: чаты по названию — сразу из базы, люди из
/// справочника вуза и сообщения — запросом после паузы в наборе.
struct ChatSearchResults: View {
    let query: String
    let rows: [ChatListRow]

    @State private var people: [DirectoryUserDTO] = []
    @State private var messages: [ChatMessageDTO] = []
    @State private var isSearching = false
    @State private var opening: String?
    private let api: ChatActing = ChatsAPI()

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    private var chats: [ChatListRow] {
        rows.filter { $0.displayTitle.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        Group {
            if !chats.isEmpty {
                Section(String(localized: "chats.search.chats", defaultValue: "Чаты")) {
                    ForEach(chats) { row in
                        ChatRowView(row: row, isGroup: row.kind != .private && row.kind != .saved)
                            .background {
                                NavigationLink(value: AppRoute.chat(id: row.id)) { EmptyView() }
                                    .opacity(0)
                            }
                            .listRowInsets(ChatListView.rowInsets)
                    }
                }
            }
            if !people.isEmpty {
                Section(String(localized: "search.section.people", defaultValue: "Люди")) {
                    ForEach(people) { person in
                        Button {
                            Task { await openPrivate(with: person.id) }
                        } label: {
                            HStack(spacing: Spacing.lg) {
                                AvatarView(url: person.avatarUrl, name: person.name, size: 40)
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(person.name).foregroundStyle(Palette.foreground)
                                    if let detail = person.group?.name ?? person.role.flatMap(Role.init(rawValue:))?.feedTitle {
                                        Text(detail)
                                            .font(Typography.meta)
                                            .foregroundStyle(Palette.mutedForeground)
                                    }
                                }
                                Spacer()
                                if opening == person.id { ProgressView() }
                            }
                        }
                        .disabled(opening != nil)
                    }
                }
            }
            if !messages.isEmpty {
                Section(String(localized: "chats.search.messages", defaultValue: "Сообщения")) {
                    ForEach(messages, id: \.id) { message in
                        // Чат открывается на найденном сообщении, а не внизу: просьба
                        // прокрутить ставится до перехода, переписка заберёт её при показе.
                        Button {
                            ChatJumpRequests.shared.pending[message.chatId] = message.id
                            AppServices.router.stacks[.chats, default: []].append(.chat(id: message.chatId))
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(rows.first { $0.id == message.chatId }?.displayTitle ?? message.sender?.name ?? "")
                                        .font(Typography.meta.weight(.semibold))
                                        .foregroundStyle(Palette.foreground)
                                        .lineLimit(1)
                                    Spacer()
                                    Text(ChatMoment.short(message.createdAt))
                                        .font(.caption)
                                        .foregroundStyle(Palette.mutedForeground)
                                }
                                Text(message.content)
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                                    .lineLimit(2)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            if chats.isEmpty, people.isEmpty, messages.isEmpty {
                Group {
                    if isSearching {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        ContentUnavailableView.search(text: trimmed)
                    }
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
        }
        .task(id: trimmed) { await search() }
    }

    private func search() async {
        guard trimmed.count >= 2 else {
            people = []
            messages = []
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        isSearching = true
        defer { isSearching = false }
        async let foundPeople = try? api.directory(String(trimmed.prefix(100)))
        async let foundMessages = try? api.searchMessages(String(trimmed.prefix(100)), chatID: nil)
        people = Array((await foundPeople ?? []).prefix(20))
        messages = await foundMessages ?? []
    }

    /// Личный чат не дублируется: сервер вернёт уже существующий.
    private func openPrivate(with userID: String) async {
        opening = userID
        defer { opening = nil }
        guard let id = try? await api.createPrivate(with: userID) else { return }
        if let page = try? await ChatsAPI().chats(cursor: nil, limit: 50) {
            try? await ChatStore().save(chats: page.items)
        }
        AppServices.router.stacks[.chats, default: []].append(.chat(id: id))
    }
}

/// Что создаём из меню «Новый».
enum NewChatKind: String, Identifiable {
    case direct, group
    var id: String { rawValue }
}

/// Новый чат: выбрать человека — личный чат, выбрать нескольких и назвать — группа.
/// Люди — из справочника вуза: писать можно своему вузу и друзьям.
struct NewChatView: View {
    let kind: NewChatKind
    let created: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var people: [DirectoryUserDTO] = []
    @State private var selected: [DirectoryUserDTO] = []
    @State private var title = ""
    @State private var isCreating = false
    @State private var failure: String?
    private let api: ChatActing = ChatsAPI()

    var body: some View {
        NavigationStack {
            List {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                if kind == .group {
                    Section {
                        TextField(String(localized: "chats.group.title", defaultValue: "Название группы"), text: $title)
                    }
                    if !selected.isEmpty {
                        Section(String(localized: "chats.group.members", defaultValue: "Участники")) {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: Spacing.lg) {
                                    ForEach(selected) { person in
                                        VStack(spacing: Spacing.xs) {
                                            AvatarView(url: person.avatarUrl, name: person.name, size: 44)
                                                .overlay(alignment: .topTrailing) {
                                                    Image(systemName: "xmark.circle.fill")
                                                        .foregroundStyle(Palette.mutedForeground)
                                                        .background(Palette.background, in: Circle())
                                                }
                                            Text(person.firstName ?? person.name)
                                                .font(.caption2)
                                                .lineLimit(1)
                                                .frame(width: 56)
                                        }
                                        .onTapGesture { selected.removeAll { $0.id == person.id } }
                                        .accessibilityAddTraits(.isButton)
                                        .accessibilityLabel(Text(person.name))
                                    }
                                }
                            }
                        }
                    }
                }
                Section {
                    ForEach(people) { person in
                        Button {
                            pick(person)
                        } label: {
                            HStack(spacing: Spacing.lg) {
                                AvatarView(url: person.avatarUrl, name: person.name, size: 40)
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(person.name).foregroundStyle(Palette.foreground)
                                    if let group = person.group?.name {
                                        Text(group).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                                    }
                                }
                                Spacer()
                                if kind == .group {
                                    Image(systemName: isSelected(person) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(isSelected(person) ? Palette.primary : Palette.mutedForeground)
                                }
                            }
                        }
                        .disabled(isCreating)
                    }
                }
            }
            .overlay {
                if people.isEmpty {
                    ContentUnavailableView(
                        String(localized: "search.hint", defaultValue: "Введите хотя бы две буквы"),
                        systemImage: "person.crop.circle.badge.plus"
                    )
                }
            }
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(String(localized: "search.people", defaultValue: "Имя или логин"))
            )
            .navigationTitle(Text(kind == .group
                ? String(localized: "chats.newGroup", defaultValue: "Новая группа")
                : String(localized: "chats.new", defaultValue: "Новый чат")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                if kind == .group {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "chats.group.create", defaultValue: "Создать")) {
                            Task { await createGroup() }
                        }
                        .disabled(isCreating || selected.isEmpty || title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .task(id: query) { await search() }
        }
    }

    private func isSelected(_ person: DirectoryUserDTO) -> Bool {
        selected.contains { $0.id == person.id }
    }

    private func pick(_ person: DirectoryUserDTO) {
        if kind == .direct {
            Task { await createPrivate(with: person.id) }
        } else if isSelected(person) {
            selected.removeAll { $0.id == person.id }
        } else if selected.count < 100 {
            selected.append(person)
        }
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            people = []
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        people = (try? await api.directory(String(trimmed.prefix(100)))) ?? []
    }

    private func createPrivate(with userID: String) async {
        isCreating = true
        defer { isCreating = false }
        do {
            created(try await api.createPrivate(with: userID))
        } catch {
            failure = (error as? APIError)?.displayMessage
        }
    }

    private func createGroup() async {
        isCreating = true
        defer { isCreating = false }
        do {
            let name = String(title.trimmingCharacters(in: .whitespaces).prefix(150))
            created(try await api.createGroup(title: name, memberIDs: selected.map(\.id)))
        } catch {
            failure = (error as? APIError)?.displayMessage
        }
    }
}

import GRDB
import SwiftUI
import UIKit

/// Результаты поиска в списке чатов: чаты по названию — сразу из базы, люди из
/// справочника вуза и сообщения — запросом после паузы в наборе.
///
/// Заголовки разделов — обычные строки, а не `Section(header:)`: в простом списке
/// заголовок секции прилипает к верху, а на iOS 26 он без подложки — при прокрутке
/// «Сообщения» висели прозрачной надписью поверх строк.
struct ChatSearchResults: View {
    let query: String
    let rows: [ChatListRow]

    @State private var people: [DirectoryUserDTO] = []
    @State private var messages: [ChatMessageDTO] = []
    /// Чаты найденных сообщений — из базы: сервер отдаёт только `chatId`, а строке
    /// нужны название, вид и аватар чата.
    @State private var messageChats: [String: ChatRecord] = [:]
    @State private var isSearching = false
    /// Люди или сообщения не пришли: без этого сбой выглядел бы как «нет результатов».
    @State private var failure: String?
    @State private var isOffline = false
    @State private var opening: String?
    private let api: ChatActing = ChatsAPI()

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    private var chats: [ChatListRow] {
        rows.filter { $0.displayTitle.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        Group {
            // Что-то нашлось (хотя бы чаты из базы) — сбой сети полосой над найденным.
            if let failure, !chats.isEmpty || !people.isEmpty || !messages.isEmpty {
                StaleDataBanner(message: failure, isOffline: isOffline) { await search() }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
            }
            if !chats.isEmpty {
                ChatSearchSectionTitle(title: String(localized: "chats.search.chats", defaultValue: "Чаты"))
                ForEach(chats) { row in
                    ChatRowView(row: row, isGroup: row.kind != .private && row.kind != .saved)
                        .background {
                            NavigationLink(value: AppRoute.chat(id: row.id)) { EmptyView() }
                                .opacity(0)
                        }
                        .listRowInsets(ChatListView.rowInsets)
                }
            }
            if !people.isEmpty {
                ChatSearchSectionTitle(title: String(localized: "search.section.people", defaultValue: "Люди"))
                ForEach(people) { person in
                    Button {
                        Task { await openPrivate(with: person.id) }
                    } label: {
                        HStack(spacing: Spacing.lg) {
                            AvatarView(url: person.avatarUrl, name: person.name, size: 40)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(person.name).foregroundStyle(Palette.foreground)
                                if let detail = person.groupTitle ?? person.role.flatMap(Role.init(rawValue:))?.feedTitle {
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
            if !messages.isEmpty {
                ChatSearchSectionTitle(title: String(localized: "chats.search.messages", defaultValue: "Сообщения"))
                ForEach(messages, id: \.id) { message in
                    // Чат открывается на найденном сообщении, а не внизу: просьба
                    // прокрутить ставится до перехода, переписка заберёт её при показе.
                    Button {
                        ChatJumpRequests.shared.pending[message.chatId] = message.id
                        AppServices.router.stacks[.chats, default: []].append(.chat(id: message.chatId))
                    } label: {
                        ChatSearchMessageRow(message: message, chat: messageChats[message.chatId], query: trimmed)
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(ChatListView.rowInsets)
                }
            }
            if chats.isEmpty, people.isEmpty, messages.isEmpty {
                Group {
                    if isSearching {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if let failure {
                        ErrorStateView(message: failure, isOffline: isOffline) { await search() }
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
            failure = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        isSearching = true
        defer { isSearching = false }
        let text = String(trimmed.prefix(100))
        async let foundPeople = chatSearchOutcome { try await api.directory(text) }
        async let foundMessages = chatSearchOutcome { try await api.searchMessages(text, chatID: nil) }
        let peopleOutcome = await foundPeople
        let messagesOutcome = await foundMessages
        guard !Task.isCancelled else { return }
        // Результаты прошлого запроса к новому не относятся: при сбое — пусто и ошибка.
        var lastError: Error?
        switch peopleOutcome {
        case .success(let list):
            people = Array(list.prefix(20))
        case .failure(let error):
            people = []
            lastError = error
        }
        switch messagesOutcome {
        case .success(let list):
            // Чаты — до показа строк: иначе строка мелькнула бы без названия и аватара.
            let found = await Self.chats(of: list)
            guard !Task.isCancelled else { return }
            messageChats = found
            messages = list
        case .failure(let error):
            messages = []
            lastError = error
        }
        failure = lastError?.userMessage
        isOffline = lastError?.isOffline ?? false
    }

    private func openPrivate(with userID: String) async {
        opening = userID
        defer { opening = nil }
        try? await PrivateChatOpener.open(with: userID, api: api)
    }

    /// Чаты найденных сообщений из базы — и архивные, и не из открытой вкладки.
    private static func chats(of messages: [ChatMessageDTO]) async -> [String: ChatRecord] {
        let ids = Array(Set(messages.map(\.chatId)))
        guard !ids.isEmpty else { return [:] }
        let records = (try? await AppServices.database.reader.read { db in
            try ChatRecord.fetchAll(db, keys: ids)
        }) ?? []
        return Dictionary(records.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }
}

/// Заголовок раздела результатов: строкой списка, на полосе цвета фона, — уезжает
/// вместе со строками и не ложится поверх них.
private struct ChatSearchSectionTitle: View {
    let title: String

    var body: some View {
        Text(title)
            .font(Typography.meta.weight(.semibold))
            .foregroundStyle(Palette.mutedForeground)
            .textCase(.uppercase)
            .frame(maxWidth: .infinity, alignment: .leading)
            .listRowInsets(EdgeInsets(top: Spacing.sm, leading: Spacing.lg, bottom: Spacing.sm, trailing: Spacing.lg))
            .listRowBackground(Palette.background)
            .listRowSeparator(.hidden)
            .selectionDisabled()
            .accessibilityAddTraits(.isHeader)
    }
}

/// Найденное сообщение как в Telegram: аватар и название чата (в группе — ещё и кто
/// написал), справа дата, ниже — текст с подсвеченным запросом. Без этого строки из
/// разных чатов было не различить: виден был только автор.
private struct ChatSearchMessageRow: View {
    let message: ChatMessageDTO
    /// Чата нет в базе (ещё не догрузился список) — подписываем автором.
    let chat: ChatRecord?
    let query: String

    @Environment(\.viewerID) private var viewerID
    @ScaledMetric(relativeTo: .body) private var avatarSize: CGFloat = 58

    private var isGroup: Bool {
        guard let chat else { return false }
        return chat.kind != .private && chat.kind != .saved
    }

    private var chatTitle: String {
        guard let chat else {
            let name = message.sender?.name ?? ""
            return name.isEmpty ? String(localized: "shell.chat", defaultValue: "Чат") : name
        }
        if chat.kind == .saved { return String(localized: "chats.saved", defaultValue: "Избранное") }
        if let title = chat.title, !title.isEmpty { return title }
        return ChatTitle.fallback(for: chat)
    }

    /// Автор в группе — «Вы» или имя без фамилии, как в превью списка.
    private var senderName: String? {
        guard isGroup else { return nil }
        if message.senderId == viewerID { return String(localized: "chats.you", defaultValue: "Вы") }
        guard let sender = message.sender else { return nil }
        let first = sender.firstName?.trimmingCharacters(in: .whitespaces) ?? ""
        if !first.isEmpty { return first }
        return sender.name.isEmpty ? nil : sender.name
    }

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.lg) {
            ChatAvatarView(
                title: chatTitle,
                kind: chat?.kind ?? .private,
                avatarURL: chat == nil ? message.sender?.avatarUrl : chat?.avatarUrl,
                size: min(avatarSize, 84)
            )

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
                    title
                        .lineLimit(1)
                    Spacer(minLength: Spacing.md)
                    Text(ChatMoment.short(message.createdAt))
                        .font(Typography.tabular(.subheadline))
                        .foregroundStyle(Palette.mutedForeground)
                }
                Text(ChatSearchHighlight.snippet(message.content, query: query))
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2, reservesSpace: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
        }
        .padding(.vertical, Spacing.sm)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// «Чат · Отправитель»: название чата важнее — автор сокращается первым.
    private var title: Text {
        let name = Text(chatTitle)
            .font(.body.weight(.semibold))
            .foregroundStyle(Palette.foreground)
        guard let senderName else { return name }
        return name + Text(verbatim: " · \(senderName)")
            .font(.body)
            .foregroundStyle(Palette.mutedForeground)
    }
}

/// Текст найденного сообщения с подсвеченным запросом. Совпадение далеко от начала —
/// текст начинается чуть раньше него с «…», иначе в две строки оно бы не попало.
enum ChatSearchHighlight {
    /// Сколько знаков оставить перед первым совпадением.
    private static let lead = 24

    static func snippet(_ text: String, query: String) -> AttributedString {
        let flat = text.replacingOccurrences(of: "\n", with: " ")
        let needle = query.trimmingCharacters(in: .whitespaces)
        let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]
        guard !needle.isEmpty, let first = flat.range(of: needle, options: options) else {
            return AttributedString(flat)
        }
        var start = flat.startIndex
        var result = AttributedString()
        if flat.distance(from: flat.startIndex, to: first.lowerBound) > lead {
            start = flat.index(first.lowerBound, offsetBy: -lead)
            // Слово не рвём: начинаем со следующего за пробелом.
            if let space = flat[start..<first.lowerBound].firstIndex(of: " ") {
                start = flat.index(after: space)
            }
            result += AttributedString("…")
        }
        var cursor = start
        while cursor < flat.endIndex,
              let hit = flat.range(of: needle, options: options, range: cursor..<flat.endIndex),
              !hit.isEmpty {
            result += AttributedString(String(flat[cursor..<hit.lowerBound]))
            var match = AttributedString(String(flat[hit]))
            match.foregroundColor = Palette.foreground
            match.font = Font.subheadline.weight(.semibold)
            result += match
            cursor = hit.upperBound
        }
        result += AttributedString(String(flat[cursor...]))
        return result
    }
}

/// «Написать» человеку — из поиска и из меню участника группы.
enum PrivateChatOpener {
    /// Личный чат не дублируется: сервер вернёт уже существующий. Первая страница списка —
    /// в базу до перехода, чтобы переписка открылась с шапкой, а не пустой.
    @MainActor
    static func open(with userID: String, api: ChatActing) async throws {
        let id = try await api.createPrivate(with: userID)
        if let page = try? await ChatsAPI().chats(cursor: nil, limit: 50) {
            try? await ChatStore().save(chats: page.items)
        }
        AppServices.router.stacks[.chats, default: []].append(.chat(id: id))
    }
}

/// Ответ вместе с ошибкой: два поиска идут параллельно, и сбой одного не теряется.
private func chatSearchOutcome<T>(_ body: () async throws -> T) async -> Result<T, Error> {
    do {
        return .success(try await body())
    } catch {
        return .failure(error)
    }
}

/// Что создаём из меню «Новый».
enum NewChatKind: String, Identifiable {
    case direct, group
    var id: String { rawValue }
}

/// Новый чат: выбрать человека — личный чат, выбрать нескольких и назвать — группа.
/// Люди — из справочника вуза: писать можно своему вузу и друзьям.
///
/// Группа — в два шага, как в Telegram: сначала участники (поиск сверху), «Далее» —
/// название. На одном экране системный поиск вставал над полем названия, и порядок
/// читался задом наперёд.
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
    /// Второй шаг группы — название.
    @State private var naming = false
    /// Фото будущей группы: загружается после создания — до него чата нет.
    @State private var groupPhoto: UIImage?
    /// Поиск людей: сбой отдельно от ошибки создания — у него свой повтор.
    @State private var isSearching = false
    @State private var searchFailure: String?
    @State private var searchOffline = false
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
                                    if let group = person.groupTitle {
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
                    if query.trimmingCharacters(in: .whitespaces).count < 2 {
                        ContentUnavailableView(
                            String(localized: "search.hint", defaultValue: "Введите хотя бы две буквы"),
                            systemImage: "person.crop.circle.badge.plus"
                        )
                    } else if isSearching {
                        LoadingStateView()
                    } else if let searchFailure {
                        ErrorStateView(message: searchFailure, isOffline: searchOffline) { await search() }
                    } else {
                        EmptyStateView(
                            title: String(localized: "search.empty", defaultValue: "Никого не нашли"),
                            symbol: "person.crop.circle.badge.questionmark"
                        )
                    }
                }
            }
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(String(localized: "search.people", defaultValue: "Имя или логин"))
            )
            .navigationTitle(Text(kind == .group
                ? String(localized: "chats.group.addMembers", defaultValue: "Добавить участников")
                : String(localized: "chats.new", defaultValue: "Новый чат")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                if kind == .group {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "chats.group.next", defaultValue: "Далее")) {
                            naming = true
                        }
                        .disabled(selected.isEmpty)
                    }
                }
            }
            .navigationDestination(isPresented: $naming) { groupDetails }
            .task(id: query) { await search() }
        }
    }

    /// Второй шаг группы: фото и название сверху, ниже — кого добавили.
    private var groupDetails: some View {
        List {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            Section {
                // Без названия: до выбора снимка в круге камера, а не буквы набранного.
                GroupAvatarButton(
                    title: "",
                    avatarURL: nil,
                    image: groupPhoto,
                    removable: groupPhoto != nil,
                    pick: { image in
                        if let image {
                            groupPhoto = image
                        } else {
                            failure = String(localized: "profile.imageUnreadable", defaultValue: "Не удалось прочитать изображение")
                        }
                    },
                    remove: { groupPhoto = nil }
                )
                .disabled(isCreating)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            Section {
                TextField(String(localized: "chats.group.title", defaultValue: "Название группы"), text: $title)
                    .submitLabel(.done)
            }
            Section(String(localized: "chats.group.members", defaultValue: "Участники")) {
                ForEach(selected) { person in
                    PersonRow(name: person.name, subtitle: person.groupTitle, avatarURL: person.avatarUrl)
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .navigationTitle(Text(String(localized: "chats.newGroup", defaultValue: "Новая группа")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if isCreating {
                    ProgressView()
                } else {
                    Button(String(localized: "chats.group.create", defaultValue: "Создать")) {
                        Task { await createGroup() }
                    }
                    .disabled(selected.isEmpty || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
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
            searchFailure = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        isSearching = true
        defer { isSearching = false }
        do {
            people = try await api.directory(String(trimmed.prefix(100)))
            searchFailure = nil
        } catch {
            guard !Task.isCancelled else { return }
            people = []
            searchFailure = error.userMessage
            searchOffline = error.isOffline
        }
    }

    private func createPrivate(with userID: String) async {
        isCreating = true
        defer { isCreating = false }
        do {
            created(try await api.createPrivate(with: userID))
        } catch {
            failure = error.userMessage
        }
    }

    private func createGroup() async {
        isCreating = true
        defer { isCreating = false }
        do {
            let name = String(title.trimmingCharacters(in: .whitespaces).prefix(150))
            let id = try await api.createGroup(title: name, memberIDs: selected.map(\.id))
            // Группа уже есть: сбой фото не повод оставаться на экране — повторное
            // «Создать» завело бы вторую. Фото можно поставить потом в правке группы.
            if let jpeg = await PhotoJPEG.encode(groupPhoto, maxSide: PhotoJPEG.avatarSide) {
                _ = try? await api.uploadGroupAvatar(chatID: id, jpeg: jpeg)
            }
            created(id)
        } catch {
            failure = error.userMessage
        }
    }
}

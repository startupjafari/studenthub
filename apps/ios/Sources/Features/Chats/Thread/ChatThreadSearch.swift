import Observation
import SwiftUI

/// Поиск прямо в переписке, как в Telegram: поле сверху, внизу — «N из M» и стрелки
/// между совпадениями, лента сама переходит к найденному.
///
/// Совпадения идут от свежего к старому, как отдаёт сервер: первое — самое свежее,
/// стрелка «вверх» ведёт к более старому (выше в ленте). Следующая страница дочитывается
/// по курсору, когда стрелка дошла до конца загруженного.
@Observable
final class ChatThreadSearch {
    let chatID: String
    var query = ""
    /// Только сообщения этого участника (в группах).
    var sender: ChatMemberDTO?
    private(set) var results: [ChatMessageDTO] = []
    /// Текущее совпадение в `results`.
    private(set) var index = 0
    private(set) var hasMore = false
    private(set) var isLoading = false
    private(set) var failure: String?
    /// Запрос по текущему тексту уже ответил — можно говорить «ничего не найдено».
    private(set) var isSettled = false

    private var cursor: String?
    /// Номер запроса: ответ на прежний текст не должен лечь поверх нового.
    private var generation = 0
    private let api: ChatActing

    init(chatID: String, api: ChatActing = ChatsAPI()) {
        self.chatID = chatID
        self.api = api
    }

    /// Сервер ищет от двух символов.
    var term: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    var isActive: Bool { term.count >= 2 }

    var current: ChatMessageDTO? {
        results.indices.contains(index) ? results[index] : nil
    }

    var canGoOlder: Bool { index + 1 < results.count || hasMore }
    var canGoNewer: Bool { index > 0 }

    /// Ключ запроса: смена текста или автора — новый поиск.
    var key: Key { Key(term: term, senderID: sender?.id) }

    struct Key: Equatable {
        let term: String
        let senderID: String?
    }

    /// Новый поиск с первой страницы. Возвращает самое свежее совпадение — к нему
    /// лента и переходит, как в вебе.
    @MainActor
    func run() async -> ChatMessageDTO? {
        generation += 1
        let mine = generation
        results = []
        index = 0
        cursor = nil
        hasMore = false
        failure = nil
        isSettled = false
        guard isActive else {
            isLoading = false
            return nil
        }
        isLoading = true
        do {
            let page = try await api.searchInChat(
                String(term.prefix(100)),
                chatID: chatID,
                senderID: sender?.id,
                cursor: nil
            )
            guard mine == generation else { return nil }
            accept(page)
            isLoading = false
            isSettled = true
            return results.first
        } catch {
            guard mine == generation else { return nil }
            isLoading = false
            if !(error is CancellationError) {
                failure = error.userMessage
                isSettled = true
            }
            return nil
        }
    }

    /// К более старому совпадению; в конце загруженного — следующая страница.
    @MainActor
    func older() async -> ChatMessageDTO? {
        if index + 1 >= results.count {
            await loadMore()
        }
        guard index + 1 < results.count else { return nil }
        index += 1
        return current
    }

    /// К более свежему совпадению.
    @MainActor
    func newer() -> ChatMessageDTO? {
        guard index > 0 else { return nil }
        index -= 1
        return current
    }

    /// Выбор строки в списке совпадений.
    @MainActor
    func select(_ position: Int) -> ChatMessageDTO? {
        guard results.indices.contains(position) else { return nil }
        index = position
        return current
    }

    /// Следующая страница совпадений — для стрелки и для конца списка.
    @MainActor
    func loadMore() async {
        guard hasMore, let cursor, !isLoading else { return }
        let mine = generation
        isLoading = true
        defer { if mine == generation { isLoading = false } }
        do {
            let page = try await api.searchInChat(
                String(term.prefix(100)),
                chatID: chatID,
                senderID: sender?.id,
                cursor: cursor
            )
            guard mine == generation else { return }
            accept(page)
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            guard mine == generation else { return }
            failure = error.userMessage
        }
    }

    private func accept(_ page: Page<ChatMessageDTO>) {
        let known = Set(results.map(\.id))
        results += page.items.filter { !known.contains($0.id) }
        cursor = page.meta?.cursor
        hasMore = page.meta?.hasNext == true && cursor != nil
    }
}

// MARK: - Поле поиска

/// Поле поиска на месте шапки переписки: капсула со стеклом и крестик справа. Под
/// полем — выбранный автор, его можно снять.
struct ChatSearchBar: View {
    @Bindable var search: ChatThreadSearch
    let onCancel: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.md) {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(Palette.mutedForeground)
                        .accessibilityHidden(true)
                    TextField(
                        String(localized: "chats.thread.search.prompt", defaultValue: "Поиск в чате"),
                        text: $search.query
                    )
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .focused($isFocused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .onSubmit { isFocused = false }
                    if !search.query.isEmpty {
                        Button {
                            search.query = ""
                            isFocused = true
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "chats.thread.search.clear", defaultValue: "Стереть")))
                    }
                }
                .padding(.horizontal, Spacing.lg)
                .frame(minHeight: ControlHeight.lg)
                .composerGlass(in: Capsule())

                // Как в Telegram: крестик в стеклянном круге, а не слово «Отмена».
                GlassCloseButton(action: onCancel)
            }

            if let sender = search.sender {
                Button {
                    search.sender = nil
                } label: {
                    HStack(spacing: Spacing.xs) {
                        Image(systemName: "person.fill")
                        Text(String(localized: "chats.thread.search.fromName", defaultValue: "От: \(sender.name)"))
                            .lineLimit(1)
                        Image(systemName: "xmark")
                            .font(.caption2.weight(.bold))
                    }
                    .font(Typography.meta)
                    .foregroundStyle(Palette.primary)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.xs)
                    .background(Palette.primary.opacity(0.12), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityHint(Text(String(localized: "chats.thread.search.clearFrom", defaultValue: "Убрать фильтр по автору")))
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.sm)
        .modifier(SearchBarBackground())
        .task {
            // Поле получает фокус после того, как панель встала: сразу клавиатура
            // поднималась бы вместе с перестройкой экрана и дёргала ленту.
            try? await Task.sleep(for: .milliseconds(250))
            isFocused = true
        }
    }
}

/// Подложка поля поиска: на iOS 26 её нет, как и у панели ввода; раньше —
/// непрозрачная полоса с линией снизу.
private struct SearchBarBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content
        } else {
            content
                .background(Palette.plainBackground)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(Palette.border)
                        .frame(height: 1)
                }
        }
    }
}

// MARK: - Нижняя панель

/// Панель режима поиска вместо поля ввода: календарь, автор, список совпадений слева,
/// счётчик и стрелки справа — как в Telegram.
struct ChatSearchPanel: View {
    let search: ChatThreadSearch
    let isGroup: Bool
    let showsList: Bool
    /// Над клавиатурой (панель клавиатуры): без своей подложки и отступов.
    var overKeyboard = false
    let onCalendar: () -> Void
    let onSender: () -> Void
    let onList: () -> Void
    let onOlder: () -> Void
    let onNewer: () -> Void

    var body: some View {
        if overKeyboard {
            controls
        } else {
            GlassGroup(spacing: Spacing.md) {
                controls
                    .padding(.horizontal, Spacing.xl)
                    .padding(.vertical, Spacing.md)
                    .frame(minHeight: ControlHeight.chatInput)
            }
            .modifier(ComposerBarBackground())
        }
    }

    private var controls: some View {
            HStack(spacing: Spacing.md) {
                button(
                    String(localized: "chats.calendar.title", defaultValue: "Перейти к дате"),
                    symbol: "calendar",
                    action: onCalendar
                )
                if isGroup {
                    button(
                        String(localized: "chats.thread.search.from", defaultValue: "От кого"),
                        symbol: search.sender == nil ? "person" : "person.fill",
                        isOn: search.sender != nil,
                        action: onSender
                    )
                }
                button(
                    String(localized: "chats.thread.search.list", defaultValue: "Списком"),
                    symbol: "list.bullet",
                    isOn: showsList,
                    enabled: !search.results.isEmpty,
                    action: onList
                )
                Spacer(minLength: Spacing.sm)
                status
                Spacer(minLength: Spacing.sm)
                button(
                    String(localized: "chats.thread.search.older", defaultValue: "Предыдущее совпадение"),
                    symbol: "chevron.up",
                    enabled: search.canGoOlder,
                    action: onOlder
                )
                button(
                    String(localized: "chats.thread.search.newer", defaultValue: "Следующее совпадение"),
                    symbol: "chevron.down",
                    enabled: search.canGoNewer,
                    action: onNewer
                )
            }
    }

    @ViewBuilder
    private var status: some View {
        if search.isLoading && search.results.isEmpty {
            ProgressView()
        } else if let failure = search.failure, search.results.isEmpty {
            Text(failure)
                .font(Typography.meta)
                .foregroundStyle(Palette.destructive)
                .lineLimit(1)
        } else if search.isActive && search.isSettled && search.results.isEmpty {
            Text(String(localized: "chats.thread.search.nothing", defaultValue: "Ничего не найдено"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(1)
        } else if !search.results.isEmpty {
            Text(position)
                .font(Typography.tabular(.subheadline).weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .lineLimit(1)
                .contentTransition(.numericText())
        }
    }

    /// «3 из 30»; есть ещё страницы — «3 из 30+»: сколько всего, сервер не говорит.
    private var position: String {
        let at = search.index + 1
        let total = search.results.count
        return search.hasMore
            ? String(localized: "chats.thread.search.positionMore", defaultValue: "\(at) из \(total)+")
            : String(localized: "chats.thread.search.position", defaultValue: "\(at) из \(total)")
    }

    private func button(
        _ title: String,
        symbol: String,
        isOn: Bool = false,
        enabled: Bool = true,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(isOn ? Palette.primary : Palette.mutedForeground)
                .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                .composerGlass(in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

// MARK: - Список совпадений

/// Совпадения списком поверх ленты: автор, время и текст с подсвеченным словом.
/// Выбор строки ведёт к сообщению в ленте и закрывает список.
struct ChatSearchResultsList: View {
    let search: ChatThreadSearch
    let viewerID: String
    let onPick: (Int) -> Void

    var body: some View {
        List {
            ForEach(Array(search.results.enumerated()), id: \.element.id) { position, message in
                Button {
                    onPick(position)
                } label: {
                    row(message)
                }
                .listRowBackground(position == search.index ? Palette.primary.opacity(0.1) : Palette.plainBackground)
            }
            if search.hasMore {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
                .listRowBackground(Palette.plainBackground)
                .listRowSeparator(.hidden)
                .task { await search.loadMore() }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Palette.plainBackground)
    }

    private func row(_ message: ChatMessageDTO) -> some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            AvatarView(url: message.sender?.avatarUrl, name: author(message), size: 40)
                .accessibilityHidden(true)
            texts(message)
        }
        .accessibilityElement(children: .combine)
    }

    private func texts(_ message: ChatMessageDTO) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(author(message))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
                Spacer(minLength: Spacing.md)
                Text(ChatMoment.short(message.createdAt))
                    .font(Typography.tabular(.footnote))
                    .foregroundStyle(Palette.mutedForeground)
            }
            Text(highlighted(message.content.isEmpty
                ? String(localized: "chats.attachmentPreview", defaultValue: "Вложение")
                : message.content))
                .font(.subheadline)
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(2)
        }
        .accessibilityElement(children: .combine)
    }

    private func author(_ message: ChatMessageDTO) -> String {
        if message.senderId == viewerID { return String(localized: "chats.you", defaultValue: "Вы") }
        let name = message.sender?.name ?? ""
        return name.isEmpty ? String(localized: "home.someone", defaultValue: "Кто-то") : name
    }

    /// Найденное слово — жирным и подложкой: из двух строк видно, то ли это сообщение.
    private func highlighted(_ text: String) -> AttributedString {
        var result = AttributedString(text)
        SearchHighlight.apply(search.term, to: &result, background: SearchHighlight.incoming, bold: .subheadline.weight(.semibold))
        return result
    }
}

/// Подсветка найденного — в списке совпадений и прямо в пузырях ленты, как в Telegram.
enum SearchHighlight {
    /// Подложка совпадения на светлом (чужом) пузыре и в списке.
    static let incoming = Palette.warning.opacity(0.35)
    /// На своём синем пузыре — светлая подложка: оранжевая на синем читается плохо.
    static let outgoing = Color.white.opacity(0.32)

    /// Все вхождения без учёта регистра и диакритики (ё/е, казахские буквы).
    static func apply(_ term: String, to text: inout AttributedString, background: Color, bold: Font? = nil) {
        guard term.count >= 2 else { return }
        var searchRange = text.startIndex..<text.endIndex
        while let found = text[searchRange].range(of: term, options: [.caseInsensitive, .diacriticInsensitive]) {
            text[found].backgroundColor = background
            if let bold { text[found].font = bold }
            guard found.upperBound < text.endIndex else { break }
            searchRange = found.upperBound..<text.endIndex
        }
    }
}

// MARK: - Автор

/// Выбор автора для поиска в группе: «Все участники» и состав чата с поиском по имени.
struct ChatSearchSenderSheet: View {
    let chatID: String
    let selectedID: String?
    let onPick: (ChatMemberDTO?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var members: [ChatMemberDTO] = []
    @State private var isLoading = true
    @State private var failure: String?
    @State private var isOffline = false
    @State private var query = ""
    private let api: ChatActing = ChatsAPI()

    private var filtered: [ChatMemberDTO] {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return members }
        return members.filter { $0.name.localizedCaseInsensitiveContains(text) }
    }

    var body: some View {
        NavigationStack {
            List {
                if query.isEmpty {
                    Button {
                        pick(nil)
                    } label: {
                        HStack {
                            Label(
                                String(localized: "chats.thread.search.fromAll", defaultValue: "Все участники"),
                                systemImage: "person.2"
                            )
                            .foregroundStyle(Palette.foreground)
                            Spacer()
                            if selectedID == nil { checkmark }
                        }
                    }
                }
                ForEach(filtered) { member in
                    Button {
                        pick(member)
                    } label: {
                        HStack {
                            PersonRow(
                                name: member.name.isEmpty
                                    ? String(localized: "home.someone", defaultValue: "Кто-то")
                                    : member.name,
                                avatarURL: member.avatarUrl
                            )
                            if selectedID == member.id { checkmark }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if members.isEmpty {
                    if isLoading {
                        LoadingStateView()
                    } else if let failure {
                        ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    }
                } else if filtered.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
            }
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(String(localized: "chats.search.prompt.short", defaultValue: "Поиск"))
            )
            .navigationTitle(Text(String(localized: "chats.thread.search.from", defaultValue: "От кого")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    private var checkmark: some View {
        Image(systemName: "checkmark")
            .font(.body.weight(.semibold))
            .foregroundStyle(Palette.primary)
    }

    private func pick(_ member: ChatMemberDTO?) {
        onPick(member)
        dismiss()
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            members = try await api.members(chatID: chatID)
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

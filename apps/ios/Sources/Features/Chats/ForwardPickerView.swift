import GRDB
import SwiftUI

/// Итог пересылки по каждому чату — сервер отвечает за всех сразу, и часть может не
/// пройти (запрос на переписку не принят, участника исключили).
struct ForwardOutcome: Equatable {
    var delivered: [String] = []
    var failed: [String] = []
    /// Ошибка всего запроса (нет сети, сервер упал) — повтор с тем же ключом безопасен.
    var failure: String?

    var isComplete: Bool { failure == nil && failed.isEmpty && !delivered.isEmpty }
}

/// Экран «Переслать» как в Telegram: сверху «Закрыть», заголовок и выбор нескольких,
/// ниже — поиск и папки, список чатов с кружками, внизу — что пересылаем, комментарий и
/// «Отправить».
///
/// Повторное нажатие и сетевой повтор не дублируют сообщения: ключ идемпотентности
/// создаётся один раз на экран и уходит с каждой попыткой (сервер отдаёт прежний ответ).
struct ForwardPickerView: View {
    let messages: [MessageRecord]
    let send: (_ chatIDs: [String], _ comment: String?, _ requestID: UUID) async -> ForwardOutcome

    @Environment(\.dismiss) private var dismiss
    @Environment(\.motionReduced) private var reduceMotion
    @State private var rows: [ChatListRow] = []
    @State private var folders: [ChatFolderDTO] = []
    /// База прочитана — до этого пустой список не значит «чатов нет».
    @State private var loaded = false
    @State private var selected: [String] = []
    @State private var multiple = false
    @State private var query = ""
    @State private var tab: ChatListTab?
    @State private var comment = ""
    @State private var isSending = false
    @State private var failure: String?
    @State private var sentTick = 0
    /// Один ключ на экран: повтор после сбоя сети сервер узнает и не отправит второй раз.
    @State private var requestID = UUID()
    @FocusState private var commentFocused: Bool

    var body: some View {
        NavigationStack {
            List(filtered) { row in
                Button {
                    toggle(row.id)
                } label: {
                    ForwardTargetRow(row: row, isSelected: selected.contains(row.id), showsMark: multiple || !selected.isEmpty)
                }
                .accessibilityAddTraits(selected.contains(row.id) ? .isSelected : [])
            }
            .listStyle(.plain)
            .overlay {
                if loaded, filtered.isEmpty {
                    EmptyStateView(
                        title: query.trimmingCharacters(in: .whitespaces).isEmpty
                            ? String(localized: "chats.empty", defaultValue: "Чатов пока нет")
                            : String(localized: "services.notFound", defaultValue: "Ничего не нашлось"),
                        symbol: query.trimmingCharacters(in: .whitespaces).isEmpty ? "bubble.left.and.bubble.right" : "magnifyingglass"
                    )
                }
            }
            // Папки и нижняя панель висят над списком, как в Telegram: строки уезжают под
            // них и плавно тают, а не обрываются чертой у края полосы.
            .softEdgeBar(edge: .top) {
                FilterChips(options: tabOptions, selection: $tab)
                    .padding(.horizontal, Spacing.xl)
                    .padding(.vertical, Spacing.sm)
            }
            .softEdgeBar(edge: .bottom) { bottomPanel }
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(String(localized: "chats.forward.search", defaultValue: "Поиск"))
            )
            .navigationTitle(Text(String(localized: "chats.forward", defaultValue: "Переслать")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
                            multiple.toggle()
                            if !multiple, selected.count > 1 { selected = Array(selected.prefix(1)) }
                        }
                    } label: {
                        Image(systemName: multiple ? "checkmark.circle.fill" : "checklist")
                    }
                    .accessibilityLabel(Text(String(localized: "chats.forward.multiple", defaultValue: "Несколько получателей")))
                    .accessibilityAddTraits(multiple ? .isSelected : [])
                }
            }
            .interactiveDismissDisabled(isSending)
            .sensoryFeedback(.success, trigger: sentTick)
            .sensoryFeedback(.selection, trigger: selected)
            .task { await load() }
        }
    }

    // MARK: Нижняя панель

    private var bottomPanel: some View {
        VStack(spacing: Spacing.sm) {
            if let failure {
                Text(failure)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForwardPreview(messages: messages)
            if !selected.isEmpty {
                HStack(alignment: .bottom, spacing: Spacing.md) {
                    TextField(
                        text: $comment,
                        prompt: Text(String(localized: "chats.forward.comment", defaultValue: "Добавить комментарий")),
                        axis: .vertical
                    ) {
                        Text(String(localized: "chats.forward.comment", defaultValue: "Добавить комментарий"))
                    }
                    .lineLimit(1...4)
                    .font(Typography.body)
                    .focused($commentFocused)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.md)
                    .frame(minHeight: ControlHeight.lg)
                    .composerGlass(in: RoundedRectangle(cornerRadius: ControlHeight.lg / 2, style: .continuous))

                    Button {
                        Task { await submit() }
                    } label: {
                        ZStack {
                            if isSending {
                                ProgressView().tint(Palette.primaryForeground)
                            } else {
                                Image(systemName: "arrow.up")
                                    .font(Typography.body.weight(.bold))
                            }
                        }
                        .foregroundStyle(Palette.primaryForeground)
                        .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                        .glassSurface(tint: Palette.primary, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(isSending)
                    .accessibilityLabel(Text(String(localized: "chats.send", defaultValue: "Отправить")))
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        // Размытая подложка, как у панели Telegram: без неё строки списка просвечивали
        // сквозь «что пересылаем» и поле комментария. Верх подложки сходит на нет —
        // без резкой черты.
        .background {
            Rectangle()
                .fill(.bar)
                .mask {
                    LinearGradient(
                        stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.18)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
                .padding(.top, -Spacing.xl)
                .ignoresSafeArea(edges: .bottom)
        }
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: selected.isEmpty)
    }

    // MARK: Выбор и отправка

    private func toggle(_ id: String) {
        failure = nil
        if let index = selected.firstIndex(of: id) {
            selected.remove(at: index)
        } else if multiple {
            selected.append(id)
        } else {
            selected = [id]
        }
    }

    private func submit() async {
        guard !selected.isEmpty, !isSending else { return }
        isSending = true
        failure = nil
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        let outcome = await send(selected, trimmed.isEmpty ? nil : String(trimmed.prefix(4000)), requestID)
        isSending = false
        if outcome.isComplete {
            sentTick += 1
            dismiss()
            return
        }
        if let message = outcome.failure {
            // Сеть или сервер: повтор пойдёт с тем же ключом и не задвоит пересланное.
            failure = message
            return
        }
        // Часть чатов отказала: дошедшие убираем из выбора, новая попытка — новый ключ
        // (прежний запрос сервер уже завершил и повторил бы его ответ).
        selected.removeAll { outcome.delivered.contains($0) }
        requestID = UUID()
        failure = String(
            localized: "chats.forward.partial",
            defaultValue: "Не удалось переслать в некоторые чаты — они остались отмеченными"
        )
    }

    // MARK: Данные

    private var tabOptions: [(value: ChatListTab?, title: String)] {
        var options: [(value: ChatListTab?, title: String)] = [
            (nil, String(localized: "chats.tabs.all", defaultValue: "Все")),
            (.personal, String(localized: "chats.tabs.personal", defaultValue: "Личные")),
            (.groups, String(localized: "chats.tabs.groups", defaultValue: "Группы")),
        ]
        options += folders.map { (ChatListTab.folder(id: $0.id, name: $0.name), $0.name) }
        return options
    }

    private var filtered: [ChatListRow] {
        var list = rows
        switch tab {
        case .personal?: list = list.filter { $0.kind == .private || $0.kind == .saved }
        case .groups?: list = list.filter { $0.kind != .private && $0.kind != .saved }
        case .folder(let id, _)?:
            let members = Set(folders.first { $0.id == id }?.chatIds ?? [])
            list = list.filter { members.contains($0.id) }
        default: break
        }
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return list }
        return list.filter { $0.displayTitle.localizedCaseInsensitiveContains(trimmed) }
    }

    /// Список читается из базы: пересылают в знакомые чаты, а сеть для выбора не нужна.
    /// «Избранное» первым — так же, как в вебе.
    private func load() async {
        let (all, saved) = (try? await AppServices.database.reader.read { db in
            (try ChatListQuery.rows(for: .all).fetchAll(db), try ChatListQuery.folders(in: db))
        }) ?? ([], [])
        // Писать нельзя туда, где висит непринятый запрос или блокировка.
        let writable = all.filter { !$0.requestIncoming }
        rows = writable.filter { $0.kind == .saved } + writable.filter { $0.kind != .saved }
        folders = saved
        loaded = true
    }
}

private struct ForwardTargetRow: View {
    let row: ChatListRow
    let isSelected: Bool
    let showsMark: Bool

    var body: some View {
        HStack(spacing: Spacing.lg) {
            ChatAvatarView(title: row.title ?? row.displayTitle, kind: row.kind, avatarURL: row.avatarUrl, size: 44)
            Text(row.displayTitle)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                .lineLimit(1)
            Spacer(minLength: Spacing.md)
            if showsMark {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? Palette.primary : Palette.mutedForeground)
                    .contentTransition(.symbolEffect(.replace))
                    .transition(.opacity)
            }
        }
        .contentShape(Rectangle())
    }
}

/// Что пересылаем: одно сообщение — имя автора и начало текста, несколько — их число.
private struct ForwardPreview: View {
    let messages: [MessageRecord]

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "arrowshape.turn.up.right.fill")
                .foregroundStyle(Palette.primary)
                .accessibilityHidden(true)
            Capsule()
                .fill(Palette.primary)
                .frame(width: 3, height: ControlHeight.sm)
            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(Typography.meta.weight(.semibold))
                    .foregroundStyle(Palette.primary)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private var title: String {
        if messages.count == 1, let name = messages.first?.senderName, !name.isEmpty { return name }
        return ChatPlural.forwardMessages(messages.count)
    }

    private var subtitle: String {
        guard messages.count == 1, let message = messages.first else {
            return messages.compactMap { $0.content.isEmpty ? nil : $0.content }.first
                ?? String(localized: "chats.attachmentPreview", defaultValue: "Вложение")
        }
        return message.content.isEmpty
            ? String(localized: "chats.attachmentPreview", defaultValue: "Вложение")
            : message.content
    }
}

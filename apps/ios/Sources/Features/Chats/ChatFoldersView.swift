import GRDB
import SwiftUI

/// Что открыть в листе папки: существующую папку или новую — с уже отмеченными чатами,
/// если её заводят из меню строки («Добавить в папку» → «Новая папка»).
struct ChatFolderEditTarget: Identifiable {
    var folder: ChatFolderDTO?
    var chatIDs: [String] = []

    var id: String { folder?.id ?? "new" }

    static func edit(_ folder: ChatFolderDTO) -> ChatFolderEditTarget {
        ChatFolderEditTarget(folder: folder, chatIDs: folder.chatIds)
    }
}

// MARK: - Экран «Папки с чатами»

/// Свои папки, как «Папки с чатами» в Telegram: создать, открыть настройку, удалить
/// свайпом, переставить вкладки в режиме правки.
struct ChatFoldersView: View {
    let model: ChatFoldersModel

    @State private var editing: ChatFolderEditTarget?
    @State private var deleting: ChatFolderDTO?
    @State private var editMode: EditMode = .inactive
    @Environment(\.motionReduced) private var reduceMotion

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            Section {
                VStack(spacing: Spacing.md) {
                    IconTile(symbol: "folder.fill", tint: TileTint.blue, size: 64)
                        .accessibilityHidden(true)
                    Text(String(
                        localized: "chats.folders.hint",
                        defaultValue: "Собирайте чаты в папки и переключайтесь между ними вкладками над списком."
                    ))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            }

            Section {
                Button {
                    editing = ChatFolderEditTarget()
                } label: {
                    SettingsRow(
                        title: String(localized: "chats.folders.create", defaultValue: "Создать папку"),
                        symbol: "plus",
                        tint: TileTint.blue
                    )
                }
                .buttonStyle(.plain)
                .disabled(!model.canCreate || editMode.isEditing)

                if model.folders.isEmpty {
                    Text(String(localized: "chats.folders.empty", defaultValue: "Своих папок пока нет"))
                        .font(Typography.body)
                        .foregroundStyle(Palette.mutedForeground)
                }

                ForEach(model.folders) { folder in
                    Button {
                        editing = .edit(folder)
                    } label: {
                        SettingsRow(
                            title: folder.name,
                            symbol: "folder.fill",
                            tint: TileTint.blue,
                            value: ChatPlural.chats(folder.chatIds.count),
                            showsChevron: true
                        )
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            deleting = folder
                        } label: {
                            Label(String(localized: "chats.folders.delete", defaultValue: "Удалить папку"), systemImage: "trash.fill")
                        }
                    }
                }
                .onMove { source, destination in
                    var ids = model.folders.map(\.id)
                    ids.move(fromOffsets: source, toOffset: destination)
                    model.reorder(ids)
                }
            } header: {
                Text(String(localized: "chats.folders.section", defaultValue: "Мои папки"))
            } footer: {
                if !model.canCreate {
                    Text(ChatFoldersModel.foldersLimitMessage)
                } else if model.folders.count > 1 {
                    Text(String(
                        localized: "chats.folders.reorderHint",
                        defaultValue: "Чтобы поменять порядок вкладок, нажмите «Изм.» и перетащите папки."
                    ))
                }
            }
        }
        .listStyle(.insetGrouped)
        .environment(\.editMode, $editMode)
        .navigationTitle(Text(String(localized: "chats.folders.title", defaultValue: "Папки с чатами")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.folders.count > 1 {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) {
                            editMode = editMode.isEditing ? .inactive : .active
                        }
                    } label: {
                        Text(editMode.isEditing
                            ? String(localized: "chats.edit.done", defaultValue: "Готово")
                            : String(localized: "chats.edit", defaultValue: "Изм."))
                            .fontWeight(editMode.isEditing ? .semibold : .regular)
                    }
                }
            }
        }
        .pullToRefresh { await model.refresh() }
        .onChange(of: model.folders.count) {
            // Последнюю пару разобрали — переставлять нечего, и кнопки «Готово» уже нет.
            if model.folders.count < 2 { editMode = .inactive }
        }
        .sheet(item: $editing) { target in
            ChatFolderEditorView(model: model, target: target)
        }
        .chatFolderDeleteAlert($deleting, model: model)
    }
}

extension View {
    /// Подтверждение удаления папки — одно на экран папок, лист папки и меню вкладки.
    func chatFolderDeleteAlert(
        _ folder: Binding<ChatFolderDTO?>,
        model: ChatFoldersModel,
        deleted: @escaping () -> Void = {}
    ) -> some View {
        alert(
            folder.wrappedValue.map { name in
                String(localized: "chats.folders.delete.title", defaultValue: "Удалить папку «\(name.name)»?")
            } ?? "",
            isPresented: Binding(get: { folder.wrappedValue != nil }, set: { if !$0 { folder.wrappedValue = nil } }),
            presenting: folder.wrappedValue
        ) { value in
            Button(String(localized: "chats.folders.delete", defaultValue: "Удалить папку"), role: .destructive) {
                deleted()
                Task { await model.delete(value) }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: { _ in
            Text(String(localized: "chats.folders.delete.message", defaultValue: "Чаты останутся в списке."))
        }
    }
}

// MARK: - Лист папки

/// Создание и настройка папки: название и состав. Состав правится черновиком и уходит
/// на сервер целиком по «Сохранить» — так его и принимает API.
struct ChatFolderEditorView: View {
    let model: ChatFoldersModel
    let target: ChatFolderEditTarget

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var chatIDs: [String]
    @State private var chats: [ChatListRow] = []
    @State private var isSaving = false
    @State private var failure: String?
    @State private var picking = false
    @State private var deleting: ChatFolderDTO?
    @FocusState private var nameFocused: Bool

    init(model: ChatFoldersModel, target: ChatFolderEditTarget) {
        self.model = model
        self.target = target
        _name = State(initialValue: target.folder?.name ?? "")
        _chatIDs = State(initialValue: target.chatIDs)
    }

    private var isNew: Bool { target.folder == nil }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Отмеченные чаты, что есть в базе, — в порядке списка. Чат, который ещё не доехал
    /// страницей, в составе остаётся: его просто нечем нарисовать.
    private var included: [ChatListRow] {
        let chosen = Set(chatIDs)
        return chats.filter { chosen.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            List {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                Section {
                    TextField(
                        String(localized: "chats.folders.namePlaceholder", defaultValue: "Например, «Учёба»"),
                        text: $name
                    )
                    .focused($nameFocused)
                    .submitLabel(.done)
                    .onChange(of: name) { _, value in
                        if value.count > ChatFolderLimits.nameLength {
                            name = String(value.prefix(ChatFolderLimits.nameLength))
                        }
                    }
                } header: {
                    Text(String(localized: "chats.folders.name", defaultValue: "Название папки"))
                }

                Section {
                    Button {
                        picking = true
                    } label: {
                        SettingsRow(
                            title: String(localized: "chats.folders.addChats", defaultValue: "Добавить чаты"),
                            symbol: "plus",
                            tint: TileTint.blue,
                            showsChevron: true
                        )
                    }
                    .buttonStyle(.plain)

                    ForEach(included) { chat in
                        ChatFolderChatRow(chat: chat)
                    }
                    .onDelete { offsets in
                        let removed = Set(offsets.map { included[$0].id })
                        chatIDs.removeAll { removed.contains($0) }
                    }
                } header: {
                    Text(String(localized: "chats.folders.chats", defaultValue: "Чаты в папке"))
                } footer: {
                    Text(String(
                        localized: "chats.folders.chatsHint",
                        defaultValue: "Выберите чаты, которые будут показываться в этой папке."
                    ))
                }

                if let folder = target.folder {
                    Section {
                        Button(role: .destructive) {
                            deleting = folder
                        } label: {
                            Text(String(localized: "chats.folders.delete", defaultValue: "Удалить папку"))
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.compact)
            .disabled(isSaving)
            .navigationTitle(Text(isNew
                ? String(localized: "chats.folders.new", defaultValue: "Новая папка")
                : String(localized: "chats.folders.edit", defaultValue: "Изменить папку")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(isNew
                            ? String(localized: "chats.group.create", defaultValue: "Создать")
                            : String(localized: "common.save", defaultValue: "Сохранить")) {
                            Task { await save() }
                        }
                        .disabled(trimmedName.isEmpty)
                    }
                }
            }
            .navigationDestination(isPresented: $picking) {
                ChatFolderPickerView(chats: chats.filter { $0.archivedAt == nil }, selection: $chatIDs)
            }
            .chatFolderDeleteAlert($deleting, model: model) { dismiss() }
            .task {
                await loadChats()
                if isNew, chatIDs.isEmpty { nameFocused = true }
            }
        }
    }

    /// Чаты для выбора — из базы, как и список: архивные нужны, чтобы показать их в
    /// составе, но предлагаются только живые (у архива и запросов свои вкладки).
    private func loadChats() async {
        let all = ChatListQuery.rows(for: .all)
        let archived = ChatListQuery.rows(for: .archive)
        chats = (try? await AppServices.database.reader.read { db in
            try all.fetchAll(db) + archived.fetchAll(db)
        }) ?? []
    }

    private func save() async {
        guard !trimmedName.isEmpty else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            if let folder = target.folder {
                try await model.update(id: folder.id, name: trimmedName, chatIDs: chatIDs)
            } else {
                try await model.create(name: trimmedName, chatIDs: chatIDs)
            }
            dismiss()
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Выбор чатов

/// Чаты с отметками и поиском по названию. Отметка сразу меняет черновик листа: «назад»
/// и «Готово» возвращают к нему одинаково.
private struct ChatFolderPickerView: View {
    let chats: [ChatListRow]
    @Binding var selection: [String]

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var shown: [ChatListRow] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return chats }
        return chats.filter { $0.displayTitle.localizedCaseInsensitiveContains(trimmed) }
    }

    private var isFull: Bool { selection.count >= ChatFolderLimits.chatsPerFolder }

    var body: some View {
        List {
            Section {
                ForEach(shown) { chat in
                    let isOn = selection.contains(chat.id)
                    Button {
                        if isOn {
                            selection.removeAll { $0 == chat.id }
                        } else if !isFull {
                            selection.append(chat.id)
                        }
                    } label: {
                        ChatFolderChatRow(chat: chat, isSelected: isOn)
                    }
                    .buttonStyle(.plain)
                    .disabled(!isOn && isFull)
                    .accessibilityAddTraits(isOn ? .isSelected : [])
                }
            } footer: {
                if isFull {
                    Text(ChatFoldersModel.chatsLimitMessage)
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if shown.isEmpty {
                EmptyStateView(
                    title: chats.isEmpty
                        ? String(localized: "chats.empty", defaultValue: "Чатов пока нет")
                        : String(localized: "chats.folders.nothing", defaultValue: "Ничего не найдено"),
                    symbol: chats.isEmpty ? "bubble.left.and.bubble.right" : "magnifyingglass"
                )
            }
        }
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text(String(localized: "chats.search.prompt.short", defaultValue: "Поиск"))
        )
        .navigationTitle(Text(String(localized: "chats.folders.addChats", defaultValue: "Добавить чаты")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(String(localized: "common.done", defaultValue: "Готово")) { dismiss() }
                    .fontWeight(.semibold)
            }
        }
    }
}

/// Строка чата в листе папки: аватар, название и, при выборе, кружок-отметка.
private struct ChatFolderChatRow: View {
    let chat: ChatListRow
    var isSelected: Bool?

    var body: some View {
        HStack(spacing: Spacing.lg) {
            ChatAvatarView(title: chat.displayTitle, kind: chat.kind, avatarURL: chat.avatarUrl, size: 40)
            Text(chat.displayTitle)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                .lineLimit(1)
            Spacer(minLength: Spacing.md)
            if let isSelected {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? Palette.primary : Palette.mutedForeground)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

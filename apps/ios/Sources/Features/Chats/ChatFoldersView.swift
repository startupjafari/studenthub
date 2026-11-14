import SwiftUI

/// Что открыть в листе папки: существующую папку или новую — с уже отмеченными чатами,
/// если её заводят из меню строки («Добавить в папку» → «Новая папка»).
struct ChatFolderEditTarget: Identifiable {
    var folder: ChatFolderDTO?
    var chatIDs: [String] = []
    /// Сразу к выбору чатов — «Добавить чаты» из меню вкладки.
    var opensPicker = false

    var id: String { folder?.id ?? "new" }

    static func edit(_ folder: ChatFolderDTO, addingChats: Bool = false) -> ChatFolderEditTarget {
        ChatFolderEditTarget(folder: folder, chatIDs: folder.chatIds, opensPicker: addingChats)
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

/// Настройки папки как в Telegram: название со значком-emoji, выбранные чаты и типы
/// чатов, исключения, цвет тега. Всё правится черновиком и уходит на сервер целиком по
/// галочке — так его и принимает API.
struct ChatFolderEditorView: View {
    let model: ChatFoldersModel
    let target: ChatFolderEditTarget

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var emoji: String?
    @State private var color: Int?
    @State private var chatIDs: [String]
    @State private var excludedIDs: [String]
    @State private var types: Set<ChatFolderChatType>
    @State private var chats: [ChatListRow] = []
    @State private var isSaving = false
    @State private var failure: String?
    @State private var picking: ChatFolderPickerMode?
    @State private var choosingEmoji = false
    @State private var deleting: ChatFolderDTO?
    @FocusState private var nameFocused: Bool

    init(model: ChatFoldersModel, target: ChatFolderEditTarget) {
        self.model = model
        self.target = target
        let folder = target.folder
        _name = State(initialValue: folder?.name ?? "")
        _emoji = State(initialValue: folder?.emoji)
        _color = State(initialValue: folder?.color)
        _chatIDs = State(initialValue: target.chatIDs)
        _excludedIDs = State(initialValue: folder?.excludedChatIds ?? [])
        _types = State(initialValue: folder.map(ChatFolderChatType.enabled(in:)) ?? [])
    }

    private var isNew: Bool { target.folder == nil }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Отмеченные чаты, что есть в базе, — в порядке списка. Чат, который ещё не доехал
    /// страницей, в составе остаётся: его просто нечем нарисовать.
    private func rows(_ ids: [String]) -> [ChatListRow] {
        let chosen = Set(ids)
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
                nameSection
                includedSection
                excludedSection
                colorSection
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
                : String(localized: "chats.folders.settings", defaultValue: "Настройки папки")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        ChatFolderConfirmButton(
                            title: isNew
                                ? String(localized: "chats.group.create", defaultValue: "Создать")
                                : String(localized: "common.save", defaultValue: "Сохранить")
                        ) {
                            Task { await save() }
                        }
                        .disabled(trimmedName.isEmpty)
                    }
                }
            }
            .navigationDestination(item: $picking) { mode in
                ChatFolderPickerView(
                    mode: mode,
                    chats: chats.filter { $0.archivedAt == nil },
                    selection: mode == .included ? $chatIDs : $excludedIDs,
                    types: $types
                )
            }
            .sheet(isPresented: $choosingEmoji) {
                ChatFolderEmojiSheet(emoji: $emoji)
            }
            .chatFolderDeleteAlert($deleting, model: model) { dismiss() }
            // Чат не может быть и выбран, и исключён — сервер ответит 422. Последний выбор
            // побеждает: отмеченный в одном списке уходит из другого.
            .onChange(of: chatIDs) { _, ids in
                let chosen = Set(ids)
                if excludedIDs.contains(where: chosen.contains) { excludedIDs.removeAll(where: chosen.contains) }
            }
            .onChange(of: excludedIDs) { _, ids in
                let excluded = Set(ids)
                if chatIDs.contains(where: excluded.contains) { chatIDs.removeAll(where: excluded.contains) }
            }
            .task {
                await loadChats()
                if target.opensPicker {
                    picking = .included
                } else if isNew, chatIDs.isEmpty {
                    nameFocused = true
                }
            }
        }
    }

    // MARK: Секции

    private var nameSection: some View {
        Section {
            HStack(spacing: Spacing.md) {
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
                // Значок папки — справа в поле, как в Telegram.
                Button {
                    nameFocused = false
                    choosingEmoji = true
                } label: {
                    Group {
                        if let emoji {
                            Text(verbatim: emoji).font(.title3)
                        } else {
                            Image(systemName: "face.smiling")
                                .font(.title3)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(String(localized: "chats.folders.icon", defaultValue: "Значок папки")))
            }
        } header: {
            Text(String(localized: "chats.folders.name", defaultValue: "Название папки"))
        }
    }

    private var includedSection: some View {
        Section {
            ChatFolderAddButton(
                title: String(localized: "chats.folders.addChats", defaultValue: "Добавить чаты")
            ) { picking = .included }

            ForEach(ChatFolderChatType.allCases.filter(types.contains)) { type in
                ChatFolderTypeRow(type: type)
            }
            .onDelete { offsets in
                let shown = ChatFolderChatType.allCases.filter(types.contains)
                for index in offsets { types.remove(shown[index]) }
            }

            let included = rows(chatIDs)
            ForEach(included) { chat in
                ChatFolderChatRow(chat: chat)
            }
            .onDelete { offsets in
                let removed = Set(offsets.map { included[$0].id })
                chatIDs.removeAll { removed.contains($0) }
            }
        } header: {
            Text(String(localized: "chats.folders.included", defaultValue: "Выбранные чаты"))
        } footer: {
            Text(String(
                localized: "chats.folders.includedHint",
                defaultValue: "Выберите чаты или типы чатов, которые нужно показывать в этой папке."
            ))
        }
    }

    private var excludedSection: some View {
        Section {
            ChatFolderAddButton(
                title: String(localized: "chats.folders.addExcluded", defaultValue: "Добавить исключения")
            ) { picking = .excluded }

            let excluded = rows(excludedIDs)
            ForEach(excluded) { chat in
                ChatFolderChatRow(chat: chat)
            }
            .onDelete { offsets in
                let removed = Set(offsets.map { excluded[$0].id })
                excludedIDs.removeAll { removed.contains($0) }
            }
        } header: {
            Text(String(localized: "chats.folders.excluded", defaultValue: "Исключённые чаты"))
        } footer: {
            Text(String(
                localized: "chats.folders.excludedHint",
                defaultValue: "Выберите чаты, которые не нужно показывать в этой папке."
            ))
        }
    }

    private var colorSection: some View {
        Section {
            HStack(spacing: 0) {
                ForEach(Array(ChatFolderPalette.colors.enumerated()), id: \.offset) { index, tint in
                    ChatFolderColorDot(fill: tint, isSelected: color == index) { color = index }
                        .accessibilityLabel(Text(ChatFolderPalette.name(of: index)))
                    Spacer(minLength: 0)
                }
                ChatFolderColorDot(fill: nil, isSelected: color == nil) { color = nil }
                    .accessibilityLabel(Text(String(localized: "chats.folders.color.none", defaultValue: "Без цвета")))
            }
            .padding(.vertical, Spacing.xs)
        } header: {
            HStack {
                Text(String(localized: "chats.folders.color", defaultValue: "Цвет папки"))
                Spacer(minLength: Spacing.md)
                // Как будет выглядеть тег в списке — сразу у выбора.
                if let color, !trimmedName.isEmpty {
                    ChatFolderTagLabel(tag: ChatFolderTag(folderID: "", name: trimmedName, color: color))
                        .textCase(nil)
                }
            }
        } footer: {
            Text(String(
                localized: "chats.folders.colorHint",
                defaultValue: "Цвет используется для тегов с названием папки в списке чатов."
            ))
        }
    }

    // MARK: Данные

    /// Чаты для выбора — из базы, как и список: архивные нужны, чтобы показать их в
    /// составе, но предлагаются только живые (у архива и запросов свои вкладки).
    private func loadChats() async {
        chats = (try? await ChatListQueries(database: AppServices.database).fetchFolderCandidates()) ?? []
    }

    private func save() async {
        guard !trimmedName.isEmpty else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            if let folder = target.folder {
                try await model.update(id: folder.id, patch(from: folder))
            } else {
                try await model.create(ChatFolderDraft(
                    name: trimmedName,
                    chatIds: chatIDs,
                    excludedChatIds: excludedIDs,
                    emoji: emoji,
                    color: color,
                    includeContacts: types.contains(.contacts),
                    includeNonContacts: types.contains(.nonContacts),
                    includeGroups: types.contains(.groups)
                ))
            }
            dismiss()
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    /// Только изменённые новые поля: старый сервер со строгой схемой не принял бы
    /// незнакомые ключи, и правка названия с ним ломалась бы.
    private func patch(from folder: ChatFolderDTO) -> ChatFolderPatch {
        var patch = ChatFolderPatch(name: trimmedName, chatIds: chatIDs)
        if excludedIDs != folder.excludedChatIds { patch.excludedChatIds = excludedIDs }
        if emoji != folder.emoji { patch.emoji = .some(emoji) }
        if color != folder.color { patch.color = .some(color) }
        if types.contains(.contacts) != folder.includeContacts { patch.includeContacts = types.contains(.contacts) }
        if types.contains(.nonContacts) != folder.includeNonContacts {
            patch.includeNonContacts = types.contains(.nonContacts)
        }
        if types.contains(.groups) != folder.includeGroups { patch.includeGroups = types.contains(.groups) }
        return patch
    }
}

// MARK: - Типы чатов и цвета

/// Типы чатов папки (§C контракта) — квадратные цветные значки, как в Telegram.
enum ChatFolderChatType: String, CaseIterable, Identifiable, Hashable {
    case contacts, nonContacts, groups

    var id: String { rawValue }

    var title: String {
        switch self {
        case .contacts: return String(localized: "chats.folders.type.contacts", defaultValue: "Контакты")
        case .nonContacts: return String(localized: "chats.folders.type.nonContacts", defaultValue: "Не контакты")
        case .groups: return String(localized: "chats.folders.type.groups", defaultValue: "Группы")
        }
    }

    var symbol: String {
        switch self {
        case .contacts: return "person.fill"
        case .nonContacts: return "person.fill.questionmark"
        case .groups: return "person.2.fill"
        }
    }

    var tint: Color {
        switch self {
        case .contacts: return TileTint.blue
        case .nonContacts: return TileTint.orange
        case .groups: return TileTint.green
        }
    }

    static func enabled(in folder: ChatFolderDTO) -> Set<ChatFolderChatType> {
        var types: Set<ChatFolderChatType> = []
        if folder.includeContacts { types.insert(.contacts) }
        if folder.includeNonContacts { types.insert(.nonContacts) }
        if folder.includeGroups { types.insert(.groups) }
        return types
    }
}

extension ChatFolderPalette {
    /// Цвета по индексу сервера: синий, зелёный, оранжевый, красный, фиолетовый,
    /// бирюзовый, розовый.
    static let colors: [Color] = [
        TileTint.blue, TileTint.green, TileTint.orange, TileTint.red, TileTint.purple, TileTint.teal, TileTint.pink,
    ]

    static func color(_ index: Int) -> Color {
        colors.indices.contains(index) ? colors[index] : TileTint.gray
    }

    /// Название цвета — для VoiceOver.
    static func name(of index: Int) -> String {
        switch index {
        case 0: return String(localized: "chats.folders.color.blue", defaultValue: "Синий")
        case 1: return String(localized: "chats.folders.color.green", defaultValue: "Зелёный")
        case 2: return String(localized: "chats.folders.color.orange", defaultValue: "Оранжевый")
        case 3: return String(localized: "chats.folders.color.red", defaultValue: "Красный")
        case 4: return String(localized: "chats.folders.color.purple", defaultValue: "Фиолетовый")
        case 5: return String(localized: "chats.folders.color.teal", defaultValue: "Бирюзовый")
        default: return String(localized: "chats.folders.color.pink", defaultValue: "Розовый")
        }
    }
}

/// Тег папки — название её цветом на подложке того же цвета. В строке списка чатов и
/// в предпросмотре у выбора цвета.
struct ChatFolderTagLabel: View {
    let tag: ChatFolderTag

    var body: some View {
        let tint = ChatFolderPalette.color(tag.color)
        Text(tag.name)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .foregroundStyle(tint)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

/// Кружок цвета. Выбранный — с кольцом вокруг, «без цвета» — перечёркнутый.
private struct ChatFolderColorDot: View {
    let fill: Color?
    let isSelected: Bool
    let action: () -> Void

    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 30

    var body: some View {
        Button(action: action) {
            ZStack {
                if let fill {
                    Circle().fill(fill)
                } else {
                    Circle().fill(Palette.muted)
                    Image(systemName: "nosign")
                        .font(.system(size: size * 0.5, weight: .semibold))
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            .frame(width: size, height: size)
            .padding(3)
            .overlay {
                if isSelected {
                    Circle().strokeBorder(fill ?? Palette.mutedForeground, lineWidth: 2)
                }
            }
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// «+ Добавить чаты» синим текстом — как кнопки секций папки в Telegram.
private struct ChatFolderAddButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: "plus")
                .font(Typography.body)
                .foregroundStyle(Palette.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Строка типа чатов: цветная квадратная плитка и подпись.
private struct ChatFolderTypeRow: View {
    let type: ChatFolderChatType
    var isSelected: Bool?

    var body: some View {
        HStack(spacing: Spacing.lg) {
            IconTile(symbol: type.symbol, tint: type.tint, size: 40)
            Text(type.title)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
            Spacer(minLength: Spacing.md)
            if let isSelected {
                ChatFolderCheck(isSelected: isSelected)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Кружок-галочка выбора.
private struct ChatFolderCheck: View {
    let isSelected: Bool

    var body: some View {
        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
            .font(.title3)
            .foregroundStyle(isSelected ? Palette.primary : Palette.mutedForeground)
            .accessibilityHidden(true)
    }
}

/// Галочка листа: на iOS 26 — системная в синем стекле (`role: .confirm`), раньше — та же
/// галочка значком.
private struct ChatFolderConfirmButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                Button(role: .confirm, action: action)
                    .accessibilityLabel(Text(title))
            } else {
                legacy
            }
        #else
            legacy
        #endif
    }

    private var legacy: some View {
        Button(action: action) {
            Image(systemName: "checkmark")
                .fontWeight(.semibold)
        }
        .accessibilityLabel(Text(title))
    }
}

/// Выбор значка папки — тот же каталог emoji, что в панели переписки.
private struct ChatFolderEmojiSheet: View {
    @Binding var emoji: String?

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            EmojiBrowser(columns: 8) { picked in
                emoji = picked
                dismiss()
            }
            .padding(.top, Spacing.sm)
            .navigationTitle(Text(String(localized: "chats.folders.icon", defaultValue: "Значок папки")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                if emoji != nil {
                    ToolbarItem(placement: .destructiveAction) {
                        Button(String(localized: "chats.folders.icon.remove", defaultValue: "Убрать")) {
                            emoji = nil
                            dismiss()
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Выбор чатов

/// Что выбирает экран «Чаты в папке»: состав (с типами чатов) или исключения.
enum ChatFolderPickerMode: String, Identifiable, Hashable {
    case included, excluded

    var id: String { rawValue }
}

/// «Чаты в папке» как в Telegram: сверху выбранное плашками и поиск, ниже — типы чатов
/// (только для состава) и чаты с кружками-галочками. Отметка сразу меняет черновик
/// листа: «назад» и «Готово» возвращают к нему одинаково.
private struct ChatFolderPickerView: View {
    let mode: ChatFolderPickerMode
    let chats: [ChatListRow]
    @Binding var selection: [String]
    @Binding var types: Set<ChatFolderChatType>

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    private var shown: [ChatListRow] {
        guard !trimmed.isEmpty else { return chats }
        return chats.filter { $0.displayTitle.localizedCaseInsensitiveContains(trimmed) }
    }

    private var shownTypes: [ChatFolderChatType] {
        guard mode == .included else { return [] }
        guard !trimmed.isEmpty else { return ChatFolderChatType.allCases }
        return ChatFolderChatType.allCases.filter { $0.title.localizedCaseInsensitiveContains(trimmed) }
    }

    private var limit: Int {
        mode == .included ? ChatFolderLimits.chatsPerFolder : ChatFolderLimits.excludedPerFolder
    }

    private var isFull: Bool { selection.count >= limit }

    private var chosenChats: [ChatListRow] {
        let byID = Dictionary(chats.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return selection.compactMap { byID[$0] }
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    if !(types.isEmpty || mode == .excluded) || !chosenChats.isEmpty {
                        ChatFlowLayout(spacing: Spacing.xs) {
                            if mode == .included {
                                ForEach(ChatFolderChatType.allCases.filter(types.contains)) { type in
                                    ChatFolderToken(title: type.title) {
                                        IconTile(symbol: type.symbol, tint: type.tint, size: 22)
                                    } remove: {
                                        types.remove(type)
                                    }
                                }
                            }
                            ForEach(chosenChats) { chat in
                                ChatFolderToken(title: chat.displayTitle) {
                                    ChatAvatarView(title: chat.displayTitle, kind: chat.kind, avatarURL: chat.avatarUrl, size: 22)
                                } remove: {
                                    selection.removeAll { $0 == chat.id }
                                }
                            }
                        }
                    }
                    TextField(
                        String(localized: "chats.folders.searchChats", defaultValue: "Поиск чатов"),
                        text: $query
                    )
                    .font(Typography.body)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                }
                .padding(.vertical, Spacing.xs)
            }

            if !shownTypes.isEmpty {
                Section {
                    ForEach(shownTypes) { type in
                        let isOn = types.contains(type)
                        Button {
                            if isOn { types.remove(type) } else { types.insert(type) }
                        } label: {
                            ChatFolderTypeRow(type: type, isSelected: isOn)
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(isOn ? .isSelected : [])
                    }
                } header: {
                    Text(String(localized: "chats.folders.types", defaultValue: "Типы чатов"))
                }
            }

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
            } header: {
                Text(String(localized: "chats.folders.chatsSection", defaultValue: "Чаты"))
            } footer: {
                if isFull {
                    Text(ChatFoldersModel.chatsLimitMessage)
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .overlay {
            if shown.isEmpty, shownTypes.isEmpty {
                EmptyStateView(
                    title: chats.isEmpty
                        ? String(localized: "chats.empty", defaultValue: "Чатов пока нет")
                        : String(localized: "chats.folders.nothing", defaultValue: "Ничего не найдено"),
                    symbol: chats.isEmpty ? "bubble.left.and.bubble.right" : "magnifyingglass"
                )
            }
        }
        .navigationTitle(Text(mode == .included
            ? String(localized: "chats.folders.chats", defaultValue: "Чаты в папке")
            : String(localized: "chats.folders.excluded", defaultValue: "Исключённые чаты")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                ChatFolderConfirmButton(title: String(localized: "common.done", defaultValue: "Готово")) { dismiss() }
            }
        }
    }
}

/// Плашка выбранного в шапке выбора: значок и название, касание убирает.
private struct ChatFolderToken<Icon: View>: View {
    let title: String
    @ViewBuilder let icon: () -> Icon
    let remove: () -> Void

    var body: some View {
        Button(action: remove) {
            HStack(spacing: Spacing.xs) {
                icon()
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
            }
            .padding(.leading, 3)
            .padding(.trailing, Spacing.sm)
            .padding(.vertical, 3)
            .background(Palette.muted, in: Capsule())
            .frame(maxWidth: 220, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
        .accessibilityHint(Text(String(localized: "chats.folders.token.remove", defaultValue: "Убрать из выбора")))
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
                ChatFolderCheck(isSelected: isSelected)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

import Foundation
import GRDB
import Observation

/// Свои папки чатов (§2): вкладки над списком, экран «Папки с чатами» и пункт «Добавить
/// в папку» в меню строки.
///
/// Как и список, читает базу: папки приходят вместе со списком чатов (`refresh`), а
/// правки отсюда пишутся в базу — вкладки и галочки в меню видят их сами.
@Observable
final class ChatFoldersModel {
    private(set) var folders: [ChatFolderDTO] = []
    /// Отказ правки из меню строки, перестановки или удаления. Правка из листа папки
    /// показывает ошибку в самом листе — туда она не попадает.
    private(set) var failure: String?

    private let database: AppDatabase
    private let api: ChatActing & ChatsFetching & ChatListActing
    private let store: ChatStore
    private var task: Task<Void, Never>?

    init(
        database: AppDatabase = AppServices.database,
        api: ChatActing & ChatsFetching & ChatListActing = ChatsAPI()
    ) {
        self.database = database
        self.api = api
        self.store = ChatStore(database: database)
    }

    deinit {
        task?.cancel()
    }

    var canCreate: Bool { folders.count < ChatFolderLimits.folders }

    func folder(id: String) -> ChatFolderDTO? {
        folders.first { $0.id == id }
    }

    @MainActor
    func start() {
        guard task == nil else { return }
        let observation = ValueObservation.tracking { db in try ChatListQuery.folders(in: db) }
            .removeDuplicates()
        task = Task { @MainActor [weak self, database] in
            for await folders in AsyncValues.stream(of: observation, in: database.reader) {
                self?.folders = folders
            }
        }
    }

    /// Экран папок тянет их сам по жесту: там нет списка чатов, который сделал бы это.
    @MainActor
    func refresh() async {
        do {
            try await store.save(folders: try await api.folders())
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    // MARK: - Лист папки

    /// Создание и правка из листа ждут сервер: лист закрывается только с ответом, а
    /// отказ (имя занято, лимит) показывается в нём же — поэтому они бросают ошибку.
    @MainActor
    @discardableResult
    func create(_ draft: ChatFolderDraft) async throws -> ChatFolderDTO {
        let folder = try await api.createFolder(draft)
        try await store.save(folder: folder)
        failure = nil
        return folder
    }

    @MainActor
    func update(id: String, _ patch: ChatFolderPatch) async throws {
        let folder = try await api.updateFolder(id: id, patch)
        try await store.save(folder: folder)
        failure = nil
    }

    // MARK: - Быстрые правки

    /// Чат в папку или из неё — из меню строки. Пишем сразу, как в Telegram: галочку жмут
    /// и смотрят на неё же. Отказ сервера откатывает папку к прежнему виду.
    ///
    /// Добавленный чат снимается с исключений: сервер не примет чат и там, и там.
    @MainActor
    func toggle(chatID: String, folderID: String) async {
        guard let folder = folder(id: folderID) else { return }
        let inside = folder.chatIds.contains(chatID)
        if !inside, folder.chatIds.count >= ChatFolderLimits.chatsPerFolder {
            failure = Self.chatsLimitMessage
            return
        }
        var draft = folder
        draft.chatIds = inside ? folder.chatIds.filter { $0 != chatID } : folder.chatIds + [chatID]
        let wasExcluded = folder.excludedChatIds.contains(chatID)
        if !inside { draft.excludedChatIds.removeAll { $0 == chatID } }
        await apply(draft, over: folder, patch: ChatFolderPatch(
            chatIds: draft.chatIds,
            excludedChatIds: !inside && wasExcluded ? draft.excludedChatIds : nil
        ))
    }

    /// «Удалить из папки» на её вкладке. Чат, выбранный явно, уходит из выбора; попавший
    /// по типу («Контакты», «Группы») — в исключения, иначе правило вернуло бы его.
    @MainActor
    func remove(chatID: String, fromFolder folderID: String) async {
        guard let folder = folder(id: folderID) else { return }
        var draft = folder
        draft.chatIds.removeAll { $0 == chatID }
        let patch: ChatFolderPatch
        if folder.includesTypes {
            guard folder.excludedChatIds.count < ChatFolderLimits.excludedPerFolder else {
                failure = Self.chatsLimitMessage
                return
            }
            if !draft.excludedChatIds.contains(chatID) { draft.excludedChatIds.append(chatID) }
            patch = ChatFolderPatch(chatIds: draft.chatIds, excludedChatIds: draft.excludedChatIds)
        } else {
            patch = ChatFolderPatch(chatIds: draft.chatIds)
        }
        await apply(draft, over: folder, patch: patch)
    }

    /// Звук всем чатам папки — «Выкл./Вкл. уведомления» из меню вкладки. Флаги чатов
    /// меняются сразу; отказ сервера возвращает прежние.
    @MainActor
    func setMuted(_ muted: Bool, folderID: String) async {
        let previous: [String: Bool]
        do {
            previous = try await store.setMuted(muted, folderID: folderID)
        } catch {
            failure = String(localized: "chats.error.local", defaultValue: "Не удалось сохранить изменение")
            return
        }
        do {
            if muted {
                try await api.muteFolder(id: folderID)
            } else {
                try await api.unmuteFolder(id: folderID)
            }
            failure = nil
        } catch {
            try? await store.restoreMuted(previous)
            if !(error is CancellationError) { failure = error.userMessage }
        }
    }

    @MainActor
    private func apply(_ draft: ChatFolderDTO, over folder: ChatFolderDTO, patch: ChatFolderPatch) async {
        do {
            try await store.save(folder: draft)
        } catch {
            failure = String(localized: "chats.error.local", defaultValue: "Не удалось сохранить изменение")
            return
        }
        do {
            let saved = try await api.updateFolder(id: folder.id, patch)
            try await store.save(folder: saved)
            failure = nil
        } catch {
            try? await store.save(folder: folder)
            if !(error is CancellationError) { failure = error.userMessage }
        }
    }

    /// Удаление — сразу из базы: вкладка уходит под пальцем. Папку, которой на сервере уже
    /// нет (удалили с другого устройства), не возвращаем.
    @MainActor
    func delete(_ folder: ChatFolderDTO) async {
        do {
            try await store.deleteFolder(id: folder.id)
        } catch {
            failure = String(localized: "chats.error.local", defaultValue: "Не удалось сохранить изменение")
            return
        }
        do {
            try await api.deleteFolder(id: folder.id)
            failure = nil
        } catch let error as APIError where error.code == .notFound {
            failure = nil
        } catch {
            try? await store.save(folder: folder)
            if !(error is CancellationError) { failure = error.userMessage }
        }
    }

    /// Новый порядок вкладок — id папок сверху вниз.
    ///
    /// Уходит одним `PUT /chats/folders/order`; старый сервер его не знает — тогда по
    /// запросу на каждую сдвинутую папку, как раньше. Порядок меняем сразу и синхронно —
    /// `List` после перетаскивания ждёт новые данные тем же кадром, иначе строка на миг
    /// прыгает назад.
    @MainActor
    func reorder(_ ids: [String]) {
        let previous = folders
        let byID = Dictionary(uniqueKeysWithValues: previous.map { ($0.id, $0) })
        let next = ids.enumerated().compactMap { index, id -> ChatFolderDTO? in
            guard var folder = byID[id] else { return nil }
            folder.position = index
            return folder
        }
        let moved = next.filter { byID[$0.id]?.position != $0.position }
        guard !moved.isEmpty else { return }
        folders = next
        Task { @MainActor in
            do {
                try await store.save(folders: next)
                do {
                    try await api.setFolderOrder(next.map(\.id))
                } catch let error as APIError where error.code == .notFound {
                    for folder in moved {
                        _ = try await api.updateFolder(id: folder.id, name: nil, chatIDs: nil, position: folder.position)
                    }
                }
                failure = nil
            } catch {
                // Часть запросов могла пройти: возвращаем прежний порядок и сверяемся с
                // сервером — его ответ и есть правда о вкладках.
                try? await store.save(folders: previous)
                if !(error is CancellationError) { failure = error.userMessage }
                if let actual = try? await api.folders() {
                    try? await store.save(folders: actual)
                }
            }
        }
    }

    static var chatsLimitMessage: String {
        String(
            localized: "chats.folders.limitChats",
            defaultValue: "В папке не больше \(ChatFolderLimits.chatsPerFolder) чатов"
        )
    }

    static var foldersLimitMessage: String {
        String(
            localized: "chats.folders.limit",
            defaultValue: "Больше \(ChatFolderLimits.folders) папок не поддерживается"
        )
    }
}

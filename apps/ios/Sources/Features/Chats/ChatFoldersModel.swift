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
    private let api: ChatActing & ChatsFetching
    private let store: ChatStore
    private var task: Task<Void, Never>?

    init(database: AppDatabase = AppServices.database, api: ChatActing & ChatsFetching = ChatsAPI()) {
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
    func create(name: String, chatIDs: [String]) async throws -> ChatFolderDTO {
        let folder = try await api.createFolder(name: name, chatIDs: chatIDs)
        try await store.save(folder: folder)
        failure = nil
        return folder
    }

    @MainActor
    func update(id: String, name: String, chatIDs: [String]) async throws {
        let folder = try await api.updateFolder(id: id, name: name, chatIDs: chatIDs, position: nil)
        try await store.save(folder: folder)
        failure = nil
    }

    // MARK: - Быстрые правки

    /// Чат в папку или из неё — из меню строки. Пишем сразу, как в Telegram: галочку жмут
    /// и смотрят на неё же. Отказ сервера откатывает папку к прежнему виду.
    @MainActor
    func toggle(chatID: String, folderID: String) async {
        guard let folder = folder(id: folderID) else { return }
        let inside = folder.chatIds.contains(chatID)
        if !inside, folder.chatIds.count >= ChatFolderLimits.chatsPerFolder {
            failure = Self.chatsLimitMessage
            return
        }
        let chatIDs = inside ? folder.chatIds.filter { $0 != chatID } : folder.chatIds + [chatID]
        let draft = ChatFolderDTO(id: folder.id, name: folder.name, position: folder.position, chatIds: chatIDs)
        do {
            try await store.save(folder: draft)
        } catch {
            failure = String(localized: "chats.error.local", defaultValue: "Не удалось сохранить изменение")
            return
        }
        do {
            let saved = try await api.updateFolder(id: folder.id, name: nil, chatIDs: chatIDs, position: nil)
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
    /// Ручки «переставить всё» у сервера нет: уходит по запросу на каждую сдвинутую
    /// папку, как в вебе. Порядок меняем сразу и синхронно — `List` после перетаскивания
    /// ждёт новые данные тем же кадром, иначе строка на миг прыгает назад.
    @MainActor
    func reorder(_ ids: [String]) {
        let previous = folders
        let byID = Dictionary(uniqueKeysWithValues: previous.map { ($0.id, $0) })
        let next = ids.enumerated().compactMap { index, id in
            byID[id].map { ChatFolderDTO(id: $0.id, name: $0.name, position: index, chatIds: $0.chatIds) }
        }
        let moved = next.filter { byID[$0.id]?.position != $0.position }
        guard !moved.isEmpty else { return }
        folders = next
        Task { @MainActor in
            do {
                try await store.save(folders: next)
                for folder in moved {
                    _ = try await api.updateFolder(id: folder.id, name: nil, chatIDs: nil, position: folder.position)
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

import Foundation

/// Изменение истории, которое лента применяет точечно (без перезагрузки всего списка).
struct ChatChange {
    enum Reason: Equatable {
        case send
        case receive
        case edit
        case delete
        case reaction
        case status
        case pin
        case consume
        case reset
        case forward
    }

    var reason: Reason
    var inserted: [MessageID] = []
    var updated: [MessageID] = []
    var removed: [MessageID] = []
    var animated = true

    var isReset: Bool { reason == .reset }
}

/// Всё состояние переписки, которое переживает перезапуск.
struct ChatState: Codable {
    var peer: Peer
    var messages: [Message]
    /// Закреплённые по порядку закрепления; последний — показан в панели первым.
    var pinnedIds: [MessageID]
    var settings: ChatSettings
    /// Сколько раз пересылали в другие (демонстрационные) чаты — для списка чатов.
    var forwardedCounts: [Int64: Int]
    var version: Int = 1
}

/// Единственный источник правды о переписке. Только главный поток; запись на диск —
/// в фоне, с задержкой, снимком значения.
@MainActor
final class ChatStore {
    static let shared = ChatStore()

    typealias Observer = (ChatChange) -> Void

    private(set) var state: ChatState
    private var indexById: [MessageID: Int] = [:]
    private var observers: [UUID: Observer] = [:]
    private var saveWorkItem: DispatchWorkItem?
    private static let ioQueue = DispatchQueue(label: "ChatLab.store.io", qos: .utility)

    var peer: Peer { state.peer }
    var messages: [Message] { state.messages }
    var pinnedIds: [MessageID] { state.pinnedIds }
    var settings: ChatSettings { state.settings }

    init(state: ChatState? = nil) {
        if let state {
            self.state = state
        } else if let stored = Self.loadFromDisk() {
            self.state = stored
        } else {
            self.state = MockChatService.initialState()
        }
        rebuildIndex()
    }

    // MARK: Наблюдатели

    @discardableResult
    func observe(_ observer: @escaping Observer) -> ObservationToken {
        let id = UUID()
        observers[id] = observer
        return ObservationToken { [weak self] in
            MainActor.assumeIsolated { _ = self?.observers.removeValue(forKey: id) }
        }
    }

    private func emit(_ change: ChatChange) {
        for observer in observers.values {
            observer(change)
        }
        scheduleSave()
    }

    // MARK: Чтение

    func message(_ id: MessageID) -> Message? {
        indexById[id].map { state.messages[$0] }
    }

    func index(of id: MessageID) -> Int? { indexById[id] }

    var nextId: MessageID { (state.messages.last?.id ?? 0) + 1 }

    var lastMessage: Message? { state.messages.last }

    var unreadIncomingCount: Int { 0 }

    func isPinned(_ id: MessageID) -> Bool { state.pinnedIds.contains(id) }

    /// Поиск по тексту и подписям, от новых к старым (как в Telegram: первый результат — самый свежий).
    func search(_ query: String) -> [MessageID] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return [] }
        return state.messages.reversed().compactMap { message in
            guard !message.isService else { return nil }
            let haystack = message.text + " " + (message.kind.media?.fileName ?? "")
            return haystack.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil ? message.id : nil
        }
    }

    func messages(matching predicate: (Message) -> Bool) -> [Message] {
        state.messages.filter(predicate)
    }

    // MARK: Отправка

    @discardableResult
    func send(text: String, replyTo: MessageID?) -> Message {
        let message = Message(
            id: nextId, author: .me, date: Date(), text: text, kind: .text, status: .sending, replyTo: replyTo
        )
        append(message, reason: .send)
        MockChatService.shared.didSend(message)
        return message
    }

    @discardableResult
    func sendMedia(_ kinds: [MessageKind], caption: String, replyTo: MessageID?) -> [Message] {
        guard !kinds.isEmpty else { return [] }
        let groupable = kinds.count > 1 && kinds.allSatisfy { $0.isVisualMedia }
        let groupId: Int64? = groupable ? Int64(Date().timeIntervalSince1970 * 1000) : nil
        var sent: [Message] = []
        for (offset, kind) in kinds.enumerated() {
            // Подпись — у последнего элемента альбома (так её показывает Telegram под мозаикой).
            let isLast = offset == kinds.count - 1
            let message = Message(
                id: nextId, author: .me, date: Date(), text: isLast ? caption : "", kind: kind,
                status: .sending, replyTo: offset == 0 ? replyTo : nil, groupId: groupId
            )
            state.messages.append(message)
            indexById[message.id] = state.messages.count - 1
            sent.append(message)
        }
        emit(ChatChange(reason: .send, inserted: sent.map(\.id)))
        sent.forEach { MockChatService.shared.didSend($0) }
        return sent
    }

    func receive(_ message: Message) {
        var message = message
        message.id = nextId
        append(message, reason: .receive)
    }

    func receive(batch: [Message]) {
        var ids: [MessageID] = []
        for var message in batch {
            message.id = nextId
            state.messages.append(message)
            indexById[message.id] = state.messages.count - 1
            ids.append(message.id)
        }
        emit(ChatChange(reason: .receive, inserted: ids))
    }

    private func append(_ message: Message, reason: ChatChange.Reason) {
        state.messages.append(message)
        indexById[message.id] = state.messages.count - 1
        emit(ChatChange(reason: reason, inserted: [message.id]))
    }

    func retry(_ id: MessageID) {
        guard var message = message(id), message.status == .failed else { return }
        message.status = .sending
        replace(message, reason: .status)
        MockChatService.shared.didSend(message)
    }

    // MARK: Изменение

    func updateStatus(_ id: MessageID, to status: DeliveryStatus) {
        guard var message = message(id), message.status != status else { return }
        message.status = status
        replace(message, reason: .status)
    }

    /// Пометить исходящие прочитанными до `id` включительно (собеседник открыл чат).
    func markOutgoingRead(upTo id: MessageID) {
        var updated: [MessageID] = []
        for index in state.messages.indices where state.messages[index].id <= id {
            let message = state.messages[index]
            if message.isOutgoing, message.status == .sent || message.status == .delivered {
                state.messages[index].status = .read
                updated.append(message.id)
            }
        }
        if !updated.isEmpty {
            emit(ChatChange(reason: .status, updated: updated))
        }
    }

    func edit(_ id: MessageID, text: String) {
        guard var message = message(id), message.isEditable else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if case .text = message.kind, trimmed.isEmpty { return }
        guard message.text != text else { return }
        message.text = text
        message.editedAt = Date()
        replace(message, reason: .edit)
    }

    func markConsumed(_ id: MessageID) {
        guard var message = message(id), !message.isConsumed else { return }
        message.isConsumed = true
        replace(message, reason: .consume)
    }

    /// Реакция: у пользователя одна реакция на сообщение (как без Premium). Повторное
    /// нажатие на свою снимает её.
    func toggleReaction(_ id: MessageID, emoji: String) {
        guard var message = message(id) else { return }
        let hadSame = message.reactions.contains { $0.emoji == emoji && $0.byMe }
        for index in message.reactions.indices {
            message.reactions[index].byMe = false
        }
        if !hadSame {
            if let index = message.reactions.firstIndex(where: { $0.emoji == emoji }) {
                message.reactions[index].byMe = true
            } else {
                message.reactions.append(MessageReaction(emoji: emoji, byMe: true, byPeer: false))
            }
        }
        message.reactions.removeAll { $0.count == 0 }
        replace(message, reason: .reaction)
    }

    func setPeerReaction(_ id: MessageID, emoji: String?) {
        guard var message = message(id) else { return }
        for index in message.reactions.indices {
            message.reactions[index].byPeer = false
        }
        if let emoji {
            if let index = message.reactions.firstIndex(where: { $0.emoji == emoji }) {
                message.reactions[index].byPeer = true
            } else {
                message.reactions.append(MessageReaction(emoji: emoji, byMe: false, byPeer: true))
            }
        }
        message.reactions.removeAll { $0.count == 0 }
        replace(message, reason: .reaction)
    }

    private func replace(_ message: Message, reason: ChatChange.Reason) {
        guard let index = indexById[message.id] else { return }
        state.messages[index] = message
        emit(ChatChange(reason: reason, updated: [message.id]))
    }

    // MARK: Удаление

    func delete(_ ids: [MessageID]) {
        let set = Set(ids)
        guard !set.isEmpty else { return }
        let removed = state.messages.filter { set.contains($0.id) }.map(\.id)
        guard !removed.isEmpty else { return }
        state.messages.removeAll { set.contains($0.id) }
        state.pinnedIds.removeAll { set.contains($0) }
        // Ответы на удалённое остаются, но цитата пропадает — как в Telegram («Удалённое сообщение»).
        rebuildIndex()
        emit(ChatChange(reason: .delete, removed: removed))
    }

    func clearHistory() {
        state.messages.removeAll()
        state.pinnedIds.removeAll()
        rebuildIndex()
        emit(ChatChange(reason: .reset, animated: true))
    }

    // MARK: Закрепление

    func pin(_ id: MessageID, notify: Bool = true) {
        guard let message = message(id), !state.pinnedIds.contains(id) else { return }
        state.pinnedIds.append(id)
        var change = ChatChange(reason: .pin, updated: [id])
        if notify {
            let quote = message.previewText.prefix(40)
            let service = Message(
                id: nextId, author: .me, date: Date(), text: "Вы закрепили «\(quote)»", kind: .service, status: .read,
                replyTo: id
            )
            state.messages.append(service)
            indexById[service.id] = state.messages.count - 1
            change.inserted = [service.id]
        }
        emit(change)
    }

    func unpin(_ id: MessageID) {
        guard state.pinnedIds.contains(id) else { return }
        state.pinnedIds.removeAll { $0 == id }
        emit(ChatChange(reason: .pin, updated: [id]))
    }

    func unpinAll() {
        let ids = state.pinnedIds
        guard !ids.isEmpty else { return }
        state.pinnedIds.removeAll()
        emit(ChatChange(reason: .pin, updated: ids))
    }

    // MARK: Пересылка

    /// Переслать сообщения. В текущий чат — новые сообщения с пометкой «Переслано от»,
    /// в демонстрационные — счётчик для списка чатов.
    @discardableResult
    func forward(_ ids: [MessageID], to target: ForwardTarget) -> [Message] {
        let originals = ids.compactMap { message($0) }.filter { !$0.isService }.sorted { $0.id < $1.id }
        guard !originals.isEmpty else { return [] }
        guard target.isCurrentChat else {
            state.forwardedCounts[target.id, default: 0] += originals.count
            scheduleSave()
            return []
        }
        var created: [Message] = []
        for original in originals {
            let authorName = original.forward?.authorName ?? (original.isOutgoing ? "Вы" : state.peer.displayName)
            let copy = Message(
                id: nextId, author: .me, date: Date(), text: original.text, kind: original.kind, status: .sending,
                forward: ForwardInfo(authorName: authorName, date: original.forward?.date ?? original.date),
                groupId: original.groupId.map { $0 &+ 7_000_000 }
            )
            state.messages.append(copy)
            indexById[copy.id] = state.messages.count - 1
            created.append(copy)
        }
        emit(ChatChange(reason: .forward, inserted: created.map(\.id)))
        created.forEach { MockChatService.shared.didSend($0) }
        return created
    }

    // MARK: Настройки

    func updateSettings(_ mutate: (inout ChatSettings) -> Void) {
        mutate(&state.settings)
        scheduleSave()
    }

    // MARK: Сброс

    func resetToInitial() {
        state = MockChatService.initialState()
        rebuildIndex()
        emit(ChatChange(reason: .reset, animated: false))
        NotificationCenter.default.post(name: .chatWallpaperDidChange, object: nil)
    }

    // MARK: Диск

    private func rebuildIndex() {
        indexById.removeAll(keepingCapacity: true)
        for (index, message) in state.messages.enumerated() {
            indexById[message.id] = index
        }
    }

    private func scheduleSave() {
        saveWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated { self?.flushToDisk() }
        }
        saveWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: item)
    }

    /// Снимок значения уходит на фоновую очередь: кодирование и запись не держат главный поток.
    func flushToDisk() {
        saveWorkItem?.cancel()
        saveWorkItem = nil
        let snapshot = state
        Self.ioQueue.async {
            do {
                let encoder = JSONEncoder()
                encoder.dateEncodingStrategy = .secondsSince1970
                let data = try encoder.encode(snapshot)
                try FileManager.default.createDirectory(at: Self.directory, withIntermediateDirectories: true)
                try data.write(to: Self.stateURL, options: .atomic)
            } catch {
                NSLog("ChatLab: не удалось сохранить историю: \(error)")
            }
        }
    }

    nonisolated static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ChatLab", isDirectory: true)
    }

    nonisolated static var stateURL: URL { directory.appendingPathComponent("chat-state.json") }

    nonisolated static func loadFromDisk() -> ChatState? {
        guard let data = try? Data(contentsOf: stateURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try? decoder.decode(ChatState.self, from: data)
    }

    nonisolated static func resetPersistentState() {
        try? FileManager.default.removeItem(at: stateURL)
        UserDefaults.standard.removeObject(forKey: "theme.mode")
    }
}

/// Отписка при освобождении.
final class ObservationToken {
    private let cancel: () -> Void
    init(_ cancel: @escaping () -> Void) { self.cancel = cancel }
    deinit { cancel() }
}

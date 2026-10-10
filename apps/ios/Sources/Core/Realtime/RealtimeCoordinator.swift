import Foundation
import GRDB
import Observation

/// Приём событий реального времени.
///
/// Единственный потребитель транспорта. Всё, что приходит, ложится в базу — экраны
/// перерисовываются сами, как и от сети. В памяти остаётся только то, чему в базе
/// не место: кто печатает и кто сейчас в сети (PROJECT.md §9.1a — действие живёт
/// секунды и в хранилище не попадает).
@Observable
final class RealtimeCoordinator {
    private(set) var isConnected = false
    /// Счётчик успешных подключений. По его изменению открытый чат понимает, что
    /// пора догнать пропущенное: событий за время обрыва никто не переприсылает.
    private(set) var connectionEpoch = 0
    /// Кто что делает: чат → (пользователь → действие).
    private(set) var actions: [String: [String: String]] = [:]
    private(set) var onlineUsers: Set<String> = []
    /// Последняя пришедшая смена статуса заявки. Экран заявок смотрит на неё и
    /// перечитывает себя: держать копию заявок в координаторе незачем. Время в
    /// поле — чтобы повторный тот же статус тоже считался новостью.
    private(set) var applicationStatus: ApplicationStatusChange?

    private let transport: RealtimeTransport
    private let session: SessionStore
    private let database: AppDatabase
    private let store: ChatStore

    private var pump: Task<Void, Never>?
    private var expiry: [String: Task<Void, Never>] = [:]
    /// Чат, открытый на экране: его сообщения не увеличивают счётчик непрочитанного.
    private var openChatID: String?

    init(
        transport: RealtimeTransport,
        session: SessionStore = AppServices.session,
        database: AppDatabase = AppServices.database
    ) {
        self.transport = transport
        self.session = session
        self.database = database
        store = ChatStore(database: database)
    }

    deinit {
        pump?.cancel()
        for task in expiry.values { task.cancel() }
    }

    @MainActor
    func start() {
        guard pump == nil else { return }
        pump = Task { @MainActor [weak self] in
            guard let self else { return }
            for await event in self.transport.events {
                await self.handle(event)
            }
        }
        Task { await connect() }
    }

    @MainActor
    func stop() async {
        pump?.cancel()
        pump = nil
        isConnected = false
        actions = [:]
        onlineUsers = []
        await transport.disconnect()
    }

    /// Открытый чат: вход в комнату и признак того, что его сообщения читают прямо
    /// сейчас.
    @MainActor
    func open(chatID: String) async {
        openChatID = chatID
        await transport.join(chatID: chatID)
    }

    @MainActor
    func close(chatID: String) async {
        if openChatID == chatID { openChatID = nil }
        await transport.leave(chatID: chatID)
    }

    @MainActor
    func markRead(chatID: String, messageID: String) async {
        await transport.markRead(chatID: chatID, messageID: messageID)
    }

    @MainActor
    func send(action: String?, chatID: String) async {
        await transport.send(action: action, chatID: chatID)
    }

    // MARK: - События

    @MainActor
    private func handle(_ event: RealtimeEvent) async {
        switch event {
        case .connected:
            isConnected = true
            connectionEpoch += 1
            // Комнату после переподключения сервер не помнит — входим заново.
            if let openChatID { await transport.join(chatID: openChatID) }

        case .disconnected:
            isConnected = false

        case .messageNew(let message):
            await save(message, countsAsUnread: true)

        case .messageUpdated(let message):
            await save(message, countsAsUnread: false)

        case .messageDeleted(let id, _):
            try? await database.writer.write { db in
                guard var row = try MessageRecord.fetchOne(db, key: id), row.deletedAt == nil else { return }
                row.deletedAt = Date()
                try row.update(db)
            }

        case .chatRead(let chatID, _):
            // Прочитано на другом устройстве — счётчик гаснет и здесь.
            try? await database.writer.write { db in
                guard var chat = try ChatRecord.fetchOne(db, key: chatID), chat.unreadCount != 0 else { return }
                chat.unreadCount = 0
                try chat.update(db)
            }

        case .messageRead(let chatID, _, let readAt):
            try? await database.writer.write { db in
                guard var chat = try ChatRecord.fetchOne(db, key: chatID) else { return }
                guard (chat.othersReadAt ?? .distantPast) < readAt else { return }
                chat.othersReadAt = readAt
                try chat.update(db)
            }

        case .action(let chatID, let userID, let action):
            apply(action: action, chatID: chatID, userID: userID)

        case .presence(let userID, let online):
            if online { onlineUsers.insert(userID) } else { onlineUsers.remove(userID) }

        case .chatUpdated(let chat):
            try? await store.save(chats: [chat])

        case .applicationStatusChanged(let id, let status):
            applicationStatus = ApplicationStatusChange(id: id, status: status, at: Date())
        }
    }

    @MainActor
    private func save(_ message: ChatMessageDTO, countsAsUnread: Bool) async {
        let viewerID = await session.currentToken?.subject
        let isOpen = openChatID == message.chatId
        try? await database.writer.write { db in
            try MessageStore.upsert(message, in: db)
            guard var chat = try ChatRecord.fetchOne(db, key: message.chatId) else { return }
            if let seq = message.seq, seq > chat.lastSeq {
                chat.lastSeq = seq
                chat.lastMessageId = message.id
                chat.updatedAt = message.createdAt
            }
            // Счётчик растёт только от чужого и только в закрытом чате: читаемое
            // прямо сейчас непрочитанным не бывает.
            if countsAsUnread, !isOpen, message.senderId != viewerID {
                chat.unreadCount += 1
            }
            try chat.update(db)
        }
    }

    /// Подпись живёт четыре секунды без подтверждения (§9.1a): «стоп» может не
    /// прийти вовсе — у отправителя сел аккумулятор или оборвалась связь.
    @MainActor
    private func apply(action: String?, chatID: String, userID: String) {
        let key = "\(chatID)|\(userID)"
        expiry[key]?.cancel()
        expiry[key] = nil

        guard let action else {
            actions[chatID]?.removeValue(forKey: userID)
            if actions[chatID]?.isEmpty == true { actions[chatID] = nil }
            return
        }

        actions[chatID, default: [:]][userID] = action
        expiry[key] = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self?.apply(action: nil, chatID: chatID, userID: userID)
        }
    }

    private func connect() async {
        guard let token = await session.accessToken() else { return }
        await transport.connect(token: token)
    }
}


/// Смена статуса заявки, пришедшая в реальном времени.
struct ApplicationStatusChange: Equatable {
    let id: String
    let status: String
    let at: Date
}

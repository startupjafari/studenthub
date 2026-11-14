import Foundation
import GRDB
import Observation
import os

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
    /// То же по чату отдельными наблюдаемыми объектами — для строк списка чатов: строка
    /// следит только за своим чатом, и «печатает…» в одном чате не пересчитывает
    /// остальные строки и весь список.
    @ObservationIgnored private var activities: [String: ChatActivity] = [:]
    /// Тот же приём для остального, что меняется часто (P1-4 аудита): словари ниже
    /// остаются, но экраны читают объекты по ключу — прочтение в одном чате, голос в
    /// одном опросе или «в сети» одного человека пересчитывают только своих зрителей.
    @ObservationIgnored private var chatSignals: [String: ChatSignals] = [:]
    @ObservationIgnored private var presenceSignals: [String: PresenceSignal] = [:]
    @ObservationIgnored private var pollSignals: [String: PollSignal] = [:]
    @ObservationIgnored private var checklistSignals: [String: ChecklistSignal] = [:]
    private(set) var onlineUsers: Set<String> = []
    /// Последняя смена статуса «в сети» по каждому, о ком приходили события, с
    /// моментом прихода. `onlineUsers` не отличает «ушёл» от «не знаем»; счётчику
    /// «N в сети» это нужно: снимок участников с сервера старше события — верит
    /// событию, новее — снимку.
    private(set) var presenceMarks: [String: PresenceMark] = [:]
    /// Кто из других участников до какого момента дочитал: чат → (пользователь →
    /// время). Только из событий — открытый групповой чат накладывает это на свой
    /// снимок `GET /chats/:id/reads`, а не перезапрашивает его на каждое прочтение.
    private(set) var memberReads: [String: [String: Date]] = [:]
    /// Последняя пришедшая смена статуса заявки. Экран заявок смотрит на неё и
    /// перечитывает себя: держать копию заявок в координаторе незачем. Время в
    /// поле — чтобы повторный тот же статус тоже считался новостью.
    private(set) var applicationStatus: ApplicationStatusChange?
    /// Счётчики перемен: экран смотрит на своё значение и перечитывает закреплённые
    /// сообщения или результаты опроса, когда оно выросло.
    private(set) var pinnedVersions: [String: Int] = [:]
    private(set) var pollVersions: [String: Int] = [:]
    /// Свежее состояние общих списков из `checklist:updated`: пузырь берёт его поверх
    /// того, что пришло с сообщением.
    private(set) var checklists: [String: MessageExtras.Checklist] = [:]

    private let transport: RealtimeTransport
    private let session: SessionStore
    private let database: AppDatabase
    private let store: ChatStore

    /// Единственный читатель потока событий. Живёт столько же, сколько транспорт, и
    /// при выходе из аккаунта не отменяется: отмена читающей задачи завершает
    /// `AsyncStream` навсегда, и после входа следующего человека событий не было бы.
    private var pump: Task<Void, Never>?
    /// Есть ли сессия, которой события адресованы. Между выходом и входом приходящее
    /// (запоздалое событие старого сокета) в базу не пишется.
    private var active = false
    /// Переподключение со свежим токеном. Свой автоповтор socket.io шлёт тот токен,
    /// с которым соединение открывали, — через 15 минут сервер его отклоняет и рвёт
    /// связь, и без этой задачи реального времени не было бы до перезапуска.
    private var reconnect: Task<Void, Never>?
    private var reconnectDelay = RealtimeCoordinator.firstReconnectDelay
    /// Когда соединение поднялось: короткое (сервер принял и тут же отключил) не
    /// сбрасывает паузу, иначе отказ сервера превратился бы в долбёжку раз в секунду.
    private var connectedAt: Date?
    private var expiry: [String: Task<Void, Never>] = [:]
    /// Чат, открытый на экране: его сообщения не увеличивают счётчик непрочитанного.
    private var openChatID: String?
    private var listRefresh: Task<Void, Never>?
    private let api: ChatsFetching?

    init(
        transport: RealtimeTransport,
        session: SessionStore = AppServices.session,
        database: AppDatabase = AppServices.database,
        api: ChatsFetching? = nil
    ) {
        self.transport = transport
        self.session = session
        self.database = database
        self.api = api
        store = ChatStore(database: database)
    }

    deinit {
        pump?.cancel()
        reconnect?.cancel()
        for task in expiry.values { task.cancel() }
    }

    @MainActor
    func start() {
        if pump == nil {
            pump = Task { @MainActor [weak self] in
                guard let self else { return }
                for await event in self.transport.events {
                    await self.handle(event)
                }
            }
        }
        guard !active else { return }
        active = true
        reconnectDelay = Self.firstReconnectDelay
        Task { await connect() }
    }

    /// Выход из аккаунта: рвём соединение и забываем всё, что знали о прежнем
    /// человеке. Читатель потока остаётся — его понадобится следующему входу.
    @MainActor
    func stop() async {
        active = false
        reconnect?.cancel()
        reconnect = nil
        connectedAt = nil
        isConnected = false
        actions = [:]
        // Выход из аккаунта: строки списка прежнего аккаунта уже ушли, их объекты не
        // нужны следующему. Погашены — на случай, если чей-то вид ещё держит ссылку.
        for activity in activities.values { activity.action = nil }
        activities = [:]
        for signal in chatSignals.values {
            signal.memberReads = [:]
        }
        chatSignals = [:]
        for signal in presenceSignals.values { signal.mark = nil }
        presenceSignals = [:]
        pollSignals = [:]
        for signal in checklistSignals.values { signal.checklist = nil }
        checklistSignals = [:]
        onlineUsers = []
        presenceMarks = [:]
        memberReads = [:]
        openChatID = nil
        applicationStatus = nil
        listRefresh?.cancel()
        listRefresh = nil
        pinnedVersions = [:]
        pollVersions = [:]
        checklists = [:]
        for task in expiry.values { task.cancel() }
        expiry = [:]
        await transport.disconnect()
    }

    /// Открытый чат: вход в комнату и признак того, что его сообщения читают прямо
    /// сейчас.
    @MainActor
    func open(chatID: String) async {
        openChatID = chatID
        await transport.join(chatID: chatID)
    }

    /// Чат, открытый на экране: баннер о сообщении в нём не нужен — человек его читает.
    @MainActor
    var openChat: String? { openChatID }

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

    @MainActor
    func edit(messageID: String, content: String) async {
        await transport.edit(messageID: messageID, content: content)
    }

    @MainActor
    func delete(messageID: String) async {
        await transport.delete(messageID: messageID)
    }

    /// Свой ответ сервера на правку списка — сразу всем пузырям с этим списком.
    @MainActor
    func remember(_ checklist: MessageExtras.Checklist) {
        checklists[checklist.id] = checklist
        checklistSignals[checklist.id]?.checklist = checklist
    }

    // MARK: - События

    @MainActor
    private func handle(_ event: RealtimeEvent) async {
        guard active else { return }
        switch event {
        case .connected:
            isConnected = true
            connectedAt = Date()
            reconnect?.cancel()
            reconnect = nil
            connectionEpoch += 1
            // Комнату после переподключения сервер не помнит — входим заново.
            if let openChatID { await transport.join(chatID: openChatID) }
            // Переподключение, а не первое подключение: за время обрыва события мимо
            // прошли, и не только по открытому чату — его догоняет сам экран, а список
            // и счётчики догоняются здесь (P0-3 аудита). Первой страницы хватает:
            // изменившиеся чаты поднимаются наверх.
            if connectionEpoch > 1 { scheduleListRefresh() }

        case .disconnected:
            isConnected = false
            if let connectedAt, Date().timeIntervalSince(connectedAt) >= Self.stableConnection {
                reconnectDelay = Self.firstReconnectDelay
            }
            connectedAt = nil
            scheduleReconnect()

        case .messageNew(let message, let nonce):
            Signposts.chats.emitEvent("MessageReceived", "new")
            await save(message, nonce: nonce, countsAsUnread: true)

        case .messageUpdated(let message):
            Signposts.chats.emitEvent("MessageReceived", "updated")
            await save(message, countsAsUnread: false)

        case .messageDeleted(let id, _):
            try? await database.writer.write { db in
                guard var row = try MessageRecord.fetchOne(db, key: id), row.deletedAt == nil else { return }
                row.deletedAt = Date()
                try row.update(db)
            }

        case .chatRead(let chatID, let readAt):
            Signposts.chats.emitEvent("ReadReceiptReceived", "chat")
            // Прочитано на другом устройстве — счётчик гаснет и здесь, но только если
            // отметка дошла до последнего сообщения: иначе непрочитанное ещё есть, и
            // точное число скажет список.
            let cleared = (try? await database.writer.write { db -> Bool in
                guard var chat = try ChatRecord.fetchOne(db, key: chatID), chat.unreadCount != 0 else { return true }
                let last = try chat.lastMessageId.flatMap { try MessageRecord.fetchOne(db, key: $0) }
                guard (last?.createdAt ?? .distantPast) <= readAt else { return false }
                chat.unreadCount = 0
                try chat.update(db)
                return true
            }) ?? true
            if !cleared { scheduleListRefresh() }

        case .messageRead(let chatID, let userID, let readAt):
            Signposts.chats.emitEvent("ReadReceiptReceived", "message")
            // Сервер шлёт прочтение всей комнате, и мне — моё же. Галочки своих
            // сообщений от собственного чтения загорались бы сами.
            let viewerID = await session.currentToken?.subject
            guard userID != viewerID else { return }
            if (memberReads[chatID]?[userID] ?? .distantPast) < readAt {
                memberReads[chatID, default: [:]][userID] = readAt
                chatSignals[chatID]?.memberReads[userID] = readAt
            }
            try? await database.writer.write { db in
                guard var chat = try ChatRecord.fetchOne(db, key: chatID) else { return }
                guard (chat.othersReadAt ?? .distantPast) < readAt else { return }
                chat.othersReadAt = readAt
                try chat.update(db)
            }

        case .action(let chatID, let userID, let action):
            Signposts.chats.emitEvent("TypingReceived")
            apply(action: action, chatID: chatID, userID: userID)

        case .presence(let userID, let online):
            if online { onlineUsers.insert(userID) } else { onlineUsers.remove(userID) }
            let mark = PresenceMark(online: online, at: Date())
            presenceMarks[userID] = mark
            presenceSignals[userID]?.mark = mark

        case .chatUpdated(let chatID, let title, let avatar):
            try? await database.writer.write { db in
                guard var chat = try ChatRecord.fetchOne(db, key: chatID) else { return }
                if let title { chat.title = title }
                if let avatar { chat.avatarUrl = avatar }
                try chat.update(db)
            }

        case .chatActivity, .blockChanged:
            scheduleListRefresh()

        case .chatPinned(let chatID):
            pinnedVersions[chatID, default: 0] += 1
            chatSignals[chatID]?.pinnedVersion += 1

        case .scheduledChanged(let chatID):
            // Только открытому чату: часы в поле ввода есть лишь там, а при открытии
            // список и так читается заново.
            chatSignals[chatID]?.scheduledVersion += 1

        case .pollUpdated(let pollID, _):
            pollVersions[pollID, default: 0] += 1
            pollSignals[pollID]?.version += 1

        case .checklistUpdated(let checklist, _):
            remember(checklist)

        case .locationUpdated(let location, let messageID, _):
            await LiveLocations.apply(location, messageID: messageID)

        case .messagesHidden(let chatID, let ids):
            try? await MessageStore(database: database).removeHidden(remoteIDs: ids, chatID: chatID)

        case .applicationStatusChanged(let id, let status):
            applicationStatus = ApplicationStatusChange(id: id, status: status, at: Date())
        }
    }

    @MainActor
    private func save(_ message: ChatMessageDTO, nonce: String? = nil, countsAsUnread: Bool) async {
        let viewerID = await session.currentToken?.subject
        let isOpen = openChatID == message.chatId
        try? await database.writer.write { db in
            try MessageStore.upsert(message, nonce: nonce, in: db)
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

    /// Обновить верх списка: в одном из чатов что-то произошло. События идут пачками
    /// (сообщение, затем прочтение), поэтому запрос — после короткой паузы, один на
    /// пачку. Первой страницы хватает: изменившийся чат поднимается наверх.
    @MainActor
    private func scheduleListRefresh() {
        listRefresh?.cancel()
        listRefresh = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            guard let self, !Task.isCancelled else { return }
            let api = self.api ?? ChatsAPI()
            guard let page = try? await api.chats(cursor: nil, limit: 50) else { return }
            try? await self.store.save(chats: page.items)
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
            syncActivity(of: chatID)
            return
        }

        actions[chatID, default: [:]][userID] = action
        syncActivity(of: chatID)
        expiry[key] = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self?.apply(action: nil, chatID: chatID, userID: userID)
        }
    }

    /// Наблюдаемое «что делают» одного чата. Создаётся по первому запросу строки.
    @MainActor
    func activity(for chatID: String) -> ChatActivity {
        if let known = activities[chatID] { return known }
        let made = ChatActivity()
        made.action = actions[chatID]?.values.first
        activities[chatID] = made
        return made
    }

    /// Сигналы одного чата: закрепление и прочтения участников.
    @MainActor
    func signals(for chatID: String) -> ChatSignals {
        if let known = chatSignals[chatID] { return known }
        let made = ChatSignals()
        made.pinnedVersion = pinnedVersions[chatID] ?? 0
        made.memberReads = memberReads[chatID] ?? [:]
        chatSignals[chatID] = made
        return made
    }

    /// «В сети» одного человека по событиям; `mark == nil` — событий о нём не было.
    @MainActor
    func presence(of userID: String) -> PresenceSignal {
        if let known = presenceSignals[userID] { return known }
        let made = PresenceSignal()
        made.mark = presenceMarks[userID]
        presenceSignals[userID] = made
        return made
    }

    /// Счётчик перемен одного опроса.
    @MainActor
    func pollSignal(_ pollID: String) -> PollSignal {
        if let known = pollSignals[pollID] { return known }
        let made = PollSignal()
        made.version = pollVersions[pollID] ?? 0
        pollSignals[pollID] = made
        return made
    }

    /// Свежее состояние одного общего списка.
    @MainActor
    func checklistSignal(_ checklistID: String) -> ChecklistSignal {
        if let known = checklistSignals[checklistID] { return known }
        let made = ChecklistSignal()
        made.checklist = checklists[checklistID]
        checklistSignals[checklistID] = made
        return made
    }

    @MainActor
    private func syncActivity(of chatID: String) {
        guard let activity = activities[chatID] else { return }
        let current = actions[chatID]?.values.first
        if activity.action != current { activity.action = current }
    }

    @MainActor
    private func connect() async {
        // Токена нет (сеть не дала продлить сессию) — пробуем позже, а не сдаёмся до
        // перезапуска приложения.
        guard let token = await session.accessToken() else { return scheduleReconnect() }
        await transport.connect(token: token)
    }

    /// Приложение вернулось на передний план. В фоне система рвёт сокет, а пауза до
    /// переподключения могла дорасти до минуты — человек не должен её ждать.
    @MainActor
    func resume() async {
        guard active, !isConnected else { return }
        reconnect?.cancel()
        reconnect = nil
        reconnectDelay = Self.firstReconnectDelay
        await connect()
    }

    /// Обрыв: через паузу подключиться заново с токеном, который выдаст сессия сейчас
    /// (`accessToken()` продлит просроченный). Пауза растёт до минуты, пока соединение
    /// не продержится дольше `stableConnection`.
    @MainActor
    private func scheduleReconnect() {
        guard active, reconnect == nil else { return }
        let delay = reconnectDelay
        reconnectDelay = min(reconnectDelay * 2, Self.maxReconnectDelay)
        reconnect = Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard let self, !Task.isCancelled else { return }
            self.reconnect = nil
            guard self.active, !self.isConnected else { return }
            await self.connect()
        }
    }

    private static let firstReconnectDelay: Duration = .seconds(2)
    private static let maxReconnectDelay: Duration = .seconds(60)
    private static let stableConnection: TimeInterval = 10
}


/// Статус «в сети» из события и когда оно пришло.
struct PresenceMark: Equatable {
    let online: Bool
    let at: Date
}

/// Смена статуса заявки, пришедшая в реальном времени.
struct ApplicationStatusChange: Equatable {
    let id: String
    let status: String
    let at: Date
}

/// «Печатает…», «записывает голосовое» одного чата (`RealtimeCoordinator.activity(for:)`).
@Observable
final class ChatActivity {
    var action: String?
}

/// Закрепление и прочтения участников одного чата (`RealtimeCoordinator.signals(for:)`).
@Observable
final class ChatSignals {
    var pinnedVersion = 0
    /// Растёт с каждым `chat:scheduled-changed`: экран перечитывает свои отложенные.
    var scheduledVersion = 0
    var memberReads: [String: Date] = [:]
}

/// «В сети» одного человека (`RealtimeCoordinator.presence(of:)`).
@Observable
final class PresenceSignal {
    var mark: PresenceMark?
    var isOnline: Bool { mark?.online == true }
}

/// Счётчик перемен одного опроса (`RealtimeCoordinator.pollSignal(_:)`).
@Observable
final class PollSignal {
    var version = 0
}

/// Свежее состояние одного общего списка (`RealtimeCoordinator.checklistSignal(_:)`).
@Observable
final class ChecklistSignal {
    var checklist: MessageExtras.Checklist?
}

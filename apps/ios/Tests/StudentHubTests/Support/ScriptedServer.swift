import Foundation
import XCTest

@testable import StudentHub

/// Сценарный дублёр сети для тестов синхронизации (IOS_RULES 2.5.1).
///
/// Ведёт журнал ушедшего — HTTP-запросов и событий сокета одной лентой, в порядке
/// отправки — и умеет придержать ответ до сигнала теста. Без удержания гонку не
/// воспроизвести: событие сокета должно прийти, пока запрос ещё в пути. Журнал же
/// отвечает на вопрос «что ушло», а не только «сколько раз позвали».
///
/// Класс под замком, а не актор: условие `waitUntil` читается синхронно с главного
/// потока, а дублёры-акторы зовут сервер из своей изоляции.
final class ScriptedServer: @unchecked Sendable {
    /// Ушедший запрос. У сокета метод — `WS`, путь — имя события.
    struct Request: Equatable, Sendable, CustomStringConvertible {
        let method: String
        let path: String
        /// Параметры строкой `ключ=значение&…` по алфавиту ключей: у GET — строка
        /// запроса, у остального — тело. `nil` — параметров нет.
        let body: String?

        /// «GET chats/c-1/updates» — по таким строкам сверяют стоимость сценария.
        var name: String { "\(method) \(path)" }
        var description: String { body.map { "\(name) \($0)" } ?? name }

        init(method: String, path: String, body: String? = nil) {
            self.method = method
            self.path = path
            self.body = body
        }

        init(method: String, path: String, fields: [String: String?]) {
            let pairs = fields.compactMap { key, value in value.map { "\(key)=\($0)" } }.sorted()
            self.init(method: method, path: path, body: pairs.isEmpty ? nil : pairs.joined(separator: "&"))
        }

        /// Значение параметра из `body`.
        func field(_ key: String) -> String? {
            guard let body else { return nil }
            for pair in body.split(separator: "&") {
                let parts = pair.split(separator: "=", maxSplits: 1)
                if parts.first.map(String.init) == key {
                    return parts.count > 1 ? String(parts[1]) : ""
                }
            }
            return nil
        }
    }

    /// Чем ответить на запрос.
    enum Reply: @unchecked Sendable {
        /// Следующий ответ из очереди `enqueue`, а без неё — запасной ответ дублёра.
        case scripted
        /// Готовое значение того типа, что ждёт дублёр.
        case value(Any)
        case failure(Error)
    }

    private struct Parked {
        let id: Int
        let request: Request
        let continuation: CheckedContinuation<Reply, Error>
    }

    /// Отменённая задача снимает придержанный запрос с `CancellationError`, как
    /// `URLSession`. Выключают, когда тест сам доставляет поздний ответ после отмены.
    private let honorsCancellation: Bool
    private let lock = NSLock()
    private var log: [Request] = []
    private var holdsEverything = false
    private var heldPaths: Set<String> = []
    private var parked: [Parked] = []
    private var cancelledIDs: Set<Int> = []
    private var nextID = 0
    private var queued: [String: [Reply]] = [:]

    init(honorsCancellation: Bool = true) {
        self.honorsCancellation = honorsCancellation
    }

    // MARK: - Журнал

    /// Всё ушедшее по порядку.
    var requests: [Request] { lock.withLock { log } }
    /// Только имена — для сверки стоимости сценария целиком.
    var requestNames: [String] { requests.map(\.name) }

    func matching(_ method: String, _ path: String) -> [Request] {
        requests.filter { $0.method == method && $0.path == path }
    }

    /// Сколько ответов сейчас придержано: всех или к одному пути.
    func waiting(_ path: String? = nil) -> Int {
        lock.withLock { parked.filter { path == nil || $0.request.path == path }.count }
    }

    // MARK: - Сценарий

    /// Придерживать все следующие запросы до `release`.
    func holdEverything() {
        lock.withLock { holdsEverything = true }
    }

    /// Придерживать следующие запросы к пути до `release`.
    func hold(_ path: String) {
        lock.withLock { _ = heldPaths.insert(path) }
    }

    /// Больше не придерживать. Уже придержанные ждут своего `release`.
    func stopHolding() {
        lock.withLock {
            holdsEverything = false
            heldPaths = []
        }
    }

    /// Ответы на запросы к пути — по одному на запрос, по порядку.
    func enqueue(_ path: String, _ replies: Reply...) {
        lock.withLock { queued[path, default: []].append(contentsOf: replies) }
    }

    /// Отпустить самый ранний придержанный запрос (к пути, если он задан).
    func release(_ path: String? = nil, with reply: Reply = .scripted, file: StaticString = #filePath, line: UInt = #line) {
        let entry: Parked? = lock.withLock {
            guard let index = parked.firstIndex(where: { path == nil || $0.request.path == path }) else { return nil }
            return parked.remove(at: index)
        }
        guard let entry else { return XCTFail("нечего отпускать", file: file, line: line) }
        entry.continuation.resume(returning: reply)
    }

    // MARK: - Для дублёров

    /// Запись без ответа — исходящее событие сокета.
    func record(_ request: Request) {
        lock.withLock { log.append(request) }
    }

    /// Запрос с ответом: в журнал, при удержании — ждать сигнала теста, затем ответ по
    /// сценарию или `fallback`.
    func respond<Response>(to request: Request, fallback: () throws -> Response) async throws -> Response {
        let (id, held) = lock.withLock { () -> (Int, Bool) in
            log.append(request)
            nextID += 1
            return (nextID, holdsEverything || heldPaths.contains(request.path))
        }
        var reply = Reply.scripted
        if held { reply = try await park(request, id: id) }
        if case .scripted = reply {
            reply = lock.withLock {
                guard var list = queued[request.path], !list.isEmpty else { return .scripted }
                let next = list.removeFirst()
                queued[request.path] = list
                return next
            }
        }
        switch reply {
        case .scripted:
            return try fallback()
        case .value(let value):
            guard let typed = value as? Response else {
                XCTFail("ответ на \(request.name) — \(type(of: value)), а ждут \(Response.self)")
                throw URLError(.cannotParseResponse)
            }
            return typed
        case .failure(let error):
            throw error
        }
    }

    private func park(_ request: Request, id: Int) async throws -> Reply {
        guard honorsCancellation else {
            return try await withCheckedThrowingContinuation { continuation in
                lock.withLock { parked.append(Parked(id: id, request: request, continuation: continuation)) }
            }
        }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                // Отмена могла прийти раньше, чем запрос встал в очередь.
                let cancelled = lock.withLock { () -> Bool in
                    if cancelledIDs.remove(id) != nil { return true }
                    parked.append(Parked(id: id, request: request, continuation: continuation))
                    return false
                }
                if cancelled { continuation.resume(throwing: CancellationError()) }
            }
        } onCancel: {
            let entry: Parked? = lock.withLock {
                guard let index = parked.firstIndex(where: { $0.id == id }) else {
                    cancelledIDs.insert(id)
                    return nil
                }
                return parked.remove(at: index)
            }
            entry?.continuation.resume(throwing: CancellationError())
        }
    }
}

// MARK: - Дублёры протоколов на сценарном сервере

/// Список чатов: пути — как у `ChatsAPI`, по умолчанию пустые ответы.
struct ScriptedChats: ChatsFetching {
    let server: ScriptedServer

    func chats(cursor: String?, limit: Int) async throws -> Page<ChatListItemDTO> {
        let request = ScriptedServer.Request(method: "GET", path: "chats", fields: ["cursor": cursor, "limit": String(limit)])
        return try await server.respond(to: request) { Page(items: [], meta: nil) }
    }

    func folders() async throws -> [ChatFolderDTO] {
        try await server.respond(to: .init(method: "GET", path: "chats/folders")) { [] }
    }

    /// Одна строка — `GET /chats/:id`; по умолчанию группа с заголовком «Строка <id>».
    func chat(id: String) async throws -> ChatListItemDTO {
        try await server.respond(to: .init(method: "GET", path: "chats/\(id)")) { Self.row(id: id) }
    }

    static func row(id: String) -> ChatListItemDTO {
        ChatListItemDTO(
            id: id, type: "GROUP", title: "Строка \(id)", avatarUrl: nil, description: nil, subject: nil,
            memberCount: 3, unreadCount: 2, muted: nil, mutedImportantOnly: nil, draft: nil, pinnedAt: nil,
            archived: nil, othersReadAt: nil, requestIncoming: nil, requestOutgoing: nil, lastMessage: nil,
            updatedAt: Date()
        )
    }

    func setPinned(_ pinned: Bool, chatID: String) async throws {
        try await toggle(pinned, path: "chats/\(chatID)/pin")
    }

    func setArchived(_ archived: Bool, chatID: String) async throws {
        try await toggle(archived, path: "chats/\(chatID)/archive")
    }

    func setMuted(_ muted: Bool, chatID: String) async throws {
        try await toggle(muted, path: "chats/\(chatID)/mute")
    }

    private func toggle(_ on: Bool, path: String) async throws {
        try await server.respond(to: .init(method: on ? "POST" : "DELETE", path: path)) { () }
    }
}

/// Переписка: пути — как у `ChatsAPI`. Догон по умолчанию — «ничего нового с `since`».
struct ScriptedMessages: ChatMessagesFetching {
    let server: ScriptedServer

    func messages(chatID: String, cursor: String?, limit: Int) async throws -> Page<ChatMessageDTO> {
        let fields: [String: String?] = ["cursor": cursor, "limit": String(limit)]
        return try await server.respond(to: .init(method: "GET", path: "chats/\(chatID)/messages", fields: fields)) {
            Page(items: [], meta: nil)
        }
    }

    func messages(chatID: String, aroundDate: Date, limit: Int) async throws -> Page<ChatMessageDTO> {
        let fields: [String: String?] = [
            "aroundDate": ISO8601DateFormatter.contract.string(from: aroundDate),
            "limit": String(limit),
        ]
        return try await server.respond(to: .init(method: "GET", path: "chats/\(chatID)/messages", fields: fields)) {
            Page(items: [], meta: nil)
        }
    }

    func newerMessages(chatID: String, after cursor: String, limit: Int) async throws -> Page<ChatMessageDTO> {
        let fields: [String: String?] = ["cursor": cursor, "direction": "newer", "limit": String(limit)]
        return try await server.respond(to: .init(method: "GET", path: "chats/\(chatID)/messages", fields: fields)) {
            Page(items: [], meta: nil)
        }
    }

    func updates(chatID: String, since: Int, sinceTs: Date?) async throws -> ChatUpdatesDTO {
        let fields: [String: String?] = [
            "since": String(since),
            "sinceTs": sinceTs.map { ISO8601DateFormatter.contract.string(from: $0) },
        ]
        return try await server.respond(to: .init(method: "GET", path: "chats/\(chatID)/updates", fields: fields)) {
            ChatUpdatesDTO(created: [], mutated: [], deletedIds: [], latestSeq: since, overflow: false)
        }
    }
}

/// Сокет: входящие события тест подаёт `emit`, исходящие пишутся в журнал сервера
/// (`WS` + имя события, как у `SocketIORealtimeTransport`) — в одну ленту с REST.
actor ScriptedTransport: RealtimeTransport {
    nonisolated let events: AsyncStream<RealtimeEvent>
    nonisolated let server: ScriptedServer
    private let continuation: AsyncStream<RealtimeEvent>.Continuation

    init(server: ScriptedServer = ScriptedServer()) {
        self.server = server
        (events, continuation) = AsyncStream<RealtimeEvent>.makeStream()
    }

    func emit(_ event: RealtimeEvent) {
        continuation.yield(event)
    }

    /// Значения поля `key` у ушедших событий `name`, по порядку.
    func sent(_ name: String, field key: String) -> [String?] {
        server.matching("WS", name).map { $0.field(key) }
    }

    var joins: [String] { sent(RealtimeEvent.Name.join, field: "chatId").compactMap { $0 } }
    var leaves: [String] { sent(RealtimeEvent.Name.leave, field: "chatId").compactMap { $0 } }
    var reads: [String] { sent(RealtimeEvent.Name.read, field: "messageId").compactMap { $0 } }
    var actions: [String?] { sent(RealtimeEvent.Name.action, field: "action") }
    var edits: [String] { sent(RealtimeEvent.Name.edit, field: "content").compactMap { $0 } }

    func connect(token: String) async {}
    func disconnect() async {}
    func refresh(token: String) async { emitted(RealtimeEvent.Name.authRefresh, [:]) }
    func join(chatID: String) async { emitted(RealtimeEvent.Name.join, ["chatId": chatID]) }
    func leave(chatID: String) async { emitted(RealtimeEvent.Name.leave, ["chatId": chatID]) }
    func markRead(chatID: String, messageID: String) async {
        emitted(RealtimeEvent.Name.read, ["chatId": chatID, "messageId": messageID])
    }
    func send(action: String?, chatID: String) async {
        emitted(RealtimeEvent.Name.action, ["chatId": chatID, "action": action])
    }
    func edit(messageID: String, content: String) async {
        emitted(RealtimeEvent.Name.edit, ["messageId": messageID, "content": content])
    }
    func delete(messageID: String) async { emitted(RealtimeEvent.Name.delete, ["messageId": messageID]) }

    private func emitted(_ name: String, _ fields: [String: String?]) {
        server.record(.init(method: "WS", path: name, fields: fields))
    }
}

// MARK: - Ожидание

/// Дождаться условия, уступая главный поток задачам движка. Сначала без часов — тест не
/// зависит от скорости машины, — затем короткими паузами до `timeout` (ответы после
/// пауз и debounce). Зависшее условие падает, а не висит.
@MainActor
func waitUntil(
    timeout: Duration = .seconds(1),
    _ condition: () -> Bool,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    for _ in 0..<2_000 {
        if condition() { return }
        await Task.yield()
    }
    let clock = ContinuousClock()
    let deadline = clock.now + timeout
    while clock.now < deadline {
        if condition() { return }
        try? await Task.sleep(for: .milliseconds(10))
    }
    if condition() { return }
    XCTFail("условие так и не выполнилось", file: file, line: line)
}

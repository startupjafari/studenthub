#if DEBUG
    import Foundation
    import UIKit

    /// Перехват запросов к API в режиме UI-тестов: ответ из `MockServer`, без сети.
    ///
    /// Стоит в двух местах: в конфигурации `APIClient.session` (`UITestHooks.protocolClasses`)
    /// и глобально (`URLProtocol.registerClass`) — для того, что ходит через
    /// `URLSession.shared`. Перехватывает только адреса API: остальное в тестах не нужно и
    /// пусть честно не загрузится.
    final class MockAPIProtocol: URLProtocol {
        override class func canInit(with request: URLRequest) -> Bool {
            guard UITestEnvironment.current.isMock, let url = request.url else { return false }
            return MockServer.relativePath(of: url) != nil
        }

        override class func canonicalRequest(for request: URLRequest) -> URLRequest {
            request
        }

        override func startLoading() {
            guard let url = request.url else {
                client?.urlProtocol(self, didFailWithError: URLError(.badURL))
                return
            }
            let reply = MockServer.shared.respond(to: request, body: Self.body(of: request))
            // Медленная сеть для истории переписки (`SH_UITEST_HISTORY_DELAY_MS`): так
            // проверяется открытие чата, где в базе одно превью, а страница едет из сети.
            let delay = Self.historyDelay(for: request)
            guard delay > 0 else {
                deliver(reply, for: url)
                return
            }
            // Клиенту `URLProtocol` отвечают на потоке, где началась загрузка.
            pending = (reply, url)
            let thread = Thread.current
            DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self else { return }
                self.perform(#selector(self.deliverPending), on: thread, with: nil, waitUntilDone: false)
            }
        }

        private var pending: (reply: MockServer.Reply, url: URL)?

        @objc private func deliverPending() {
            guard let pending else { return }
            self.pending = nil
            deliver(pending.reply, for: pending.url)
        }

        private func deliver(_ reply: MockServer.Reply, for url: URL) {
            guard let response = HTTPURLResponse(
                url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)
            else {
                client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
                return
            }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: reply.body)
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {
            pending = nil
        }

        private static let historyDelaySeconds: TimeInterval = {
            let value = ProcessInfo.processInfo.environment["SH_UITEST_HISTORY_DELAY_MS"].flatMap(Double.init) ?? 0
            return max(0, value) / 1000
        }()

        private static func historyDelay(for request: URLRequest) -> TimeInterval {
            guard historyDelaySeconds > 0, request.httpMethod ?? "GET" == "GET", let url = request.url,
                  let path = MockServer.relativePath(of: url)
            else { return 0 }
            let parts = path.split(separator: "/")
            return parts.count == 3 && parts[0] == "chats" && parts[2] == "messages" ? historyDelaySeconds : 0
        }

        /// Тело запроса: внутри `URLProtocol` оно приходит потоком, а не `httpBody`.
        private static func body(of request: URLRequest) -> Data {
            if let body = request.httpBody { return body }
            guard let stream = request.httpBodyStream else { return Data() }
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 16 * 1024)
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                guard read > 0 else { break }
                data.append(buffer, count: read)
            }
            return data
        }
    }

    /// Маршруты mock API. Состояние — в памяти процесса: отправленное сообщение и
    /// комментарий видны в следующих ответах, как на настоящем сервере.
    final class MockServer: @unchecked Sendable {
        static let shared = MockServer()

        struct Reply {
            var status: Int
            var body: Data
            var headers: [String: String] = ["Content-Type": "application/json"]
        }

        typealias JSON = MockFixtures.JSON
        private typealias Handler = (_ request: Request) -> Reply

        struct Request {
            let method: String
            let parts: [String]
            let params: [String: String]
            let query: [String: String]
            let body: Data
            let headers: [String: String]
        }

        private let lock = NSLock()
        /// Отправленные в этом процессе сообщения: чат → свежие первыми.
        private var sentMessages: [String: [JSON]] = [:]
        /// Тип файла по ключу прямой загрузки — из `presign`, для сообщения по ключам.
        private var uploadMimes: [String: String] = [:]
        private var sentComments: [String: [JSON]] = [:]
        /// Правки сообщений: реакции, закрепление, удаление «у всех» (id → поля поверх).
        private var messagePatches: [String: JSON] = [:]
        /// Скрытые «у меня» — в выдаче их нет.
        private var hiddenMessageIDs: Set<String> = []
        /// Закреплённые, свежие первыми.
        private var pinnedIDs: [String] = []
        /// Ответы пересылки по ключу идемпотентности: повтор не шлёт второй раз.
        private var forwardReplies: [String: JSON] = [:]
        private var nextID = 1
        private var routes: [(method: String, pattern: [String], handler: Handler)] = []

        private init() {
            registerRoutes()
        }

        // MARK: - Разбор адреса

        /// Путь относительно корня API (`chats/chat-1/messages`); `nil` — адрес не API.
        static func relativePath(of url: URL) -> String? {
            let base = AppConfiguration.apiBaseURL
            guard url.host == base.host, url.port == base.port else { return nil }
            let basePath = base.path.hasSuffix("/") ? base.path : base.path + "/"
            guard url.path.hasPrefix(basePath) else { return nil }
            return String(url.path.dropFirst(basePath.count))
        }

        func respond(to request: URLRequest, body: Data) -> Reply {
            guard let url = request.url, let path = Self.relativePath(of: url) else {
                return Self.error(404, code: "NOT_FOUND", message: "Not found")
            }
            let method = request.httpMethod ?? "GET"
            let parts = path.split(separator: "/").map(String.init)
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .reduce(into: [String: String]()) { $0[$1.name] = $1.value ?? "" } ?? [:]

            for route in routes where route.method == method {
                guard let params = Self.match(route.pattern, parts) else { continue }
                let request = Request(
                    method: method, parts: parts, params: params, query: query, body: body,
                    headers: request.allHTTPHeaderFields ?? [:])
                return lock.withLock { route.handler(request) }
            }
            print("[MockAPI] unmatched \(method) /\(path)")
            return Self.error(404, code: "NOT_FOUND", message: "Mock: маршрут не описан")
        }

        private static func match(_ pattern: [String], _ parts: [String]) -> [String: String]? {
            guard pattern.count == parts.count else { return nil }
            var params: [String: String] = [:]
            for (expected, actual) in zip(pattern, parts) {
                if expected.hasPrefix(":") {
                    params[String(expected.dropFirst())] = actual.removingPercentEncoding ?? actual
                } else if expected != actual {
                    return nil
                }
            }
            return params
        }

        // MARK: - Ответы

        static func ok(_ data: Any, meta: JSON? = nil, headers: [String: String] = [:]) -> Reply {
            var envelope: JSON = ["success": true, "data": data]
            if let meta { envelope["meta"] = meta }
            var reply = Reply(status: 200, body: encode(envelope))
            reply.headers.merge(headers) { $1 }
            return reply
        }

        static var empty: Reply { ok(NSNull()) }

        static func error(_ status: Int, code: String, message: String) -> Reply {
            Reply(
                status: status,
                body: encode([
                    "success": false,
                    "error": ["code": code, "message": message],
                    "statusCode": status,
                ]))
        }

        private static func encode(_ value: Any) -> Data {
            (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{}".utf8)
        }

        /// Страница списка: `cursor` — смещение, как его ни назови на сервере.
        private static func page(_ total: Int, query: [String: String], defaultLimit: Int, item: (Int) -> JSON) -> Reply {
            let offset = query["cursor"].flatMap(Int.init) ?? 0
            let limit = min(query["limit"].flatMap(Int.init) ?? defaultLimit, 200)
            let end = min(total, offset + limit)
            let items = offset < end ? (offset..<end).map(item) : []
            let hasNext = end < total
            var meta: JSON = ["hasNext": hasNext, "total": total]
            if hasNext { meta["cursor"] = String(end) }
            return ok(items, meta: meta)
        }

        /// Новое своё сообщение в чате: номер — следующий после фикстур и уже отправленного.
        private func newMessage(in chatID: String, content: String?, replyToID: String?) -> JSON {
            let index = MockFixtures.chatIndex(of: chatID) ?? 0
            let sent = sentMessages[chatID] ?? []
            let seq = MockFixtures.messageCount(chatIndex: index) + sent.count + 1
            var message: JSON = [
                "id": "\(chatID)-m\(seq)",
                "chatId": chatID,
                "seq": seq,
                "senderId": MockFixtures.studentID,
                "sender": MockFixtures.student.json,
                "content": content ?? "",
                // Свежее любого сообщения фикстур: точка отсчёта плюс номер отправки.
                "createdAt": MockFixtures.iso(Date(timeIntervalSince1970: MockFixtures.epoch + TimeInterval(sent.count + 1))),
            ]
            if let replyToID { message["replyToId"] = replyToID }
            return message
        }

        private func store(_ message: JSON, in chatID: String) -> JSON {
            sentMessages[chatID] = [message] + (sentMessages[chatID] ?? [])
            return message
        }

        private func makeID(_ prefix: String) -> String {
            defer { nextID += 1 }
            return "\(prefix)-\(nextID)"
        }

        // MARK: - Маршруты

        private func route(_ method: String, _ pattern: String, _ handler: @escaping Handler) {
            routes.append((method, pattern.split(separator: "/").map(String.init), handler))
        }

        private func registerRoutes() {
            registerAuthRoutes()
            registerProfileRoutes()
            registerChatRoutes()
            registerFeedRoutes()
        }

        private func registerAuthRoutes() {
            route("GET", "client-version") { _ in Self.ok(MockFixtures.clientVersion) }

            route("POST", "auth/login") { request in
                let body = (try? JSONSerialization.jsonObject(with: request.body)) as? JSON
                let identifier = (body?["identifier"] as? String)?.lowercased()
                guard identifier == MockFixtures.login, body?["password"] as? String == MockFixtures.password else {
                    return Self.error(401, code: "UNAUTHORIZED", message: "Неверный email или пароль")
                }
                return Self.ok(
                    ["accessToken": MockFixtures.studentAccessToken],
                    headers: ["Set-Cookie": "sh_refresh=\(MockFixtures.refreshCookie); Path=/api/v1/auth; HttpOnly; Max-Age=2592000"])
            }

            route("POST", "auth/refresh") { request in
                guard request.headers["Cookie"]?.contains(MockFixtures.refreshCookie) == true else {
                    return Self.error(401, code: "UNAUTHORIZED", message: "Сессия истекла")
                }
                return Self.ok(["accessToken": MockFixtures.studentAccessToken])
            }

            route("POST", "auth/logout") { _ in
                var reply = Self.empty
                reply.headers["Set-Cookie"] = "sh_refresh=; Path=/api/v1/auth; Max-Age=0"
                return reply
            }

            route("GET", "users/me/consent") { _ in Self.ok(MockFixtures.consent) }
            route("POST", "push/devices/remove") { _ in Self.empty }
        }

        private func registerProfileRoutes() {
            route("GET", "users/me") { _ in Self.ok(MockFixtures.me) }
            route("GET", "users/:id") { request in Self.ok(MockFixtures.user(id: request.params["id"] ?? "")) }
            route("GET", "profile/:id/counts") { _ in Self.ok(MockFixtures.profileCounts) }
            route("GET", "profile/:id/media") { _ in Self.ok([Any]()) }
            route("GET", "profile/:id/articles") { _ in Self.ok([Any]()) }
            route("GET", "polls/by-user/:id") { _ in Self.ok([Any]()) }
            route("GET", "friends/count") { _ in Self.ok(["friends": 12]) }
            route("GET", "friends/requests") { _ in Self.ok([Any](), meta: ["hasNext": false]) }
            route("GET", "notifications/unread-count") { _ in Self.ok(["count": 1]) }
            route("GET", "notifications") { request in
                Self.page(MockFixtures.notifications.count, query: request.query, defaultLimit: 30) {
                    MockFixtures.notifications[$0]
                }
            }
            route("GET", "notifications/settings") { _ in Self.ok(["pushEnabled": true, "emailEnabled": false]) }
            route("GET", "events") { _ in Self.ok([Any](), meta: ["hasNext": false, "total": 0]) }
            route("GET", "schedule") { _ in Self.ok(MockFixtures.schedule) }
            route("GET", "schedule/changes") { _ in Self.ok([Any]()) }
            route("GET", "search") { _ in Self.ok(["people": [Any](), "events": [Any]()]) }
        }

        private func registerChatRoutes() {
            route("GET", "chats") { [unowned self] request in
                Self.page(MockFixtures.chatCount, query: request.query, defaultLimit: 100) { index in
                    let id = MockFixtures.chatID(index)
                    let last = self.sentMessages[id]?.first ?? MockFixtures.message(chatIndex: index, position: 0)
                    return MockFixtures.chat(index, lastMessage: last)
                }
            }
            route("GET", "chats/folders") { _ in Self.ok([Any]()) }
            route("GET", "chats/saved") { _ in Self.ok(["id": "chat-saved"]) }
            route("GET", "chats/stickers/sets") { _ in Self.ok([Any]()) }
            route("GET", "chats/gifs/recent") { _ in Self.ok([Any]()) }

            route("GET", "chats/:id/messages") { [unowned self] request in
                let id = request.params["id"] ?? ""
                guard let index = MockFixtures.chatIndex(of: id) else {
                    return Self.error(404, code: "NOT_FOUND", message: "Чат не найден")
                }
                // Догрузка вниз из окна истории: новее последней страницы ничего нет.
                if request.query["direction"] == "newer" {
                    return Self.ok([Any](), meta: ["hasPrev": false, "hasNext": false])
                }
                _ = index
                let all = self.messages(of: id)
                // Окно вокруг даты — последняя страница: переход по дате в тестах не нужен.
                var query = request.query
                if query["aroundDate"] != nil { query["cursor"] = nil }
                return Self.page(all.count, query: query, defaultLimit: 50) { all[$0] }
            }

            route("POST", "chats/:id/messages") { [unowned self] request in
                let id = request.params["id"] ?? ""
                guard MockFixtures.chatIndex(of: id) != nil else {
                    return Self.error(404, code: "NOT_FOUND", message: "Чат не найден")
                }
                let fields = Self.multipartFields(request)
                let files = Self.multipartFiles(request)
                var message = self.newMessage(in: id, content: fields["content"], replyToID: fields["replyToId"])
                if !files.isEmpty {
                    let hidden = Set((fields["spoilerIndexes"] ?? "").split(separator: ",").compactMap { Int($0) })
                    let allHidden = fields["spoiler"] == "true"
                    let asFiles = fields["asFiles"] == "true"
                    message["media"] = files.enumerated().map { offset, file -> JSON in
                        [
                            "id": self.makeID("file"),
                            "mime": file.mime,
                            "name": file.name,
                            "size": file.size,
                            "spoiler": allHidden || hidden.contains(offset),
                            "asDocument": asFiles,
                        ]
                    }
                }
                return Self.ok(self.store(message, in: id))
            }

            // Прямая загрузка, как в приложении: подпись → PUT в «хранилище» → сообщение
            // по ключам. Хранилище — тот же mock (адрес API), тело файла не храним.
            route("POST", "chats/:id/attachments/presign") { [unowned self] request in
                let body = (try? JSONSerialization.jsonObject(with: request.body)) as? JSON
                let key = self.makeID("upload")
                self.uploadMimes[key] = body?["mime"] as? String ?? "application/octet-stream"
                return Self.ok([
                    "key": key,
                    "url": AppConfiguration.apiBaseURL.appending(path: "mock-storage/\(key)").absoluteString,
                    "expiresAt": MockFixtures.iso(Date().addingTimeInterval(3600)),
                ])
            }
            route("PUT", "mock-storage/:key") { _ in Self.empty }
            route("POST", "chats/:id/messages/uploaded") { [unowned self] request in
                let id = request.params["id"] ?? ""
                guard MockFixtures.chatIndex(of: id) != nil else {
                    return Self.error(404, code: "NOT_FOUND", message: "Чат не найден")
                }
                let body = (try? JSONSerialization.jsonObject(with: request.body)) as? JSON ?? [:]
                var message = self.newMessage(in: id, content: body["content"] as? String, replyToID: body["replyToId"] as? String)
                let asFiles = body["asFiles"] as? Bool ?? false
                let uploads = body["attachments"] as? [JSON] ?? []
                message["media"] = uploads.map { upload -> JSON in
                    let key = upload["key"] as? String ?? ""
                    return [
                        "id": self.makeID("file"),
                        "mime": self.uploadMimes[key] ?? "application/octet-stream",
                        "name": upload["name"] as? String ?? key,
                        "size": 1024,
                        "spoiler": upload["spoiler"] as? Bool ?? false,
                        "asDocument": asFiles,
                    ]
                }
                return Self.ok(self.store(message, in: id))
            }

            route("GET", "chats/:id/updates") { [unowned self] request in
                let id = request.params["id"] ?? ""
                let latest = MockFixtures.chatIndex(of: id).map {
                    MockFixtures.messageCount(chatIndex: $0) + (self.sentMessages[id]?.count ?? 0)
                } ?? 0
                return Self.ok([
                    "created": [Any](), "mutated": [Any](), "deletedIds": [Any](), "latestSeq": latest, "overflow": false,
                ])
            }
            route("GET", "chats/:id/pinned") { [unowned self] request in
                let id = request.params["id"] ?? ""
                let all = self.messages(of: id)
                return Self.ok(self.pinnedIDs.compactMap { pinned in all.first { $0["id"] as? String == pinned } })
            }
            route("GET", "chats/:id/presence") { _ in
                Self.ok([["userId": MockFixtures.people[0].id, "online": true]])
            }
            route("GET", "chats/:id/members") { _ in Self.ok(MockFixtures.chatMembers) }
            route("GET", "chats/:id/reads") { _ in Self.ok([Any]()) }
            route("GET", "chats/:id/media") { _ in Self.ok([Any](), meta: ["hasNext": false]) }
            route("GET", "chats/:id/links") { _ in Self.ok([Any](), meta: ["hasNext": false]) }
            route("GET", "chats/:id/polls") { _ in Self.ok([Any](), meta: ["hasNext": false]) }
            route("PUT", "chats/:id/draft") { _ in Self.empty }
            route("PATCH", "chats/:id/draft") { _ in Self.empty }
            route("POST", "chats/:id/read") { _ in Self.empty }
            for action in ["pin", "archive", "mute"] {
                route("POST", "chats/:id/\(action)") { _ in Self.empty }
                route("DELETE", "chats/:id/\(action)") { _ in Self.empty }
            }
            registerMessageActionRoutes()
        }

        // MARK: - Действия с сообщениями (меню, выбор, пересылка, поиск, вложения)

        /// Переписка чата, свежие первыми: отправленное в процессе, затем фикстуры; правки
        /// поверх, скрытое «у меня» — убрано.
        private func messages(of chatID: String) -> [JSON] {
            guard let index = MockFixtures.chatIndex(of: chatID) else { return [] }
            let sent = sentMessages[chatID] ?? []
            let fixtures = (0..<MockFixtures.messageCount(chatIndex: index)).map {
                MockFixtures.message(chatIndex: index, position: $0)
            }
            return (sent + fixtures).compactMap { message in
                guard let id = message["id"] as? String, !hiddenMessageIDs.contains(id) else { return nil }
                guard let patch = messagePatches[id] else { return message }
                return message.merging(patch) { $1 }
            }
        }

        /// Сообщение по id: чат — часть id до «-m».
        private func message(id: String) -> JSON? {
            guard let range = id.range(of: "-m", options: .backwards) else { return nil }
            let chatID = String(id[..<range.lowerBound])
            return messages(of: chatID).first { $0["id"] as? String == id }
        }

        private static var now: String { MockFixtures.iso(Date()) }

        private func registerMessageActionRoutes() {
            // Реакция: одна на человека, та же снимает, другая заменяет (как сервер).
            route("POST", "chats/messages/:id/reactions") { [unowned self] request in
                let id = request.params["id"] ?? ""
                guard let message = self.message(id: id) else { return Self.error(404, code: "NOT_FOUND", message: "Нет сообщения") }
                let body = (try? JSONSerialization.jsonObject(with: request.body)) as? JSON
                let emoji = body?["emoji"] as? String ?? ""
                var reactions = (message["reactions"] as? [JSON]) ?? []
                let mine = reactions.first { $0["userId"] as? String == MockFixtures.studentID }?["emoji"] as? String
                reactions.removeAll { $0["userId"] as? String == MockFixtures.studentID }
                if mine != emoji {
                    reactions.append(["emoji": emoji, "userId": MockFixtures.studentID, "user": MockFixtures.student.json])
                }
                self.messagePatches[id, default: [:]]["reactions"] = reactions
                return Self.ok(self.message(id: id) ?? message)
            }
            route("POST", "chats/messages/:id/pin") { [unowned self] request in
                let id = request.params["id"] ?? ""
                self.messagePatches[id, default: [:]]["pinnedAt"] = Self.now
                self.pinnedIDs.removeAll { $0 == id }
                self.pinnedIDs.insert(id, at: 0)
                return Self.empty
            }
            route("DELETE", "chats/messages/:id/pin") { [unowned self] request in
                let id = request.params["id"] ?? ""
                self.messagePatches[id, default: [:]]["pinnedAt"] = NSNull()
                self.pinnedIDs.removeAll { $0 == id }
                return Self.empty
            }
            route("DELETE", "chats/:id/pinned") { [unowned self] request in
                let chatID = request.params["id"] ?? ""
                let ids = Set(self.messages(of: chatID).compactMap { $0["id"] as? String })
                let removed = self.pinnedIDs.filter { ids.contains($0) }
                for id in removed { self.messagePatches[id, default: [:]]["pinnedAt"] = NSNull() }
                self.pinnedIDs.removeAll { ids.contains($0) }
                return Self.ok(["count": removed.count])
            }
            route("POST", "chats/:id/messages/hide") { [unowned self] request in
                let body = (try? JSONSerialization.jsonObject(with: request.body)) as? JSON
                let ids = body?["messageIds"] as? [String] ?? []
                self.hiddenMessageIDs.formUnion(ids)
                return Self.ok(["hiddenIds": ids])
            }
            // У всех — только своё, как на сервере.
            route("POST", "chats/:id/messages/delete") { [unowned self] request in
                let body = (try? JSONSerialization.jsonObject(with: request.body)) as? JSON
                let ids = body?["messageIds"] as? [String] ?? []
                var deleted: [String] = []
                var skipped: [String] = []
                for id in ids {
                    if self.message(id: id)?["senderId"] as? String == MockFixtures.studentID {
                        self.messagePatches[id, default: [:]]["deletedAt"] = Self.now
                        self.messagePatches[id, default: [:]]["content"] = ""
                        deleted.append(id)
                    } else {
                        skipped.append(id)
                    }
                }
                return Self.ok(["deletedIds": deleted, "skippedIds": skipped])
            }
            route("POST", "chats/forward") { [unowned self] request in
                let body = (try? JSONSerialization.jsonObject(with: request.body)) as? JSON ?? [:]
                let key = body["requestId"] as? String ?? UUID().uuidString
                if let reply = self.forwardReplies[key] { return Self.ok(reply) }
                let sources = (body["messageIds"] as? [String] ?? []).compactMap { self.message(id: $0) }
                let hide = body["hideSender"] as? Bool ?? false
                var results: [JSON] = []
                for chatID in body["chatIds"] as? [String] ?? [] {
                    guard let index = MockFixtures.chatIndex(of: chatID) else {
                        results.append(["chatId": chatID, "ok": false, "messageIds": [String](), "code": "NOT_FOUND"])
                        continue
                    }
                    var created: [String] = []
                    func append(_ fields: JSON) {
                        let sent = self.sentMessages[chatID] ?? []
                        let seq = MockFixtures.messageCount(chatIndex: index) + sent.count + 1
                        var message: JSON = [
                            "id": "\(chatID)-m\(seq)",
                            "chatId": chatID,
                            "seq": seq,
                            "senderId": MockFixtures.studentID,
                            "sender": MockFixtures.student.json,
                            "content": "",
                            "createdAt": MockFixtures.iso(Date(timeIntervalSince1970: MockFixtures.epoch + TimeInterval(sent.count + 1))),
                        ]
                        message.merge(fields) { $1 }
                        self.sentMessages[chatID] = [message] + sent
                        created.append(message["id"] as? String ?? "")
                    }
                    if let comment = body["comment"] as? String, !comment.isEmpty { append(["content": comment]) }
                    for source in sources {
                        var fields: JSON = ["content": source["content"] ?? ""]
                        if let media = source["media"] { fields["media"] = media }
                        if !hide {
                            fields["forwardedFromId"] = source["id"]
                            fields["forwardedFrom"] = [
                                "id": source["id"] ?? "",
                                "senderId": source["senderId"] ?? "",
                                "sender": source["sender"] ?? NSNull(),
                            ]
                        }
                        append(fields)
                    }
                    results.append(["chatId": chatID, "ok": true, "messageIds": created])
                }
                let reply: JSON = ["results": results]
                self.forwardReplies[key] = reply
                return Self.ok(reply)
            }
            // Поиск по переписке: подстрока без регистра, свежие первыми, `total` — всё.
            route("GET", "chats/search") { [unowned self] request in
                let term = (request.query["q"] ?? "").lowercased()
                let chatID = request.query["chatId"] ?? MockFixtures.chatID(0)
                let withFiles = request.query["hasFile"] == "true"
                let sender = request.query["senderId"]
                let found = self.messages(of: chatID).filter { message in
                    guard message["deletedAt"] == nil || message["deletedAt"] is NSNull else { return false }
                    let content = (message["content"] as? String ?? "").lowercased()
                    let hasMedia = !((message["media"] as? [Any])?.isEmpty ?? true)
                    return content.contains(term) && (!withFiles || hasMedia)
                        && (sender == nil || message["senderId"] as? String == sender)
                }
                return Self.page(found.count, query: request.query, defaultLimit: 20) { found[$0] }
            }
            route("GET", "chats/files/recent") { request in
                let kind = request.query["kind"] ?? "document"
                let term = (request.query["q"] ?? "").lowercased()
                let files = (kind == "audio" ? MockFixtures.recentAudio : MockFixtures.recentDocuments).filter {
                    term.isEmpty || ($0["name"] as? String ?? "").lowercased().contains(term)
                }
                return Self.ok(files, meta: ["hasNext": false])
            }
            // Ссылка на вложение — файл на устройстве: «Сохранить фото» и недавние файлы
            // работают без сети.
            route("GET", "chats/attachments/:id/url") { request in
                let id = request.params["id"] ?? "file"
                guard let url = MockFixtures.localFile(for: id) else {
                    return Self.error(404, code: "NOT_FOUND", message: "Нет файла")
                }
                return Self.ok(["url": url.absoluteString, "expiresAt": MockFixtures.iso(Date().addingTimeInterval(3600))])
            }
        }

        private func registerFeedRoutes() {
            route("GET", "posts") { request in
                // Посты одного автора (профиль) — только его; в фикстурах их нет.
                if let author = request.query["authorId"], author == MockFixtures.studentID {
                    return Self.ok([Any](), meta: ["hasNext": false])
                }
                return Self.page(MockFixtures.postCount, query: request.query, defaultLimit: 20) { index in
                    MockFixtures.post(index, extraComments: 0)
                }
            }
            route("GET", "posts/:id") { [unowned self] request in
                let id = request.params["id"] ?? ""
                guard let index = MockFixtures.postIndex(of: id) else {
                    return Self.error(404, code: "NOT_FOUND", message: "Пост не найден")
                }
                return Self.ok(MockFixtures.post(index, extraComments: self.sentComments[id]?.count ?? 0))
            }
            route("GET", "posts/:id/comments") { [unowned self] request in
                let id = request.params["id"] ?? ""
                guard let index = MockFixtures.postIndex(of: id) else {
                    return Self.error(404, code: "NOT_FOUND", message: "Пост не найден")
                }
                let sent = self.sentComments[id] ?? []
                return Self.page(3 + sent.count, query: request.query, defaultLimit: 20) { position in
                    position < 3 ? MockFixtures.comment(postIndex: index, position: position) : sent[position - 3]
                }
            }
            route("POST", "posts/:id/comments") { [unowned self] request in
                let id = request.params["id"] ?? ""
                let body = (try? JSONSerialization.jsonObject(with: request.body)) as? JSON
                let comment: JSON = [
                    "id": self.makeID("comment"),
                    "content": body?["content"] as? String ?? "",
                    "createdAt": MockFixtures.iso(Date(timeIntervalSince1970: MockFixtures.epoch)),
                    "author": MockFixtures.student.json,
                    "canDelete": true,
                ]
                self.sentComments[id, default: []].append(comment)
                return Self.ok(comment)
            }
            route("POST", "posts/:id/view") { _ in Self.empty }
            route("POST", "posts/:id/reactions") { _ in Self.empty }
            route("DELETE", "posts/:id/reactions/:emoji") { _ in Self.empty }
            route("POST", "posts/:id/bookmark") { _ in Self.ok(["bookmarked": true]) }

            route("GET", "stories") { _ in Self.ok(MockFixtures.storyRings) }
            route("POST", "stories/:id/view") { _ in Self.empty }
        }

        /// Поля multipart-формы отправки сообщения: текст и ключ повтора. Тело читается с
        /// заменой нечитаемых байтов: файлы в той же форме бинарные.
        private static func multipartFields(_ request: Request) -> [String: String] {
            let text = String(decoding: request.body, as: UTF8.self)
            var fields: [String: String] = [:]
            for part in text.components(separatedBy: "\r\n--") where !part.contains("filename=\"") {
                guard let nameRange = part.range(of: "name=\""),
                    let nameEnd = part[nameRange.upperBound...].firstIndex(of: "\""),
                    let valueStart = part.range(of: "\r\n\r\n")
                else { continue }
                let name = String(part[nameRange.upperBound..<nameEnd])
                var value = String(part[valueStart.upperBound...])
                if value.hasSuffix("\r\n") { value.removeLast(2) }
                fields[name] = value
            }
            return fields
        }

        /// Файлы формы: имя, тип и размер — у сообщения в ответе появятся вложения.
        private static func multipartFiles(_ request: Request) -> [(name: String, mime: String, size: Int)] {
            let text = String(decoding: request.body, as: UTF8.self)
            return text.components(separatedBy: "\r\n--").compactMap { part in
                guard let start = part.range(of: "filename=\""),
                    let end = part[start.upperBound...].firstIndex(of: "\""),
                    let body = part.range(of: "\r\n\r\n")
                else { return nil }
                var mime = "application/octet-stream"
                if let type = part.range(of: "Content-Type: ") {
                    let line = part[type.upperBound...].prefix { $0 != "\r" && $0 != "\n" }
                    mime = String(line)
                }
                return (String(part[start.upperBound..<end]), mime, part[body.upperBound...].utf8.count)
            }
        }
    }
#endif

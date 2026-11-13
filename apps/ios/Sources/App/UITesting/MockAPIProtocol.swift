#if DEBUG
    import Foundation

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

        override func stopLoading() {}

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
        private var sentComments: [String: [JSON]] = [:]
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
                let sent = self.sentMessages[id] ?? []
                let total = sent.count + MockFixtures.messageCount(chatIndex: index)
                // Окно вокруг даты — последняя страница: переход по дате в тестах не нужен.
                var query = request.query
                if query["aroundDate"] != nil { query["cursor"] = nil }
                return Self.page(total, query: query, defaultLimit: 50) { position in
                    position < sent.count
                        ? sent[position]
                        : MockFixtures.message(chatIndex: index, position: position - sent.count)
                }
            }

            route("POST", "chats/:id/messages") { [unowned self] request in
                let id = request.params["id"] ?? ""
                guard let index = MockFixtures.chatIndex(of: id) else {
                    return Self.error(404, code: "NOT_FOUND", message: "Чат не найден")
                }
                let fields = Self.multipartFields(request)
                let sent = self.sentMessages[id] ?? []
                let seq = MockFixtures.messageCount(chatIndex: index) + sent.count + 1
                var message: JSON = [
                    "id": "\(id)-m\(seq)",
                    "chatId": id,
                    "seq": seq,
                    "senderId": MockFixtures.studentID,
                    "sender": MockFixtures.student.json,
                    "content": fields["content"] ?? "",
                    // Свежее любого сообщения фикстур: точка отсчёта плюс номер отправки.
                    "createdAt": MockFixtures.iso(Date(timeIntervalSince1970: MockFixtures.epoch + TimeInterval(sent.count + 1))),
                ]
                if let reply = fields["replyToId"] { message["replyToId"] = reply }
                self.sentMessages[id] = [message] + sent
                return Self.ok(message)
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
            route("GET", "chats/:id/pinned") { _ in Self.ok([Any]()) }
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

        /// Поля multipart-формы отправки сообщения: текст и ключ повтора.
        private static func multipartFields(_ request: Request) -> [String: String] {
            guard let text = String(data: request.body, encoding: .utf8) else { return [:] }
            var fields: [String: String] = [:]
            for part in text.components(separatedBy: "\r\n--") {
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
    }
#endif

#if DEBUG
    import Foundation

    /// Чистый старт процесса под UI-тест (`SH_UITEST_MOCK=1`).
    ///
    /// Каждый сценарий начинается с одного и того же состояния, что бы ни оставил прошлый:
    /// настройки (`UserDefaults` — тема, отметка владельца базы, ответ проверки версии)
    /// стираются целиком, сессия живёт в памяти. Локальная база чатов, кеш экранов и
    /// картинок стираются сами при входе: отметки владельца больше нет, и
    /// `LocalData.claim` считает данные чужими.
    enum UITestBootstrap {
        /// Секреты сессии этого процесса. Сценарий `student` кладёт сюда признак входа и
        /// действующий токен — холодный старт открывает оболочку без сети и без экрана входа.
        static let secrets = MemorySecretStore()

        static func prepare() {
            if let domain = Bundle.main.bundleIdentifier {
                UserDefaults.standard.removePersistentDomain(forName: domain)
            }
            RefreshCookieJar.shared.clear()
            URLCache.shared.removeAllCachedResponses()
            // Картинки и прочее, что ходит через `URLSession.shared`.
            URLProtocol.registerClass(MockAPIProtocol.self)

            switch UITestEnvironment.current.scenario {
            case .signedOut:
                break
            case .student:
                secrets.set("1", for: .sessionPresent)
                secrets.set(MockFixtures.studentAccessToken, for: .lastAccessToken)
                secrets.set(MockFixtures.refreshCookie, for: .refreshToken)
                RefreshCookieJar.shared.restore(MockFixtures.refreshCookie)
            }
            print("[MockAPI] режим UI-тестов: сценарий \(UITestEnvironment.current.scenario.rawValue), большие данные: \(UITestEnvironment.current.isLarge)")
        }
    }

    /// Секреты в памяти процесса — вместо связки ключей.
    final class MemorySecretStore: SecretStore, @unchecked Sendable {
        private let lock = NSLock()
        private var values: [SecretKey: String] = [:]

        func value(for key: SecretKey) -> String? {
            lock.withLock { values[key] }
        }

        func set(_ value: String, for key: SecretKey) {
            lock.withLock { values[key] = value }
        }

        func remove(_ key: SecretKey) {
            lock.withLock { values[key] = nil }
        }
    }

    /// Реальное время без сервера: соединение «поднимается» сразу и молчит.
    ///
    /// `connected` нужен, чтобы экраны не висели в состоянии «соединение…»: догон по
    /// подключению сходит в REST (`chats/:id/updates`), и mock ответит, что нового нет.
    actor MockRealtimeTransport: RealtimeTransport {
        nonisolated let events: AsyncStream<RealtimeEvent>
        private let continuation: AsyncStream<RealtimeEvent>.Continuation

        init() {
            (events, continuation) = AsyncStream<RealtimeEvent>.makeStream()
        }

        deinit {
            continuation.finish()
        }

        func connect(token: String) async { continuation.yield(.connected) }
        func disconnect() async { continuation.yield(.disconnected) }
        func refresh(token: String) async {}
        func join(chatID: String) async {}
        func leave(chatID: String) async {}
        func markRead(chatID: String, messageID: String) async {}
        func send(action: String?, chatID: String) async {}
        func edit(messageID: String, content: String) async {}
        func delete(messageID: String) async {}
    }
#endif

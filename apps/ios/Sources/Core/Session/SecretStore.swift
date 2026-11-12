import Foundation
import Security

/// Хранилище секретов. Протокол — ради тестов: в них подставляется словарь в памяти,
/// иначе прогон упирается в связку ключей симулятора.
protocol SecretStore: Sendable {
    func value(for key: SecretKey) -> String?
    func set(_ value: String, for key: SecretKey)
    func remove(_ key: SecretKey)
    /// Хранилище заперто (связка ключей до первой разблокировки после включения):
    /// `value` вернёт `nil`, хотя секрет есть. Отсутствие тогда — не «сессии нет».
    var isLocked: Bool { get }
}

extension SecretStore {
    var isLocked: Bool { false }
}

enum SecretKey: String {
    /// Refresh-токен. Сервер отдаёт его только в httpOnly-cookie, и приложение
    /// переносит значение сюда: хранилище cookie система вправе очистить, связку
    /// ключей — нет (см. `RefreshCookieStore`).
    case refreshToken = "session.refresh-token"
    /// Признак того, что вход уже был. Нужен на холодном старте: без него
    /// приложение не отличает «не входил ни разу» от «токен в памяти пропал после
    /// выгрузки» и либо зря дёргает обновление сессии, либо зря показывает вход.
    case sessionPresent = "session.present"
    /// Последний выданный access-токен. Для запросов не годится (живёт 15 минут), но из
    /// него видно, кто вошёл и с какой ролью: холодный старт без сети открывает
    /// приложение по нему, а не выбрасывает на вход.
    case lastAccessToken = "session.last-access-token"
    /// Выходы, которые не дошли до сервера (не было сети): refresh-токен и токен пушей
    /// каждого. Досылаются, когда связь появится (`SessionStore.completePendingLogouts`).
    case pendingLogouts = "session.pending-logouts"
}

/// Связка ключей iOS.
///
/// Доступность — `AfterFirstUnlockThisDeviceOnly`: после первой разблокировки с момента включения.
/// `WhenUnlocked` сломал бы фоновое обновление по тихому пушу, а `Always` хранит
/// секрет доступным на выключенном устройстве.
///
/// `ThisDeviceOnly` — обязательно: без него refresh-токен уезжает в резервную копию
/// iCloud/Finder и восстанавливается на другом телефоне, то есть копия устройства
/// получает живую сессию владельца.
struct Keychain: SecretStore {
    private static let accessibility = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

    private let service: String

    init(service: String = Bundle.main.bundleIdentifier ?? "kz.studenthub.app") {
        self.service = service
    }

    func value(for key: SecretKey) -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard
            SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
            let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func set(_ value: String, for key: SecretKey) {
        guard let data = value.data(using: .utf8) else { return }
        let query = baseQuery(for: key)
        // Доступность переписывается и при обновлении: записи, заведённые прежними
        // сборками без `ThisDeviceOnly`, переезжают на неё при первой же записи.
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: Self.accessibility,
        ]

        // Сначала пробуем обновить: SecItemAdd на существующий ключ вернёт
        // errSecDuplicateItem, и секрет молча не обновится.
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecSuccess {
            return
        }
        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = Self.accessibility
        SecItemAdd(insert as CFDictionary, nil)
    }

    func remove(_ key: SecretKey) {
        SecItemDelete(baseQuery(for: key) as CFDictionary)
    }

    /// Запрос к связке ключей отклонён как недоступный в этом состоянии устройства —
    /// значит, она заперта, а не пуста.
    var isLocked: Bool {
        var query = baseQuery(for: .sessionPresent)
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        return SecItemCopyMatching(query as CFDictionary, nil) == errSecInteractionNotAllowed
    }

    private func baseQuery(for key: SecretKey) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
    }
}

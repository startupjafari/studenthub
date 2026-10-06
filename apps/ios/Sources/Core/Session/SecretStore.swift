import Foundation
import Security

/// Хранилище секретов. Протокол — ради тестов: в них подставляется словарь в памяти,
/// иначе прогон упирается в связку ключей симулятора.
protocol SecretStore: Sendable {
    func value(for key: SecretKey) -> String?
    func set(_ value: String, for key: SecretKey)
    func remove(_ key: SecretKey)
}

enum SecretKey: String {
    /// Refresh-токен. Сегодня сервер отдаёт его только в httpOnly-cookie и в теле
    /// ответа его нет — запись появится, когда закроется Задача Б2.
    case refreshToken = "session.refresh-token"
    /// Признак того, что вход уже был. Нужен на холодном старте: без него
    /// приложение не отличает «не входил ни разу» от «токен в памяти пропал после
    /// выгрузки» и либо зря дёргает обновление сессии, либо зря показывает вход.
    case sessionPresent = "session.present"
}

/// Связка ключей iOS.
///
/// Доступность — `AfterFirstUnlock`: после первой разблокировки с момента включения.
/// `WhenUnlocked` сломал бы фоновое обновление по тихому пушу, а `Always` хранит
/// секрет доступным на выключенном устройстве.
struct Keychain: SecretStore {
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
        let attributes: [String: Any] = [kSecValueData as String: data]

        // Сначала пробуем обновить: SecItemAdd на существующий ключ вернёт
        // errSecDuplicateItem, и секрет молча не обновится.
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecSuccess {
            return
        }
        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(insert as CFDictionary, nil)
    }

    func remove(_ key: SecretKey) {
        SecItemDelete(baseQuery(for: key) as CFDictionary)
    }

    private func baseQuery(for key: SecretKey) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
    }
}

import Foundation

/// Ответ `GET /client-version` (PROJECT.md §8.3).
struct ClientVersionInfo: Codable, Equatable {
    let platform: String
    let minimumVersion: String
    /// Адрес в App Store. Не задан на сервере — кнопки «Обновить» не будет: кнопка,
    /// ведущая в никуда, хуже её отсутствия.
    let storeUrl: URL?
    /// Удалённо выключенные функции (`RemoteFeatures`). Едут в этом же ответе, чтобы
    /// клиент не делал второй запрос при каждом запуске; незнакомые имена отброшены.
    var disabledFeatures: [RemoteFeature] = []
}

extension ClientVersionInfo {
    /// Своё декодирование ради одного поля: `disabledFeatures` разбирается терпимо, и
    /// ответ старого сервера или кеш прежней сборки (поля нет) читается как «всё
    /// включено», а не как отказ, который отключил бы и проверку версии. Остальные поля
    /// — как раньше, строго. Кодирование — синтезированное.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        platform = try container.decode(String.self, forKey: .platform)
        minimumVersion = try container.decode(String.self, forKey: .minimumVersion)
        storeUrl = try container.decodeIfPresent(URL.self, forKey: .storeUrl)
        disabledFeatures = RemoteFeature.decodeList(from: container, forKey: .disabledFeatures)
    }
}

protocol ClientVersionChecking: Sendable {
    func supportedVersion() async throws -> ClientVersionInfo
}

/// Маршрут публичный: спросить про обновление нужно раньше входа — человек со старой
/// сборкой иначе упёрся бы в неработающую форму и не узнал бы, в чём дело.
struct ClientVersionAPI: ClientVersionChecking {
    private let client: APIClient

    init(client: APIClient = APIClient(authorization: nil)) {
        self.client = client
    }

    func supportedVersion() async throws -> ClientVersionInfo {
        var endpoint = Endpoint.get("client-version", query: [URLQueryItem(name: "platform", value: "ios")])
        endpoint.requiresAuthorization = false
        return try await client.send(endpoint, as: ClientVersionInfo.self)
    }
}

/// Последний ответ сервера. Нужен для запуска без сети: решение «эта сборка больше
/// не поддерживается» не должно пропадать, стоит человеку выйти из зоны приёма.
protocol ClientVersionCache: Sendable {
    func load() -> ClientVersionInfo?
    func save(_ info: ClientVersionInfo)
}

/// `UserDefaults`, а не связка ключей: это не секрет, а публичный ответ сервера.
///
/// `@unchecked Sendable`: `UserDefaults` потокобезопасно, но Sendable не помечено.
struct DefaultsClientVersionCache: ClientVersionCache, @unchecked Sendable {
    private static let key = "client-version.last-answer"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> ClientVersionInfo? {
        guard let data = defaults.data(forKey: Self.key) else { return nil }
        return try? JSONCoding.decoder.decode(ClientVersionInfo.self, from: data)
    }

    func save(_ info: ClientVersionInfo) {
        guard let data = try? JSONCoding.encoder.encode(info) else { return }
        defaults.set(data, forKey: Self.key)
    }
}

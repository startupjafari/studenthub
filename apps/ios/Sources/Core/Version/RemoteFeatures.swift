import Foundation
import Observation

/// Функция клиента, которую сервер может выключить удалённо (`disabledFeatures` в ответе
/// `GET /client-version`, PROJECT.md §8.3; IOS_RULES 14.5.1).
///
/// Имя — `rawValue`, ровно как в env сервера. Новое имя заводится здесь и в таблице
/// PROJECT.md одновременно.
enum RemoteFeature: String, Codable, CaseIterable, Sendable {
    /// Отправка видео в чат: ролики из «Фото» и видеофайлы.
    case chatVideoUpload
    /// Трансляция геопозиции в чате (отправка одной точки остаётся).
    case liveLocation
    /// Поиск и популярные GIF из каталога; свои недавние GIF остаются.
    case gifSearch
    /// Вкладка стикеров в панели выражений.
    case stickers
    /// Имя, которого эта сборка не знает: функция новее сборки, выключать здесь нечего.
    case unknown

    /// Незнакомое имя или не строка — `.unknown`, а не ошибка: сервер выключает функцию
    /// новой сборки, а старая из-за этого не должна терять весь ответ (и с ним проверку
    /// версии).
    init(from decoder: Decoder) throws {
        let raw = try? decoder.singleValueContainer().decode(String.self)
        self = raw.flatMap(Self.init(rawValue:)) ?? .unknown
    }
}

extension RemoteFeature {
    /// Терпимый разбор списка: нет поля, не массив, мусор в элементах — пустой или
    /// очищенный список, но не отказ. Старый кеш без поля и битое значение в env не
    /// должны ломать решение о версии, которое едет в том же ответе.
    static func decodeList<Key: CodingKey>(
        from container: KeyedDecodingContainer<Key>,
        forKey key: Key
    ) -> [RemoteFeature] {
        let decoded = (try? container.decodeIfPresent([RemoteFeature].self, forKey: key)) ?? nil
        var seen = Set<RemoteFeature>()
        return (decoded ?? []).filter { $0 != .unknown && seen.insert($0).inserted }
    }
}

/// Какие функции сейчас выключены — одно значение на всё приложение.
///
/// Наполняется тем же путём, что проверка версии (`UpdateGateModel`): при запуске
/// и возврате из фона, сначала из кеша последнего ответа, потом из сети. Без сети
/// действует последний ответ: функция, выключенная из-за поломки, не должна
/// включаться обратно, стоит выйти из зоны приёма.
///
/// Не `@MainActor`: спрашивают и с фона (подготовка вложения, выборка медиатеки), поэтому
/// значение под замком, а наблюдение для экранов — через `ObservationRegistrar` вручную
/// (макрос `@Observable` хранение под замок не кладёт).
final class RemoteFeatures: Observable, @unchecked Sendable {
    static let shared = RemoteFeatures()

    private let registrar = ObservationRegistrar()
    private let lock = NSLock()
    private var storedDisabled: Set<RemoteFeature>

    /// Стартовое значение — из кеша ответа о версии: первый кадр уже знает, что
    /// выключено, и не показывает на миг кнопку, которая тут же исчезнет.
    init(cache: ClientVersionCache = DefaultsClientVersionCache()) {
        storedDisabled = Set(cache.load()?.disabledFeatures ?? [])
    }

    /// Выключенные функции. Чтение из `body` подписывает экран на изменения.
    var disabled: Set<RemoteFeature> {
        registrar.access(self, keyPath: \.disabled)
        return lock.withLock { storedDisabled }
    }

    func isEnabled(_ feature: RemoteFeature) -> Bool {
        !disabled.contains(feature)
    }

    /// Новый ответ сервера. Тот же список — без уведомления: экраны не перерисовываются
    /// на каждом возврате из фона.
    func apply(_ features: [RemoteFeature]) {
        let next = Set(features.filter { $0 != .unknown })
        guard next != lock.withLock({ storedDisabled }) else { return }
        registrar.withMutation(of: self, keyPath: \.disabled) {
            lock.withLock { storedDisabled = next }
        }
    }
}

import Foundation
import Observation

/// Решение «пускать ли эту сборку».
///
/// Нативное приложение обновляет не сервер, а человек, и часть людей не обновляет
/// его никогда. Сборка старше контракта API ведёт себя хуже, чем отсутствие
/// приложения: экраны пустые, ошибки непонятные, а жалоба приходит на платформу.
@Observable
final class UpdateGateModel {
    enum State: Equatable {
        /// Ещё не знаем — и не мешаем: пустой экран на старте хуже старой сборки.
        case checking
        case allowed
        case blocked(storeURL: URL?)
    }

    private(set) var state: State = .checking

    private let api: ClientVersionChecking
    private let cache: ClientVersionCache
    private let features: RemoteFeatures
    private let current: AppVersion?

    init(
        api: ClientVersionChecking = ClientVersionAPI(),
        cache: ClientVersionCache = DefaultsClientVersionCache(),
        features: RemoteFeatures = .shared,
        currentVersion: String = AppConfiguration.marketingVersion
    ) {
        self.api = api
        self.cache = cache
        self.features = features
        current = AppVersion(currentVersion)
    }

    /// Проверка уже идёт. Запуск и первый переход в `.active` зовут `check()` почти
    /// одновременно — второй запрос с тем же ответом не нужен.
    @ObservationIgnored private var isChecking = false

    @MainActor
    func check() async {
        guard !isChecking else { return }
        isChecking = true
        defer { isChecking = false }

        // Сначала — по последнему известному ответу: запуск без сети не должен
        // отменять уже принятое решение, иначе выключенный Wi-Fi обходит блокировку.
        if let remembered = cache.load() {
            apply(remembered)
        }

        do {
            let info = try await api.supportedVersion()
            cache.save(info)
            apply(info)
        } catch {
            // Сервер недоступен или ответил ошибкой — никого не запираем сверх того,
            // что уже решено по кэшу. Иначе авария на бэкенде закрывает приложение
            // всем сразу, включая тех, у кого версия свежая.
            if state == .checking {
                state = .allowed
            }
        }
    }

    @MainActor
    private func apply(_ info: ClientVersionInfo) {
        // Выключатель функций едет в том же ответе (IOS_RULES 14.5.1) и применяется
        // независимо от решения о версии: неразобранная версия не отменяет выключение.
        features.apply(info.disabledFeatures)
        guard let current, let minimum = AppVersion(info.minimumVersion) else {
            // Не разобрали свою или серверную версию — пропускаем. Блокировать по
            // неразобранной строке значит ломать приложение из-за опечатки в env.
            state = .allowed
            return
        }
        state = current < minimum ? .blocked(storeURL: info.storeUrl) : .allowed
    }
}

import Foundation
import Observation

/// Одно значение экрана по сети — карточка, сводка, настройки — с общей политикой
/// загрузки (P1-8 аудита). Пара к `PagedLoader` для списков.
///
/// Политика одна на все экраны:
/// - первый показ — значение из сохранённых ответов (`ScreenCache.cached`) сразу, сеть
///   обновляет его фоном (`ScreenCache.refreshing`);
/// - возврат на экран и возврат приложения из фона — показанное остаётся, сеть обновляет
///   его без спиннера;
/// - обновление не удалось, а значение есть — оно остаётся, сверху полоса «данные не
///   свежие» (`failure`); значения нет — ошибка на весь экран.
///
/// Раньше каждый экран держал `@State` значения, ошибки и признака офлайна и писал свой
/// `do/catch`; политик было четыре. Экран, который после действия знает новое значение,
/// кладёт его в `value` сам, без перезагрузки.
@MainActor
@Observable
final class RemoteValue<Value> {
    /// Показанное значение. Экран может поправить его на месте после действия.
    var value: Value?
    /// Последняя загрузка не удалась. При показанном значении — полоса над ним.
    private(set) var failure: String?
    private(set) var isOffline = false
    /// Сохранённое уже проверено (или кеш не используется). До этого экран пуст, а не
    /// со спиннером: чтение с диска — миллисекунды, и спиннер только мигнул бы.
    private(set) var checkedCache = false

    @ObservationIgnored private let caching: Bool
    @ObservationIgnored private var generation = 0

    /// `caching: false` — значение, которое нельзя показывать из сохранённого.
    /// Маршруты-исключения (`ScreenCache.allows`) не сохраняются и без этого.
    init(caching: Bool = true) {
        self.caching = caching
    }

    private var usesCache: Bool { caching && PerformanceFlags.screenCache }

    /// Сменился запрос (вкладка, период, фильтр): показанное уже не ответ на него.
    /// Значение и ошибка сбрасываются, идущая загрузка больше ничего не запишет.
    func reset() {
        generation += 1
        value = nil
        failure = nil
        isOffline = false
        checkedCache = false
    }

    /// Загрузить. Ответ устаревшей загрузки (её обогнала новая — жест обновления поверх
    /// первой загрузки) отбрасывается.
    func load(_ fetch: () async throws -> Value) async {
        generation += 1
        let current = generation
        if value == nil, usesCache {
            let cached = await ScreenCache.cached(fetch)
            guard !Task.isCancelled, current == generation else { return }
            if let cached, value == nil { value = cached }
        }
        checkedCache = true
        do {
            let loaded = usesCache ? try await ScreenCache.refreshing(fetch) : try await fetch()
            // Отменённая загрузка (сменился период, ушли с экрана) не пишет: загрузка,
            // гасящая ошибки частей, вернула бы пустые блоки вместо отмены.
            guard !Task.isCancelled, current == generation else { return }
            value = loaded
            failure = nil
            isOffline = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, current == generation else { return }
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

import Foundation
import Observation

/// Какую страницу просить. В API два вида пагинации (BACKEND_RULES §4): лента и
/// сообщения — по курсору, админские таблицы — по номеру страницы с `total`. Загрузчик
/// ведёт оба счётчика, а запрос берёт тот, что понимает его маршрут.
struct PageRequest: Sendable {
    let cursor: String?
    /// С единицы, как `page` в API.
    let page: Int
    let limit: Int

    /// Готовые параметры для маршрута со страницами: `page` и `limit`.
    var pageQuery: [URLQueryItem] {
        [URLQueryItem(name: "page", value: String(page)), URLQueryItem(name: "limit", value: String(limit))]
    }

    /// Параметры для маршрута с курсором: `cursor` (если не первая) и `limit`.
    var cursorQuery: [URLQueryItem] {
        var items = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        return items
    }
}

/// Список с подгрузкой: первая страница, следующие по мере прокрутки, обновление
/// жестом. Ошибка первой страницы занимает экран; ошибка следующей — только полоса,
/// уже загруженное остаётся.
@MainActor
@Observable
final class PagedLoader<Item: Decodable & Identifiable> {
    private(set) var items: [Item] = []
    private(set) var total: Int?
    private(set) var isLoaded = false
    private(set) var isLoading = false
    private(set) var failure: String?
    private(set) var isOffline = false
    private(set) var hasMore = false
    /// Следующая страница не пришла. Список не обрывается молча: внизу — «Повторить».
    private(set) var pageFailure: String?

    let limit: Int
    @ObservationIgnored private var fetch: (PageRequest) async throws -> Page<Item>
    @ObservationIgnored private var cursor: String?
    @ObservationIgnored private var page = 1
    @ObservationIgnored private var generation = 0
    /// Первая страница исходного запроса — в кеше экранов (итерация 5, п. 28): при первом
    /// показе встаёт сразу, сеть обновляет фоном.
    @ObservationIgnored private let cachesFirstPage: Bool
    /// Запрос заменили (поиск, другой фильтр): такие страницы не сохраняем — строки
    /// поиска не должны копиться на диске, а их выдача быстро устаревает.
    @ObservationIgnored private var replaced = false

    init(limit: Int = 30, cachesFirstPage: Bool = true, fetch: @escaping (PageRequest) async throws -> Page<Item>) {
        self.limit = limit
        self.cachesFirstPage = cachesFirstPage
        self.fetch = fetch
    }

    private var usesCache: Bool { cachesFirstPage && !replaced && PerformanceFlags.screenCache }

    /// Сменить запрос — новый поиск или фильтр — и загрузить с начала.
    func replace(fetch: @escaping (PageRequest) async throws -> Page<Item>) async {
        self.fetch = fetch
        replaced = true
        await reload()
    }

    /// Загрузить с первой страницы. Ответ на устаревший запрос (человек успел сменить
    /// фильтр) отбрасывается по номеру поколения.
    func reload() async {
        generation += 1
        let current = generation
        isLoading = true
        defer { if current == generation { isLoading = false } }
        do {
            let request = PageRequest(cursor: nil, page: 1, limit: limit)
            let fetch = fetch
            let result = usesCache
                ? try await ScreenCache.refreshing { try await fetch(request) }
                : try await fetch(request)
            guard current == generation else { return }
            items = result.items
            apply(result.meta, received: result.items.count, page: 1)
            failure = nil
            pageFailure = nil
            isOffline = false
            isLoaded = true
        } catch is CancellationError {
            return
        } catch {
            guard current == generation else { return }
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    /// Первая загрузка — только если ещё не грузили: `.task` срабатывает при каждом
    /// возврате на экран, а список, ушедший на второй экран, перечитывать незачем.
    func loadIfNeeded() async {
        guard !isLoaded, !isLoading else { return }
        if usesCache, items.isEmpty { await showCachedFirstPage() }
        await reload()
    }

    /// Сохранённая первая страница — сразу, до сети. Нет её — ничего не меняется.
    private func showCachedFirstPage() async {
        let current = generation
        let request = PageRequest(cursor: nil, page: 1, limit: limit)
        let fetch = fetch
        guard
            let cached = await ScreenCache.cached({ try await fetch(request) }),
            current == generation, !isLoaded, !Task.isCancelled
        else { return }
        items = cached.items
        apply(cached.meta, received: cached.items.count, page: 1)
        isLoaded = true
    }

    /// Следующая страница, когда на экране показался последний элемент.
    func loadMore(after item: Item) async {
        guard hasMore, !isLoading, pageFailure == nil, item.id == items.last?.id else { return }
        let current = generation
        isLoading = true
        defer { if current == generation { isLoading = false } }
        do {
            let nextPage = page + 1
            let result = try await fetch(PageRequest(cursor: cursor, page: nextPage, limit: limit))
            guard current == generation else { return }
            let known = Set(items.map { AnyHashable($0.id) })
            items += result.items.filter { !known.contains(AnyHashable($0.id)) }
            apply(result.meta, received: result.items.count, page: nextPage)
            pageFailure = nil
        } catch is CancellationError {
            // Строка ушла с экрана посреди запроса — страница не потеряна, её попросит
            // следующее появление последней строки.
            return
        } catch {
            guard current == generation else { return }
            pageFailure = error.userMessage
        }
    }

    /// «Повторить» под списком после сбоя подгрузки.
    func retryMore() async {
        guard let last = items.last else { return }
        pageFailure = nil
        await loadMore(after: last)
    }

    /// Правка на месте — после действия над строкой, без перезагрузки всего списка.
    func update(_ transform: (inout [Item]) -> Void) {
        transform(&items)
    }

    func remove(id: Item.ID) {
        let before = items.count
        items.removeAll { $0.id == id }
        if let total, items.count < before { self.total = max(0, total - 1) }
    }

    /// Вернуть строку на место — откат оптимистичного удаления. Уже есть — ничего.
    func insert(_ item: Item, at index: Int) {
        guard !items.contains(where: { $0.id == item.id }) else { return }
        items.insert(item, at: min(max(0, index), items.count))
        if let total { self.total = total + 1 }
    }

    private func apply(_ meta: APIMeta?, received: Int, page: Int) {
        self.page = page
        cursor = meta?.cursor
        total = meta?.total ?? total
        if let hasNext = meta?.hasNext {
            hasMore = hasNext
        } else if let total = meta?.total {
            hasMore = items.count < total
        } else {
            // Сервер не сказал: полная страница — повод спросить ещё раз.
            hasMore = received >= limit
        }
    }
}

extension Error {
    /// Нет связи — экран показывает «проверьте сеть», а не «что-то сломалось».
    var isOffline: Bool {
        if let api = self as? APIError, case .transport = api { return true }
        return self is URLError
    }
}

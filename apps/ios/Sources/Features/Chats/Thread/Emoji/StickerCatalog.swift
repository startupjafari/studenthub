import Foundation
import Observation

/// Каталог стикеров StudentHub: наборы публикует администратор платформы, приложение их
/// только показывает. Читается один раз за сеанс и по жесту «обновить».
@MainActor
@Observable
final class StickerCatalog {
    static let shared = StickerCatalog()

    private(set) var sets: [StickerSetDTO] = []
    private(set) var isLoading = false
    private(set) var failure: String?
    private(set) var loaded = false

    private let api: ChatMessaging = ChatsAPI()

    func load(force: Bool = false) async {
        guard !isLoading, force || !loaded else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            sets = try await api.stickerSets()
            failure = nil
            loaded = true
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    func sticker(id: String) -> StickerSetDTO.Sticker? {
        for set in sets {
            if let found = set.stickers.first(where: { $0.id == id }) { return found }
        }
        return favorites.first { $0.id == id }
    }

    // MARK: Избранные

    /// Избранные стикеры — свежие сверху, как отдаёт сервер (не больше 30).
    private(set) var favorites: [StickerSetDTO.Sticker] = []
    private var favoritesLoaded = false
    private var isLoadingFavorites = false
    /// Порядковый номер правки: ответ загрузки, начатой до оптимистичной правки, её не
    /// перетирает.
    private var favoritesRevision = 0

    static let favoritesLimit = 30

    func isFavorite(_ id: String) -> Bool {
        favorites.contains { $0.id == id }
    }

    func loadFavorites(force: Bool = false) async {
        guard !isLoadingFavorites, force || !favoritesLoaded else { return }
        isLoadingFavorites = true
        defer { isLoadingFavorites = false }
        let revision = favoritesRevision
        do {
            let loaded = try await api.favoriteStickers()
            guard revision == favoritesRevision else { return }
            favorites = loaded
            favoritesLoaded = true
        } catch {
            // Не загрузилось — панель просто без секции; повторим при следующем открытии.
            return
        }
    }

    /// Добавить в избранное или убрать — сразу на экране, затем на сервере; отказ
    /// сервера возвращает как было. Ответ — текст ошибки для показа или `nil`.
    @discardableResult
    func setFavorite(_ favorite: Bool, sticker: StickerSetDTO.Sticker) async -> String? {
        let before = favorites
        favoritesRevision += 1
        favorites = Self.applying(favorite, sticker: sticker, to: favorites)
        do {
            try await api.setFavoriteSticker(favorite, stickerID: sticker.id)
            return nil
        } catch is CancellationError {
            return nil
        } catch {
            favoritesRevision += 1
            favorites = before
            return error.userMessage
        }
    }

    /// Избранное после правки — как его держит сервер: добавленный (и повторно
    /// добавленный) встаёт наверх, сверх лимита вытесняется самый старый.
    static func applying(
        _ favorite: Bool,
        sticker: StickerSetDTO.Sticker,
        to list: [StickerSetDTO.Sticker]
    ) -> [StickerSetDTO.Sticker] {
        var result = list.filter { $0.id != sticker.id }
        guard favorite else { return result }
        result.insert(sticker, at: 0)
        if result.count > favoritesLimit { result.removeLast(result.count - favoritesLimit) }
        return result
    }
}

/// Недавние стикеры — на устройстве, как в Telegram «Недавние».
@MainActor
@Observable
final class RecentStickers {
    static let shared = RecentStickers()

    private(set) var ids: [String]

    private static let key = "chats.recentStickers"
    private static let limit = 20

    private init() {
        ids = UserDefaults.standard.stringArray(forKey: Self.key) ?? []
    }

    func use(_ id: String) {
        ids.removeAll { $0 == id }
        ids.insert(id, at: 0)
        if ids.count > Self.limit { ids.removeLast(ids.count - Self.limit) }
        UserDefaults.standard.set(ids, forKey: Self.key)
    }
}

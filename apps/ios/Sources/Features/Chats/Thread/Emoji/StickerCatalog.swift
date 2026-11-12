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
        return nil
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

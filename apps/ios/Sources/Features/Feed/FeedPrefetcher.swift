import SwiftUI
import UIKit

/// Предзагрузка ленты на несколько постов вперёд (п. 40 аудита): разбор текста, размытое
/// превью и первая картинка поста (или обложка видео) под размер плитки — пока человек
/// дочитывает видимое.
///
/// Окно — `lookahead` постов за последним видимым. Пост вышел из окна (прокрутили назад,
/// сменили раздел ленты, экран ушёл) — его предзагрузка отменяется: сеть и декодирование
/// останавливаются (`ImageMemoryCache.load` проверяет отмену).
@MainActor
final class FeedPrefetcher {
    /// Что грузить для поста. Значения, а не модель: уходят в фоновую задачу.
    struct ImageRequest: Equatable, Sendable {
        let url: URL
        let key: String
        let target: ImageTarget
        let placeholder: String?
    }

    private let lookahead: Int
    private var visible: Set<String> = []
    private var tasks: [String: Task<Void, Never>] = [:]

    /// `nonisolated`: экран создаёт его в инициализаторе `@State`.
    nonisolated init(lookahead: Int = 4) {
        self.lookahead = max(1, lookahead)
    }

    func appeared(_ id: String, in posts: [PostDTO], width: CGFloat, scale: CGFloat) {
        visible.insert(id)
        update(posts, width: width, scale: scale)
    }

    func disappeared(_ id: String, in posts: [PostDTO], width: CGFloat, scale: CGFloat) {
        visible.remove(id)
        update(posts, width: width, scale: scale)
    }

    /// Лента сменилась или экран ушёл: всё в полёте — отменить.
    func cancelAll() {
        for task in tasks.values { task.cancel() }
        tasks = [:]
        visible = []
    }

    /// Посты окна предзагрузки: следующие `lookahead` за последним видимым.
    static func window(visible: Set<String>, posts: [PostDTO], lookahead: Int) -> [PostDTO] {
        guard let last = posts.lastIndex(where: { visible.contains($0.id) }) else { return [] }
        let start = last + 1
        guard start < posts.count else { return [] }
        return Array(posts[start..<min(posts.count, start + lookahead)])
    }

    /// Первая картинка поста под размер плитки ленты шириной `width` точек: тот же
    /// ключ кеша и та же цель, что посчитает `RemoteImage` плитки, — её первый кадр
    /// возьмёт готовое из памяти.
    static func imageRequest(for post: PostDTO, width: CGFloat, scale: CGFloat) -> ImageRequest? {
        let items = (post.media ?? []).filter { $0.status != "FAILED" && ($0.isImage || $0.isVideo) }
        guard let first = items.first, width > 0 else { return nil }
        let size = CGSize(width: width, height: width / PostMediaView.ratio(for: items))
        if first.isVideo {
            guard
                let url = first.posterURL(width: cardImagePoints),
                let target = ImageTarget.view(size, scale: scale, mode: .fill)
            else { return nil }
            return ImageRequest(
                url: url, key: "poster:" + first.cacheKey(cardImagePoints), target: target, placeholder: first.placeholder
            )
        }
        guard
            let url = first.imageURL(width: cardImagePoints),
            let target = ImageTarget.view(size, scale: scale, mode: first.tileContentMode == .fit ? .fit : .fill)
        else { return nil }
        return ImageRequest(url: url, key: first.cacheKey(cardImagePoints), target: target, placeholder: first.placeholder)
    }

    private func update(_ posts: [PostDTO], width: CGFloat, scale: CGFloat) {
        let window = Self.window(visible: visible, posts: posts, lookahead: lookahead)
        let wanted = Set(window.map(\.id))
        for (id, task) in tasks where !wanted.contains(id) {
            task.cancel()
            tasks[id] = nil
        }
        for post in window where tasks[post.id] == nil {
            let text = post.content.flatMap { $0.isEmpty ? nil : $0 }
            let image = Self.imageRequest(for: post, width: width, scale: scale)
            guard text != nil || image != nil else { continue }
            tasks[post.id] = Task.detached(priority: .utility) {
                let signpost = Signposts.images.beginInterval("FeedPrefetch")
                defer { Signposts.images.endInterval("FeedPrefetch", signpost) }
                if let text { RichText.prepare([text]) }
                guard let image, !Task.isCancelled else { return }
                _ = LQIP.blurred(from: image.placeholder)
                _ = await ImageMemoryCache.shared.load(image.url, key: image.key, target: image.target)
            }
        }
    }
}

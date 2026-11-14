import UIKit

/// Предзагрузка снимков переписки по ходу прокрутки (шаг 2.8 плана аудита, идея
/// `InChatPrefetchManager` из Telegram-iOS).
///
/// Лента сообщает, к каким ячейкам подъезжает (`UICollectionViewDataSourcePrefetching`),
/// и снимок грузится заранее тем же путём и под тем же ключом кеша, что у самой плитки
/// (`ChatMediaImages.load`, `ChatMediaTile.cacheKey`): при появлении плитка находит его в
/// памяти и не показывает размытое превью. Ячейка ушла из зоны подъезда — загрузка
/// отменяется (у общего загрузчика она прерывается, если её больше никто не ждёт).
///
/// Приоритет ниже видимого: `.utility`, видимые плитки грузятся с приоритетом экрана.
@MainActor
final class ChatMediaPrefetcher {
    private var tasks: [String: Task<Void, Never>] = [:]

    deinit {
        for task in tasks.values { task.cancel() }
    }

    func prefetch(_ attachments: [AttachmentRecord], scale: CGFloat) {
        for attachment in attachments where tasks[attachment.id] == nil {
            // Гифка — анимация целиком, со своим кешем; спойлер плитка всё равно размывает.
            guard attachment.mime != "image/gif" else { continue }
            let points = ChatMediaTile.pixelPoints(attachment, size: ChatMediaTile.singleSize(for: attachment))
            let key = ChatMediaTile.cacheKey(attachment, points: points)
            guard ImageMemoryCache.shared.image(for: key) == nil else { continue }
            let id = attachment.id
            tasks[id] = Task(priority: .utility) { [weak self] in
                // Только постер: первый кадр из оригинала ролика — забота видимой плитки,
                // ради невидимой файл по сети не читаем.
                _ = await ChatMediaImages.load(
                    attachment,
                    points: points,
                    scale: scale,
                    key: key,
                    allowsVideoOriginal: false
                )
                self?.tasks[id] = nil
            }
        }
    }

    func cancel(_ ids: [String]) {
        for id in ids {
            tasks.removeValue(forKey: id)?.cancel()
        }
    }
}

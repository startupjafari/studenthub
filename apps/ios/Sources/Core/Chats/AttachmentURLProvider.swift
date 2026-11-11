import Foundation

/// Ссылки на вложения.
///
/// Presigned-ссылка живёт минуты, поэтому кэшируем её по id файла и обновляем,
/// когда истекла. Ключ кэша — именно id, а не адрес: по адресу кэш превратился бы
/// в мусор через четверть часа (решение плана «Кэш картинок»).
actor AttachmentURLProvider {
    private let client: APIClient
    private var cache: [String: (media: AttachmentMedia, until: Date)] = [:]

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func url(for fileID: String) async -> URL? {
        try? await media(for: fileID).url
    }

    /// Ссылка вместе с копиями: уменьшенные WebP, постер видео и HLS. Тот же ответ
    /// сервера, что и у голой ссылки, — копии приходят без лишнего запроса. Ошибка не
    /// глотается: экрану, который открывает файл по нажатию, нужна её причина.
    func media(for fileID: String) async throws -> AttachmentMedia {
        if let known = cache[fileID], known.until > Date().addingTimeInterval(30) {
            return known.media
        }
        struct Answer: Decodable {
            let url: URL
            let expiresAt: Date?
            let sources: [MediaSource]?
            let poster: [MediaSource]?
            let hls: String?
        }
        let answer = try await client.send(.get("chats/attachments/\(fileID)/url"), as: Answer.self)
        let media = AttachmentMedia(url: answer.url, sources: answer.sources ?? [], poster: answer.poster ?? [], hls: answer.hls)
        cache[fileID] = (media, answer.expiresAt ?? Date().addingTimeInterval(600))
        return media
    }

    /// Выход из аккаунта: подписанные ссылки прежнего человека следующему не достаются.
    func clear() {
        cache = [:]
    }
}

/// Подписанный оригинал вложения и его копии.
struct AttachmentMedia: Sendable {
    let url: URL
    /// Уменьшенные WebP по возрастанию ширины; пусто — только оригинал.
    let sources: [MediaSource]
    /// Кадры-обложки видео по возрастанию ширины.
    let poster: [MediaSource]
    /// Путь HLS от корня API, если ролик уже нарезан.
    let hls: String?
}

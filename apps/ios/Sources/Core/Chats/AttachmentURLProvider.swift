import Foundation
import os

/// Ссылки на вложения.
///
/// Presigned-ссылка живёт минуты, поэтому кэшируем её по id файла и обновляем,
/// когда истекла. Ключ кэша — именно id, а не адрес: по адресу кэш превратился бы
/// в мусор через четверть часа (решение плана «Кэш картинок»).
///
/// - Одновременные запросы одного файла сводятся в один: альбом и его строка в
///   «Медиа» не просят ссылку дважды, а лимит запросов на маршрут (100 в минуту на
///   человека) не выбирается прокруткой.
/// - Срок — по часам сервера, пересчитанный в «сколько ещё жить»: часы телефона
///   могут спешить или отставать, и ссылка считалась бы живой после конца подписи.
/// - Ссылка, по которой файл не скачался, сбрасывается (`invalidate`): повтор идёт
///   по свежей, а не по той же битой.
actor AttachmentURLProvider {
    private let client: APIClient
    private var cache: [String: (media: AttachmentMedia, until: Date)] = [:]
    private var inFlight: [String: (id: UInt64, task: Task<AttachmentMedia, Error>)] = [:]
    private var nextID: UInt64 = 0
    /// Растёт с каждой очисткой: ответ, пришедший после выхода, в кэш не попадает.
    private var generation = 0
    private let log = Logger(subsystem: "kz.studenthub", category: "AttachmentURLs")

    /// Подпись сервера живёт 10–15 минут (окно подписи, `stable-sign.ts`); держим не
    /// дольше девяти и не меньше минуты.
    private static let lifetime: ClosedRange<TimeInterval> = 60...(9 * 60)

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
        if let known = cache[fileID], known.until > Date() {
            return known.media
        }
        if let running = inFlight[fileID] {
            return try await running.task.value
        }
        nextID &+= 1
        let id = nextID
        let generation = generation
        // Отдельная задача, а не запрос в задаче ячейки: ячейка уехала с экрана — ответ
        // всё равно ляжет в кэш и пригодится, когда она вернётся.
        let task = Task { [client] () throws -> AttachmentMedia in
            try await Self.request(fileID, client: client)
        }
        inFlight[fileID] = (id, task)
        do {
            let (media, until) = try await finish(task)
            if inFlight[fileID]?.id == id { inFlight[fileID] = nil }
            if self.generation == generation { cache[fileID] = (media, until) }
            return media
        } catch {
            if inFlight[fileID]?.id == id { inFlight[fileID] = nil }
            log.error(
                "Ссылка на вложение не получена: \(String(describing: error), privacy: .public)"
            )
            throw error
        }
    }

    /// Ссылка не сработала (истекла, отозвана, хранилище ответило ошибкой) — следующий
    /// запрос пойдёт за новой.
    func invalidate(_ fileID: String) {
        cache[fileID] = nil
    }

    /// Выход из аккаунта: подписанные ссылки прежнего человека следующему не достаются.
    func clear() {
        generation += 1
        cache = [:]
        inFlight = [:]
    }

    // MARK: - Внутреннее

    private struct Answer: Decodable {
        let url: URL
        let expiresAt: Date?
        let sources: [MediaSource]?
        let poster: [MediaSource]?
        let hls: String?
    }

    private func finish(_ task: Task<AttachmentMedia, Error>) async throws -> (AttachmentMedia, Date) {
        let started = Date()
        let media = try await task.value
        return (media, Self.until(media.expiresAt, requestedAt: started))
    }

    private static func request(_ fileID: String, client: APIClient) async throws -> AttachmentMedia {
        let answer = try await client.send(.get("chats/attachments/\(fileID)/url"), as: Answer.self)
        return AttachmentMedia(
            url: answer.url,
            sources: answer.sources ?? [],
            poster: answer.poster ?? [],
            hls: answer.hls,
            expiresAt: answer.expiresAt
        )
    }

    /// До какого момента ссылку можно отдавать: остаток жизни по часам сервера, но не
    /// больше девяти минут и не меньше одной от момента запроса.
    static func until(_ expiresAt: Date?, requestedAt: Date) -> Date {
        let left = (expiresAt ?? requestedAt.addingTimeInterval(lifetime.upperBound)).timeIntervalSince(requestedAt) - 30
        let clamped = min(max(left, lifetime.lowerBound), lifetime.upperBound)
        return requestedAt.addingTimeInterval(clamped)
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
    /// Конец подписи по часам сервера.
    var expiresAt: Date? = nil
}

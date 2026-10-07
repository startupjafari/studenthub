import Foundation

/// Ссылки на вложения.
///
/// Presigned-ссылка живёт минуты, поэтому кэшируем её по id файла и обновляем,
/// когда истекла. Ключ кэша — именно id, а не адрес: по адресу кэш превратился бы
/// в мусор через четверть часа (решение плана «Кэш картинок»).
actor AttachmentURLProvider {
    private let client: APIClient
    private var cache: [String: (url: URL, until: Date)] = [:]

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func url(for fileID: String) async -> URL? {
        if let known = cache[fileID], known.until > Date().addingTimeInterval(30) {
            return known.url
        }
        struct Answer: Decodable {
            let url: URL
            let expiresAt: Date?
        }
        guard
            let answer = try? await client.send(
                .get("chats/attachments/\(fileID)/url"),
                as: Answer.self
            )
        else { return nil }

        cache[fileID] = (answer.url, answer.expiresAt ?? Date().addingTimeInterval(600))
        return answer.url
    }
}

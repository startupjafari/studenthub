import Foundation

/// Вкладки «Общие медиа» в профиле — как в Telegram: медиа, файлы, ссылки, голосовые.
enum SharedMediaTab: Int, CaseIterable {
    case media
    case files
    case links
    case voice

    var title: String {
        switch self {
        case .media: return "Медиа"
        case .files: return "Файлы"
        case .links: return "Ссылки"
        case .voice: return "Голосовые"
        }
    }

    var identifier: String {
        switch self {
        case .media: return "profile.tab.media"
        case .files: return "profile.tab.files"
        case .links: return "profile.tab.links"
        case .voice: return "profile.tab.voice"
        }
    }

    var emptyText: String {
        switch self {
        case .media: return "Здесь появятся фото и видео из этого чата."
        case .files: return "Здесь появятся файлы из этого чата."
        case .links: return "Здесь появятся ссылки из этого чата."
        case .voice: return "Здесь появятся голосовые и видеосообщения из этого чата."
        }
    }
}

/// Ссылка из текста сообщения.
struct SharedLink: Hashable {
    var messageId: MessageID
    var url: URL
    var date: Date
    var context: String
}

/// Разбор переписки на вкладки общих медиа. Новые — сверху, как в Telegram.
struct SharedMediaIndex {
    var media: [Message] = []
    var files: [Message] = []
    var links: [SharedLink] = []
    var voice: [Message] = []

    private static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    init() {}

    init(messages: [Message]) {
        for message in messages.reversed() where !message.isService {
            switch message.kind {
            case .photo, .video, .gif: media.append(message)
            case .file: files.append(message)
            case .voice, .videoNote: voice.append(message)
            case .text, .service: break
            }
            guard !message.text.isEmpty, message.text.contains("."), let detector = Self.detector else { continue }
            let text = message.text
            let range = NSRange(text.startIndex..., in: text)
            for match in detector.matches(in: text, options: [], range: range) {
                guard let url = match.url, url.scheme != "mailto", url.scheme != "tel" else { continue }
                links.append(SharedLink(messageId: message.id, url: url, date: message.date, context: message.previewText))
            }
        }
    }

    func count(for tab: SharedMediaTab) -> Int {
        switch tab {
        case .media: return media.count
        case .files: return files.count
        case .links: return links.count
        case .voice: return voice.count
        }
    }
}

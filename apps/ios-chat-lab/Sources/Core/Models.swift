import Foundation
import CoreGraphics

typealias MessageID = Int64

enum Author: String, Codable, Hashable {
    case me
    case peer
}

/// Статус исходящего: часы → одна галочка → две галочки (прочитано окрашено). Ошибка — красный значок.
enum DeliveryStatus: String, Codable, Hashable {
    case sending
    case sent
    case delivered
    case read
    case failed
}

/// Файл медиа в локальном каталоге приложения (`MediaStorage`). Путь относительный, чтобы
/// история переживала переустановку контейнера.
struct MediaRef: Codable, Hashable {
    var file: String
    var width: Double = 0
    var height: Double = 0
    /// Длительность видео/аудио, секунды.
    var duration: Double = 0
    /// Форма волны голосового: 0…31 (5 бит, как у Telegram), обычно 64–100 значений.
    var waveform: [UInt8]? = nil
    var fileName: String? = nil
    var fileSize: Int64? = nil
    var mimeType: String? = nil

    var aspectRatio: CGFloat {
        guard width > 0, height > 0 else { return 4.0 / 3.0 }
        return CGFloat(width / height)
    }
}

enum MessageKind: Codable, Hashable {
    case text
    case photo(MediaRef)
    case video(MediaRef)
    case gif(MediaRef)
    case file(MediaRef)
    case voice(MediaRef)
    case videoNote(MediaRef)
    /// Служебное сообщение по центру («Вы закрепили …»).
    case service

    var media: MediaRef? {
        switch self {
        case .text, .service: return nil
        case let .photo(m), let .video(m), let .gif(m), let .file(m), let .voice(m), let .videoNote(m): return m
        }
    }

    /// Медиа, которое открывается в галерее (фото, видео, GIF).
    var isVisualMedia: Bool {
        switch self {
        case .photo, .video, .gif: return true
        default: return false
        }
    }

    var shortDescription: String {
        switch self {
        case .text: return ""
        case .photo: return "Фотография"
        case .video: return "Видео"
        case .gif: return "GIF"
        case let .file(m): return m.fileName ?? "Файл"
        case .voice: return "Голосовое сообщение"
        case .videoNote: return "Видеосообщение"
        case .service: return ""
        }
    }

    var iconEmoji: String {
        switch self {
        case .photo: return "🖼"
        case .video: return "📹"
        case .gif: return "GIF"
        case .file: return "📎"
        case .voice: return "🎤"
        case .videoNote: return "📹"
        default: return ""
        }
    }
}

struct ForwardInfo: Codable, Hashable {
    var authorName: String
    var date: Date
}

/// Реакция в личном чате: каждая может стоять от меня, от собеседника или от обоих.
struct MessageReaction: Codable, Hashable {
    var emoji: String
    var byMe: Bool
    var byPeer: Bool

    var count: Int { (byMe ? 1 : 0) + (byPeer ? 1 : 0) }
}

struct Message: Codable, Hashable, Identifiable {
    var id: MessageID
    var author: Author
    var date: Date
    /// Текст или подпись к медиа.
    var text: String
    var kind: MessageKind
    var status: DeliveryStatus
    var replyTo: MessageID?
    var forward: ForwardInfo?
    var editedAt: Date?
    var reactions: [MessageReaction]
    /// Сообщения с одинаковым ключом, идущие подряд, — один альбом.
    var groupId: Int64?
    /// Голосовое/кружок прослушан (у входящих — синяя точка до прослушивания).
    var isConsumed: Bool

    init(
        id: MessageID, author: Author, date: Date, text: String, kind: MessageKind = .text,
        status: DeliveryStatus = .read, replyTo: MessageID? = nil, forward: ForwardInfo? = nil,
        editedAt: Date? = nil, reactions: [MessageReaction] = [], groupId: Int64? = nil, isConsumed: Bool = true
    ) {
        self.id = id
        self.author = author
        self.date = date
        self.text = text
        self.kind = kind
        self.status = status
        self.replyTo = replyTo
        self.forward = forward
        self.editedAt = editedAt
        self.reactions = reactions
        self.groupId = groupId
        self.isConsumed = isConsumed
    }

    var isOutgoing: Bool { author == .me }
    var isService: Bool { if case .service = kind { return true } else { return false } }

    /// Текст для цитаты в ответе, закрепе, уведомлении, поиске.
    var previewText: String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch kind {
        case .text, .service:
            return trimmed
        default:
            return trimmed.isEmpty ? kind.shortDescription : trimmed
        }
    }

    /// Можно ли редактировать: только свои, не служебные, не голосовые/кружки, не пересланные.
    var isEditable: Bool {
        guard isOutgoing, forward == nil else { return false }
        switch kind {
        case .text, .photo, .video, .gif, .file: return status != .failed
        default: return false
        }
    }

    var hasCopyableText: Bool { !text.isEmpty && !isService }
}

struct Peer: Codable, Hashable {
    var id: Int64
    var firstName: String
    var lastName: String
    var username: String
    var phone: String
    var bio: String
    var avatarFile: String?

    var displayName: String { lastName.isEmpty ? firstName : "\(firstName) \(lastName)" }
    var initials: String {
        let first = firstName.first.map(String.init) ?? ""
        let last = lastName.first.map(String.init) ?? ""
        return (first + last).uppercased()
    }
}

/// Присутствие собеседника, которое показывает шапка.
enum PeerPresence: Equatable {
    case online
    case recently
    case lastSeen(Date)
    case typing
    case recordingVoice
    case recordingVideo
    case choosingPhoto

    var isActivity: Bool {
        switch self {
        case .typing, .recordingVoice, .recordingVideo, .choosingPhoto: return true
        default: return false
        }
    }
}

/// Настройки чата, которые меняет пользователь и которые сохраняются между запусками.
struct ChatSettings: Codable, Hashable {
    var isMuted = false
    var isBlocked = false
    var wallpaperId = WallpaperPreset.defaultId
    var draft = ""
}

/// Получатель для «Переслать» (локальный демонстрационный список).
struct ForwardTarget: Hashable {
    var id: Int64
    var name: String
    var subtitle: String
    /// Пересылка в этот же чат (тогда сообщение появится в ленте).
    var isCurrentChat: Bool
}

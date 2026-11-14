import UIKit

extension Notification.Name {
    /// Файл медиа готов: `object` — имя файла (`String`).
    static let mediaFileReady = Notification.Name("ChatLab.mediaFileReady")
}

/// Каталог медиа на диске.
enum MediaStorage {
    nonisolated static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ChatLab/Media", isDirectory: true)
    }

    nonisolated static func url(for file: String) -> URL {
        directory.appendingPathComponent(file)
    }

    nonisolated static func exists(_ file: String) -> Bool {
        FileManager.default.fileExists(atPath: url(for: file).path)
    }

    /// Новое имя для файла, который пользователь отправил сам (снимок, запись, документ).
    nonisolated static func makeUserFileName(extension ext: String) -> String {
        "user_\(UUID().uuidString.prefix(8)).\(ext)"
    }
}

/// Генерирует тестовые медиа при первом запуске (ЗАГЛУШКА — полная реализация в отдельном шаге).
final class MediaFactory: @unchecked Sendable {
    static let shared = MediaFactory()

    private let queue = DispatchQueue(label: "ChatLab.media.factory", qos: .utility)

    func prepareIfNeeded() {
        try? FileManager.default.createDirectory(at: MediaStorage.directory, withIntermediateDirectories: true)
    }
}

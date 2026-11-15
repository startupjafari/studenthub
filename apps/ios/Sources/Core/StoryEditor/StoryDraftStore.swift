import Foundation

/// Черновик в списке галереи.
struct StoryDraftSummary: Identifiable, Equatable, Sendable {
    let id: UUID
    let updatedAt: Date
    let isVideo: Bool
    /// Превью — JPEG рядом с документом. Нет файла — плитка без картинки.
    let thumbnail: URL?
}

/// Черновики историй на устройстве.
///
/// Сервер черновиков не знает (история живёт сутки с момента публикации), поэтому
/// черновик — папка в Application Support: `document.json` (редактируемое состояние),
/// файлы, на которые он ссылается (исходное фото или видео, кружки, картинки), и
/// `thumbnail.jpg`. Запись атомарная: новая папка собирается рядом и подменяет старую,
/// так что сбой посреди записи не портит прежний черновик.
final class StoryDraftStore: @unchecked Sendable {
    enum Failure: Error, Equatable {
        case missingFile(String)
        case notFound
    }

    static let documentName = "document.json"
    static let thumbnailName = "thumbnail.jpg"
    /// Больше — старые уходят: каждый черновик держит исходное видео, это сотни мегабайт.
    static let limit = 30

    let root: URL
    private let fileManager = FileManager.default
    private let lock = NSLock()

    init(root: URL = StoryDraftStore.defaultRoot) {
        self.root = root
    }

    static var defaultRoot: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("StoryDrafts", isDirectory: true)
    }

    /// Записать документ с его файлами из рабочей папки. Возвращает сводку черновика.
    @discardableResult
    func save(_ document: StoryDocument, from workDirectory: URL, thumbnail: Data?) throws -> StoryDraftSummary {
        lock.lock()
        defer { lock.unlock() }
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        let staging = root.appendingPathComponent(".staging-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
        do {
            for file in Set(document.referencedFiles) {
                let source = workDirectory.appendingPathComponent(file)
                guard fileManager.fileExists(atPath: source.path) else { throw Failure.missingFile(file) }
                try fileManager.copyItem(at: source, to: staging.appendingPathComponent(file))
            }
            var stored = document
            stored.updatedAt = Date()
            try Self.encoder.encode(stored).write(to: staging.appendingPathComponent(Self.documentName), options: .atomic)
            if let thumbnail {
                try thumbnail.write(to: staging.appendingPathComponent(Self.thumbnailName), options: .atomic)
            }
            let target = directory(for: document.id)
            if fileManager.fileExists(atPath: target.path) {
                _ = try fileManager.replaceItemAt(target, withItemAt: staging)
            } else {
                try fileManager.moveItem(at: staging, to: target)
            }
            pruneLocked()
            return summary(of: stored, in: target)
        } catch {
            try? fileManager.removeItem(at: staging)
            throw error
        }
    }

    /// Открыть черновик для правки: копия его файлов уходит в `workDirectory`, сам
    /// черновик не трогается, пока человек не сохранит снова (или не опубликует).
    func open(_ id: UUID, into workDirectory: URL) throws -> StoryDocument {
        lock.lock()
        defer { lock.unlock() }
        let source = directory(for: id)
        let documentURL = source.appendingPathComponent(Self.documentName)
        guard let data = try? Data(contentsOf: documentURL) else { throw Failure.notFound }
        let document = try Self.decoder.decode(StoryDocument.self, from: data)
        try fileManager.createDirectory(at: workDirectory, withIntermediateDirectories: true)
        for file in Set(document.referencedFiles) {
            let from = source.appendingPathComponent(file)
            let to = workDirectory.appendingPathComponent(file)
            guard fileManager.fileExists(atPath: from.path) else { throw Failure.missingFile(file) }
            if fileManager.fileExists(atPath: to.path) { try fileManager.removeItem(at: to) }
            try fileManager.copyItem(at: from, to: to)
        }
        return document
    }

    /// Черновики, новые сверху. Нечитаемая папка (сбой записи, старый формат) пропускается.
    func list() -> [StoryDraftSummary] {
        lock.lock()
        defer { lock.unlock() }
        return listLocked()
    }

    func delete(_ id: UUID) {
        lock.lock()
        defer { lock.unlock() }
        try? fileManager.removeItem(at: directory(for: id))
    }

    func contains(_ id: UUID) -> Bool {
        fileManager.fileExists(atPath: directory(for: id).appendingPathComponent(Self.documentName).path)
    }

    // MARK: Внутреннее

    private func directory(for id: UUID) -> URL {
        root.appendingPathComponent(id.uuidString, isDirectory: true)
    }

    private func listLocked() -> [StoryDraftSummary] {
        guard let folders = try? fileManager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return [] }
        return folders.compactMap { folder -> StoryDraftSummary? in
            guard !folder.lastPathComponent.hasPrefix("."),
                  let data = try? Data(contentsOf: folder.appendingPathComponent(Self.documentName)),
                  let document = try? Self.decoder.decode(StoryDocument.self, from: data)
            else { return nil }
            return summary(of: document, in: folder)
        }
        .sorted { $0.updatedAt > $1.updatedAt }
    }

    private func pruneLocked() {
        for stale in listLocked().dropFirst(Self.limit) {
            try? fileManager.removeItem(at: directory(for: stale.id))
        }
    }

    private func summary(of document: StoryDocument, in folder: URL) -> StoryDraftSummary {
        let thumbnail = folder.appendingPathComponent(Self.thumbnailName)
        return StoryDraftSummary(
            id: document.id,
            updatedAt: document.updatedAt,
            isVideo: document.producesVideo,
            thumbnail: fileManager.fileExists(atPath: thumbnail.path) ? thumbnail : nil
        )
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

/// Рабочая папка открытого редактора во временном каталоге: снятые кадры, исходники
/// из галереи, записанные кружки. Удаляется, когда редактор закрыт.
struct StoryWorkspace: Sendable {
    let directory: URL

    static func make(root: URL = FileManager.default.temporaryDirectory) throws -> StoryWorkspace {
        let directory = root
            .appendingPathComponent("StoryEditor", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return StoryWorkspace(directory: directory)
    }

    func url(for file: String) -> URL {
        directory.appendingPathComponent(file)
    }

    /// Новое имя файла с расширением — для снимка, видео или кружка.
    func newFile(extension ext: String) -> String {
        "\(UUID().uuidString.lowercased()).\(ext)"
    }

    /// Положить данные в папку под новым именем.
    func store(_ data: Data, extension ext: String) throws -> String {
        let name = newFile(extension: ext)
        try data.write(to: url(for: name), options: .atomic)
        return name
    }

    /// Перенести готовый файл (запись камеры, выгрузка из «Фото») в папку.
    func adopt(_ source: URL, extension ext: String) throws -> String {
        let name = newFile(extension: ext)
        let target = url(for: name)
        do {
            try FileManager.default.moveItem(at: source, to: target)
        } catch {
            try FileManager.default.copyItem(at: source, to: target)
        }
        return name
    }

    func remove() {
        try? FileManager.default.removeItem(at: directory)
    }

    /// Хвосты прошлых запусков (приложение убили посреди правки).
    static func removeLeftovers(root: URL = FileManager.default.temporaryDirectory) {
        try? FileManager.default.removeItem(at: root.appendingPathComponent("StoryEditor", isDirectory: true))
    }
}

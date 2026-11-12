import Foundation
import GRDB

/// Локальная база чатов.
///
/// Она не кэш «на всякий случай», а источник правды для экранов: лента и список
/// читают только её, а сеть в неё пишет. Отсюда и мгновенность — экран никогда не
/// ждёт ответа сервера, чтобы что-то показать.
final class AppDatabase: Sendable {
    /// Писатель и читатель — один объект: `DatabasePool` разводит их внутри себя,
    /// позволяя читать во время записи (WAL).
    let writer: any DatabaseWriter

    var reader: any DatabaseReader { writer }

    init(_ writer: any DatabaseWriter) throws {
        self.writer = writer
        try Self.migrator.migrate(writer)
    }

    /// База приложения.
    ///
    /// Application Support, а не Caches: систему, которая вправе очистить каталог,
    /// нельзя назначать хранителем черновиков. Из резервной копии каталог исключён —
    /// переписка восстановится с сервера, а тащить её в iCloud незачем.
    ///
    /// Класс защиты — «до первой разблокировки»: тихий пуш и догон после обрыва
    /// работают при заблокированном экране, и с `complete` база была бы им недоступна.
    /// Он же наследуется файлами `-wal` и `-shm`.
    static func onDisk(fileManager: FileManager = .default) throws -> AppDatabase {
        var folder = try storeFolder(fileManager: fileManager)
        try fileManager.createDirectory(
            at: folder,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )

        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? folder.setResourceValues(values)

        let pool = try DatabasePool(path: folder.appendingPathComponent(storeName).path)
        return try AppDatabase(pool)
    }

    /// Файл базы есть, но не читается: данные устройства заперты до первой разблокировки
    /// (запуск тихим пушем после перезагрузки). Это не повреждение — сносить нельзя.
    static func isStoreLocked(fileManager: FileManager = .default) -> Bool {
        guard let folder = try? storeFolder(fileManager: fileManager) else { return false }
        let path = folder.appendingPathComponent(storeName).path
        guard fileManager.fileExists(atPath: path) else { return false }
        return FileHandle(forReadingAtPath: path) == nil
    }

    /// Отложить хранилище в резервную копию с датой — путь для базы, которая не
    /// открылась (повреждение, ошибка миграции). Не удаляем: в ней черновики и
    /// неотправленное, а резервную копию можно достать при разборе. Резервная — одна:
    /// прежняя удаляется, чтобы копии не копились.
    ///
    /// Переносим каталог, а не один файл: рядом с базой лежат `-wal` и `-shm`, и
    /// оставленный журнал воскресил бы ровно ту поломку, из-за которой мы сюда пришли.
    static func moveStoreAside(fileManager: FileManager = .default, now: Date = Date()) throws {
        let folder = try storeFolder(fileManager: fileManager)
        guard fileManager.fileExists(atPath: folder.path) else { return }
        let parent = folder.deletingLastPathComponent()
        let prefix = folder.lastPathComponent + backupMarker
        let existing = (try? fileManager.contentsOfDirectory(at: parent, includingPropertiesForKeys: nil)) ?? []
        for old in existing where old.lastPathComponent.hasPrefix(prefix) {
            try? fileManager.removeItem(at: old)
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let stamp = formatter.string(from: now)
        try fileManager.moveItem(at: folder, to: parent.appendingPathComponent(prefix + stamp, isDirectory: true))
    }

    private static let backupMarker = "-backup-"

    private static let storeName = "chats.sqlite"

    private static func storeFolder(fileManager: FileManager) throws -> URL {
        try fileManager
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("StudentHub", isDirectory: true)
    }

    /// База в памяти — для тестов и превью. Файла не создаёт, живёт до конца прогона.
    static func inMemory() throws -> AppDatabase {
        try AppDatabase(try DatabaseQueue())
    }
}

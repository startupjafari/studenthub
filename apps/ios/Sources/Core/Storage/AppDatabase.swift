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
        do {
            try Self.migrator.migrate(writer)
        } catch {
            // Помечаем отдельно: упавшая миграция — повод отложить базу (схему уже не
            // догнать), а такая же ошибка при открытии файла — нет (`StoreOpenFailure`).
            throw MigrationFailure(underlying: error)
        }
    }

    /// Мигратор не довёл схему до текущей версии.
    struct MigrationFailure: Error {
        let underlying: any Error
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
    /// неотправленное, а резервную копию можно достать при разборе.
    ///
    /// Переносим каталог, а не один файл: рядом с базой лежат `-wal` и `-shm`, и
    /// оставленный журнал воскресил бы ровно ту поломку, из-за которой мы сюда пришли.
    static func moveStoreAside(fileManager: FileManager = .default, now: Date = Date()) throws {
        try moveAside(folder: storeFolder(fileManager: fileManager), fileManager: fileManager, now: now)
    }

    /// Сколько резервных копий хранить: каждая — целая база, копить их без счёта нельзя,
    /// но и одна мало — вторая поломка подряд стёрла бы первую копию.
    static let backupsKept = 3

    /// Перенос каталога `folder` в соседний `<имя>-backup-<UTC-время>`. Прежние копии
    /// не трогаем, пока новая не легла на место; после — оставляем `keep` самых новых.
    static func moveAside(folder: URL, fileManager: FileManager, now: Date, keep: Int = backupsKept) throws {
        guard fileManager.fileExists(atPath: folder.path) else { return }
        let parent = folder.deletingLastPathComponent()
        let prefix = folder.lastPathComponent + backupMarker
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let stamp = formatter.string(from: now)

        // Две поломки в одну секунду не должны затереть друг друга.
        var target = parent.appendingPathComponent(prefix + stamp, isDirectory: true)
        var attempt = 1
        while fileManager.fileExists(atPath: target.path) {
            attempt += 1
            target = parent.appendingPathComponent("\(prefix)\(stamp)-\(attempt)", isDirectory: true)
        }
        try fileManager.moveItem(at: folder, to: target)

        // Имя с временем сортируется как время: новые — в начале.
        let backups = ((try? fileManager.contentsOfDirectory(at: parent, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.lastPathComponent.hasPrefix(prefix) }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
        for old in backups.dropFirst(max(keep, 1)) {
            try? fileManager.removeItem(at: old)
        }
    }

    private static let backupMarker = "-backup-"

    /// Стереть данные, оставив схему, — при смене человека на устройстве.
    ///
    /// Таблицы берутся из самой базы, а не списком: новая таблица в миграции иначе
    /// однажды осталась бы непочищенной, и чужие данные дожили бы до следующего входа.
    /// Внешние ключи проверяются в конце транзакции — порядок удаления не важен.
    func eraseAll() async throws {
        try await writer.write { db in
            try db.execute(sql: "PRAGMA defer_foreign_keys = ON")
            let tables = try String.fetchAll(
                db,
                sql: """
                    SELECT name FROM sqlite_master
                    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'grdb_%'
                    """
            )
            for table in tables {
                try db.execute(sql: "DELETE FROM \(table.quotedDatabaseIdentifier)")
            }
        }
    }

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

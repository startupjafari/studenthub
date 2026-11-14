import Foundation
import GRDB

/// Чтения для экрана «Поддержка» из локальной базы.
struct SupportQueries: Sendable {
    let database: AppDatabase

    init(database: AppDatabase = AppServices.database) {
        self.database = database
    }

    /// Последнее обращение в поддержку платформы из локального списка чатов: если оно
    /// уже есть, экран открывает его сразу, без запроса к серверу.
    func fetchLatestSupportChatID() async throws -> String? {
        try await database.reader.read { db in
            try ChatRecord
                .filter(Column("type") == ChatKind.supportPlatform.rawValue)
                .order(Column("updatedAt").desc)
                .fetchOne(db)?
                .id
        }
    }
}

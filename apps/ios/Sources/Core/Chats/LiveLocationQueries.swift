import Foundation
import GRDB

/// Запись живой геопозиции в локальную базу.
struct LiveLocationQueries: Sendable {
    let database: AppDatabase

    init(database: AppDatabase = AppServices.database) {
        self.database = database
    }

    /// Положить свежую точку в сообщение с трансляцией. Сообщения ещё нет в базе —
    /// ничего не делаем: точку подтянет следующая синхронизация переписки.
    func updateLocation(_ location: MessageExtras.Location, messageID: String) async throws {
        try await database.writer.write { db in
            guard var row = try MessageRecord.filter(MessageRecord.Columns.remoteId == messageID).fetchOne(db) else { return }
            var extras = row.extras ?? MessageExtras()
            extras.location = location
            row.extras = extras
            try row.update(db)
        }
    }
}

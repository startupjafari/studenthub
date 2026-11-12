import Foundation
import GRDB
import Observation

/// Число на вкладке «Чаты».
///
/// Читает базу, как и сам список: сокет пишет новое сообщение в `chat.unreadCount`,
/// наблюдаемый запрос присылает новую сумму — вкладка узнаёт о сообщении без
/// отдельного канала. Архив и чаты без звука не считаются: человек сам попросил их
/// не дёргать, и цифра на вкладке — тоже дёрганье.
@Observable
final class ChatBadgeModel {
    private(set) var unread = 0

    private let database: AppDatabase
    private var task: Task<Void, Never>?

    init(database: AppDatabase = AppServices.database) {
        self.database = database
    }

    deinit {
        task?.cancel()
    }

    @MainActor
    func start() {
        guard task == nil else { return }
        let observation = ValueObservation.tracking { db in
            try Int.fetchOne(
                db,
                sql: """
                    SELECT COALESCE(SUM(unreadCount), 0) FROM chat
                    WHERE archivedAt IS NULL AND muted = 0
                    """
            ) ?? 0
        }
        // Число то же — оболочка с вкладками не пересчитывается.
        .removeDuplicates()
        task = Task { @MainActor [weak self, database] in
            for await unread in AsyncValues.stream(of: observation, in: database.reader) {
                self?.unread = unread
            }
        }
    }
}

import Foundation
import Observation

/// Число на вкладке «Чаты».
///
/// Читает базу, как и сам список: сокет пишет новое сообщение в `chat.unreadCount`,
/// наблюдаемый запрос присылает новую сумму — вкладка узнаёт о сообщении без
/// отдельного канала. Архив и чаты без звука не считаются: человек сам попросил их
/// не дёргать, и цифра на вкладке — тоже дёрганье. Чат, помеченный «как новое», без
/// новых сообщений добавляет единицу — как в Telegram.
@Observable
final class ChatBadgeModel {
    private(set) var unread = 0

    /// База — по первому `start()`, а не в инициализаторе: оболочка держит модель в
    /// `@State`, и SwiftUI вызывает инициализатор при каждом пересчёте корня, выбрасывая
    /// лишние экземпляры (п. 19 аудита). Такой экземпляр не должен ни открывать базу, ни
    /// брать её замок.
    @ObservationIgnored private let databaseSource: () -> AppDatabase
    private var task: Task<Void, Never>?

    init(database: @autoclosure @escaping () -> AppDatabase = AppServices.database) {
        databaseSource = database
    }

    deinit {
        task?.cancel()
    }

    @MainActor
    func start() {
        guard task == nil else { return }
        // Число то же — оболочка с вкладками не пересчитывается: отсев внутри запроса.
        let queries = ChatListQueries(database: databaseSource())
        task = Task { @MainActor [weak self, queries] in
            for await unread in queries.observeUnreadTotal() {
                self?.unread = unread
            }
        }
    }
}

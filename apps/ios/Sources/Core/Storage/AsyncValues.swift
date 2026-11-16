import Foundation
import GRDB

/// Поток значений наблюдения GRDB.
///
/// Общий для всех экранов: ошибка чтения локальной базы не повод падать — список и
/// лента просто перестают обновляться, а показывают то, что уже прочитали.
enum AsyncValues {
    static func stream<Reducer: ValueReducer>(
        of observation: ValueObservation<Reducer>,
        in reader: any DatabaseReader
    ) -> AsyncStream<Reducer.Value> {
        AsyncStream { continuation in
            let cancellable = observation.start(
                in: reader,
                scheduling: .async(onQueue: .main),
                onError: { _ in continuation.finish() },
                onChange: { value in
                    // Значение наблюдения дошло до главного потока (после отсева, если
                    // он есть): сколько раз экран будят изменения базы.
                    Signposts.chats.emitEvent("DBChangeObserved", "\(String(describing: type(of: value)), privacy: .public)")
                    continuation.yield(value)
                }
            )
            continuation.onTermination = { _ in cancellable.cancel() }
        }
    }
}


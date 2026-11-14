import CoreGraphics
import Foundation

/// Что считать прочитанным (IOS_RULES 6.6.1): только реально видимое в ленте.
///
/// Загруженное окно — это экран плюс запас предзагрузки, а лента уходит под панели сверху
/// и кончается над полем ввода. Отметка «прочитано» по последнему загруженному сказала бы
/// собеседнику, что человек видел то, до чего он ещё не долистал. Недосчитать безопаснее:
/// отметка догонит, когда сообщение покажется.
enum ReadVisibility {
    struct Frame: Equatable {
        let id: String
        let minY: CGFloat
        let maxY: CGFloat
    }

    /// Сколько строки должно быть видно, чтобы она считалась увиденной: краешек пузыря
    /// под панелью — ещё не прочитанное. Низкая строка — целиком.
    static let minimumVisible: CGFloat = 24

    /// Нижняя строка, видимая в полосе `band` (координаты содержимого: от низа панелей
    /// сверху до верха поля ввода).
    static func lowestVisible(_ frames: [Frame], band: ClosedRange<CGFloat>) -> String? {
        frames
            .filter { frame in
                let shown = min(frame.maxY, band.upperBound) - max(frame.minY, band.lowerBound)
                return shown >= min(frame.maxY - frame.minY, minimumVisible)
            }
            .max { $0.maxY < $1.maxY }?
            .id
    }

    /// Серверный id сообщения для отметки: последнее чужое подтверждённое не ниже нижней
    /// видимой строки. Неотправленное в отметку не входит — у него нет серверного id.
    static func readMark(in messages: [MessageRecord], lowestVisible: String?, viewerID: String) -> String? {
        guard let lowestVisible, let index = messages.firstIndex(where: { $0.id == lowestVisible }) else {
            return nil
        }
        return messages[...index].last { $0.senderId != viewerID && $0.remoteId != nil }?.remoteId
    }
}

import os

/// Датчик скачков ленты — только отладочная сборка. Пишет в системный лог (категория
/// `ScrollProbe`) всё, что двигает ленту не пальцем: смену отступов, подгонку позиции
/// раскладкой, вставку строк, программную прокрутку, а также скачок больше 200 pt за кадр.
/// Снимается `idevicesyslog -m ScrollProbe`, чтобы по факту, а не на глаз, найти причину.
enum ScrollProbe {
    #if DEBUG
        private static let log = Logger(subsystem: "kz.studenthub", category: "ScrollProbe")
    #endif

    static func note(_ message: @autoclosure () -> String) {
        #if DEBUG
            let text = message()
            log.notice("ScrollProbe \(text, privacy: .public)")
        #endif
    }
}

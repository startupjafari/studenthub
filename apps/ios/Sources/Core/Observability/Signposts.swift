import os

/// Метки времени для Instruments (os_signpost и Points of Interest) — чтобы «тормозит»
/// мерилось, а не обсуждалось. Набор и сценарии замеров — `PERFORMANCE_AUDIT.md`,
/// раздел «Как мерить».
///
/// Интервалы ставятся вокруг работы, которую оптимизируем: чтение среза переписки,
/// сборка ленты, применение снапшота, чтение списка чатов, восстановление сессии,
/// загрузка и декодирование картинки. Пока Instruments не подключён, `OSSignposter`
/// почти ничего не стоит.
enum Signposts {
    private static let subsystem = "kz.studenthub"

    /// Переписка и список чатов.
    static let chats = OSSignposter(subsystem: subsystem, category: "Chats")
    /// Запуск: восстановление сессии, первый кадр оболочки.
    static let launch = OSSignposter(subsystem: subsystem, category: "Launch")
    /// Картинки: сеть и декодирование.
    static let images = OSSignposter(subsystem: subsystem, category: "Images")
    /// Оптимистичные действия: отправка итогового состояния, слияние нажатий, откат.
    static let actions = OSSignposter(subsystem: subsystem, category: "Actions")
    /// Кеш экранов: чтение сохранённого, попадание или промах.
    static let screenCache = OSSignposter(subsystem: subsystem, category: "ScreenCache")
}

/// Открытие чата (`ChatOpen`): от появления экрана переписки до первого показанного кадра
/// ленты. Интервал на чат один: повторное появление того же экрана, пока лента ещё не
/// показалась, нового не открывает.
@MainActor
enum ChatOpenSignpost {
    private static var open: [String: OSSignpostIntervalState] = [:]

    static func begin(chatID: String) {
        guard open[chatID] == nil else { return }
        open[chatID] = Signposts.chats.beginInterval("ChatOpen")
    }

    static func end(chatID: String) {
        guard let state = open.removeValue(forKey: chatID) else { return }
        Signposts.chats.endInterval("ChatOpen", state)
    }
}

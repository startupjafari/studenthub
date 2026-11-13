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

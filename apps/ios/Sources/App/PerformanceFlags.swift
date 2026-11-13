import Foundation

/// Выключатели рискованных частей работы над скоростью (`PERFORMANCE_AUDIT.md`,
/// `CHANGELOG-PERF.md`). Каждый выключается одной строкой — `false` — без отката кода:
/// поведение возвращается к прежнему, а сам механизм остаётся в сборке.
///
/// Константы, а не настройки: переключать их на устройстве незачем, а компилятор
/// выбрасывает выключенную ветку целиком.
enum PerformanceFlags {
    /// Итерация 3. Действия (прочитать уведомление, переключатели, дружба, реакции,
    /// запись на событие, голос в опросе) показывают результат сразу и откатываются при
    /// отказе. `false` — действие ждёт ответа сервера и только потом меняет экран;
    /// последовательность запросов (один в полёте на ключ) остаётся.
    static let optimisticActions = true

    /// Итерация 5. Экраны на `RemoteContent`, лента, уведомления и главная показывают
    /// сохранённый на диске ответ сразу и обновляют его фоном. `false` — каждый экран
    /// снова начинает со спиннера, а кеш экранов не читается и не пишется.
    static let screenCache = true
    /// План аудита по Telegram-iOS, шаг 2.2. Лента наблюдает окно у свежего края (≈150
    /// сообщений и всё непрочитанное) и расширяет его при прокрутке вверх, а не читает
    /// весь чат на каждое изменение базы. `false` — прежнее наблюдение всего чата.
    static let chatWindowedObservation = true
    /// Каждой строке ленты — своя ожидаемая высота (замер из кеша или оценка по
    /// содержимому) вместо общих 44 pt. Убирает скачки при быстрой прокрутке через ни разу
    /// не показанные строки. `false` — прежний список с оценкой 44 pt.
    static let chatEstimatedHeights = true

    // MARK: - Вторая волна: проверяется автоматически в обоих положениях

    /// Шаг 2.9. Открытие чата, где в базе меньше страницы, ждёт сеть 0,6 с, а не 2,5 с,
    /// и дальше показывает то, что есть (страница доезжает сверху, лента держится за низ).
    static var chatThinHistoryShortWait: Bool { isOn(.chatThinHistoryShortWait) }
    /// Шаг 2.5. Своя раскладка ленты с кешем высот (`MessageStackLayout`): высота строки
    /// известна до показа.
    static var chatHeightCache: Bool { isOn(.chatHeightCache) }
    /// Шаг 2.6. `ChatBubbleStack` запоминает замеры детей между `sizeThatFits` и
    /// `placeSubviews` при той же ширине — каждый ребёнок меряется раз, а не 2–3.
    static var chatBubbleLayoutCache: Bool { isOn(.chatBubbleLayoutCache) }
    /// Шаг 2.7. Тень входящего пузыря в светлой теме — второй заливкой со сдвигом на
    /// 0,6 pt, а не `.shadow` (отдельный проход отрисовки на каждый пузырь).
    static var chatBubbleFlatShadow: Bool { isOn(.chatBubbleFlatShadow) }

    /// Выключатели второй волны. Включены они не «на глаз», а по автотестам, которые
    /// сравнивают оба положения: снимки пузырей (`PerformanceFlagSnapshotTests`),
    /// ленту переписки целиком и её поведение при медленной сети
    /// (`PerformanceFlagUITests`). Тест держит флаг в нужном положении через `overrides`
    /// (в процессе тестов) или `SH_PERF_FLAGS` (в запускаемом приложении), так что
    /// откат — по-прежнему одна строка в `defaultValue`.
    enum Switch: String, CaseIterable, Sendable {
        case chatThinHistoryShortWait
        case chatHeightCache
        case chatBubbleLayoutCache
        case chatBubbleFlatShadow

        var defaultValue: Bool {
            switch self {
            case .chatThinHistoryShortWait: false
            case .chatHeightCache: false
            case .chatBubbleLayoutCache: false
            case .chatBubbleFlatShadow: false
            }
        }
    }

    static func isOn(_ flag: Switch) -> Bool {
        #if DEBUG
            if let value = overrides[flag] { return value }
        #endif
        return flag.defaultValue
    }

    #if DEBUG
        /// Подмена для тестов. Стартовое значение — из `SH_PERF_FLAGS` запускаемого
        /// приложения: `all=1`, `all=0` или `chatHeightCache=1,chatBubbleFlatShadow=0`.
        nonisolated(unsafe) static var overrides: [Switch: Bool] = parse(
            ProcessInfo.processInfo.environment["SH_PERF_FLAGS"] ?? "")

        static func parse(_ spec: String) -> [Switch: Bool] {
            var result: [Switch: Bool] = [:]
            for pair in spec.split(separator: ",") {
                let parts = pair.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                guard parts.count == 2, let value = ["1": true, "0": false][parts[1]] else { continue }
                if parts[0] == "all" {
                    for flag in Switch.allCases { result[flag] = value }
                } else if let flag = Switch(rawValue: parts[0]) {
                    result[flag] = value
                }
            }
            return result
        }
    #endif
}

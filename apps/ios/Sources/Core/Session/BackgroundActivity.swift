import Foundation

/// Фоновое задание ОС вокруг короткой работы, которую нельзя бросить на полпути
/// (обмен refresh-токена): ушедшее в фон приложение получает время её закончить.
///
/// Протокол, а не прямой вызов UIKit: хранилище сессии живёт в ядре и тестируется без
/// приложения. Реальная реализация — `UIKitBackgroundActivity` в приложении; расширений
/// (Notification Service, виджеты, Share) у проекта нет, а появятся — им своя или
/// пустышка.
protocol BackgroundActivity: Sendable {
    /// Начать задание. Возвращает, чем его закончить.
    func begin(_ name: String) async -> BackgroundActivityToken
    func end(_ token: BackgroundActivityToken) async
}

/// Чем закончить задание. Класс — чтобы закрытие по истечению времени и обычное не
/// закрыли его дважды.
final class BackgroundActivityToken: @unchecked Sendable {
    /// Идентификатор задания ОС; `nil` — задание закрыто или его не было.
    var identifier: Int?

    init(identifier: Int? = nil) {
        self.identifier = identifier
    }
}

/// Без фонового задания — для тестов и окружений без UIKit.
struct NoBackgroundActivity: BackgroundActivity {
    func begin(_ name: String) async -> BackgroundActivityToken { BackgroundActivityToken() }
    func end(_ token: BackgroundActivityToken) async {}
}

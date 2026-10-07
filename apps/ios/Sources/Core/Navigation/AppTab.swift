import Foundation

/// Пять вкладок оболочки (план, «Карта экранов»).
///
/// Состав вкладок одинаков у всех трёх ролей — меняется наполнение. Так устроен и
/// веб: роль решает, что показать, а не как устроено приложение. Трёх разных
/// приложений под три роли не получается.
enum AppTab: String, CaseIterable, Identifiable, Hashable {
    case home
    case schedule
    case chats
    case study
    case more

    var id: AppTab { self }

    var title: String {
        switch self {
        case .home:
            return String(localized: "tab.home", defaultValue: "Главная")
        case .schedule:
            return String(localized: "tab.schedule", defaultValue: "Расписание")
        case .chats:
            return String(localized: "tab.chats", defaultValue: "Чаты")
        case .study:
            return String(localized: "tab.study", defaultValue: "Учёба")
        case .more:
            return String(localized: "tab.more", defaultValue: "Ещё")
        }
    }

    /// Системные символы, а не свои иконки: в панели вкладок они совпадают по весу
    /// и оптическому размеру с остальной системой и живут во всех кеглях.
    var symbol: String {
        switch self {
        case .home: return "house"
        case .schedule: return "calendar"
        case .chats: return "bubble.left.and.bubble.right"
        case .study: return "graduationcap"
        case .more: return "ellipsis"
        }
    }
}

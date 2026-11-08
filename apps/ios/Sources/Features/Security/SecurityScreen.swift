import SwiftUI

/// Пост охраны: обзор, камеры и просмотр потока, помещения, проверка студенческого билета.
///
/// Маршрут — `AppRoute.security(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum SecurityScreen: Hashable {
    case post
    case cameras
    case camera(id: String)
    case rooms
    case verifyID

    var title: String {
        switch self {
        case .post: return String(localized: "security.screen.post", defaultValue: "Пост охраны")
        case .cameras: return String(localized: "security.screen.cameras", defaultValue: "Камеры")
        case .camera: return String(localized: "security.screen.camera", defaultValue: "Камера")
        case .rooms: return String(localized: "security.screen.rooms", defaultValue: "Помещения")
        case .verifyID: return String(localized: "security.screen.verifyID", defaultValue: "Проверка билета")
        }
    }

    var symbol: String {
        switch self {
        case .post: return "shield.lefthalf.filled"
        case .cameras: return "video"
        case .camera: return "video"
        case .rooms: return "door.left.hand.closed"
        case .verifyID: return "person.text.rectangle"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        PendingScreen(title: title, symbol: symbol)
    }

    static var workspace: [WorkspaceGroup] {
        [
            WorkspaceGroup(
                title: String(localized: "security.group", defaultValue: "Охрана"),
                items: [
                    WorkspaceItem(title: Self.cameras.title, symbol: Self.cameras.symbol, tint: TileTint.gray, route: .security(.cameras)),
                    WorkspaceItem(title: Self.rooms.title, symbol: Self.rooms.symbol, tint: TileTint.orange, route: .security(.rooms)),
                    WorkspaceItem(title: Self.verifyID.title, symbol: Self.verifyID.symbol, tint: TileTint.blue, route: .security(.verifyID)),
                    WorkspaceItem(title: MoreSection.campusMap.title, symbol: MoreSection.campusMap.symbol, tint: TileTint.green, route: .section(.campusMap)),
                ]
            ),
        ]
    }
}

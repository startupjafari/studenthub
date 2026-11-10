import SwiftUI

/// Пост охраны: обзор, камеры и просмотр потока, помещения, проверка студенческого.
///
/// Маршрут — `AppRoute.security(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum SecurityScreen: Hashable {
    case post
    case cameras
    case camera(id: String)
    case rooms
    case verifyID
    /// Журнал проходов студентов целиком.
    case passes
    /// Журнал посетителей: кто в здании и все записи.
    case visitors
    /// Несколько камер сразу — до четырёх.
    case cameraWall(ids: [String])
    /// Помещение по коду с наклейки (веб `/r/<код>`).
    case roomStatus(code: String)
    /// Общий сканер QR StudentHub (веб `/scan`).
    case scan

    var title: String {
        switch self {
        case .post: return String(localized: "security.screen.post", defaultValue: "Пост охраны")
        case .cameras: return String(localized: "security.screen.cameras", defaultValue: "Камеры")
        case .camera: return String(localized: "security.screen.camera", defaultValue: "Камера")
        case .rooms: return String(localized: "security.screen.rooms", defaultValue: "Помещения")
        case .verifyID: return String(localized: "security.screen.verifyID", defaultValue: "Проверка билета")
        case .passes: return String(localized: "security.screen.passes", defaultValue: "Проходы студентов")
        case .visitors: return String(localized: "security.screen.visitors", defaultValue: "Посетители")
        case .cameraWall: return String(localized: "security.screen.cameraWall", defaultValue: "Несколько камер")
        case .roomStatus: return String(localized: "security.screen.roomStatus", defaultValue: "Помещение")
        case .scan: return String(localized: "security.screen.scan", defaultValue: "Сканер QR")
        }
    }

    var symbol: String {
        switch self {
        case .post: return "shield.lefthalf.filled"
        case .cameras: return "video"
        case .camera: return "video"
        case .rooms: return "door.left.hand.closed"
        case .verifyID: return "person.text.rectangle"
        case .passes: return "checkmark.shield"
        case .visitors: return "person.2"
        case .cameraWall: return "rectangle.grid.2x2"
        case .roomStatus: return "door.left.hand.open"
        case .scan: return "qrcode.viewfinder"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        switch self {
        case .post: SecurityPostView()
        case .cameras: SecurityCamerasView()
        case .camera(let id): SecurityCameraScreen(cameraID: id)
        case .rooms: SecurityRoomsView()
        case .verifyID: SecurityVerifyView()
        case .passes: SecurityPassesView()
        case .visitors: SecurityVisitorsView()
        case .cameraWall(let ids): SecurityCameraWallView(ids: ids)
        case .roomStatus(let code): SecurityRoomStatusView(code: code)
        case .scan: SecurityScanView()
        }
    }

    static var workspace: [WorkspaceGroup] {
        [
            WorkspaceGroup(
                title: String(localized: "security.group", defaultValue: "Охрана"),
                items: [
                    WorkspaceItem(title: Self.verifyID.title, symbol: Self.verifyID.symbol, tint: TileTint.blue, route: .security(.verifyID)),
                    WorkspaceItem(title: Self.cameras.title, symbol: Self.cameras.symbol, tint: TileTint.gray, route: .security(.cameras)),
                    WorkspaceItem(title: Self.rooms.title, symbol: Self.rooms.symbol, tint: TileTint.orange, route: .security(.rooms)),
                    WorkspaceItem(title: MoreSection.campusMap.title, symbol: MoreSection.campusMap.symbol, tint: TileTint.green, route: .section(.campusMap)),
                ]
            ),
            WorkspaceGroup(
                title: String(localized: "security.group.journals", defaultValue: "Журналы"),
                items: [
                    WorkspaceItem(title: Self.passes.title, symbol: Self.passes.symbol, tint: TileTint.teal, route: .security(.passes)),
                    WorkspaceItem(title: Self.visitors.title, symbol: Self.visitors.symbol, tint: TileTint.indigo, route: .security(.visitors)),
                    WorkspaceItem(title: Self.scan.title, symbol: Self.scan.symbol, tint: TileTint.purple, route: .security(.scan)),
                ]
            ),
        ]
    }
}

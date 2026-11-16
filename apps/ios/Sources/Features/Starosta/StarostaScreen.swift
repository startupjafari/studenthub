import SwiftUI

/// Разделы старосты: своя группа, сбор документов группы, приглашения одногруппников.
///
/// Маршрут — `AppRoute.starosta(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum StarostaScreen: Hashable {
    case myGroup
    case groupDocuments
    case groupDocumentRequest(id: String)
    case invites

    var title: String {
        switch self {
        case .myGroup: return String(localized: "starosta.screen.myGroup", defaultValue: "Моя группа")
        case .groupDocuments: return String(localized: "starosta.screen.groupDocuments", defaultValue: "Сбор документов")
        case .groupDocumentRequest: return String(localized: "starosta.screen.groupDocumentRequest", defaultValue: "Запрос документов")
        case .invites: return String(localized: "starosta.screen.invites", defaultValue: "Приглашения")
        }
    }

    var symbol: String {
        switch self {
        case .myGroup: return "person.3"
        case .groupDocuments: return "tray.full"
        case .groupDocumentRequest: return "tray.full"
        case .invites: return "paperplane"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        switch self {
        case .myGroup:
            StarostaGroupView()
        case .groupDocuments:
            StarostaGroupDocumentsView()
        case .groupDocumentRequest(let id):
            StarostaGroupDocumentRequestView(requestID: id)
        case .invites:
            StarostaInvitesView()
        }
    }

    static var serviceItems: [WorkspaceItem] {
        [
            WorkspaceItem(title: Self.myGroup.title, symbol: Self.myGroup.symbol, tint: TileTint.teal, route: .starosta(.myGroup)),
            WorkspaceItem(title: Self.groupDocuments.title, symbol: Self.groupDocuments.symbol, tint: TileTint.orange, route: .starosta(.groupDocuments)),
            WorkspaceItem(title: Self.invites.title, symbol: Self.invites.symbol, tint: TileTint.blue, route: .starosta(.invites)),
        ]
    }
}

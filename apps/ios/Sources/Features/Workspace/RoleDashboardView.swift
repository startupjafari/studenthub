import SwiftUI

/// Вкладка «Обзор»: стартовый экран роли, как `ROLE_HOME` в вебе. Сам обзор живёт в
/// области роли, здесь — только развилка.
struct RoleDashboardView: View {
    let role: Role

    var body: some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: AppRoute.section(.notifications)) {
                        Image(systemName: "bell")
                    }
                    .accessibilityLabel(Text(MoreSection.notifications.title))
                    .accessibilityIdentifier("dashboard.notifications")
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch role {
        case .dean:
            DeanScreen.dashboard.destination
        case .universityAdmin:
            UniAdminScreen.dashboard.destination
        case .universityModerator:
            AdminScreen.universityModeratorDashboard.destination
        case .platformAdmin:
            AdminScreen.platformDashboard.destination
        case .platformModerator:
            AdminScreen.platformModeratorDashboard.destination
        case .employer:
            CareerScreen.employerHome.destination
        case .securityGuard:
            SecurityScreen.post.destination
        case .librarian:
            LibrarianScreen.home.destination
        case .student, .starosta, .teacher, .unknown:
            HomeView(role: role)
        }
    }
}

import SwiftUI

/// Вкладка «Главная»: стартовый экран роли, как `ROLE_HOME` в вебе. Сам экран живёт в
/// области роли, здесь — только развилка и колокольчик уведомлений, общий для всех.
struct RoleHomeView: View {
    let role: Role

    var body: some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NotificationsBell()
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch role {
        case .student, .starosta:
            StudentHomeView()
        case .teacher:
            TeachingDashboardView()
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
        case .unknown:
            // Роль вне сборки до оболочки не доходит (`UnsupportedRoleView`).
            EmptyView()
        }
    }
}

/// Колокольчик в верхней панели «Главной»: точка у значка — есть непрочитанное.
/// Счётчик перечитывается при каждом показе: вернулись из уведомлений — точка гаснет.
struct NotificationsBell: View {
    @State private var unread = 0

    var body: some View {
        NavigationLink(value: AppRoute.section(.notifications)) {
            Image(systemName: unread > 0 ? "bell.badge" : "bell")
                .symbolRenderingMode(unread > 0 ? .multicolor : .monochrome)
        }
        .accessibilityLabel(Text(MoreSection.notifications.title))
        .accessibilityValue(Text(unread > 0
            ? String(localized: "home.notifications.unread", defaultValue: "Непрочитанных: \(unread)")
            : ""))
        .accessibilityIdentifier("dashboard.notifications")
        .onAppear {
            Task {
                if let value = try? await FeedAPI().unreadNotifications() { unread = value }
            }
        }
    }
}

import SwiftUI

/// Мои заявки: что подано и в каком состоянии.
///
/// Статусы приезжают в реальном времени (`application.status.changed`): человек
/// ждёт справку и не должен обновлять экран, чтобы узнать, что она готова. Раздел
/// может выключить платформа.
struct ApplicationsView: View {
    var body: some View {
        CommunitySectionGate(section: "applications") { CommunityApplicationsList() }
    }
}

/// Каталог услуг: категории и услуги внутри них, поиск по названию.
struct ServiceCatalogView: View {
    var body: some View {
        CommunitySectionGate(section: "applications") { CommunityServiceCatalog() }
    }
}

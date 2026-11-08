import SwiftUI

/// Подача заявки на услугу.
///
/// Форма строится по ответу сервера, а не по захардкоженным полям: состав полей
/// задаёт вуз, и каждая новая услуга иначе требовала бы релиза приложения.
struct ApplicationFormView: View {
    let serviceID: String

    var body: some View {
        CommunitySectionGate(section: "applications") { CommunityApplicationForm(serviceID: serviceID) }
    }
}

/// Карточка заявки: статус, анкета, документы по требованиям, результат, выдача, история.
struct ApplicationDetailView: View {
    let applicationID: String

    var body: some View {
        CommunitySectionGate(section: "applications") { CommunityApplicationDetail(applicationID: applicationID) }
    }
}

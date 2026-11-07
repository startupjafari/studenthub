import Observation
import SwiftUI

/// Свой профиль, общий для всей оболочки: аватар в верхней панели каждой вкладки,
/// строка «Что нового?», шапка профиля и настройки.
///
/// Живёт в оболочке, а не в `AppServices`: оболочка исчезает при выходе из аккаунта,
/// и вместе с ней — профиль прежнего человека. Следующий вход начинает с пустого.
@Observable
final class ViewerProfileModel {
    private(set) var profile: UserProfileDTO?

    private let api: FeedFetching

    init(api: FeedFetching = FeedAPI()) {
        self.api = api
    }

    /// Отказ сети прежний профиль не стирает: аватар без связи лучше вопросительного
    /// знака.
    @MainActor
    func refresh() async {
        if let value = try? await api.me() { profile = value }
    }

    /// Профиль поменяли на своём экране — остальные места подхватывают без запроса.
    @MainActor
    func adopt(_ profile: UserProfileDTO) {
        self.profile = profile
    }
}

/// Аватар в верхней панели: вход в свой профиль, а оттуда — в настройки. Отдельной
/// вкладки у профиля нет: его открывают реже, чем расписание и чаты, и место в панели
/// вкладок ему не по чину.
struct ProfileToolbarButton: View {
    @Environment(ViewerProfileModel.self) private var viewer

    var body: some View {
        NavigationLink(value: AppRoute.section(.profile)) {
            AvatarView(url: viewer.profile?.avatarUrl, name: viewer.profile?.name, size: 30)
        }
        .accessibilityLabel(Text(String(localized: "more.profile", defaultValue: "Профиль")))
        .accessibilityIdentifier("toolbar.profile")
    }
}

extension View {
    /// Аватар профиля в начале верхней панели корневого экрана вкладки.
    func profileToolbarItem() -> some View {
        toolbar {
            ToolbarItem(placement: .topBarLeading) {
                ProfileToolbarButton()
            }
        }
    }
}

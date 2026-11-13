import Observation
import SwiftUI

/// Свой профиль, общий для всей оболочки: аватар в верхней панели каждой вкладки,
/// строка «Что нового?», шапка профиля и настройки.
///
/// Живёт в оболочке, а не в `AppServices`: оболочка исчезает при выходе из аккаунта,
/// и вместе с ней — профиль прежнего человека. Следующий вход начинает с пустого.
@MainActor
@Observable
final class ViewerProfileModel {
    /// Переключатели конфиденциальности (`PrivacySettingsView`).
    enum PrivacyFlag: Hashable, Sendable {
        case showEmail
        case showPhone
    }

    private(set) var profile: UserProfileDTO?

    private let api: FeedFetching
    /// Переключатели и выбор «кто видит профиль» — оптимистично: значение меняется
    /// сразу и не отскакивает назад до ответа сервера (п. 22 аудита).
    private let privacyFlags: OptimisticSync<PrivacyFlag, Bool>
    private let visibility: OptimisticSync<String, String>

    init(api: FeedFetching = FeedAPI(), pacing: OptimisticPacing = .standard) {
        self.api = api
        privacyFlags = OptimisticSync(label: "privacy.flag", pacing: pacing)
        visibility = OptimisticSync(label: "privacy.visibility", pacing: pacing)
    }

    /// Отказ сети прежний профиль не стирает: аватар без связи лучше вопросительного
    /// знака. Настройки, которые ещё в пути, — поверх ответа.
    @MainActor
    func refresh() async {
        let flagsRead = privacyFlags.beginRead()
        let visibilityRead = visibility.beginRead()
        guard var value = try? await api.me() else { return }
        value.showEmail = privacyFlags.resolve(.showEmail, server: value.showEmail ?? false, readAt: flagsRead)
        value.showPhone = privacyFlags.resolve(.showPhone, server: value.showPhone ?? false, readAt: flagsRead)
        if let server = value.profileVisibility {
            value.profileVisibility = visibility.resolve(Self.visibilityKey, server: server, readAt: visibilityRead)
        }
        profile = value
    }

    /// Показывать почту или телефон. Отказ — откат и `failed`.
    @MainActor
    func setPrivacy(
        _ flag: PrivacyFlag,
        to on: Bool,
        api account: AccountFetching = AccountAPI(),
        failed: @escaping @MainActor (Error) -> Void
    ) async {
        let shown = privacyFlag(flag)
        await privacyFlags.set(
            flag,
            to: on,
            current: shown,
            apply: { [weak self] value in self?.applyPrivacy(flag, value) },
            send: { _, value in
                let update = flag == .showEmail ? ProfileUpdate(showEmail: value) : ProfileUpdate(showPhone: value)
                let saved = try await account.updateProfile(update)
                return flag == .showEmail ? saved.showEmail : saved.showPhone
            },
            failed: failed
        )
    }

    /// Кто видит профиль.
    @MainActor
    func setVisibility(
        _ value: String,
        api account: AccountFetching = AccountAPI(),
        failed: @escaping @MainActor (Error) -> Void
    ) async {
        let shown = profile?.profileVisibility ?? Self.defaultVisibility
        await visibility.set(
            Self.visibilityKey,
            to: value,
            current: shown,
            apply: { [weak self] next in self?.profile?.profileVisibility = next },
            send: { _, next in
                try await account.updateProfile(ProfileUpdate(profileVisibility: next)).profileVisibility
            },
            failed: failed
        )
    }

    /// Значение переключателя — как его рисует экран: нет поля — выключен.
    func privacyFlag(_ flag: PrivacyFlag) -> Bool {
        switch flag {
        case .showEmail: profile?.showEmail ?? false
        case .showPhone: profile?.showPhone ?? false
        }
    }

    static let defaultVisibility = "UNIVERSITY"
    private static let visibilityKey = "profileVisibility"

    @MainActor
    private func applyPrivacy(_ flag: PrivacyFlag, _ on: Bool) {
        switch flag {
        case .showEmail: profile?.showEmail = on
        case .showPhone: profile?.showPhone = on
        }
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
    func profileToolbarItem(isHidden: Bool = false) -> some View {
        toolbar {
            if !isHidden {
                ToolbarItem(placement: .topBarLeading) {
                    ProfileToolbarButton()
                }
            }
        }
    }
}

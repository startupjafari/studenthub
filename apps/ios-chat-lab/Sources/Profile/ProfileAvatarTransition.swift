import UIKit

/// Перелёт аватара между шапкой чата и профилем.
///
/// Сам переход — системный push/pop навигации: так остаются рабочими интерактивный свайп
/// назад (на iOS 26 — с любого места экрана) и его отмена. Аватар летит поверх перехода
/// анимацией «вместе с переходом» (`animate(alongsideTransition:)`): при интерактивном
/// возврате она идёт за пальцем, при отмене — возвращается. Кривая — системная кривая
/// перехода, а не `.spring` Telegram: кастомный аниматор потребовал бы своего
/// интерактивного жеста вместо системного (см. отчёт о расхождениях).
@MainActor
final class ProfileAvatarTransition {
    private let flyingView = AvatarView()

    private init() {}

    /// Push чат → профиль: аватар из навигационной панели чата вырастает в аватар шапки.
    static func runPush(for profile: ProfileViewController) {
        guard !Motion.reduceMotion, UIView.areAnimationsEnabled,
              let coordinator = profile.transitionCoordinator,
              let chat = coordinator.viewController(forKey: .from) as? ChatViewController else { return }
        let transition = ProfileAvatarTransition()
        profile.avatarTransition = transition
        let flying = transition.flyingView
        flying.configure(peer: profile.store.peer)
        flying.isUserInteractionEnabled = false
        let source = sourceFrameInWindow(chat: chat)

        coordinator.animate(alongsideTransition: { context in
            let container = context.containerView
            profile.view.layoutIfNeeded()
            let target = profile.header.convert(profile.header.avatarRestingFrame, to: container)
            UIView.performWithoutAnimation {
                container.addSubview(flying)
                flying.frame = container.convert(source, from: nil)
                flying.layoutIfNeeded()
                chat.avatarView.alpha = 0
                profile.header.avatarView.alpha = 0
            }
            flying.frame = target
            flying.layoutIfNeeded()
        }, completion: { context in
            flying.removeFromSuperview()
            chat.avatarView.alpha = 1
            profile.avatarTransition = nil
            profile.header.avatarView.alpha = 1
            profile.header.setCollapse(progress: profile.header.collapseProgress)
            _ = context
        })
    }

    /// Pop профиль → чат: аватар шапки сжимается обратно в навигационную панель чата.
    /// При интерактивном свайпе идёт за пальцем; при отмене всё возвращается как было.
    static func runPop(for profile: ProfileViewController) {
        guard !Motion.reduceMotion, UIView.areAnimationsEnabled,
              let coordinator = profile.transitionCoordinator,
              let chat = coordinator.viewController(forKey: .to) as? ChatViewController,
              profile.header.avatarView.alpha > 0.05 else { return }
        let transition = ProfileAvatarTransition()
        profile.avatarTransition = transition
        let flying = transition.flyingView
        flying.configure(peer: profile.store.peer)
        flying.isUserInteractionEnabled = false
        let headerAlpha = profile.header.avatarView.alpha

        coordinator.animate(alongsideTransition: { context in
            let container = context.containerView
            let avatar = profile.header.avatarView
            let source = avatar.convert(avatar.bounds, to: container)
            let target = container.convert(sourceFrameInWindow(chat: chat), from: nil)
            UIView.performWithoutAnimation {
                container.addSubview(flying)
                flying.frame = source
                flying.alpha = headerAlpha
                flying.layoutIfNeeded()
                avatar.alpha = 0
                chat.avatarView.alpha = 0
            }
            flying.frame = target
            flying.alpha = 1
            flying.layoutIfNeeded()
        }, completion: { context in
            flying.removeFromSuperview()
            chat.avatarView.alpha = 1
            profile.avatarTransition = nil
            if context.isCancelled {
                profile.header.avatarView.alpha = headerAlpha
                profile.header.setCollapse(progress: profile.header.collapseProgress)
            }
        })
    }

    /// Рамка аватара в шапке чата в координатах окна. Во время перехода панель чата может
    /// быть ещё не в окне — тогда место считается от навигационной панели (кнопка справа).
    private static func sourceFrameInWindow(chat: ChatViewController) -> CGRect {
        let avatar = chat.avatarView
        if avatar.window != nil {
            let frame = avatar.convert(avatar.bounds, to: nil)
            if frame.width > 1, frame.minX > 0 { return frame }
        }
        let size: CGFloat = 37
        if let bar = chat.navigationController?.navigationBar, bar.window != nil {
            let barFrame = bar.convert(bar.bounds, to: nil)
            return CGRect(x: barFrame.maxX - 16 - size, y: barFrame.midY - size / 2, width: size, height: size)
        }
        let width = chat.view.window?.bounds.width ?? chat.view.bounds.width
        let top = chat.view.window?.safeAreaInsets.top ?? 59
        return CGRect(x: width - 16 - size, y: top + 22 - size / 2, width: size, height: size)
    }
}

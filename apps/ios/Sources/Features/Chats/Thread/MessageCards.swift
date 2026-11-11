import SwiftUI

// MARK: - Профиль, которым поделились

/// Профиль, которым поделились в чат. «Поделиться профилем» отправляет обычный текст
/// из двух строк — «Имя Фамилия» и ссылку на `/profile/<id>`, — и веб рисует его
/// карточкой (`parseProfileShare` в `shared-cards.tsx`). Здесь — то же правило.
struct ProfileShare: Equatable {
    let userID: String
    let name: String

    /// Ровно две строки: имя и ссылка на профиль на нашем вебе. Адрес веба неизвестен
    /// (сборка без `SHWebBaseURL`) — подходит любая https-ссылка вида `/profile/<id>`.
    static func parse(_ content: String) -> ProfileShare? {
        // Дешёвый отсев: разбор идёт на каждую перерисовку пузыря.
        guard content.contains("/profile/") else { return nil }
        let lines = content
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard lines.count == 2, !lines[0].isEmpty, let url = URL(string: lines[1]) else { return nil }
        guard isOurWeb(url), let id = profileID(in: url) else { return nil }
        return ProfileShare(userID: id, name: lines[0])
    }

    private static func isOurWeb(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host()?.lowercased() else { return false }
        guard let base = AppConfiguration.webBaseURL else { return scheme == "https" }
        return host == base.host()?.lowercased()
            && scheme == base.scheme?.lowercased()
            && url.port == base.port
    }

    /// `/profile/<id>` или `/profile/<id>/`; id — буквы, цифры, «-» и «_», как в вебе.
    private static func profileID(in url: URL) -> String? {
        let parts = url.path(percentEncoded: false).split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count == 2, parts[0] == "profile" else { return nil }
        let id = String(parts[1])
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        guard id.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }
        return id
    }
}

/// Карточка профиля в пузыре: аватар, имя, чем человек занимается, «Профиль ›». Данные —
/// запросом карточки пользователя, как в вебе; не загрузилось (профиль скрыт или удалён) —
/// остаётся имя из сообщения: оно тоже ведёт в профиль, а там сервер скажет, что видно.
struct ProfileShareCard: View {
    let share: ProfileShare
    let isOwn: Bool

    @State private var info: ProfileCards.Info?

    private static let width: CGFloat = 240
    private static let avatar: CGFloat = 44

    private var name: String {
        if let full = info?.name, !full.isEmpty { return full }
        return share.name
    }

    var body: some View {
        Button(action: open) {
            HStack(spacing: Spacing.md) {
                avatarView
                VStack(alignment: .leading, spacing: 1) {
                    Text(String(localized: "chats.profileCard.label", defaultValue: "Профиль"))
                        .font(.caption.weight(.medium))
                        .opacity(0.75)
                    Text(name)
                        .font(Typography.body.weight(.semibold))
                        .lineLimit(1)
                    if let subtitle = info?.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(Typography.meta)
                            .lineLimit(1)
                            .opacity(0.75)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .opacity(0.6)
                    .accessibilityHidden(true)
            }
            .multilineTextAlignment(.leading)
            .padding(Spacing.md)
            .frame(maxWidth: Self.width, alignment: .leading)
            .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
            .background(
                isOwn ? Palette.primaryForeground.opacity(0.15) : Palette.muted,
                in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
            )
            .contentShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        }
        .buttonStyle(.plain)
        .task(id: share.userID) {
            info = await ProfileCards.shared.info(for: share.userID)
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text(String(localized: "chats.profileCard.open", defaultValue: "Открыть профиль")))
    }

    @ViewBuilder
    private var avatarView: some View {
        if let url = info?.avatarURL {
            AvatarView(url: url, name: name, size: Self.avatar)
        } else {
            // Без фото — инициалы на устойчивом цвете человека, как имя автора в группе.
            Text(verbatim: initials)
                .font(.system(size: Self.avatar * 0.38, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: Self.avatar, height: Self.avatar)
                .background(SenderColor.color(for: share.userID), in: Circle())
                .accessibilityHidden(true)
        }
    }

    private var initials: String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    /// Профиль открывается в стеке текущей вкладки — там, где открыта переписка.
    private func open() {
        let router = AppServices.router
        router.stacks[router.selectedTab, default: []].append(.profile(id: share.userID))
    }
}

/// Карточки профилей для пузырей: один запрос на человека за запуск приложения. Лента
/// переиспользует ячейки, и без этого каждая прокрутка мимо карточки ходила бы в сеть.
/// `nil` в кэше — «не вышло» (профиль скрыт, сеть): карточка остаётся с именем из текста.
actor ProfileCards {
    static let shared = ProfileCards()

    struct Info: Sendable, Equatable {
        let name: String?
        let avatarURL: String?
        let subtitle: String?
    }

    private var known: [String: Info?] = [:]
    private var inFlight: [String: Task<Info?, Never>] = [:]

    func info(for userID: String) async -> Info? {
        if let cached = known[userID] { return cached }
        if let running = inFlight[userID] { return await running.value }
        let task = Task<Info?, Never> {
            guard let profile = try? await FeedAPI().user(id: userID) else { return nil }
            let name = [profile.lastName, profile.firstName]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            let headline = profile.headline?.trimmingCharacters(in: .whitespacesAndNewlines)
            let subtitle = (headline?.isEmpty == false ? headline : nil)
                ?? profile.role.flatMap { Role(rawValue: $0) }.map(\.title)
            return Info(name: name.isEmpty ? nil : name, avatarURL: profile.avatarUrl, subtitle: subtitle)
        }
        inFlight[userID] = task
        let result = await task.value
        inFlight[userID] = nil
        known[userID] = .some(result)
        return result
    }

    /// Выход из аккаунта: карточки, увиденные прежним человеком, следующему ни к чему.
    func clear() {
        known = [:]
    }
}

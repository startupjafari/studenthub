import SwiftUI
import UIKit

// Общие детали ленты и историй: картинка с кэшем, аватар, форматированный текст,
// подписи ролей и аудиторий.

/// Картинки ленты в памяти.
///
/// Ключ — id файла и ширина копии, а не ссылка: ссылки подписаны и меняются при каждом
/// обновлении ленты, и кэш по адресу промахивался бы всякий раз. `NSCache` сам
/// отпускает память, когда системе её не хватает.
final class ImageMemoryCache: @unchecked Sendable {
    static let shared = ImageMemoryCache()

    private let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 80 * 1024 * 1024
        return cache
    }()

    func image(for key: String) -> UIImage? {
        cache.object(forKey: key as NSString)
    }

    func store(_ image: UIImage, for key: String) {
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: key as NSString, cost: cost)
    }

    /// Загрузка с декодированием вне главного потока: крупный JPEG, распакованный при
    /// первом показе, дёргает прокрутку.
    func load(_ url: URL, key: String) async -> UIImage? {
        if let cached = image(for: key) { return cached }
        guard
            let (data, response) = try? await URLSession.shared.data(from: url),
            (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true,
            let image = UIImage(data: data)
        else { return nil }
        let prepared = await image.byPreparingForDisplay() ?? image
        store(prepared, for: key)
        return prepared
    }
}

/// Картинка по сети: пока грузится — размытое превью или ровная подложка, при ошибке
/// — значок. Пропорции держит тот, кто ставит рамку.
struct RemoteImage: View {
    let url: URL?
    let cacheKey: String
    var placeholder: String?
    var contentMode: ContentMode = .fill

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else if let preview = LQIP.image(from: placeholder) {
                Image(uiImage: preview)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .blur(radius: 12)
            } else {
                Rectangle().fill(Palette.muted)
                if failed {
                    Image(systemName: "photo")
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
        }
        .clipped()
        .task(id: cacheKey) {
            if let cached = ImageMemoryCache.shared.image(for: cacheKey) {
                image = cached
                return
            }
            guard let url else {
                failed = true
                return
            }
            let loaded = await ImageMemoryCache.shared.load(url, key: cacheKey)
            withAnimation(.easeOut(duration: Motion.Duration.feedback)) {
                image = loaded
                failed = loaded == nil
            }
        }
    }
}

/// Размытое превью из data-URI (`data:image/webp;base64,…`).
enum LQIP {
    static func image(from dataURI: String?) -> UIImage? {
        guard
            let dataURI,
            let comma = dataURI.firstIndex(of: ","),
            let data = Data(base64Encoded: String(dataURI[dataURI.index(after: comma)...]))
        else { return nil }
        return UIImage(data: data)
    }
}

extension Array where Element == MediaSource {
    /// Наименьшая копия, которая не мельче нужного: экран 3x на ширину карточки.
    func best(forPoints points: CGFloat, scale: CGFloat = 3) -> MediaSource? {
        let pixels = Int(points * scale)
        return first { $0.width >= pixels } ?? last
    }
}

extension URL {
    /// Путь от корня API (`/api/v1/media/…`) — к хосту API из конфигурации.
    static func apiRooted(_ path: String) -> URL? {
        if path.hasPrefix("http") { return URL(string: path) }
        var components = URLComponents(url: AppConfiguration.apiBaseURL, resolvingAgainstBaseURL: false)
        components?.path = ""
        components?.query = nil
        guard let base = components?.url else { return nil }
        return URL(string: base.absoluteString + path)
    }
}

/// Аватар: фото или инициалы на подложке. Круг — как во всей системе. По умолчанию —
/// размер профиля; в ленте и комментариях размер передаётся явно.
struct AvatarView: View {
    let url: String?
    let name: String?
    var size: CGFloat = ControlHeight.island

    var body: some View {
        Group {
            if let url, let parsed = URL(string: url) {
                RemoteImage(url: parsed, cacheKey: "avatar:\(url.split(separator: "?").first ?? "")")
            } else {
                ZStack {
                    Circle().fill(Palette.primary.opacity(0.12))
                    Text(verbatim: initials)
                        .font(.system(size: size * 0.38, weight: .semibold))
                        .foregroundStyle(Palette.primary)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initials: String {
        let letters = (name ?? "").split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }
}

/// Текст поста: ограниченный Markdown сервера (жирный, курсив, зачёркнутый, код,
/// ссылки), голые адреса и упоминания `@login`.
///
/// Списки и цитаты остаются строками как есть: разбор `inlineOnlyPreservingWhitespace`
/// сохраняет переносы, и «- пункт» читается и без отрисовки маркера.
enum RichText {
    static func attributed(_ source: String) -> AttributedString {
        var text = (try? AttributedString(
            markdown: source,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace,
                failurePolicy: .returnPartiallyParsedIfPossible
            )
        )) ?? AttributedString(source)
        // Опасные схемы не открываем: сервер разрешает только http, https и mailto.
        for run in text.runs {
            if let link = run.link, !["http", "https", "mailto"].contains(link.scheme ?? "") {
                text[run.range].link = nil
            }
        }
        decorate(&text)
        return text
    }

    private static let mention = try? NSRegularExpression(pattern: "(?<![\\w@])@[A-Za-z0-9_]{3,32}")
    private static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    private static func decorate(_ text: inout AttributedString) {
        let plain = String(text.characters)
        let whole = NSRange(plain.startIndex..., in: plain)
        for match in detector?.matches(in: plain, range: whole) ?? [] {
            guard
                let url = match.url, ["http", "https"].contains(url.scheme ?? ""),
                let range = Range(match.range, in: plain),
                let attributed = Range(range, in: text),
                text[attributed].link == nil
            else { continue }
            text[attributed].link = url
        }
        for match in mention?.matches(in: plain, range: whole) ?? [] {
            guard let range = Range(match.range, in: plain), let attributed = Range(range, in: text) else { continue }
            text[attributed].foregroundColor = Palette.primary
            text[attributed].font = Typography.body.weight(.medium)
        }
    }
}

extension Role {
    /// Подпись под именем автора. Студент без подписи: в студенческой ленте это
    /// большинство, и строка «Студент» под каждым постом — шум.
    var feedTitle: String? {
        switch self {
        case .teacher: return String(localized: "role.teacher", defaultValue: "Преподаватель")
        case .starosta: return String(localized: "role.starosta", defaultValue: "Староста")
        case .dean: return String(localized: "role.dean", defaultValue: "Деканат")
        case .universityAdmin, .universityModerator:
            return String(localized: "role.university", defaultValue: "Администрация вуза")
        case .platformAdmin, .platformModerator:
            return String(localized: "role.platform", defaultValue: "StudentHub")
        case .employer: return String(localized: "role.employer", defaultValue: "Работодатель")
        case .securityGuard: return String(localized: "role.securityGuard", defaultValue: "Охрана")
        case .librarian: return String(localized: "role.librarian", defaultValue: "Библиотекарь")
        case .student, .unknown: return nil
        }
    }
}

/// Кому адресован пост — короткой подписью рядом со временем.
enum PostAudienceLabel {
    static func title(_ raw: String?) -> String? {
        switch raw {
        case "ALL": return String(localized: "audience.all", defaultValue: "Для всех")
        case "UNIVERSITY": return String(localized: "audience.university", defaultValue: "Вуз")
        case "FACULTY": return String(localized: "audience.faculty", defaultValue: "Факультет")
        case "GROUP": return String(localized: "audience.group", defaultValue: "Группа")
        case "SUBJECT": return String(localized: "audience.subject", defaultValue: "Дисциплина")
        case "TEACHERS": return String(localized: "audience.teachers", defaultValue: "Преподаватели")
        case "PERSONAL": return String(localized: "audience.personal", defaultValue: "Лично вам")
        default: return nil
        }
    }

    static func symbol(_ raw: String?) -> String {
        switch raw {
        case "ALL": return "globe"
        case "UNIVERSITY": return "building.columns"
        case "FACULTY": return "building.2"
        case "GROUP": return "person.3"
        case "SUBJECT": return "book.closed"
        case "TEACHERS": return "person.crop.rectangle.stack"
        case "PERSONAL": return "lock"
        default: return "globe"
        }
    }
}

/// Реакции на посты — белый список сервера (`POST_REACTION_EMOJIS`). Первая —
/// реакция по быстрому нажатию, как «нравится» в вебе.
enum PostReactions {
    static let all = ["❤️", "👍", "🔥", "👏", "😮", "🎉"]
    static let quick = "❤️"
}

/// Ровная серая плашка вместо контента, пока идёт первая загрузка.
struct SkeletonBlock: View {
    var height: CGFloat
    var width: CGFloat?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dimmed = false

    var body: some View {
        RoundedRectangle(cornerRadius: Radius.sm)
            .fill(Palette.muted)
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .opacity(dimmed ? 0.5 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                    dimmed = true
                }
            }
            .accessibilityHidden(true)
    }
}

/// Поверхность карточки на главной: непрозрачная, со скруглением системы и тонкой
/// границей — в тёмной теме карточка отделяется от фона цветом, а не тенью.
struct CardSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous)
                    .strokeBorder(Palette.border.opacity(0.6), lineWidth: 0.5)
            )
    }
}

extension View {
    func cardSurface() -> some View { modifier(CardSurface()) }
}

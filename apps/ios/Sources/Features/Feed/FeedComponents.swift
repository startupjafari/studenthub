import CoreImage
import SwiftUI
import UIKit
import os

// Общие детали ленты и историй: картинка с кэшем, аватар, форматированный текст,
// подписи ролей и аудиторий.

/// Картинка по сети: пока грузится — размытое превью или ровная подложка, при ошибке
/// — значок. Пропорции держит тот, кто ставит рамку.
///
/// Размер копии: `maxPixelSize`, если его задал вызывающий (аватар), иначе — по
/// фактическому размеру вида × масштаб экрана (`ImageTarget.view`), с учётом
/// `contentMode`. Первый кадр берёт из памяти любую готовую копию — при возврате
/// прокруткой картинка не мигает превью, а точная копия догружается следом.
struct RemoteImage: View {
    let url: URL?
    let cacheKey: String
    var placeholder: String?
    var contentMode: ContentMode = .fill
    /// Длинная сторона копии в пикселях: аватару и миниатюре полный кадр не нужен.
    /// `nil` — по размеру вида.
    var maxPixelSize: CGFloat?
    /// Подложка, пока картинки нет. `nil` — прозрачно: под картинкой своя заглушка
    /// (обложка книги со значком).
    var emptyFill: Color? = Palette.muted

    @State private var image: UIImage?
    @State private var failed = false
    /// Чьи `image` и `failed`: вид мог получить другой ключ (сменили аватар), и прежний
    /// кадр или прежний сбой показывать уже нельзя.
    @State private var stateKey: String?
    /// Размер вида в точках — из него цель считается в теле, с текущими масштабом
    /// экрана и `contentMode`.
    @State private var viewSize: CGSize = .zero
    @Environment(\.motionReduced) private var reduceMotion
    @Environment(\.displayScale) private var displayScale

    private var target: ImageTarget? {
        if let maxPixelSize { return .longSide(maxPixelSize) }
        return ImageTarget.view(viewSize, scale: displayScale, mode: contentMode == .fit ? .fit : .fill)
    }

    var body: some View {
        // Готовая копия из памяти — уже в первом кадре, без ожидания `.task`.
        let own = stateKey == cacheKey ? image : nil
        let shown = own ?? ImageMemoryCache.shared.image(for: cacheKey)
        let showsFailure = stateKey == cacheKey && failed
        ZStack {
            if let shown {
                Image(uiImage: shown)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else if let preview = LQIP.blurred(from: placeholder) {
                // Превью уже размыто при разборе: размытие на каждом кадре прокрутки —
                // лишний проход вне экрана на каждую плитку.
                Image(uiImage: preview)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else if let emptyFill {
                Rectangle().fill(emptyFill)
                if showsFailure {
                    Image(systemName: "photo")
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
        }
        .clipped()
        .onGeometryChange(for: CGSize.self) { proxy in
            proxy.size
        } action: { size in
            guard maxPixelSize == nil else { return }
            // Цель идёт ступенями, так что дрожь раскладки в доли точки задачу не
            // перезапустит; лишнее присваивание отсекаем здесь же.
            if abs(size.width - viewSize.width) >= 0.5 || abs(size.height - viewSize.height) >= 0.5 {
                viewSize = size
            }
        }
        // После сбоя в повод входит и адрес: экран из сохранённого мог дать просроченную
        // подписанную ссылку (403), а свежий ответ — новую с тем же ключом файла.
        .task(id: RemoteImageLoad(key: cacheKey, target: target, retryURL: showsFailure ? url : nil)) {
            await load()
        }
    }

    @MainActor
    private func load() async {
        // Размер вида ещё неизвестен: грузить полный кадр «на всякий случай» нельзя —
        // дождёмся раскладки (`viewSize` сменит цель, а с ней id задачи).
        guard let target else { return }
        let key = cacheKey
        if let cached = ImageMemoryCache.shared.image(for: key, satisfying: target) {
            adopt(cached, for: key, animated: false)
            return
        }
        // Приблизительная копия этого же файла (своя или из памяти) — держим её, пока
        // грузится точная, и оставляем, если точная не пришла.
        let approximate = (stateKey == key ? image : nil) ?? ImageMemoryCache.shared.image(for: key)
        guard let url else {
            settle(approximate, for: key)
            return
        }
        let loaded = await ImageMemoryCache.shared.load(url, key: key, target: target)
        // Ключ сменился или вид ушёл — задачу сняли, её результат не наш.
        guard !Task.isCancelled else { return }
        if let loaded {
            adopt(loaded, for: key, animated: approximate == nil)
        } else {
            settle(approximate, for: key)
        }
    }

    /// Показать загруженное. Точная копия вместо приблизительной — без анимации:
    /// картинка та же.
    @MainActor
    private func adopt(_ loaded: UIImage, for key: String, animated: Bool) {
        guard animated else {
            image = loaded
            stateKey = key
            failed = false
            return
        }
        withAnimation(Motion.respecting(.easeOut(duration: Motion.Duration.feedback), reduceMotion: reduceMotion)) {
            image = loaded
            stateKey = key
            failed = false
        }
    }

    /// Загрузить не вышло: остаётся то, что было для этого ключа, иначе — значок сбоя.
    @MainActor
    private func settle(_ fallback: UIImage?, for key: String) {
        image = fallback
        stateKey = key
        failed = fallback == nil
    }
}

/// Повод перезапустить загрузку: другой файл или другая цель.
private struct RemoteImageLoad: Hashable {
    let key: String
    let target: ImageTarget?
    /// Адрес — только пока показан сбой: новая ссылка на тот же файл — повод повторить.
    let retryURL: URL?
}

/// Превью из data-URI (`data:image/webp;base64,…`), разобранное один раз.
///
/// Тело карточки пересчитывается при каждой прокрутке, и base64 с WebP разбирался
/// бы каждый раз (п. 37 аудита). Кеш — по самой строке: превью крошечные, строка
/// однозначно определяет картинку. Потокобезопасно: зовётся и из тела вида, и из
/// предзагрузки.
enum LQIP {
    /// Кеши и контекст Core Image — потокобезопасны сами по себе (`NSCache`,
    /// `CIContext`); обёртка только сообщает это компилятору.
    private final class Storage: @unchecked Sendable {
        let raw: NSCache<NSString, UIImage> = {
            let cache = NSCache<NSString, UIImage>()
            cache.countLimit = 400
            return cache
        }()

        let soft: NSCache<NSString, UIImage> = {
            let cache = NSCache<NSString, UIImage>()
            cache.countLimit = 400
            return cache
        }()

        /// Создавать контекст на каждое превью дорого.
        let context = CIContext(options: [.cacheIntermediates: false])

        private let lock = NSLock()
        private var generation = 0

        /// Растёт с каждой очисткой: превью, разобранное до выхода, в кеш не вернётся.
        var currentGeneration: Int { lock.withLock { generation } }

        func clear() {
            lock.withLock { generation += 1 }
            raw.removeAllObjects()
            soft.removeAllObjects()
        }
    }

    private static let storage = Storage()

    /// Выход из аккаунта: превью чужих фото в памяти не остаются.
    static func clearCache() {
        storage.clear()
    }

    /// Превью как есть (переписка размывает его сама).
    static func image(from dataURI: String?) -> UIImage? {
        guard let dataURI, !dataURI.isEmpty else { return nil }
        let key = dataURI as NSString
        if let known = storage.raw.object(forKey: key) { return known }
        let generation = storage.currentGeneration
        guard
            let comma = dataURI.firstIndex(of: ","),
            let data = Data(base64Encoded: String(dataURI[dataURI.index(after: comma)...])),
            let image = UIImage(data: data)
        else { return nil }
        let prepared = image.preparingForDisplay() ?? image
        if storage.currentGeneration == generation { storage.raw.setObject(prepared, forKey: key) }
        return prepared
    }

    /// Превью, уже размытое: вид рисует его как обычную картинку, без `.blur` на
    /// каждом кадре. Размытие — один раз, на крошечной копии.
    static func blurred(from dataURI: String?) -> UIImage? {
        guard let dataURI, !dataURI.isEmpty else { return nil }
        let key = dataURI as NSString
        if let known = storage.soft.object(forKey: key) { return known }
        let generation = storage.currentGeneration
        guard let source = image(from: dataURI) else { return nil }
        let result = blur(source) ?? source
        if storage.currentGeneration == generation { storage.soft.setObject(result, forKey: key) }
        return result
    }

    /// Крошечное превью растягивается до 64 px по длинной стороне и размывается: на
    /// экране это то же мягкое пятно, что давал `.blur(radius: 12)` поверх плитки.
    private static func blur(_ image: UIImage) -> UIImage? {
        guard let cgImage = image.cgImage else { return nil }
        let input = CIImage(cgImage: cgImage)
        let side = max(input.extent.width, input.extent.height)
        guard side > 0 else { return nil }
        let scale = max(1, 64 / side)
        let scaled = input.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let blurred = scaled.clampedToExtent().applyingGaussianBlur(sigma: 3).cropped(to: scaled.extent)
        guard let output = storage.context.createCGImage(blurred, from: scaled.extent) else { return nil }
        return UIImage(cgImage: output)
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
        // Свой файл на устройстве (снимок из переписки до отправки или уже скачанный):
        // приклеенный к адресу API, он превращался в ссылку в никуда, и «Поделиться»
        // висело на загрузке.
        if path.hasPrefix("file:") { return URL(string: path) }
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

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Group {
            if let url, let parsed = URL(string: url) {
                // Копия под размер кружка; в ключе — её размер, иначе маленькая копия из
                // ленты растягивалась бы на крупном аватаре профиля.
                let pixels = (size * displayScale).rounded(.up)
                RemoteImage(
                    url: parsed,
                    cacheKey: "avatar:\(url.split(separator: "?").first ?? ""):\(Int(pixels))",
                    maxPixelSize: pixels
                )
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
///
/// Разбор — один раз на текст (п. 3 и 34 аудита): `attributed` берёт готовое из кеша в
/// памяти, а `prepare`/`warm` разбирают заранее вне главного потока (сборка ленты
/// переписки, загрузка страницы ленты, предзагрузка ячеек), и ячейка получает готовый
/// результат. Ключ — сам текст: правка сообщения меняет текст и тем самым ключ, так что
/// устаревший разбор не покажется ни при какой правке, в том числе до ответа сервера.
/// От темы, Dynamic Type и языка результат не зависит: цвет и шрифт упоминаний —
/// системные динамические (`Palette.primary`, `Typography.body`), разрешаются при
/// отрисовке. Подсветка поиска накладывается на копию (значение `AttributedString`).
enum RichText {
    /// `NSCache` потокобезопасен; обёртка только сообщает это компилятору.
    private final class Storage: @unchecked Sendable {
        final class Parsed {
            let value: AttributedString
            init(_ value: AttributedString) { self.value = value }
        }

        let cache: NSCache<NSString, Parsed> = {
            let cache = NSCache<NSString, Parsed>()
            // Цена — длина текста: ограничение и по числу, и по объёму (≈ 8 МБ строк).
            cache.countLimit = 3_000
            cache.totalCostLimit = 4_000_000
            return cache
        }()

        private let lock = NSLock()
        private var generation = 0

        /// Растёт с каждой очисткой: разбор, начатый до выхода из аккаунта, в кеш
        /// следующего человека не попадёт.
        var currentGeneration: Int { lock.withLock { generation } }

        func clear() {
            lock.withLock { generation += 1 }
            cache.removeAllObjects()
        }
    }

    private static let storage = Storage()

    /// Разобранный текст: из кеша, иначе — разбор здесь же (и в кеш).
    static func attributed(_ source: String) -> AttributedString {
        if let known = cached(source) { return known }
        let generation = storage.currentGeneration
        let parsed = parse(source)
        remember(parsed, for: source, generation: generation)
        return parsed
    }

    /// Готовый разбор, если он уже есть.
    static func cached(_ source: String) -> AttributedString? {
        guard !source.isEmpty else { return nil }
        return storage.cache.object(forKey: source as NSString)?.value
    }

    /// Разобрать заранее то, чего ещё нет в кеше. Синхронно — для фоновых задач
    /// (сборка ленты переписки); прерывается отменой задачи.
    static func prepare<Sources: Sequence>(_ sources: Sources) where Sources.Element == String {
        let signpost = Signposts.chats.beginInterval("TextPrepare")
        let generation = storage.currentGeneration
        var parsed = 0
        for source in sources {
            if Task.isCancelled || storage.currentGeneration != generation { break }
            guard !source.isEmpty, cached(source) == nil else { continue }
            remember(parse(source), for: source, generation: generation)
            parsed += 1
        }
        Signposts.chats.endInterval("TextPrepare", signpost, "parsed: \(parsed)")
    }

    /// Разобрать заранее фоном. Задачу можно отменить (ячейка ушла с экрана).
    @discardableResult
    static func warm(_ sources: [String], priority: TaskPriority = .utility) -> Task<Void, Never> {
        Task.detached(priority: priority) { prepare(sources) }
    }

    /// Выход из аккаунта: тексты прежнего человека в памяти не остаются.
    static func clearCache() {
        storage.clear()
    }

    /// В кеш — только если с начала разбора его не очищали.
    private static func remember(_ parsed: AttributedString, for source: String, generation: Int) {
        guard !source.isEmpty, storage.currentGeneration == generation else { return }
        storage.cache.setObject(Storage.Parsed(parsed), forKey: source as NSString, cost: source.utf16.count)
    }

    private static func parse(_ source: String) -> AttributedString {
        // Разбор — только при промахе кеша: сколько раз и сколько стоит.
        let signpost = Signposts.chats.beginInterval("TextParse")
        defer { Signposts.chats.endInterval("TextParse", signpost, "chars: \(source.count)") }
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
        // Упоминание выделено весом, но не цветом ссылки: открыть профиль по логину
        // приложению нечем (ни адреса, ни запроса по логину), а цвет ссылки обещал бы
        // касание, которое ничего не делает (IOS_RULES 7.6.5).
        for match in mention?.matches(in: plain, range: whole) ?? [] {
            guard let range = Range(match.range, in: plain), let attributed = Range(range, in: text) else { continue }
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

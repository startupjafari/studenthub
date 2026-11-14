import Observation
import SwiftUI

/// Общие детали оформления чатов «как в Telegram»: обои переписки, галочки прочтения,
/// подписи числа участников, раскладка «в строку с переносом» и подложка плавающих
/// панелей.

// MARK: - Обои

/// Обои переписки: мягкий цветной градиент и едва заметный узор из учебных значков.
///
/// Рисуются кодом, без картинок: один и тот же узор подстраивается под тему и размер
/// экрана. В светлой теме подложка заметнее — иначе белые пузыри собеседника сливались
/// бы с фоном; в тёмной — глубже и спокойнее. При «Повышенном контрасте» узор убран:
/// он только мешает читать.
struct ChatWallpaper: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    private static let symbols = [
        "book.closed", "pencil", "graduationcap", "lightbulb", "bubble.left", "star",
        "paperplane", "books.vertical", "atom", "function", "music.note", "backpack",
    ]

    /// Места значков внутри плитки: смещение и поворот. Плитки идут вразбежку, поэтому
    /// повтор не бросается в глаза.
    private static let spots: [(x: CGFloat, y: CGFloat, angle: Double)] = [
        (18, 22, -14), (78, 12, 18), (128, 44, -6), (40, 76, 24), (98, 92, -22), (150, 118, 10), (16, 138, 8),
    ]
    private static let tile: CGFloat = 170

    var body: some View {
        ZStack {
            Palette.plainBackground
            LinearGradient(colors: gradient, startPoint: .topLeading, endPoint: .bottomTrailing)
            if contrast != .increased {
                pattern
            }
        }
        .accessibilityHidden(true)
    }

    private var gradient: [Color] {
        scheme == .dark
            ? [Palette.primary.opacity(0.20), Palette.chart2.opacity(0.12), Palette.chart3.opacity(0.10)]
            : [Palette.chart3.opacity(0.20), Palette.primary.opacity(0.14), Palette.success.opacity(0.16)]
    }

    private var pattern: some View {
        let ink = Palette.foreground.opacity(scheme == .dark ? 0.07 : 0.06)
        return Canvas(rendersAsynchronously: true) { context, size in
            let tile = Self.tile
            var row = 0
            var y: CGFloat = -tile / 3
            while y < size.height + tile {
                let shift: CGFloat = row.isMultiple(of: 2) ? 0 : tile / 2
                var column = 0
                var x: CGFloat = -shift
                while x < size.width + tile {
                    for (index, spot) in Self.spots.enumerated() {
                        let id = (index + row * 3 + column * 5) % Self.symbols.count
                        guard let symbol = context.resolveSymbol(id: id) else { continue }
                        var copy = context
                        copy.translateBy(x: x + spot.x, y: y + spot.y)
                        copy.rotate(by: .degrees(spot.angle))
                        copy.draw(symbol, at: .zero)
                    }
                    x += tile
                    column += 1
                }
                y += tile
                row += 1
            }
        } symbols: {
            ForEach(Array(Self.symbols.enumerated()), id: \.offset) { index, name in
                Image(systemName: name)
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(ink)
                    .tag(index)
            }
        }
    }
}

// MARK: - Галочки

/// Галочки своего сообщения: одна — доставлено, две — прочитано. Две рисуются
/// внахлёст, как в Telegram: отдельного символа для них в SF Symbols нет. В группе
/// рядом — сколько участников прочитали, как в вебе.
struct ChatReadChecks: View {
    let isRead: Bool
    var readCount = 0

    @ScaledMetric(relativeTo: .caption2) private var shift: CGFloat = 4.5

    var body: some View {
        HStack(spacing: 2) {
            ZStack(alignment: .leading) {
                Image(systemName: "checkmark")
                if isRead {
                    Image(systemName: "checkmark")
                        .offset(x: shift)
                }
            }
            .padding(.trailing, isRead ? shift : 0)
            .font(.caption2.weight(.bold))
            if isRead, readCount > 0 {
                Text(verbatim: readCount.formatted())
                    .font(Typography.tabular(.caption2))
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(label))
    }

    private var label: String {
        guard isRead else { return String(localized: "chats.sent", defaultValue: "Отправлено") }
        return readCount > 0 ? ChatPlural.readBy(readCount) : String(localized: "chats.read", defaultValue: "Прочитано")
    }
}

// MARK: - Подписи

enum ChatPlural {
    /// «1 участник», «3 участника», «12 участников» — по правилам русского языка.
    static func members(_ count: Int) -> String {
        let number = count.formatted()
        switch form(count) {
        case .one: return String(localized: "chats.members.one", defaultValue: "\(number) участник")
        case .few: return String(localized: "chats.members.few", defaultValue: "\(number) участника")
        case .many: return String(localized: "chats.members.many", defaultValue: "\(number) участников")
        }
    }

    /// «1 чат», «3 чата», «12 чатов» — число чатов в папке.
    static func chats(_ count: Int) -> String {
        let number = count.formatted()
        switch form(count) {
        case .one: return String(localized: "chats.count.one", defaultValue: "\(number) чат")
        case .few: return String(localized: "chats.count.few", defaultValue: "\(number) чата")
        case .many: return String(localized: "chats.count.many", defaultValue: "\(number) чатов")
        }
    }

    /// «Удалить 1 сообщение у всех?», «…2 сообщения…», «…5 сообщений…» — подтверждение
    /// удаления выбранного.
    static func deleteMessagesQuestion(_ count: Int) -> String {
        let number = count.formatted()
        switch form(count) {
        case .one:
            return String(localized: "chats.selection.delete.one", defaultValue: "Удалить \(number) сообщение?")
        case .few:
            return String(localized: "chats.selection.delete.few", defaultValue: "Удалить \(number) сообщения?")
        case .many:
            return String(localized: "chats.selection.delete.many", defaultValue: "Удалить \(number) сообщений?")
        }
    }

    /// «Переслано в 1 чат», «…в 3 чата», «…в 12 чатов» — итог пересылки.
    static func forwardedTo(_ count: Int) -> String {
        let number = count.formatted()
        switch form(count) {
        case .one: return String(localized: "chats.forwarded.one", defaultValue: "Переслано в \(number) чат")
        case .few: return String(localized: "chats.forwarded.few", defaultValue: "Переслано в \(number) чата")
        case .many: return String(localized: "chats.forwarded.many", defaultValue: "Переслано в \(number) чатов")
        }
    }

    /// «1 сообщение», «3 сообщения», «12 сообщений» — что пересылаем.
    static func forwardMessages(_ count: Int) -> String {
        let number = count.formatted()
        switch form(count) {
        case .one: return String(localized: "chats.forward.count.one", defaultValue: "\(number) сообщение")
        case .few: return String(localized: "chats.forward.count.few", defaultValue: "\(number) сообщения")
        case .many: return String(localized: "chats.forward.count.many", defaultValue: "\(number) сообщений")
        }
    }

    /// Заголовок листа вложений: «Отправить 1 файл», «…2 файла», «…5 файлов».
    static func sendFiles(_ count: Int) -> String {
        let number = count.formatted()
        switch form(count) {
        case .one: return String(localized: "chats.attach.sendFiles.one", defaultValue: "Отправить \(number) файл")
        case .few: return String(localized: "chats.attach.sendFiles.few", defaultValue: "Отправить \(number) файла")
        case .many: return String(localized: "chats.attach.sendFiles.many", defaultValue: "Отправить \(number) файлов")
        }
    }

    /// Сколько сообщений уйдёт из листа вложений — видно до отправки: одиннадцать
    /// снимков это два альбома, и узнавать об этом постфактум поздно.
    static func messagesToSend(_ count: Int) -> String {
        let number = count.formatted()
        switch form(count) {
        case .one: return String(localized: "chats.attach.messages.one", defaultValue: "Уйдёт \(number) сообщение")
        case .few: return String(localized: "chats.attach.messages.few", defaultValue: "Уйдут \(number) сообщения")
        case .many: return String(localized: "chats.attach.messages.many", defaultValue: "Уйдут \(number) сообщений")
        }
    }

    /// «Прочитали: 1 участник», «…3 участника», «…5 участников» — как в вебе.
    static func readBy(_ count: Int) -> String {
        let number = count.formatted()
        switch form(count) {
        case .one: return String(localized: "chats.readBy.one", defaultValue: "Прочитали: \(number) участник")
        case .few: return String(localized: "chats.readBy.few", defaultValue: "Прочитали: \(number) участника")
        case .many: return String(localized: "chats.readBy.many", defaultValue: "Прочитали: \(number) участников")
        }
    }

    private enum Form { case one, few, many }

    private static func form(_ count: Int) -> Form {
        let tens = count % 100
        let ones = count % 10
        if (11...14).contains(tens) { return .many }
        if ones == 1 { return .one }
        if (2...4).contains(ones) { return .few }
        return .many
    }
}

/// Статус собеседника личного чата: «в сети», «был(а) 5 минут назад» или «был(а)
/// недавно», когда человек скрыл время.
enum ChatPresence {
    static func caption(online: Bool, lastSeen: Date?, known: Bool) -> String? {
        if online { return String(localized: "chats.online", defaultValue: "в сети") }
        if let lastSeen {
            return String(
                localized: "chats.lastSeen",
                defaultValue: "был(а) \(lastSeen.formatted(.relative(presentation: .named)))"
            )
        }
        // Сведения о собеседнике пришли, а времени нет — он его скрыл.
        return known ? String(localized: "chats.lastSeen.recently", defaultValue: "был(а) недавно") : nil
    }

    /// Подпись группы: «12 участников, 3 в сети», а когда в сети никого — только число
    /// участников, как в Telegram.
    static func groupCaption(members: Int, online: Int) -> String? {
        guard members > 0 else { return nil }
        let total = ChatPlural.members(members)
        guard online > 0 else { return total }
        return String(
            localized: "chats.members.withOnline",
            defaultValue: "\(total), \(online.formatted()) в сети"
        )
    }
}

/// Кто из участников чата в сети: снимок с сервера, поверх него — события, пришедшие
/// позже снимка (`RealtimeCoordinator.presenceMarks`). Событие раньше снимка уже
/// учтено в нём самом и верх не берёт.
struct ChatPresenceSnapshot: Equatable {
    let online: [String: Bool]
    let takenAt: Date

    init(online: [String: Bool], takenAt: Date) {
        self.online = online
        self.takenAt = takenAt
    }

    init(_ entries: [ChatPresenceDTO], takenAt: Date) {
        online = Dictionary(entries.map { ($0.userId, $0.online) }, uniquingKeysWith: { $0 || $1 })
        self.takenAt = takenAt
    }

    var memberCount: Int { online.count }

    func isOnline(_ userID: String, live: [String: PresenceMark]) -> Bool {
        isOnline(userID) { live[$0] }
    }

    /// `live` — отметка по событиям для одного человека. Замыкание, а не словарь: экран
    /// следит только за участниками этого чата (`RealtimeCoordinator.presence(of:)`).
    func isOnline(_ userID: String, live: (String) -> PresenceMark?) -> Bool {
        if let mark = live(userID), mark.at >= takenAt { return mark.online }
        return online[userID] ?? false
    }

    /// Сколько участников, кроме смотрящего, сейчас в сети — как «N в сети» в вебе.
    func othersOnline(excluding viewerID: String, live: [String: PresenceMark]) -> Int {
        othersOnline(excluding: viewerID) { live[$0] }
    }

    func othersOnline(excluding viewerID: String, live: (String) -> PresenceMark?) -> Int {
        online.keys.reduce(0) { count, id in
            count + (id != viewerID && isOnline(id, live: live) ? 1 : 0)
        }
    }
}

// MARK: - Переход к сообщению

/// Просьба открыть переписку на конкретном сообщении или дате либо сразу с поиском —
/// от поиска и общих материалов, от календаря и «Поиска» в информации о чате. Экран переписки забирает просьбу,
/// когда снова становится видимым.
@MainActor
@Observable
final class ChatJumpRequests {
    static let shared = ChatJumpRequests()

    /// Чат → серверный идентификатор сообщения.
    var pending: [String: String] = [:]
    /// Чат → день, к которому перейти.
    var days: [String: Date] = [:]
    /// Чаты, где открыть поиск прямо в переписке.
    var searches: Set<String> = []
}

// MARK: - Раскладка с переносом

/// Элементы в строку с переносом на следующую — реакции под текстом пузыря.
struct ChatFlowLayout: Layout {
    var spacing: CGFloat = Spacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for (index, size) in zip(row.indices, row.sizes) {
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        /// Размеры детей из замера: расстановка берёт их же, а не мерит заново иначе.
        var sizes: [CGSize] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        // Ребёнка мерим шириной контейнера, а не `.unspecified`: элемент шире пузыря
        // переносится или сжимается внутри него, а не вылезает за край.
        let limit = ProposedViewSize(width: width.isFinite ? width : nil, height: nil)
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            var size = subviews[index].sizeThatFits(limit)
            if width.isFinite { size.width = min(size.width, width) }
            let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if needed > width, !current.indices.isEmpty {
                rows.append(current)
                current = Row()
            }
            current.width = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.indices.append(index)
            current.sizes.append(size)
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}

// MARK: - Плавающие панели

extension View {
    /// Панель над перепиской (закреплённое, ответ, запись голосового): на iOS 26 —
    /// стеклянная карточка с отступом от краёв, раньше — полоса системного материала.
    func chatPanelSurface() -> some View {
        modifier(ChatPanelSurface())
    }
}

private struct ChatPanelSurface: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content
                .glassSurface(
                    interactive: false,
                    in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous)
                )
                .padding(.horizontal, Spacing.md)
        } else {
            content.background(.bar)
        }
    }
}

// MARK: - Столбец пузыря

/// Признак «растягиваться на ширину пузыря»: цитата ответа, превью ссылки, карточка
/// поста. Такие элементы не раздувают пузырь сами, а тянутся до ширины остального.
struct ChatStretches: LayoutValueKey {
    static let defaultValue = false
}

/// Столбец содержимого пузыря.
///
/// Обычный `VStack` с растягивающимся элементом (цитата с `maxWidth: .infinity`)
/// раздувал бы короткое «ок» на всю ширину экрана. Здесь ширина столбца — по самому
/// широкому из обычных элементов и идеальной ширине растягивающихся, а уже потом все
/// элементы получают эту ширину, как в Telegram.
struct ChatBubbleStack: Layout {
    var spacing: CGFloat = Spacing.xs

    /// Замеры детей при последнем предложенном размере (шаг 2.6, флаг
    /// `chatBubbleLayoutCache`): `placeSubviews` берёт высоты отсюда, а не меряет заново.
    struct Cache {
        var limit: CGFloat?
        var width: CGFloat = 0
        var heights: [CGFloat] = []
    }

    func makeCache(subviews: Subviews) -> Cache {
        Cache()
    }

    func updateCache(_ cache: inout Cache, subviews: Subviews) {
        // Дети сменились — прежние замеры недействительны.
        cache = Cache()
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) -> CGSize {
        let limit = proposal.width ?? .infinity
        let gaps = spacing * CGFloat(max(subviews.count - 1, 0))
        if PerformanceFlags.chatBubbleLayoutCache, cache.limit == limit, cache.heights.count == subviews.count {
            return CGSize(width: cache.width, height: cache.heights.reduce(0, +) + gaps)
        }
        let width = contentWidth(limit: limit, subviews: subviews)
        let heights = subviews.map { $0.sizeThatFits(ProposedViewSize(width: width, height: nil)).height }
        if PerformanceFlags.chatBubbleLayoutCache {
            cache = Cache(limit: limit, width: width, heights: heights)
        }
        return CGSize(width: width, height: heights.reduce(0, +) + gaps)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) {
        let cached = PerformanceFlags.chatBubbleLayoutCache
            && abs(cache.width - bounds.width) < 0.5 && cache.heights.count == subviews.count
        var y = bounds.minY
        for (index, subview) in subviews.enumerated() {
            let size = cached
                ? CGSize(width: bounds.width, height: cache.heights[index])
                : subview.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            subview.place(
                at: CGPoint(x: bounds.minX, y: y),
                anchor: .topLeading,
                proposal: ProposedViewSize(width: bounds.width, height: size.height)
            )
            y += size.height + spacing
        }
    }

    private func contentWidth(limit: CGFloat, subviews: Subviews) -> CGFloat {
        var width: CGFloat = 0
        for subview in subviews {
            let natural = subview[ChatStretches.self]
                ? subview.sizeThatFits(.unspecified).width
                : subview.sizeThatFits(ProposedViewSize(width: limit, height: nil)).width
            width = max(width, min(natural, limit))
        }
        return width
    }
}

// MARK: - Капсулы над обоями

extension View {
    /// Капсула над обоями переписки — дата, системное событие: на iOS 26 — стекло,
    /// раньше — полупрозрачная карточка.
    func chatCapsuleSurface() -> some View {
        modifier(ChatCapsuleSurface())
    }
}

private struct ChatCapsuleSurface: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.glassSurface(interactive: false, in: Capsule())
        } else {
            content.background(Palette.card.opacity(0.85), in: Capsule())
        }
    }
}

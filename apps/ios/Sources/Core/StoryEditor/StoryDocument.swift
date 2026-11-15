import Foundation

/// Редактируемая история целиком: исходное медиа и всё, что на нём сделано.
///
/// Документ — значение: снимок до открытия инструмента и шаги отмены — это просто копии.
/// Черновик сохраняет именно его (плюс файлы, на которые он ссылается), поэтому после
/// повторного открытия всё снова редактируется, а не лежит запечённым в картинку.
struct StoryDocument: Codable, Equatable, Sendable {
    /// Версия формата черновика: новая версия приложения читает старые черновики.
    static let formatVersion = 1

    var formatVersion = StoryDocument.formatVersion
    var id = UUID()
    var background: StoryBackgroundMedia
    /// Сдвиг, масштаб и поворот фона (двумя пальцами по пустому месту).
    var mediaTransform = StoryTransform.identity
    /// Цвета заливки вокруг вписанного медиа (сверху и снизу) — из краёв снимка.
    var backdrop: [StoryColor] = [StoryColor(white: 0.12), StoryColor(white: 0.04)]
    var adjustments = StoryAdjustments.identity
    var blur = StoryBlur.off
    var curves = StoryToneCurves.identity
    /// Объекты над фото. Порядок наложения — `zIndex`, массив держится отсортированным.
    private(set) var entities: [StoryEntity] = []
    var drawing = StoryDrawing()
    var drawingTool = StoryDrawingTool()
    /// Последний цвет и шрифт текста — следующая надпись начинается с них.
    var textDefaults = StoryTextPayload(text: "")
    var caption = ""
    /// Обрезка видео-фона, секунды исходника.
    var videoTrim: StoryTimeRange?
    var createdAt = Date()
    var updatedAt = Date()

    init(background: StoryBackgroundMedia) {
        self.background = background
    }

    // MARK: Объекты

    func entity(_ id: UUID) -> StoryEntity? {
        entities.first { $0.id == id }
    }

    /// Новый объект встаёт поверх остальных.
    @discardableResult
    mutating func add(_ kind: StoryEntity.Kind, center: StoryPoint = .center, size: StorySize) -> UUID {
        let entity = StoryEntity(
            kind: kind,
            center: center,
            size: size,
            zIndex: (entities.map(\.zIndex).max() ?? 0) + 1
        )
        entities.append(entity)
        return entity.id
    }

    mutating func update(_ id: UUID, _ change: (inout StoryEntity) -> Void) {
        guard let index = entities.firstIndex(where: { $0.id == id }) else { return }
        change(&entities[index])
        entities.sort { $0.zIndex < $1.zIndex }
    }

    mutating func remove(_ id: UUID) {
        entities.removeAll { $0.id == id }
    }

    mutating func bringToFront(_ id: UUID) {
        let top = entities.map(\.zIndex).max() ?? 0
        // Уже единственный сверху — порядок не меняется, и документ не становится «изменённым».
        let sharesTop = entities.filter { $0.zIndex == top }.count > 1
        guard let current = entity(id), current.zIndex < top || sharesTop else { return }
        update(id) { $0.zIndex = top + 1 }
    }

    /// Копия объекта со сдвигом — «Дублировать» в меню долгого нажатия.
    @discardableResult
    mutating func duplicate(_ id: UUID) -> UUID? {
        guard var copy = entity(id) else { return nil }
        copy.id = UUID()
        copy.center = StoryPoint(x: min(copy.center.x + 0.05, 0.95), y: min(copy.center.y + 0.05, 0.95))
        copy.zIndex = (entities.map(\.zIndex).max() ?? 0) + 1
        entities.append(copy)
        return copy.id
    }

    var textEntities: [StoryEntity] {
        entities.filter { if case .text = $0.kind { return true } else { return false } }
    }

    var roundVideos: [StoryEntity] {
        entities.filter { if case .roundVideo = $0.kind { return true } else { return false } }
    }

    // MARK: Медиа

    /// Итог — видео: видео-фон или круглое видео поверх фото.
    var producesVideo: Bool {
        if case .video = background { return true }
        return !roundVideos.isEmpty
    }

    /// Длина истории в секундах: обрезанный видео-фон или самое длинное круглое видео.
    var duration: Double? {
        if case let .video(_, _, duration) = background {
            return (videoTrim ?? StoryTimeRange(start: 0, end: duration)).length
        }
        let ends = roundVideos.compactMap { entity -> Double? in
            guard case let .roundVideo(video) = entity.kind else { return nil }
            return video.startTime + video.trimmedDuration
        }
        return ends.max()
    }

    /// Файлы рабочей папки, на которые ссылается документ: их переносит черновик.
    var referencedFiles: [String] {
        var files: [String] = []
        switch background {
        case let .photo(file, _), let .video(file, _, _): files.append(file)
        case .gradient: break
        }
        for entity in entities {
            switch entity.kind {
            case let .image(image): files.append(image.file)
            case let .roundVideo(video): files.append(video.file)
            default: break
            }
        }
        return files
    }

    /// Обработка изменяет снимок (для кнопки «Обработка» — подсветка, что правки есть).
    var hasImageProcessing: Bool {
        !adjustments.isIdentity || blur.isActive || !curves.isIdentity
    }
}

/// Фон истории.
enum StoryBackgroundMedia: Codable, Equatable, Sendable {
    /// Фото (в том числе собранный коллаж) — файл в рабочей папке и размер в пикселях.
    case photo(file: String, size: StorySize)
    /// Видео — файл, размер кадра и длительность в секундах.
    case video(file: String, size: StorySize, duration: Double)
    /// Градиент текстовой истории: ключ из `STORY_BACKGROUNDS`.
    case gradient(String)

    var pixelSize: StorySize {
        switch self {
        case let .photo(_, size), let .video(_, size, _): return size
        case .gradient: return StoryCanvasGeometry.exportSize
        }
    }

    var isVideo: Bool {
        if case .video = self { return true }
        return false
    }
}

struct StoryTimeRange: Codable, Equatable, Sendable {
    var start: Double
    var end: Double

    var length: Double { max(0, end - start) }
}

/// Объект на холсте. Позиция — центр в долях холста; размер — в долях **ширины**
/// холста по обеим осям (квадратные единицы: круг остаётся кругом на любом экране).
struct StoryEntity: Codable, Equatable, Identifiable, Sendable {
    enum Kind: Codable, Equatable, Sendable {
        case text(StoryTextPayload)
        case emoji(String)
        case shape(StoryShapePayload)
        case image(StoryImagePayload)
        case roundVideo(StoryRoundVideoPayload)
    }

    var id = UUID()
    var kind: Kind
    var center: StoryPoint
    /// Размер до масштаба. Текст пересчитывает его по раскладке при каждой правке.
    var size: StorySize
    var scale: Double = 1
    var rotation: Double = 0
    var opacity: Double = 1
    var zIndex: Int = 0

    /// Вращают все, кроме круглого видео: у Telegram кружок не поворачивается — внутри
    /// живое лицо, и наклонённое видео выглядит ошибкой.
    var supportsRotation: Bool {
        if case .roundVideo = kind { return false }
        return true
    }

    /// Допустимый масштаб. Кружок — от 0,2 до 0,9 ширины холста по диаметру.
    var scaleRange: ClosedRange<Double> {
        if case .roundVideo = kind {
            let base = max(size.width, 0.01)
            return (0.2 / base)...(0.9 / base)
        }
        return 0.2...8
    }

    var isText: Bool {
        if case .text = kind { return true }
        return false
    }
}

enum StoryFont: String, Codable, CaseIterable, Identifiable, Sendable {
    /// San Francisco — системный.
    case system
    case rounded
    /// New York.
    case serif
    case mono
    case typewriter
    case handwriting

    var id: String { rawValue }
}

/// Оформление надписи.
enum StoryTextStyle: String, Codable, CaseIterable, Sendable {
    /// Цветной текст без подложки.
    case plain
    /// Сплошная подложка цвета текста, текст — контрастный.
    case filled
    /// Полупрозрачная тёмная подложка.
    case translucent
    /// Обводка букв.
    case outline
    /// Мягкая тень под буквами.
    case shadow

    /// Порядок переключения по кнопке «А» панели форматирования.
    var next: StoryTextStyle {
        let all = Self.allCases
        return all[(all.firstIndex(of: self)! + 1) % all.count]
    }
}

enum StoryTextAlignment: String, Codable, CaseIterable, Sendable {
    case left
    case center
    case right

    var next: StoryTextAlignment {
        let all = Self.allCases
        return all[(all.firstIndex(of: self)! + 1) % all.count]
    }
}

struct StoryTextPayload: Codable, Equatable, Sendable {
    var text: String
    var font: StoryFont = .system
    var style: StoryTextStyle = .plain
    var alignment: StoryTextAlignment = .center
    var color: StoryColor = .white
    /// Кегль — доля ширины холста (на 1080 px: 0,075 ≈ 81 px).
    var fontSize: Double = 0.075

    static let maxLength = 600

    /// Цвет букв с учётом подложки: на сплошной подложке цвета текста буквы контрастные.
    var glyphColor: StoryColor {
        guard style == .filled else { return color }
        return color.isLight ? .black : .white
    }

    /// Цвет подложки, если она есть.
    var plateColor: StoryColor? {
        switch style {
        case .filled: return color
        case .translucent: return StoryColor(white: 0, alpha: 0.45)
        default: return nil
        }
    }

    var isBlank: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

/// Накладная фигура (раздел «Стикеры» → «Фигуры»): собственный цвет и прозрачность.
struct StoryShapePayload: Codable, Equatable, Sendable {
    enum Shape: String, Codable, CaseIterable, Sendable {
        case rectangle
        case ellipse
        case bubble
        case star
        case arrow
        case heart
    }

    var shape: Shape
    var color: StoryColor
    var filled: Bool = false

    /// Стороны по умолчанию в долях ширины холста.
    var defaultSize: StorySize {
        switch shape {
        case .arrow: return StorySize(width: 0.5, height: 0.2)
        case .rectangle: return StorySize(width: 0.45, height: 0.32)
        default: return StorySize(width: 0.4, height: 0.4)
        }
    }
}

/// Картинка поверх фона — второе фото из галереи.
struct StoryImagePayload: Codable, Equatable, Sendable {
    var file: String
    var pixelSize: StorySize
}

/// Круглое видео поверх истории.
struct StoryRoundVideoPayload: Codable, Equatable, Sendable {
    var file: String
    /// Длительность исходной записи, секунды.
    var duration: Double
    /// С какой секунды истории кружок начинает играть.
    var startTime: Double = 0
    var trim: StoryTimeRange?
    /// Дополнительное отражение. Фронтальная камера уже пишет кадр зеркально
    /// (`isVideoMirrored` у записи) — человек получает то, что видел в кружке.
    var mirrored = false

    var trimmedDuration: Double { trim?.length ?? duration }

    /// Самый длинный кружок — минута, как у Telegram.
    static let maxDuration: Double = 60
}

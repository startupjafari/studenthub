import AVFoundation
import SwiftUI
import UIKit

/// Вид вложения в пузыре. Выводится из mime, имени и флага «как файл», как в вебе
/// (`attachment-kind.ts`): отдельного типа сообщения в модели нет.
enum ChatAttachmentKind {
    case voice, photo, video, audio, file
}

extension AttachmentRecord {
    /// Голосовое узнаётся по имени из рекордера (`voice-…`): mime у записи
    /// непредсказуем — запись из Safari приходит `video/mp4`. Дальше «как файл»
    /// перевешивает mime: снимок или ролик, отправленный без сжатия, — строка файла.
    var chatKind: ChatAttachmentKind {
        let voiceName = name?.lowercased().hasPrefix("voice-") ?? false
        if voiceName, mime.hasPrefix("audio/") || mime.hasPrefix("video/") { return .voice }
        if asDocument { return .file }
        if mime.hasPrefix("image/") { return .photo }
        if mime.hasPrefix("video/") { return .video }
        if mime.hasPrefix("audio/") { return .audio }
        return .file
    }

    /// Снимок или ролик — плиткой (одиночной или в альбоме), а не строкой файла.
    var showsAsMedia: Bool {
        let kind = chatKind
        return kind == .photo || kind == .video
    }
}

/// Вложения в пузыре.
///
/// Фото и видео — плиткой, голосовое — волной, аудиофайл — проигрывателем с названием,
/// остальное — строкой файла. Альбом из нескольких снимков пузырь собирает сам
/// (`ChatMediaMosaic`), сюда приходит одиночное вложение.
struct AttachmentView: View {
    let attachment: AttachmentRecord
    let isOwn: Bool
    /// Своё вложение ещё грузится: кольцо прогресса с крестиком отмены.
    var upload: AttachmentUploadState?
    /// Открыть во весь экран: фото, документ, видео — системным просмотром.
    var open: () -> Void = {}

    var body: some View {
        switch attachment.chatKind {
        case .voice:
            VoiceAttachmentView(attachment: attachment, isOwn: isOwn)
        case .photo, .video:
            // Ширина — до 240 pt, но не шире пузыря: в группе на узком экране с крупным
            // шрифтом места меньше, и жёсткая рамка вылезла бы за пузырь.
            ChatMosaicLayout(
                rows: [1],
                maxWidth: ChatMediaTile.singleWidth,
                singleAspect: ChatMediaTile.singleAspect(for: attachment)
            ) {
                ChatMediaTile(
                    attachment: attachment,
                    nominal: ChatMediaTile.singleSize(for: attachment),
                    cornerRadius: Radius.lg,
                    upload: upload,
                    open: open
                )
                // Своя личность на каждый файл: ячейка ленты переиспользуется, и без этого
                // плитка чужого сообщения унаследовала бы прежний снимок и «открытый» спойлер.
                .id(attachment.id)
            }
        case .audio:
            AudioFileAttachmentView(attachment: attachment, isOwn: isOwn, upload: upload)
        case .file:
            FileAttachmentView(attachment: attachment, isOwn: isOwn, upload: upload, open: open)
        }
    }
}

/// Загрузка своего вложения: доля отправленного по всему сообщению и отмена.
struct AttachmentUploadState {
    let fraction: Double
    let cancel: () -> Void
}

/// Кольцо загрузки с крестиком, как в Telegram: касание отменяет отправку.
struct UploadRing: View {
    let fraction: Double
    var tint: Color = .white
    /// Тёмная подложка — поверх снимка; на строке файла её нет.
    var backdrop: Color? = Palette.overlay.opacity(0.45)
    var diameter: CGFloat = ControlHeight.xl
    let cancel: () -> Void

    var body: some View {
        Button(action: cancel) {
            ZStack {
                if let backdrop {
                    Circle().fill(backdrop)
                }
                Circle()
                    .stroke(tint.opacity(0.3), lineWidth: 2.5)
                    .padding(Spacing.xs)
                // Совсем пустое кольцо читается как «ничего не происходит» — хвостик видно
                // с первой секунды.
                Circle()
                    .trim(from: 0, to: max(0.03, fraction))
                    .stroke(tint, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .padding(Spacing.xs)
                    .animation(.linear(duration: 0.2), value: fraction)
                Image(systemName: "xmark")
                    .font(.system(size: diameter * 0.3, weight: .bold))
                    .foregroundStyle(tint)
            }
            .frame(width: diameter, height: diameter)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(String(localized: "chats.upload.cancel", defaultValue: "Отменить загрузку")))
        .accessibilityValue(Text(fraction.formatted(.percent.precision(.fractionLength(0)))))
    }
}

// MARK: - Плитка фото и видео

/// Плитка снимка или ролика: одиночная в пузыре и ячейка альбома.
///
/// Картинка грузится копией под размер плитки: у снимка — уменьшенный WebP медиа-системы,
/// у ролика — постер, а без постера (ролик ещё не обработан) — первый кадр самого файла.
/// Пока картинки нет — размытое превью (LQIP) из сообщения, без него — ровная подложка;
/// значок «нет фото» — только когда загрузка правда не удалась. Готовая картинка
/// проявляется за 0,2 с.
///
/// Готовую картинку плитка берёт из кэша ещё при создании: лента переиспользует ячейки,
/// и без этого каждый возврат к снимку мигал бы подложкой.
///
/// Плитка заполняет предложенную ей рамку (её задаёт `ChatMosaicLayout`), а
/// `nominal` — наибольший её размер: по нему выбирается копия картинки и ключ кэша.
struct ChatMediaTile: View {
    let attachment: AttachmentRecord
    let nominal: CGSize
    /// Скругление своей плитки. В альбоме — 0: скругляется вся мозаика снаружи.
    var cornerRadius: CGFloat = 0
    var upload: AttachmentUploadState?
    let open: () -> Void

    @State private var image: UIImage?
    @State private var failed = false
    /// Спойлер открыт касанием — дальше плитка открывается как обычно.
    @State private var revealed = false
    /// Размытое превью разбирается один раз на плитку, а не на каждый кадр.
    @State private var preview: UIImage?
    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Одиночная плитка — ширина как у прежнего снимка, высота по пропорциям кадра в
    /// разумных пределах: панорама не превращается в нитку, портрет — в столб.
    static let singleWidth: CGFloat = 240
    static let singleHeights: ClosedRange<CGFloat> = 140...320

    /// Высота к ширине одиночной плитки; без размеров — прежние 240 × 180.
    static func singleAspect(for attachment: AttachmentRecord) -> CGFloat {
        guard let width = attachment.width, let height = attachment.height, width > 0, height > 0 else {
            return 0.75
        }
        return CGFloat(height) / CGFloat(width)
    }

    static func singleSize(for attachment: AttachmentRecord) -> CGSize {
        let height = singleWidth * singleAspect(for: attachment)
        return CGSize(
            width: singleWidth,
            height: min(max(height, singleHeights.lowerBound), singleHeights.upperBound)
        )
    }

    init(
        attachment: AttachmentRecord,
        nominal: CGSize,
        cornerRadius: CGFloat = 0,
        upload: AttachmentUploadState? = nil,
        open: @escaping () -> Void
    ) {
        self.attachment = attachment
        self.nominal = nominal
        self.cornerRadius = cornerRadius
        self.upload = upload
        self.open = open
        let key = Self.cacheKey(attachment, points: Self.pixelPoints(attachment, size: nominal))
        _image = State(initialValue: ImageMemoryCache.shared.image(for: key))
        _preview = State(initialValue: ChatMediaImages.preview(for: attachment))
    }

    private var isVideo: Bool { attachment.chatKind == .video }
    private var isHidden: Bool { attachment.spoiler && !revealed }
    private var points: CGFloat { Self.pixelPoints(attachment, size: nominal) }
    private var cacheKey: String { Self.cacheKey(attachment, points: points) }

    /// Длинная сторона копии в точках, чтобы кадр закрыл плитку целиком (`fill`):
    /// квадратная ячейка альбома под широкий кадр требует копию шире самой ячейки.
    /// Округляем вверх до 40 pt — ключ кэша не дробится на соседние размеры.
    static func pixelPoints(_ attachment: AttachmentRecord, size: CGSize) -> CGFloat {
        let side = max(size.width, size.height)
        let exact: CGFloat
        if let width = attachment.width, let height = attachment.height, width > 0, height > 0 {
            let scale = max(size.width / CGFloat(width), size.height / CGFloat(height))
            exact = min(CGFloat(max(width, height)) * scale, side * 3)
        } else {
            exact = side * 1.5
        }
        return (max(exact, side) / 40).rounded(.up) * 40
    }

    private static func cacheKey(_ attachment: AttachmentRecord, points: CGFloat) -> String {
        "att:\(attachment.id):\(Int(points))"
    }

    var body: some View {
        // `Color.clear` берёт рамку от раскладки, картинка заполняет её с обрезкой.
        Color.clear.overlay {
            ZStack {
                placeholder
                if let image {
                    if image.images != nil {
                        AnimatedImageView(image: image)
                            .transition(.opacity)
                    } else {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .transition(.opacity)
                    }
                }
            }
        }
        .clipped()
        // Спойлер — размыт до первого касания, как в вебе и Telegram; `opaque` держит
        // края плитки чёткими.
        .blur(radius: isHidden ? 24 : 0, opaque: true)
        .overlay {
            if isHidden {
                Label(String(localized: "chats.spoiler", defaultValue: "Спойлер"), systemImage: "eye.slash")
                    .font(Typography.meta.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
                    .background(.black.opacity(0.4), in: Capsule())
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(Spacing.xs)
                    .transition(
                        reduceMotion ? AnyTransition.opacity : AnyTransition.opacity.combined(with: .scale(scale: 1.15))
                    )
            } else if isVideo, upload == nil {
                playGlyph
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .topLeading) {
            if isVideo, !isHidden, let duration = attachment.durationMs, duration > 0 {
                Text(verbatim: VoiceWave.time(Double(duration) / 1000))
                    .font(Typography.tabular(.caption2.weight(.semibold)))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Spacing.sm)
                    .padding(.vertical, 2)
                    .background(.black.opacity(0.45), in: Capsule())
                    .padding(Spacing.sm)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .contentShape(Rectangle())
        .overlay {
            if let upload {
                UploadRing(fraction: upload.fraction, cancel: upload.cancel)
            }
        }
        .onTapGesture {
            if isHidden {
                withAnimation(Motion.respecting(.easeOut(duration: Motion.Duration.surface), reduceMotion: reduceMotion)) {
                    revealed = true
                }
            } else {
                open()
            }
        }
        .task(id: cacheKey) { await load() }
        .accessibilityElement()
        .accessibilityLabel(Text(accessibilityLabel))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(.default) {
            if isHidden { revealed = true } else { open() }
        }
    }

    /// Пока картинки нет: размытое превью, у ролика без превью — тёмная плитка, у снимка —
    /// ровная нейтральная подложка. Значок — только если загрузка не удалась.
    @ViewBuilder
    private var placeholder: some View {
        if let preview {
            Image(uiImage: preview)
                .resizable()
                .scaledToFill()
                .blur(radius: 12, opaque: true)
        } else if isVideo {
            Color(white: 0.14)
        } else {
            // Полупрозрачный тон, а не `muted`: на синем своём пузыре светлая подложка
            // читалась как белая дыра на месте снимка.
            Palette.foreground.opacity(0.08)
                .overlay {
                    if failed {
                        Image(systemName: "photo")
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
        }
    }

    /// Кнопка «играть» по центру ролика. В мелкой ячейке альбома — поменьше.
    private var playGlyph: some View {
        let diameter = min(ControlHeight.xl, min(nominal.width, nominal.height) * 0.36)
        return Image(systemName: "play.fill")
            .font(.system(size: diameter * 0.42, weight: .bold))
            .foregroundStyle(.white)
            .offset(x: diameter * 0.04)
            .frame(width: diameter, height: diameter)
            .background(.black.opacity(0.45), in: Circle())
            .accessibilityHidden(true)
    }

    private var accessibilityLabel: String {
        if isHidden { return String(localized: "chats.spoiler", defaultValue: "Спойлер") }
        guard isVideo else { return String(localized: "chats.photo", defaultValue: "Фотография") }
        let title = String(localized: "chats.preview.video", defaultValue: "Видео")
        guard let duration = attachment.durationMs, duration > 0 else { return title }
        return "\(title), \(VoiceWave.time(Double(duration) / 1000))"
    }

    private func load() async {
        let key = cacheKey
        if let cached = ImageMemoryCache.shared.image(for: key) {
            image = cached
            return
        }
        let loaded = await ChatMediaImages.load(attachment, points: points, scale: displayScale, key: key)
        guard !Task.isCancelled else { return }
        if let loaded {
            withAnimation(Motion.respecting(.easeOut(duration: Motion.Duration.layer), reduceMotion: reduceMotion)) {
                image = loaded
            }
        } else {
            failed = true
        }
    }
}

// MARK: - Альбом

/// Альбом из нескольких снимков и роликов мозаикой, как в Telegram: два — рядом, три —
/// один широкий сверху и два под ним, четыре — два на два, дальше — ряды по два и три.
/// Зазор 2 pt, скруглены только внешние углы всей мозаики. Загрузка своего альбома —
/// одно кольцо поверх всей мозаики: отправка у сообщения одна.
struct ChatMediaMosaic: View {
    let items: [AttachmentRecord]
    var upload: AttachmentUploadState?
    let open: (AttachmentRecord) -> Void

    static let width: CGFloat = 264
    static let gap: CGFloat = 2

    /// Сколько плиток в каждом ряду. 7+ — по три, остаток — двойками сверху.
    static func rows(count: Int) -> [Int] {
        switch count {
        case ..<1: return []
        case 1: return [1]
        case 2: return [2]
        case 3: return [1, 2]
        default:
            switch count % 3 {
            case 0: return Array(repeating: 3, count: count / 3)
            case 2: return [2] + Array(repeating: 3, count: count / 3)
            default: return [2, 2] + Array(repeating: 3, count: (count - 4) / 3)
            }
        }
    }

    var body: some View {
        let rows = Self.rows(count: items.count)
        let columns = rows.flatMap { count in Array(repeating: count, count: count) }
        ChatMosaicLayout(rows: rows, maxWidth: Self.width, gap: Self.gap) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, attachment in
                ChatMediaTile(
                    attachment: attachment,
                    nominal: Self.tileSize(columns: index < columns.count ? columns[index] : 3)
                ) {
                    open(attachment)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay {
            if let upload {
                UploadRing(fraction: upload.fraction, cancel: upload.cancel)
            }
        }
    }

    /// Наибольший размер плитки ряда — по нему выбирается копия картинки.
    static func tileSize(columns: Int) -> CGSize {
        let count = CGFloat(max(columns, 1))
        let tile = ((width - gap * (count - 1)) / count).rounded(.down)
        return columns == 1
            ? CGSize(width: width, height: (width * ChatMosaicLayout.wideRowAspect).rounded())
            : CGSize(width: tile, height: tile)
    }
}

/// Раскладка плиток медиа рядами. Ширина — сколько предложит пузырь, но не больше
/// `maxWidth`: на узком экране мозаика сжимается целиком, а не вылезает за пузырь.
/// В ряду из нескольких плиток они квадратные; одиночный ряд — широкий (верх альбома
/// из трёх) или по пропорциям кадра, если это единственная плитка (`singleAspect`).
struct ChatMosaicLayout: Layout {
    /// Сколько плиток в каждом ряду, сверху вниз.
    let rows: [Int]
    var maxWidth: CGFloat
    var gap: CGFloat = 2
    /// Высота к ширине одиночной плитки; `nil` — широкий ряд альбома.
    var singleAspect: CGFloat?

    static let wideRowAspect: CGFloat = 0.6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = Self.clampedWidth(proposal.width, maxWidth: maxWidth)
        let placed = tileFrames(width: width)
        return CGSize(width: width, height: placed.map(\.maxY).max() ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let placed = tileFrames(width: bounds.width)
        for index in subviews.indices {
            guard index < placed.count else {
                // Лишняя плитка (рядов меньше, чем вложений) — не показываем.
                subviews[index].place(at: bounds.origin, proposal: .zero)
                continue
            }
            let frame = placed[index]
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private static func clampedWidth(_ proposed: CGFloat?, maxWidth: CGFloat) -> CGFloat {
        guard let proposed, proposed.isFinite else { return maxWidth }
        return max(0, min(proposed, maxWidth))
    }

    private func tileFrames(width: CGFloat) -> [CGRect] {
        var result: [CGRect] = []
        var y: CGFloat = 0
        for (index, count) in rows.enumerated() where count > 0 {
            let columns = CGFloat(count)
            let tile = ((width - gap * (columns - 1)) / columns).rounded(.down)
            let height: CGFloat
            if count == 1 {
                if let singleAspect {
                    height = min(
                        max(width * singleAspect, ChatMediaTile.singleHeights.lowerBound),
                        ChatMediaTile.singleHeights.upperBound
                    ).rounded()
                } else {
                    height = (width * Self.wideRowAspect).rounded()
                }
            } else {
                height = tile
            }
            for column in 0..<count {
                // Последняя плитка ряда добирает остаток от округления — правый край ровный.
                let x = CGFloat(column) * (tile + gap)
                let w = column == count - 1 ? width - x : tile
                result.append(CGRect(x: x, y: y, width: w, height: height))
            }
            y += height
            if index < rows.count - 1 { y += gap }
        }
        return result
    }
}

// MARK: - Загрузка картинок плиток

/// Откуда плитка берёт картинку. Свой файл на диске — с диска, чужой — по подписанной
/// ссылке (она кэшируется по id файла в `AttachmentURLProvider`). Берётся наименьшая
/// копия, которая не мельче плитки: оригинал камеры ради ячейки в 130 pt — это
/// мегабайты по сети и долгий серый квадрат.
enum ChatMediaImages {
    /// Размытое превью из сообщения, разобранное один раз: плитка создаётся заново на
    /// каждую перерисовку пузыря, и base64 с WebP разбирался бы каждый раз.
    static func preview(for attachment: AttachmentRecord) -> UIImage? {
        guard let placeholder = attachment.placeholder, !placeholder.isEmpty else { return nil }
        let key = "lqip:\(attachment.id)"
        if let known = ImageMemoryCache.shared.image(for: key) { return known }
        guard let image = LQIP.image(from: placeholder) else { return nil }
        ImageMemoryCache.shared.store(image, for: key)
        return image
    }

    static func load(_ attachment: AttachmentRecord, points: CGFloat, scale: CGFloat, key: String) async -> UIImage? {
        let pixels = points * scale
        if attachment.mime == "image/gif" {
            return await gif(attachment, maxPixelSize: pixels, key: key)
        }
        let isVideo = attachment.mime.hasPrefix("video/")
        if let path = attachment.localPath, FileManager.default.fileExists(atPath: path) {
            let file = URL(filePath: path)
            if isVideo {
                return await ChatVideoFrames.shared.frame(of: file, key: key, maxPixelSize: pixels)
            }
            return await ImageMemoryCache.shared.load(file, key: key, maxPixelSize: pixels)
        }
        guard let media = try? await AppServices.attachmentURLs.media(for: attachment.id) else { return nil }
        if isVideo {
            if let poster = media.poster.best(forPoints: points, scale: scale), let url = URL.apiRooted(poster.url) {
                return await ImageMemoryCache.shared.load(url, key: key, maxPixelSize: pixels)
            }
            // Постера нет — ролик ещё не обработан медиа-системой: первый кадр самого
            // файла, а не строка файла вместо видео.
            return await ChatVideoFrames.shared.frame(of: media.url, key: key, maxPixelSize: pixels)
        }
        let variant = media.sources.best(forPoints: points, scale: scale).flatMap { URL.apiRooted($0.url) }
        return await ImageMemoryCache.shared.load(variant ?? media.url, key: key, maxPixelSize: pixels)
    }
}

extension ChatMediaImages {
    /// GIF — оригинал целиком (уменьшенные копии медиа-системы анимацию теряют).
    static func gif(_ attachment: AttachmentRecord, maxPixelSize: CGFloat, key: String) async -> UIImage? {
        if let cached = AnimatedGIF.cached(key) { return cached }
        let data: Data?
        if let path = attachment.localPath, FileManager.default.fileExists(atPath: path) {
            data = try? Data(contentsOf: URL(filePath: path))
        } else if let media = try? await AppServices.attachmentURLs.media(for: attachment.id) {
            data = try? await URLSession.shared.data(from: media.url).0
        } else {
            data = nil
        }
        guard let data else { return nil }
        return await Task.detached(priority: .utility) {
            AnimatedGIF.decode(data, maxPixelSize: maxPixelSize, key: key)
        }.value
    }
}

/// Первые кадры роликов без постера. Готовый кадр ложится в общий кэш картинок по ключу
/// плитки; неудача запоминается до выхода из приложения, чтобы прокрутка туда-обратно
/// не дёргала файл снова. Одновременные запросы одного кадра сводятся в один.
actor ChatVideoFrames {
    static let shared = ChatVideoFrames()

    private var failed: Set<String> = []
    private var inFlight: [String: Task<UIImage?, Never>] = [:]

    func frame(of url: URL, key: String, maxPixelSize: CGFloat) async -> UIImage? {
        if let cached = ImageMemoryCache.shared.image(for: key) { return cached }
        if failed.contains(key) { return nil }
        if let running = inFlight[key] { return await running.value }
        let task = Task.detached(priority: .utility) { () -> UIImage? in
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: maxPixelSize, height: maxPixelSize)
            guard let frame = try? await generator.image(at: .zero) else { return nil }
            return UIImage(cgImage: frame.image)
        }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        if let image {
            ImageMemoryCache.shared.store(image, for: key)
        } else {
            failed.insert(key)
        }
        return image
    }
}

// MARK: - Строка файла

/// Строка файла как в Telegram: слева круг со значком — стрелка «скачать», пока файла
/// нет на устройстве, кольцо прогресса во время скачивания (касание отменяет), значок
/// типа — когда файл скачан и открывается сразу. Под именем — размер и тип, во время
/// скачивания — «1,2 / 3,4 МБ».
private struct FileAttachmentView: View {
    let attachment: AttachmentRecord
    let isOwn: Bool
    let upload: AttachmentUploadState?
    let open: () -> Void

    private var downloads: ChatFileDownloads { ChatFileDownloads.shared }
    private static let circle: CGFloat = 44

    var body: some View {
        // Пока свой файл отправляется, вместо значка — кольцо с крестиком (как в
        // Telegram), а строка не открывается: отдельной кнопкой внутри кнопки касания
        // путались бы.
        if let upload {
            HStack(spacing: Spacing.md) {
                UploadRing(
                    fraction: upload.fraction,
                    tint: circleGlyph,
                    backdrop: circleFill,
                    diameter: Self.circle,
                    cancel: upload.cancel
                )
                caption(state: nil)
            }
            .padding(.vertical, Spacing.xs)
        } else {
            let state = downloads.state(for: attachment)
            Button(action: open) {
                HStack(spacing: Spacing.md) {
                    badge(state)
                    caption(state: state)
                }
                .padding(.vertical, Spacing.xs)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text(hint(state)))
        }
    }

    private var circleFill: Color { isOwn ? Palette.primaryForeground : Palette.primary }
    private var circleGlyph: Color { isOwn ? Palette.primary : Palette.primaryForeground }

    @ViewBuilder
    private func badge(_ state: ChatFileDownloads.State?) -> some View {
        ZStack {
            Circle().fill(circleFill)
            switch state {
            case .downloading(let fraction):
                Circle()
                    .stroke(circleGlyph.opacity(0.3), lineWidth: 2.5)
                    .padding(Spacing.xs)
                Circle()
                    .trim(from: 0, to: max(0.03, fraction))
                    .stroke(circleGlyph, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .padding(Spacing.xs)
                    .animation(.linear(duration: 0.2), value: fraction)
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(circleGlyph)
            case .done:
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(circleGlyph)
            case nil:
                Image(systemName: "arrow.down")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(circleGlyph)
            }
        }
        .frame(width: Self.circle, height: Self.circle)
        .contentTransition(.symbolEffect(.replace))
        .animation(.easeOut(duration: 0.2), value: state)
        .accessibilityHidden(true)
    }

    private func caption(state: ChatFileDownloads.State?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(attachment.name ?? String(localized: "chats.file", defaultValue: "Файл"))
                .font(Typography.body.weight(.medium))
                .lineLimit(1)
                .truncationMode(.middle)
                .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
            Text(verbatim: details(state))
                .font(Typography.tabular(Typography.meta))
                .foregroundStyle(isOwn ? Palette.primaryForeground.opacity(0.8) : Palette.mutedForeground)
                .contentTransition(.numericText())
        }
    }

    /// «3,4 МБ · PDF»; во время скачивания — «1,2 МБ / 3,4 МБ».
    private func details(_ state: ChatFileDownloads.State?) -> String {
        let total = attachment.size.map { Int64($0) }
        if case .downloading(let fraction) = state, let total {
            let done = Int64(Double(total) * fraction)
            return "\(Self.bytes(done)) / \(Self.bytes(total))"
        }
        let ext = ((attachment.name ?? "") as NSString).pathExtension.uppercased()
        return [total.map(Self.bytes), ext.isEmpty ? nil : ext].compactMap { $0 }.joined(separator: " · ")
    }

    private static func bytes(_ count: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: count, countStyle: .file)
    }

    private func hint(_ state: ChatFileDownloads.State?) -> String {
        switch state {
        case .downloading: String(localized: "chats.file.cancelDownload", defaultValue: "Отменить скачивание")
        case .done: String(localized: "chats.file.open", defaultValue: "Открыть")
        case nil: String(localized: "chats.file.download", defaultValue: "Скачать и открыть")
        }
    }

    private var symbol: String {
        if attachment.mime.hasPrefix("video/") { return "play.fill" }
        if attachment.mime.hasPrefix("audio/") { return "music.note" }
        if attachment.isImage { return "photo.fill" }
        return "doc.fill"
    }
}

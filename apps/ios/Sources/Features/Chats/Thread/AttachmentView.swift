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
///
/// `retry` задан — отправка не удалась: на снимке вместо кольца круг «повторить»
/// (строки файлов и аудио такое состояние не получают — у них своя кнопка у пузыря).
struct AttachmentUploadState {
    let fraction: Double
    let cancel: () -> Void
    var retry: (() -> Void)? = nil
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

/// Где загрузка картинки плитки. Сама картинка — отдельно: готовая показывается при
/// любом состоянии.
private enum TileLoadPhase: Equatable {
    /// Ещё не начинали или ячейка уехала с экрана (вернётся — загрузка начнётся заново).
    case idle
    /// Качается.
    case loading
    /// Не скачалось. `retryable == false` — сервер ответил, что файла нет или он не наш:
    /// сами не повторяем, только по касанию.
    case failed(retryable: Bool)
    /// Остановлено касанием по кольцу — ждёт следующего касания.
    case paused
}

/// Плитка снимка или ролика: одиночная в пузыре и ячейка альбома.
///
/// Как в Telegram:
/// - место под снимок занято сразу, по пропорциям из сообщения (`ChatMosaicLayout`), и
///   при загрузке не меняется — лента не прыгает;
/// - пока картинки нет — размытое превью (LQIP) из сообщения, без него — ровная
///   подложка; загрузка начинается сама, когда плитка на экране;
/// - дольше мгновения — по центру тёмный круг с кольцом прогресса (настоящая доля, если
///   сеть её сообщает, иначе крутится) и крестиком: касание останавливает загрузку;
/// - не скачалось — круг со стрелкой «скачать»: касание повторяет загрузку по новой
///   подписанной ссылке; сами повторяем ещё трижды с паузами, пока плитка на экране;
/// - готовая картинка проявляется за 0,2 с (без анимации при «уменьшении движения»).
///
/// Картинка грузится копией под размер плитки: у снимка — уменьшенный WebP медиа-системы
/// (не скачался — оригинал), у ролика — постер, а без постера — первый кадр самого файла.
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
    @State private var phase: TileLoadPhase = .idle
    /// Кольцо на экране: загрузка идёт дольше мгновения. С диска картинка приходит
    /// быстрее — кольцо только мелькнуло бы.
    @State private var showsRing = false
    /// Доля скачанного; `nil` — сеть её пока не сообщила, кольцо крутится.
    @State private var progress: Double?
    /// Новый номер — новая загрузка: повтор, остановка, автоповтор.
    @State private var attempt = 0
    /// Сколько раз уже повторили сами после сбоя.
    @State private var autoRetries = 0
    /// Спойлер открыт касанием — дальше плитка открывается как обычно.
    @State private var revealed = false
    /// Откуда и насколько раскрылся спойлер: круг растёт от точки касания.
    @State private var revealOrigin: CGPoint?
    @State private var revealRadius: CGFloat = 0
    /// Размытое превью разбирается один раз на плитку, а не на каждый кадр.
    @State private var preview: UIImage?
    @Environment(\.displayScale) private var displayScale
    @Environment(\.motionReduced) private var reduceMotion
    /// Углы снимка без подписи — по форме пузыря (`MessageBubbleView`).
    @Environment(\.chatMediaCorners) private var bubbleCorners

    /// Одиночная плитка — ширина как у прежнего снимка, высота по пропорциям кадра в
    /// разумных пределах: панорама не превращается в нитку, портрет — в столб.
    static let singleWidth: CGFloat = 240
    static let singleHeights: ClosedRange<CGFloat> = 140...320

    /// Паузы перед автоповтором: сеть мигнула — вторая попытка через пару секунд, дальше
    /// реже. Плитка ушла с экрана — ожидание снимается вместе с задачей.
    private static let retryDelays: [Duration] = [.seconds(2), .seconds(6), .seconds(15)]
    /// С какого размера под кольцом подписан вес файла.
    private static let sizeLabelThreshold = 512 * 1024

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

    /// Ключ кэша. Свой снимок — по пути файла на устройстве: после отправки запись
    /// получает серверный id, картинка же та же, и плитка не должна мигнуть подложкой.
    /// Ключ кеша плитки. Открыт для предзагрузки (`ChatMediaPrefetcher`): она греет тот же
    /// ключ, и плитка при появлении берёт снимок из памяти сразу.
    static func cacheKey(_ attachment: AttachmentRecord, points: CGFloat) -> String {
        if let path = attachment.localPath { return "att-file:\(path):\(Int(points))" }
        return "att:\(attachment.id):\(Int(points))"
    }

    /// Форма плитки: одиночный снимок без подписи — углы пузыря, с подписью — `cornerRadius`,
    /// ячейка альбома — без скругления.
    private var tileShape: UnevenRoundedRectangle {
        let corners = cornerRadius > 0
            ? bubbleCorners ?? RectangleCornerRadii(
                topLeading: cornerRadius,
                bottomLeading: cornerRadius,
                bottomTrailing: cornerRadius,
                topTrailing: cornerRadius
            )
            : RectangleCornerRadii()
        return UnevenRoundedRectangle(cornerRadii: corners, style: .continuous)
    }

    /// Снимок или кадр ролика по рамке плитки, поверх подложки.
    private var picture: some View {
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
    }

    var body: some View {
        picture
            .overlay {
                if isHidden { spoilerCover }
            }
            .overlay {
                // У ролика «играть» по центру; пока там кольцо загрузки или «скачать» — они.
                if isVideo, !isHidden, upload == nil, loadControl == nil {
                    playGlyph
                        .transition(.opacity)
                }
            }
            .overlay(alignment: .topLeading) {
                if isVideo, !isHidden, let badge = videoBadge {
                    Text(verbatim: badge)
                        .font(Typography.tabular(.caption2.weight(.semibold)))
                        .foregroundStyle(.white)
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, 2)
                        .background(Palette.overlay.opacity(0.45), in: Capsule())
                        .padding(Spacing.sm)
                }
            }
            .clipShape(tileShape)
            .contentShape(Rectangle())
            .overlay { centerControl }
            .animation(Motion.respecting(.easeOut(duration: Motion.Duration.layer), reduceMotion: reduceMotion), value: loadControl)
            .onTapGesture(coordinateSpace: .local) { location in
                tap(at: location)
            }
            .task(id: "\(cacheKey)#\(attempt)") { await load() }
            .accessibilityElement()
            .accessibilityLabel(Text(accessibilityLabel))
            .accessibilityValue(Text(accessibilityValue))
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(.default) {
                if isHidden { revealed = true } else { open() }
            }
            .accessibilityActions {
                switch loadControl {
                case .progress:
                    Button(String(localized: "chats.file.cancelDownload", defaultValue: "Отменить скачивание")) {
                        pause()
                    }
                case .download:
                    Button(String(localized: "chats.media.download", defaultValue: "Загрузить")) {
                        retry()
                    }
                case nil:
                    EmptyView()
                }
            }
    }

    /// Что по центру вместо картинки: кольцо загрузки, «скачать» или ничего.
    private enum LoadControl: Equatable {
        case progress(Double?)
        case download
    }

    private var loadControl: LoadControl? {
        guard upload == nil, !isHidden, image == nil else { return nil }
        switch phase {
        case .loading where showsRing: return .progress(progress)
        case .failed, .paused: return .download
        default: return nil
        }
    }

    /// Кнопка по центру: отправка своего файла, загрузка, «скачать». Кнопки, а не часть
    /// касания плитки: касание мимо круга открывает просмотр.
    @ViewBuilder
    private var centerControl: some View {
        if let upload {
            if let retryUpload = upload.retry {
                MediaCircleButton(
                    symbol: "arrow.clockwise",
                    label: String(localized: "chats.retrySend", defaultValue: "Отправить ещё раз"),
                    diameter: controlDiameter,
                    action: retryUpload
                )
            } else {
                UploadRing(fraction: upload.fraction, diameter: controlDiameter, cancel: upload.cancel)
            }
        } else {
            switch loadControl {
            case .progress(let fraction):
                MediaLoadControl(fraction: fraction, diameter: controlDiameter, sizeLabel: sizeLabel) { pause() }
                    .transition(.opacity)
            case .download:
                MediaCircleButton(
                    symbol: "arrow.down",
                    label: String(localized: "chats.media.download", defaultValue: "Загрузить"),
                    diameter: controlDiameter,
                    caption: sizeLabel
                ) { retry() }
                    .transition(.opacity)
            case nil:
                EmptyView()
            }
        }
    }

    /// Круг по центру — 44 pt, в мелкой ячейке альбома поменьше.
    private var controlDiameter: CGFloat {
        min(ControlHeight.xl, (min(nominal.width, nominal.height) * 0.4).rounded())
    }

    /// Вес файла под кругом, как в Telegram: у крупных снимков, где под кругом есть место.
    /// У ролика вес и так в плашке длительности.
    private var sizeLabel: String? {
        guard !isVideo, let size = attachment.size, size >= Self.sizeLabelThreshold,
              min(nominal.width, nominal.height) >= 120
        else { return nil }
        return ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)
    }

    /// Спойлер как в Telegram: размытый снимок под мерцающей «пылью»; касание раскрывает
    /// его кругом, растущим от пальца.
    private var spoilerCover: some View {
        GeometryReader { proxy in
            ZStack {
                picture
                    .blur(radius: 24, opaque: true)
                Color.black.opacity(0.18)
                SpoilerDust()
            }
            .mask {
                Rectangle()
                    .overlay {
                        if let origin = revealOrigin {
                            Circle()
                                .frame(width: revealRadius * 2, height: revealRadius * 2)
                                .position(origin)
                                .blendMode(.destinationOut)
                        }
                    }
                    .compositingGroup()
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .allowsHitTesting(false)
        .transition(.identity)
    }

    private func tap(at location: CGPoint) {
        if isHidden {
            reveal(from: location)
        } else if upload == nil, image == nil, loadControl == .download {
            // Мимо круга, но снимка нет и он не грузится — касание тоже «скачать».
            retry()
        } else {
            open()
        }
    }

    /// Остановить загрузку: задача снимается, ждущих у сети не остаётся — запрос
    /// отменяется (`ImageDownloads`).
    private func pause() {
        phase = .paused
        showsRing = false
        progress = nil
        attempt += 1
    }

    /// Загрузить заново — по новой подписанной ссылке: прежнюю сбросил сбой.
    private func retry() {
        autoRetries = 0
        phase = .loading
        showsRing = true
        progress = nil
        attempt += 1
    }

    private func reveal(from origin: CGPoint) {
        // Круг уже растёт — второе касание его не перезапускает.
        guard revealOrigin == nil else { return }
        guard !reduceMotion else {
            revealed = true
            return
        }
        // Круг должен накрыть дальний угол плитки.
        let reach = hypot(max(origin.x, nominal.width - origin.x), max(origin.y, nominal.height - origin.y)) + 24
        revealOrigin = origin
        revealRadius = 0
        withAnimation(.easeOut(duration: 0.45)) {
            revealRadius = reach
        } completion: {
            revealed = true
        }
    }

    /// Ролик: длительность, а пока не загружен кадр — и размер файла, как в Telegram.
    private var videoBadge: String? {
        let duration = attachment.durationMs.flatMap { $0 > 0 ? VoiceWave.time(Double($0) / 1000) : nil }
        let size = image == nil
            ? attachment.size.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }
            : nil
        let parts = [duration, size].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Пока картинки нет: размытое превью, у ролика без превью — тёмная плитка, у снимка —
    /// ровная нейтральная подложка.
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
        }
    }

    /// Кнопка «играть» по центру ролика. В мелкой ячейке альбома — поменьше.
    private var playGlyph: some View {
        let diameter = controlDiameter
        return Image(systemName: "play.fill")
            .font(.system(size: diameter * 0.42, weight: .bold))
            .foregroundStyle(.white)
            .offset(x: diameter * 0.04)
            .frame(width: diameter, height: diameter)
            .background(Palette.overlay.opacity(0.45), in: Circle())
            .accessibilityHidden(true)
    }

    private var accessibilityLabel: String {
        if isHidden { return String(localized: "chats.spoiler", defaultValue: "Спойлер") }
        guard isVideo else { return String(localized: "chats.photo", defaultValue: "Фотография") }
        let title = String(localized: "chats.preview.video", defaultValue: "Видео")
        guard let duration = attachment.durationMs, duration > 0 else { return title }
        return "\(title), \(VoiceWave.time(Double(duration) / 1000))"
    }

    private var accessibilityValue: String {
        switch loadControl {
        case .progress(let fraction):
            let loading = String(localized: "chats.media.loading", defaultValue: "Загружается")
            guard let fraction else { return loading }
            return "\(loading), \(fraction.formatted(.percent.precision(.fractionLength(0))))"
        case .download:
            return String(localized: "chats.media.failed", defaultValue: "Не загрузилось")
        case nil:
            return ""
        }
    }

    private func load() async {
        if image == nil, let cached = ImageMemoryCache.shared.image(for: cacheKey) {
            image = cached
        }
        guard image == nil else {
            phase = .idle
            return
        }
        // Остановлено касанием — ждём следующего.
        if phase == .paused { return }
        // Повтор (касанием или сам) — кольцо сразу: человек ждёт ответа на действие.
        let immediate = phase != .idle
        phase = .loading
        showsRing = immediate
        progress = nil
        let spinner = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            if !Task.isCancelled, image == nil, phase == .loading { showsRing = true }
        }
        let (stream, sink) = AsyncStream.makeStream(of: Double.self, bufferingPolicy: .bufferingNewest(1))
        let watcher = Task { @MainActor in
            for await fraction in stream where phase == .loading {
                progress = fraction
            }
        }
        let outcome = await ChatMediaImages.load(
            attachment,
            points: points,
            scale: displayScale,
            key: cacheKey
        ) { fraction in
            sink.yield(fraction)
        }
        spinner.cancel()
        sink.finish()
        watcher.cancel()
        guard !Task.isCancelled else {
            // Плитка ушла с экрана (или загрузку остановили): вернётся — `.task`
            // запустит загрузку заново.
            if phase == .loading {
                phase = .idle
                showsRing = false
            }
            return
        }
        switch outcome {
        case .loaded(let loaded):
            autoRetries = 0
            phase = .idle
            showsRing = false
            withAnimation(Motion.respecting(.easeOut(duration: Motion.Duration.layer), reduceMotion: reduceMotion)) {
                image = loaded
            }
        case .failed(let retryable):
            phase = .failed(retryable: retryable)
            showsRing = false
            guard retryable, autoRetries < Self.retryDelays.count else { return }
            try? await Task.sleep(for: Self.retryDelays[autoRetries])
            guard !Task.isCancelled, phase == .failed(retryable: true) else { return }
            autoRetries += 1
            attempt += 1
        }
    }
}

/// Углы снимка без подписи: пузырь задаёт их по своей форме (крупные снаружи группы,
/// мелкие у хвостика и между сообщениями). `nil` — обычное скругление плитки.
private struct ChatMediaCornersKey: EnvironmentKey {
    static let defaultValue: RectangleCornerRadii? = nil
}

extension EnvironmentValues {
    var chatMediaCorners: RectangleCornerRadii? {
        get { self[ChatMediaCornersKey.self] }
        set { self[ChatMediaCornersKey.self] = newValue }
    }
}

/// Тёмный круг по центру снимка: кольцо загрузки с крестиком, как в Telegram. Доля
/// известна — дуга растёт, нет — короткая дуга крутится. Касание останавливает загрузку.
/// Под кругом — вес файла, если он передан.
struct MediaLoadControl: View {
    let fraction: Double?
    var diameter: CGFloat = ControlHeight.xl
    var sizeLabel: String?
    let cancel: () -> Void

    @State private var spinning = false
    @Environment(\.motionReduced) private var reduceMotion

    var body: some View {
        Button(action: cancel) {
            ZStack {
                Circle().fill(Palette.overlay.opacity(0.45))
                Circle()
                    .stroke(.white.opacity(0.25), lineWidth: 2.5)
                    .padding(Spacing.xs)
                arc
                Image(systemName: "xmark")
                    .font(.system(size: diameter * 0.3, weight: .bold))
                    .foregroundStyle(.white)
            }
            .frame(width: diameter, height: diameter)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) {
            if let sizeLabel {
                MediaSizeCaption(text: sizeLabel)
                    .offset(y: diameter + Spacing.xs)
            }
        }
        .onAppear { spinning = true }
        .accessibilityLabel(Text(String(localized: "chats.file.cancelDownload", defaultValue: "Отменить скачивание")))
    }

    @ViewBuilder
    private var arc: some View {
        if let fraction {
            // Совсем пустое кольцо читается как «ничего не происходит» — хвостик видно
            // с первой доли.
            Circle()
                .trim(from: 0, to: max(0.04, min(fraction, 1)))
                .stroke(.white, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(Spacing.xs)
                .animation(.linear(duration: 0.2), value: fraction)
        } else {
            Circle()
                .trim(from: 0, to: 0.28)
                .stroke(.white, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .padding(Spacing.xs)
                .rotationEffect(.degrees(spinning ? 360 : 0))
                .animation(
                    reduceMotion ? nil : .linear(duration: 0.9).repeatForever(autoreverses: false),
                    value: spinning
                )
        }
    }
}

/// Тёмный круг со значком по центру снимка: «скачать» после сбоя или остановки,
/// «повторить» у неотправленного своего. Под кругом — вес файла, если передан.
struct MediaCircleButton: View {
    let symbol: String
    let label: String
    var diameter: CGFloat = ControlHeight.xl
    var caption: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: diameter * 0.4, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: diameter, height: diameter)
                .background(Palette.overlay.opacity(0.45), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) {
            if let caption {
                MediaSizeCaption(text: caption)
                    .offset(y: diameter + Spacing.xs)
            }
        }
        .accessibilityLabel(Text(label))
    }
}

/// Вес файла под кругом загрузки — в тёмной капсуле, чтобы читался на любом снимке.
private struct MediaSizeCaption: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Typography.tabular(.caption2.weight(.semibold)))
            .foregroundStyle(.white)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, 2)
            .background(Palette.overlay.opacity(0.45), in: Capsule())
            .accessibilityHidden(true)
    }
}

/// «Пыль» спойлера, как в Telegram: мелкие светлые точки медленно плывут и мерцают
/// поверх размытого снимка. Без движения — неподвижный узор.
struct SpoilerDust: View {
    @Environment(\.motionReduced) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in
            Canvas { context, size in
                let time = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                // Плотность по площади, с потолком: большая плитка не съедает кадр.
                let count = min(260, Int(size.width * size.height / 110))
                var seed: UInt64 = 0x9E37_79B9_7F4A_7C15
                func random() -> Double {
                    seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
                    return Double(seed >> 11) / Double(1 << 53)
                }
                for _ in 0..<count {
                    let startX = random() * size.width
                    let startY = random() * size.height
                    let angle = random() * .pi * 2
                    let speed = 4 + random() * 9
                    let phase = random() * .pi * 2
                    let radius = 0.5 + random() * 0.9
                    var x = (startX + cos(angle) * speed * time).truncatingRemainder(dividingBy: size.width)
                    var y = (startY + sin(angle) * speed * time).truncatingRemainder(dividingBy: size.height)
                    if x < 0 { x += size.width }
                    if y < 0 { y += size.height }
                    let alpha = 0.35 + 0.65 * (0.5 + 0.5 * sin(time * 2.2 + phase))
                    context.fill(
                        Path(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2)),
                        with: .color(.white.opacity(alpha))
                    )
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Альбом

/// Альбом из нескольких снимков и роликов мозаикой, как в Telegram: два — рядом, три —
/// один широкий сверху и два под ним, четыре — два на два, дальше — ряды по два и три.
/// Зазор 2 pt, скруглены только внешние углы всей мозаики. Загрузка своего альбома —
/// кольцо с крестиком на каждой плитке (`tileUpload`), как в Telegram.
struct ChatMediaMosaic: View {
    let items: [AttachmentRecord]
    var upload: AttachmentUploadState?
    /// Своя загрузка у каждой плитки: кольцо и крестик на каждой, общего кольца нет.
    /// Неудача (`upload.retry`) — по-прежнему один круг «повторить» на всю мозаику.
    var tileUpload: ((AttachmentRecord) -> AttachmentUploadState)?
    let open: (AttachmentRecord) -> Void

    @Environment(\.chatMediaCorners) private var bubbleCorners

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
                    nominal: Self.tileSize(columns: index < columns.count ? columns[index] : 3),
                    upload: perTile ? tileUpload?(attachment) : nil
                ) {
                    open(attachment)
                }
            }
        }
        .clipShape(UnevenRoundedRectangle(cornerRadii: corners, style: .continuous))
        .overlay {
            if let upload {
                if let retryUpload = upload.retry {
                    MediaCircleButton(
                        symbol: "arrow.clockwise",
                        label: String(localized: "chats.retrySend", defaultValue: "Отправить ещё раз"),
                        action: retryUpload
                    )
                } else if !perTile {
                    UploadRing(fraction: upload.fraction, cancel: upload.cancel)
                }
            }
        }
    }

    /// Кольца на плитках — только пока альбом уходит; неудача рисуется одним кругом.
    private var perTile: Bool {
        tileUpload != nil && upload?.retry == nil
    }

    /// Альбом без подписи — углы пузыря, с подписью — обычное скругление.
    private var corners: RectangleCornerRadii {
        bubbleCorners ?? RectangleCornerRadii(
            topLeading: Radius.lg,
            bottomLeading: Radius.lg,
            bottomTrailing: Radius.lg,
            topTrailing: Radius.lg
        )
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
///
/// Копия не скачалась — пробуем оригинал (копий в хранилище может не быть, а запись о
/// них есть). Не скачалось ничего — подписанная ссылка сбрасывается: следующая попытка
/// пойдёт по новой, а не по той же протухшей или битой.
enum ChatMediaImages {
    /// Чем кончилась загрузка.
    enum Outcome {
        case loaded(UIImage)
        /// `retryable == false` — сервер ответил, что файла нет или он не наш: повтор
        /// без действия человека ничего не даст.
        case failed(retryable: Bool)
    }

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

    static func load(
        _ attachment: AttachmentRecord,
        points: CGFloat,
        scale: CGFloat,
        key: String,
        progress: ImageDownloads.Progress? = nil,
        allowsVideoOriginal: Bool = true
    ) async -> Outcome {
        let pixels = points * scale
        if attachment.mime == "image/gif" {
            return await gif(attachment, maxPixelSize: pixels, key: key, progress: progress)
        }
        let isVideo = attachment.mime.hasPrefix("video/")
        if let path = attachment.localPath, FileManager.default.fileExists(atPath: path) {
            let file = URL(filePath: path)
            let local = isVideo
                ? await ChatVideoFrames.shared.frame(of: file, key: key, maxPixelSize: pixels)
                : await ImageMemoryCache.shared.load(file, key: key, maxPixelSize: pixels)
            if let local { return .loaded(local) }
            // Своя копия не прочиталась — дальше по сети, если файл уже на сервере.
        }
        let urls = AppServices.attachmentURLs
        let media: AttachmentMedia
        do {
            media = try await urls.media(for: attachment.id)
        } catch {
            return .failed(retryable: isRetryable(error))
        }
        if Task.isCancelled { return .failed(retryable: true) }
        if isVideo {
            if let poster = media.poster.best(forPoints: points, scale: scale), let url = URL.apiRooted(poster.url),
               let image = await ImageMemoryCache.shared.load(url, key: key, maxPixelSize: pixels, progress: progress) {
                return .loaded(image)
            }
            if Task.isCancelled { return .failed(retryable: true) }
            // Предзагрузка невидимой плитки оригинал ролика не трогает: первый кадр из
            // файла по сети — только для плитки на экране. Ссылку не сбрасываем — она цела.
            guard allowsVideoOriginal else { return .failed(retryable: true) }
            // Постера нет — ролик ещё не обработан медиа-системой: первый кадр самого
            // файла, а не строка файла вместо видео.
            if let frame = await ChatVideoFrames.shared.frame(of: media.url, key: key, maxPixelSize: pixels) {
                return .loaded(frame)
            }
        } else {
            let variant = media.sources.best(forPoints: points, scale: scale).flatMap { URL.apiRooted($0.url) }
            for url in [variant, media.url].compactMap({ $0 }) {
                if let image = await ImageMemoryCache.shared.load(url, key: key, maxPixelSize: pixels, progress: progress) {
                    return .loaded(image)
                }
                if Task.isCancelled { return .failed(retryable: true) }
            }
        }
        if !Task.isCancelled { await urls.invalidate(attachment.id) }
        return .failed(retryable: true)
    }

    /// Повторять ли самим: «нет файла», «не участник», «не то прочли» — нет; сеть, лимит
    /// запросов, сбой сервера — да.
    static func isRetryable(_ error: Error) -> Bool {
        guard let error = error as? APIError else { return true }
        switch error {
        case .server(let code, _, _, let status):
            if code == .rateLimit { return true }
            return !(400..<500).contains(status) || status == 408
        case .decoding:
            return false
        case .transport, .malformedResponse:
            return true
        }
    }
}

extension ChatMediaImages {
    /// GIF — оригинал целиком (уменьшенные копии медиа-системы анимацию теряют). Байты —
    /// через общий загрузчик: проверка статуса, кэш на диске, доля скачанного.
    static func gif(
        _ attachment: AttachmentRecord,
        maxPixelSize: CGFloat,
        key: String,
        progress: ImageDownloads.Progress?
    ) async -> Outcome {
        if let cached = AnimatedGIF.cached(key) { return .loaded(cached) }
        let data: Data?
        if let path = attachment.localPath, FileManager.default.fileExists(atPath: path) {
            data = try? Data(contentsOf: URL(filePath: path))
        } else {
            let media: AttachmentMedia
            do {
                media = try await AppServices.attachmentURLs.media(for: attachment.id)
            } catch {
                return .failed(retryable: isRetryable(error))
            }
            data = await ImageDownloads.shared.data(for: media.url, progress: progress)
            if data == nil, !Task.isCancelled { await AppServices.attachmentURLs.invalidate(attachment.id) }
        }
        guard let data else { return .failed(retryable: true) }
        let image = await Task.detached(priority: .utility) {
            AnimatedGIF.decode(data, maxPixelSize: maxPixelSize, key: key)
        }.value
        return image.map(Outcome.loaded) ?? .failed(retryable: false)
    }
}

/// Первые кадры роликов без постера. Готовый кадр ложится в общий кэш картинок по ключу
/// плитки. Неудача помнится минуту, а не до выхода из приложения: прокрутка туда-обратно
/// не дёргает файл снова, но ролик, который просто не успел обработаться или попал на
/// обрыв сети, не остаётся пустым навсегда. Одновременные запросы одного кадра сводятся
/// в один.
actor ChatVideoFrames {
    static let shared = ChatVideoFrames()

    private static let failureMemory: TimeInterval = 60

    private var failed: [String: Date] = [:]
    private var inFlight: [String: Task<UIImage?, Never>] = [:]

    func frame(of url: URL, key: String, maxPixelSize: CGFloat) async -> UIImage? {
        if let cached = ImageMemoryCache.shared.image(for: key) { return cached }
        if let since = failed[key], Date().timeIntervalSince(since) < Self.failureMemory { return nil }
        if let running = inFlight[key] { return await running.value }
        let task = Task.detached(priority: .utility) { () -> UIImage? in
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: maxPixelSize, height: maxPixelSize)
            guard let frame = try? await generator.image(at: .zero) else { return nil }
            // Кадр раскодирован здесь, вне главного: иначе первая отрисовка крупного
            // кадра декодирует его на главном потоке.
            let image = UIImage(cgImage: frame.image)
            return await image.byPreparingForDisplay() ?? image
        }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        if let image {
            failed[key] = nil
            ImageMemoryCache.shared.store(image, for: key)
        } else {
            failed[key] = Date()
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

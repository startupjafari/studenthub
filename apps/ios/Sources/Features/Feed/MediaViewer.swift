import AVKit
import Photos
import SwiftUI
import UIKit

/// Просмотр фото и видео на весь экран — инструменты веб-просмотрщика (листание,
/// счётчик, увеличение, скачивание), перенесённые на привычные жесты и системные
/// листы iOS.
///
/// Сверху — компактная панель: закрыть, «2 / 14», «Поделиться» и «…» (сохранить в
/// «Фото», скопировать, оригинал). Касание снимка прячет и показывает панель, не
/// сдвигая сам снимок. Щипок и двойное касание увеличивают, увеличенный снимок
/// двигается пальцем, а листание и смахивание вниз (закрыть) ждут, пока его вернут к
/// исходному размеру. Видео играет системный `AVPlayerViewController`: его контролы —
/// пауза, ±10 с, полоса прокрутки, время, скорость, AirPlay, картинка в картинке, — и
/// своих поверх них нет.
struct MediaViewer: View {
    let media: [PostDTO.Media]
    let start: Int

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selection = 0
    @State private var dragOffset: CGFloat = 0
    @State private var showsControls = true
    @State private var isZoomed = false
    /// Снимки, для которых попросили оригинал вместо уменьшенной копии.
    @State private var originals: Set<String> = []
    @State private var isBusy = false
    @State private var sharing: ExportedFile?
    @State private var notice: String?
    @State private var failure: String?

    private var current: PostDTO.Media? {
        media.indices.contains(selection) ? media[selection] : nil
    }

    /// Затемнение фона тает, пока снимок тянут вниз. Отдельным свойством с явным
    /// `Double`: в выражении `1 - min(abs(x) / 400, 0.6)` Swift 6.1 (Xcode 16) не мог
    /// выбрать между `CGFloat` и `Double`.
    private var backdropOpacity: Double {
        1 - min(Double(abs(dragOffset)) / 400, 0.6)
    }

    var body: some View {
        ZStack {
            Color.black
                .opacity(backdropOpacity)
                .ignoresSafeArea()

            TabView(selection: $selection) {
                ForEach(Array(media.enumerated()), id: \.element.id) { index, item in
                    page(item, index: index)
                        .tag(index)
                }
            }
            // Точки страниц не нужны: номер — в панели сверху.
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            .offset(y: dragOffset)
            .simultaneousGesture(dismissDrag, including: isZoomed ? .none : .all)
        }
        // Панель — поверх снимка и не участвует в раскладке: прячется и появляется, не
        // двигая снимок. У видео она видна всегда — касания забирает плеер.
        .overlay(alignment: .top) {
            if showsControls || current?.isVideo == true {
                topBar
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice)
                    .font(Typography.meta.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Spacing.xl)
                    .padding(.vertical, Spacing.md)
                    .floatingGlass(in: Capsule())
                    .padding(.bottom, Spacing.xxl)
                    .transition(.opacity)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .statusBarHidden(!showsControls)
        .sheet(item: $sharing) { file in
            ShareSheet(items: [file.url])
                .presentationDetents([.medium, .large])
        }
        .actionFailureAlert($failure)
        .onAppear { selection = start }
        .onChange(of: selection) { _, _ in isZoomed = false }
        .animation(Motion.respecting(.easeInOut(duration: Motion.Duration.feedback), reduceMotion: reduceMotion), value: showsControls)
        .animation(Motion.respecting(.easeInOut(duration: Motion.Duration.feedback), reduceMotion: reduceMotion), value: notice)
    }

    @ViewBuilder
    private func page(_ item: PostDTO.Media, index: Int) -> some View {
        if item.isVideo, let url = item.playbackURL {
            // Видео — под панелью, а не под ней: контролы плеера и кнопки панели не
            // перекрывают друг друга.
            ViewerVideo(url: url, isActive: selection == index)
                .safeAreaPadding(.top, MediaViewerBar.height)
        } else {
            ZoomableImage(
                media: item,
                showsOriginal: originals.contains(item.id),
                isZoomed: selection == index ? $isZoomed : .constant(false),
                toggleControls: { showsControls.toggle() }
            )
        }
    }

    private var dismissDrag: some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { value in
                guard abs(value.translation.height) > abs(value.translation.width) else { return }
                dragOffset = value.translation.height
            }
            .onEnded { value in
                if abs(value.translation.height) > 140 || abs(value.predictedEndTranslation.height) > 400 {
                    dismiss()
                } else {
                    withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) {
                        dragOffset = 0
                    }
                }
            }
    }

    // MARK: Панель

    private var topBar: some View {
        HStack(spacing: Spacing.md) {
            MediaViewerBar.button(symbol: "xmark", title: String(localized: "common.close", defaultValue: "Закрыть")) {
                dismiss()
            }
            Spacer(minLength: 0)
            if media.count > 1 {
                Text(verbatim: "\(selection + 1) / \(media.count)")
                    .font(Typography.tabular(.subheadline.weight(.semibold)))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Spacing.lg)
                    .frame(height: ControlHeight.md)
                    .floatingGlass(in: Capsule())
            }
            Spacer(minLength: 0)
            if isBusy {
                ProgressView()
                    .tint(.white)
                    .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                    .floatingGlass(in: Circle())
            } else {
                MediaViewerBar.button(symbol: "square.and.arrow.up", title: String(localized: "feed.share", defaultValue: "Поделиться")) {
                    Task { await share() }
                }
            }
            MediaViewerBar.circle(symbol: "ellipsis")
                .accessibilityHidden(true)
                .overlay {
                    MenuOverlay(menu: moreMenu.uiMenu, accessibilityLabel: String(localized: "chats.info.more", defaultValue: "Ещё"))
                }
                .disabled(isBusy)
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.top, Spacing.sm)
    }

    @HeroMenuBuilder
    private var moreMenu: [HeroMenuElement] {
        if let item = current {
            HeroMenuItem(String(localized: "media.save", defaultValue: "Сохранить в «Фото»"), symbol: "square.and.arrow.down") {
                Task { await saveToPhotos(item) }
            }
            if !item.isVideo {
                HeroMenuItem(String(localized: "media.copyImage", defaultValue: "Скопировать изображение"), symbol: "doc.on.doc") {
                    Task { await copyImage(item) }
                }
            }
            if item.originalURL != nil {
                HeroMenuItem(String(localized: "media.copyLink", defaultValue: "Скопировать ссылку"), symbol: "link") {
                    copyLink(item)
                }
            }
            // Оригинал — только когда сейчас показана уменьшенная копия.
            if !item.isVideo, item.sources?.isEmpty == false, !originals.contains(item.id) {
                HeroMenuDivider()
                HeroMenuItem(String(localized: "media.original", defaultValue: "Показать оригинал"), symbol: "photo") {
                    originals.insert(item.id)
                }
            }
        }
    }

    // MARK: Действия

    @MainActor
    private func share() async {
        guard let item = current else { return }
        await run {
            sharing = ExportedFile(url: try await MediaDownload.file(for: item))
        }
    }

    @MainActor
    private func saveToPhotos(_ item: PostDTO.Media) async {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            failure = String(localized: "media.photosDenied", defaultValue: "Нет доступа к «Фото». Разрешите его в Настройках")
            return
        }
        await run {
            let file = try await MediaDownload.file(for: item)
            let isVideo = item.isVideo
            try await PHPhotoLibrary.shared().performChanges {
                if isVideo {
                    PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: file)
                } else {
                    PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: file)
                }
            }
            show(String(localized: "media.saved", defaultValue: "Сохранено в «Фото»"))
        }
    }

    @MainActor
    private func copyImage(_ item: PostDTO.Media) async {
        await run {
            let file = try await MediaDownload.file(for: item)
            guard let image = UIImage(contentsOfFile: file.path) else { throw URLError(.cannotDecodeContentData) }
            UIPasteboard.general.image = image
            show(String(localized: "media.copied", defaultValue: "Скопировано"))
        }
    }

    private func copyLink(_ item: PostDTO.Media) {
        guard let url = item.originalURL else { return }
        UIPasteboard.general.url = url
        show(String(localized: "media.copied", defaultValue: "Скопировано"))
    }

    @MainActor
    private func run(_ action: () async throws -> Void) async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await action()
        } catch {
            failure = error.userMessage
        }
    }

    /// Короткая подсказка внизу — «Скопировано», «Сохранено».
    private func show(_ message: String) {
        notice = message
        Task {
            try? await Task.sleep(for: .seconds(1.6))
            if notice == message { notice = nil }
        }
    }
}

// MARK: - Кнопки панели

private enum MediaViewerBar {
    static let height: CGFloat = ControlHeight.xl + Spacing.sm * 2

    static func circle(symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.headline)
            .foregroundStyle(.white)
            .frame(width: ControlHeight.xl, height: ControlHeight.xl)
            .floatingGlass(in: Circle())
    }

    static func button(symbol: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { circle(symbol: symbol) }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(title))
    }
}

// MARK: - Снимок

/// Снимок с увеличением: щипок, двойное касание в точку (и обратно), перемещение
/// увеличенного пальцем. Края не уезжают дальше, чем позволяет увеличение.
private struct ZoomableImage: View {
    let media: PostDTO.Media
    let showsOriginal: Bool
    @Binding var isZoomed: Bool
    let toggleControls: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var size: CGSize = .zero

    private static let maxScale: CGFloat = 5
    private static let doubleTapScale: CGFloat = 2.5
    private static let copyPoints: CGFloat = 840

    var body: some View {
        image
            .scaleEffect(scale)
            .offset(offset)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
            .gesture(magnify)
            .highPriorityGesture(pan, including: scale > 1 ? .all : .none)
            .onTapGesture(count: 2, coordinateSpace: .local) { location in
                toggleZoom(at: location)
            }
            .onTapGesture(perform: toggleControls)
            .onChange(of: scale) { _, value in isZoomed = value > 1.01 }
            .onDisappear { reset() }
            .accessibilityLabel(Text(String(localized: "feed.photo", defaultValue: "Фотография")))
            .accessibilityAddTraits(.isImage)
    }

    @ViewBuilder
    private var image: some View {
        if showsOriginal, let original = media.originalURL {
            RemoteImage(url: original, cacheKey: "\(media.id):original", placeholder: media.placeholder, contentMode: .fit)
        } else {
            RemoteImage(
                url: media.imageURL(width: Self.copyPoints),
                cacheKey: media.cacheKey(Self.copyPoints),
                placeholder: media.placeholder,
                contentMode: .fit
            )
        }
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                scale = min(max(lastScale * value.magnification, 1), Self.maxScale)
                offset = clamped(offset)
            }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1.01 { animateReset() } else { lastOffset = offset }
            }
    }

    private var pan: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = clamped(CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                ))
            }
            .onEnded { _ in lastOffset = offset }
    }

    /// Двойное касание: увеличить так, чтобы точка касания встала в центр, или вернуть.
    private func toggleZoom(at location: CGPoint) {
        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) {
            if scale > 1.01 {
                reset()
            } else {
                scale = Self.doubleTapScale
                lastScale = scale
                offset = clamped(CGSize(
                    width: (size.width / 2 - location.x) * (scale - 1),
                    height: (size.height / 2 - location.y) * (scale - 1)
                ))
                lastOffset = offset
            }
        }
    }

    private func clamped(_ value: CGSize) -> CGSize {
        let maxX = max(0, (size.width * scale - size.width) / 2)
        let maxY = max(0, (size.height * scale - size.height) / 2)
        return CGSize(width: min(max(value.width, -maxX), maxX), height: min(max(value.height, -maxY), maxY))
    }

    private func animateReset() {
        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) { reset() }
    }

    private func reset() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
    }
}

// MARK: - Видео

/// Ролик в системном плеере. `AVPlayer` создаётся один раз на страницу и не
/// пересоздаётся при перерисовке экрана; уходя со страницы, ролик встаёт на паузу.
private struct ViewerVideo: View {
    let url: URL
    let isActive: Bool

    @State private var player: AVPlayer?

    var body: some View {
        SystemPlayer(player: player)
            .onAppear {
                if player == nil { player = AVPlayer(url: url) }
                if isActive { player?.play() }
            }
            .onChange(of: isActive) { _, active in
                if active { player?.play() } else { player?.pause() }
            }
            .onDisappear { player?.pause() }
    }
}

/// `AVPlayerViewController` целиком: системные контролы, AirPlay, картинка в картинке и
/// выбор скорости. Кадр вписан без искажения пропорций.
private struct SystemPlayer: UIViewControllerRepresentable {
    let player: AVPlayer?

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.videoGravity = .resizeAspect
        controller.allowsPictureInPicturePlayback = true
        controller.entersFullScreenWhenPlaybackBegins = false
        controller.exitsFullScreenWhenPlaybackEnds = false
        controller.speeds = AVPlaybackSpeed.systemDefaultSpeeds
        controller.view.backgroundColor = .clear
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
    }
}

// MARK: - Файл

/// Медиафайл целиком — для «Поделиться», «Фото» и буфера обмена. Ложится во временную
/// папку с расширением по типу: по нему «Фото» и получатель понимают, что это.
private enum MediaDownload {
    static func file(for media: PostDTO.Media) async throws -> URL {
        guard let remote = media.originalURL else { throw URLError(.badURL) }
        let (temporary, response) = try await URLSession.shared.download(from: remote)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        let destination = FileManager.default.temporaryDirectory
            .appending(path: "studenthub-\(media.id).\(fileExtension(for: media, remote: remote))")
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }

    private static func fileExtension(for media: PostDTO.Media, remote: URL) -> String {
        if !remote.pathExtension.isEmpty { return remote.pathExtension.lowercased() }
        switch media.mime {
        case "image/png": return "png"
        case "image/webp": return "webp"
        case "image/heic": return "heic"
        case "image/gif": return "gif"
        case "video/quicktime": return "mov"
        case let mime? where mime.hasPrefix("video/"): return "mp4"
        default: return media.isVideo ? "mp4" : "jpg"
        }
    }
}

extension PostDTO.Media {
    /// Оригинал файла — для скачивания, «Фото» и ссылки. Относительный путь
    /// дополняется адресом API.
    var originalURL: URL? {
        guard let url, !url.isEmpty else { return nil }
        return URL.apiRooted(url)
    }
}

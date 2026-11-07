import AVKit
import Observation
import SwiftUI

/// Медиа поста.
///
/// Одно вложение — в своих пропорциях, без обрезки значимого: высота ограничена, а
/// слишком вытянутое по вертикали показывается целиком на размытой подложке. Несколько
/// — листаются по одному с точками-индикаторами: сетка из четырёх плиток на телефоне
/// превращает каждое фото в марку. Нажатие открывает полноэкранный просмотр.
struct PostMediaView: View {
    let media: [PostDTO.Media]

    @State private var selection = 0
    @State private var viewerIndex: Int?

    private var visible: [PostDTO.Media] {
        media.filter { $0.status != "FAILED" && ($0.isImage || $0.isVideo) }
    }

    var body: some View {
        let items = visible
        if !items.isEmpty {
            Color.clear
                .aspectRatio(Self.ratio(for: items), contentMode: .fit)
                .frame(maxWidth: .infinity)
                .overlay {
                    if items.count == 1 {
                        MediaTile(media: items[0]) { viewerIndex = 0 }
                    } else {
                        TabView(selection: $selection) {
                            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                                MediaTile(media: item) { viewerIndex = index }
                                    .tag(index)
                            }
                        }
                        .tabViewStyle(.page(indexDisplayMode: .never))
                        .overlay(alignment: .topTrailing) {
                            Text(verbatim: "\(selection + 1)/\(items.count)")
                                .font(Typography.tabular(Typography.meta))
                                .padding(.horizontal, Spacing.md)
                                .padding(.vertical, Spacing.xs)
                                .floatingGlass(in: Capsule())
                                .padding(Spacing.md)
                                .accessibilityHidden(true)
                        }
                        .overlay(alignment: .bottom) {
                            PageDots(count: items.count, selection: selection)
                                .padding(.bottom, Spacing.md)
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
                .fullScreenCover(item: Binding(
                    get: { viewerIndex.map(ViewerTarget.init) },
                    set: { viewerIndex = $0?.index }
                )) { target in
                    MediaViewer(media: items, start: target.index)
                }
        }
    }

    /// Пропорции блока: первого вложения (у галереи — самого высокого из первых), но
    /// не выше 4:5 и не ниже 16:9 — так лента не превращается в столбы портретов и в
    /// полоски панорам. Не влезшее показывается целиком на размытой подложке.
    static func ratio(for items: [PostDTO.Media]) -> CGFloat {
        let ratios = items.prefix(4).map { $0.aspectRatio ?? 1 }
        let ratio = items.count == 1 ? ratios.first ?? 1 : ratios.min() ?? 1
        return min(max(ratio, 4.0 / 5.0), 16.0 / 9.0)
    }
}

/// Ширина карточки в точках для выбора копии: точный размер не нужен — копии идут
/// ступенями 320/640/1280, и ошибка в полэкрана не меняет выбор.
private let cardImagePoints: CGFloat = 420

private struct ViewerTarget: Identifiable {
    let index: Int
    var id: Int { index }
}

/// Плитка вложения: фото или обложка видео.
private struct MediaTile: View {
    let media: PostDTO.Media
    let open: () -> Void

    private var width: CGFloat { cardImagePoints }

    var body: some View {
        if media.isVideo {
            InlineVideoView(media: media, width: width)
        } else {
            Button(action: open) {
                ZStack {
                    // Подложка: то же фото, размытое, — поля у вертикального снимка не
                    // выглядят пустыми.
                    RemoteImage(url: media.imageURL(width: 320), cacheKey: media.cacheKey(320), placeholder: media.placeholder)
                        .blur(radius: 24)
                        .opacity(0.6)
                    RemoteImage(
                        url: media.imageURL(width: width),
                        cacheKey: media.cacheKey(width),
                        placeholder: media.placeholder,
                        contentMode: (media.aspectRatio ?? 1) < 4.0 / 5.0 ? .fit : .fill
                    )
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "feed.photo", defaultValue: "Фотография")))
            .accessibilityHint(Text(String(localized: "feed.photo.open", defaultValue: "Открыть на весь экран")))
        }
    }
}

private struct PageDots: View {
    let count: Int
    let selection: Int

    var body: some View {
        HStack(spacing: Spacing.xs) {
            ForEach(0..<min(count, 10), id: \.self) { index in
                Circle()
                    .fill(index == selection ? Color.white : Color.white.opacity(0.5))
                    .frame(width: 6, height: 6)
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.xs)
        .floatingGlass(in: Capsule())
        .accessibilityHidden(true)
    }
}

// MARK: - Видео

/// Какое видео ленты сейчас играет. Одно на всё приложение: второе ставит первое
/// на паузу, иначе прокрутка ленты включала бы хор.
@MainActor
@Observable
final class VideoPlaybackCenter {
    static let shared = VideoPlaybackCenter()

    private(set) var activeID: String?

    func activate(_ id: String) { activeID = id }

    func deactivate(_ id: String) {
        if activeID == id { activeID = nil }
    }
}

/// Видео в карточке: обложка с кнопкой, по нажатию — системный плеер на месте.
/// Плеер создаётся только при запуске: десяток постов с видео не держит десяток
/// декодеров. Ушло с экрана — пауза.
struct InlineVideoView: View {
    let media: PostDTO.Media
    let width: CGFloat

    @State private var player: AVPlayer?
    private let center = VideoPlaybackCenter.shared

    var body: some View {
        ZStack {
            if let player, center.activeID == media.id {
                VideoPlayer(player: player)
            } else {
                RemoteImage(
                    url: media.posterURL(width: width),
                    cacheKey: "poster:" + media.cacheKey(width),
                    placeholder: media.placeholder
                )
                Button(action: play) {
                    Image(systemName: "play.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 56, height: 56)
                        .floatingGlass(in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(media.playbackURL == nil)
                .accessibilityLabel(Text(String(localized: "feed.video.play", defaultValue: "Воспроизвести видео")))

                if let duration = media.durationMs {
                    Text(verbatim: Duration.milliseconds(duration).formatted(.time(pattern: .minuteSecond)))
                        .font(Typography.tabular(Typography.meta))
                        .foregroundStyle(.white)
                        .padding(.horizontal, Spacing.md)
                        .padding(.vertical, Spacing.xs)
                        .background(.black.opacity(0.5), in: Capsule())
                        .padding(Spacing.md)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                        .accessibilityHidden(true)
                }
                if media.status == "PROCESSING" || media.status == "PENDING" {
                    Text(String(localized: "feed.video.processing", defaultValue: "Видео обрабатывается"))
                        .font(Typography.meta)
                        .foregroundStyle(.white)
                        .padding(Spacing.md)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                }
            }
        }
        .onChange(of: center.activeID) { _, active in
            if active != media.id { player?.pause() }
        }
        .onDisappear {
            player?.pause()
            center.deactivate(media.id)
        }
    }

    private func play() {
        guard let url = media.playbackURL else { return }
        if player == nil { player = AVPlayer(url: url) }
        center.activate(media.id)
        player?.play()
    }
}

// MARK: - Полноэкранный просмотр

/// Просмотр вложений на весь экран: листание, щипок и двойное нажатие для
/// увеличения, смахивание вниз — закрыть.
struct MediaViewer: View {
    let media: [PostDTO.Media]
    let start: Int

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selection = 0
    @State private var dragOffset: CGFloat = 0

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black
                .opacity(1 - min(abs(dragOffset) / 400, 0.6))
                .ignoresSafeArea()

            TabView(selection: $selection) {
                ForEach(Array(media.enumerated()), id: \.element.id) { index, item in
                    Group {
                        if item.isVideo, let url = item.playbackURL {
                            FullscreenVideo(url: url, isActive: selection == index)
                        } else {
                            ZoomableImage(media: item)
                        }
                    }
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: media.count > 1 ? .automatic : .never))
            .offset(y: dragOffset)
            .simultaneousGesture(
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
            )

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                    .floatingGlass(in: Circle())
            }
            .padding(Spacing.xl)
            .accessibilityLabel(Text(String(localized: "common.close", defaultValue: "Закрыть")))
        }
        .statusBarHidden()
        .onAppear { selection = start }
    }
}

private struct ZoomableImage: View {
    let media: PostDTO.Media

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1

    var body: some View {
        RemoteImage(
            url: media.imageURL(width: 2 * cardImagePoints),
            cacheKey: media.cacheKey(2 * cardImagePoints),
            placeholder: media.placeholder,
            contentMode: .fit
        )
        .scaleEffect(scale)
        .gesture(
            MagnifyGesture()
                .onChanged { value in scale = min(max(lastScale * value.magnification, 1), 5) }
                .onEnded { _ in lastScale = scale }
        )
        .onTapGesture(count: 2) {
            withAnimation(Motion.calm) {
                scale = scale > 1 ? 1 : 2.5
                lastScale = scale
            }
        }
        .accessibilityLabel(Text(String(localized: "feed.photo", defaultValue: "Фотография")))
        .accessibilityAddTraits(.isImage)
    }
}

private struct FullscreenVideo: View {
    let url: URL
    let isActive: Bool

    @State private var player: AVPlayer?

    var body: some View {
        VideoPlayer(player: player)
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

// MARK: - Адреса

extension PostDTO.Media {
    var isVideo: Bool { mime?.hasPrefix("video/") == true || hls != nil }
    var isImage: Bool { mime?.hasPrefix("image/") == true || (mime == nil && hls == nil) }

    /// Ширина к высоте. Без размеров — квадрат: так плитка не прыгает после загрузки.
    var aspectRatio: CGFloat? {
        guard let width, let height, width > 0, height > 0 else { return nil }
        return CGFloat(width) / CGFloat(height)
    }

    func imageURL(width points: CGFloat) -> URL? {
        let raw = sources?.best(forPoints: points)?.url ?? url
        return raw.flatMap(URL.init(string:))
    }

    func posterURL(width points: CGFloat) -> URL? {
        (poster?.best(forPoints: points)?.url).flatMap(URL.init(string:)) ?? imageURL(width: points)
    }

    /// HLS, если ролик уже нарезан, иначе — оригинал.
    var playbackURL: URL? {
        if let hls, let url = URL.apiRooted(hls) { return url }
        return url.flatMap(URL.init(string:))
    }

    func cacheKey(_ points: CGFloat) -> String {
        "\(id):\(sources?.best(forPoints: points)?.width ?? 0)"
    }
}

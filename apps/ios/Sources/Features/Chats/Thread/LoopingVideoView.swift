import AVFoundation
import SwiftUI
import UIKit

/// GIF, который сервер хранит беззвучным MP4 (`animation` у вложения), — как GIF в
/// Telegram: играет сам, без звука, по кругу и без контролов.
///
/// Кадр — в той же рамке, что постер под ним (IOS_RULES 8.6.6): в плитке — с обрезкой
/// (`resizeAspectFill`, как `scaledToFill` у постера), в просмотре — вписан. До первого
/// кадра слой прозрачен, и виден постер под ним — без чёрной вспышки.
///
/// Играет, только пока вид в окне, приложение на экране и `isPlaying`; разобран —
/// плеер отпущен вместе с декодером.
struct LoopingVideoView: UIViewRepresentable {
    let url: URL
    var isPlaying = true
    var gravity: AVLayerVideoGravity = .resizeAspectFill

    func makeUIView(context: Context) -> LoopingVideoPlayerView {
        let view = LoopingVideoPlayerView()
        apply(to: view)
        return view
    }

    func updateUIView(_ view: LoopingVideoPlayerView, context: Context) {
        apply(to: view)
    }

    static func dismantleUIView(_ view: LoopingVideoPlayerView, coordinator: ()) {
        view.stop()
    }

    private func apply(to view: LoopingVideoPlayerView) {
        view.videoGravity = gravity
        // Сначала «играть ли», потом ролик: иначе новый плеер на миг стартовал бы и тут же
        // вставал на паузу.
        view.isPlaying = isPlaying
        view.load(url)
    }
}

/// Слой плеера с зацикленным беззвучным роликом (`AVQueuePlayer` + `AVPlayerLooper`, как
/// у круглого видео редактора историй). Касаний не берёт: они уходят плитке под ним.
final class LoopingVideoPlayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }

    private var playerLayer: AVPlayerLayer {
        // `layerClass` выше гарантирует тип слоя.
        layer as! AVPlayerLayer
    }

    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private var url: URL?
    /// Приложение ушло в фон: система сама ставит видео на паузу, а обратно не запускает.
    private var inBackground = false
    private var observers: [NSObjectProtocol] = []

    /// Хочет ли хозяин, чтобы ролик шёл (плитка видна, просмотр на этой странице).
    var isPlaying = true {
        didSet {
            if isPlaying != oldValue { updatePlayback() }
        }
    }

    var videoGravity: AVLayerVideoGravity {
        get { playerLayer.videoGravity }
        set {
            if playerLayer.videoGravity != newValue { playerLayer.videoGravity = newValue }
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        // `resizeAspectFill` рисует кадр шире рамки — обрезаем по ней, как постер.
        clipsToBounds = true
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        playerLayer.videoGravity = .resizeAspectFill
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.inBackground = true
            self?.updatePlayback()
        })
        observers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.inBackground = false
            self?.updatePlayback()
        })
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updatePlayback()
    }

    /// Тот же адрес — ничего не делаем: перерисовка SwiftUI не перезапускает ролик.
    func load(_ url: URL) {
        guard url != self.url else { return }
        stop()
        self.url = url
        let queue = AVQueuePlayer()
        // Звука у GIF нет, а беззвучный плеер не должен глушить чужую музыку и не держит
        // экран включённым.
        queue.isMuted = true
        queue.preventsDisplaySleepDuringVideoPlayback = false
        looper = AVPlayerLooper(player: queue, templateItem: AVPlayerItem(url: url))
        player = queue
        playerLayer.player = queue
        updatePlayback()
    }

    func stop() {
        player?.pause()
        looper?.disableLooping()
        looper = nil
        player = nil
        playerLayer.player = nil
        url = nil
    }

    private func updatePlayback() {
        guard let player else { return }
        if isPlaying, window != nil, !inBackground {
            player.play()
        } else {
            player.pause()
        }
    }
}

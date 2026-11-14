import AVFoundation
import Foundation
import ObjectiveC

/// Повтор загрузки ролика после сбоя (IOS_RULES 9.6.13).
///
/// `AVPlayerItem` со статусом `.failed` больше не играет: без повтора обрыв сети или истёкший
/// токен `?t=` в HLS-ссылке превращались в вечную ошибку. Здесь сбой сети — повтор с паузой
/// 1, 2, 4, 8, 16 с; отказ в доступе (401/403) — сначала свежая подписанная ссылка; позиция
/// сохраняется. Окончательна только ошибка содержимого (неразбираемый файл, нет кодека, 404).
///
/// Один экземпляр на плеер (`attach`): карточка ленты отдаёт свой плеер просмотру, и два
/// наблюдателя пересоздавали бы источник наперегонки.
/// Свежая ссылка на тот же ролик; `nil` — повторить по прежней. Структура, а не голое замыкание:
/// замыкание-поле экрана компилятор считал «не Sendable» при передаче в `attach` (предупреждение
/// «converting non-Sendable function value»), а Sendable-значение передаётся без преобразования.
struct VideoResign: Sendable {
    let fetch: @Sendable () async -> URL?

    func callAsFunction() async -> URL? { await fetch() }
}

@MainActor
final class VideoRecovery {
    typealias Resign = VideoResign

    enum Failure: Equatable {
        /// Обрыв, таймаут, сбой сервера — повторить по той же ссылке.
        case network
        /// Подпись истекла или отозвана — нужна новая ссылка.
        case expiredLink
        /// Файл не разобрать или его нет — повторять бесполезно.
        case content
    }

    static let delays: [Duration] = [.seconds(1), .seconds(2), .seconds(4), .seconds(8), .seconds(16)]

    private weak var player: AVPlayer?
    private var resign: Resign?
    /// Экран хочет, чтобы ролик играл: пауза с экрана или уход отменяют повтор и запуск.
    private var wantsPlayback = false
    /// Последнее здоровое состояние: где был ролик и играл ли он, — с периодического
    /// наблюдателя. У упавшего item `currentTime` уже ненадёжен.
    private var position: CMTime = .zero
    private var wasPlaying = false
    private var pendingSeek: CMTime?
    private var attempt = 0
    private var retry: Task<Void, Never>?
    private var statusObservation: NSKeyValueObservation?
    nonisolated(unsafe) private var failureObserver: NSObjectProtocol?
    private var timeObserver: Any?

    private static var key: UInt8 = 0

    /// Наблюдатель плеера: создаётся при первом обращении и живёт, пока жив плеер.
    static func attach(to player: AVPlayer, resign: Resign?) -> VideoRecovery {
        if let existing = objc_getAssociatedObject(player, &key) as? VideoRecovery {
            if existing.resign == nil { existing.resign = resign }
            return existing
        }
        let recovery = VideoRecovery(player: player, resign: resign)
        objc_setAssociatedObject(player, &key, recovery, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        return recovery
    }

    private init(player: AVPlayer, resign: Resign?) {
        self.player = player
        self.resign = resign
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(value: 1, timescale: 2), queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated { self?.record(time) }
        }
        if let item = player.currentItem { watch(item) }
    }

    deinit {
        if let failureObserver { NotificationCenter.default.removeObserver(failureObserver) }
        // Сам плеер уже уходит (наблюдатель живёт в нём), снимать периодический наблюдатель
        // не с кого.
    }

    /// Запуск с экрана. Упавший ролик пересоздаётся сразу: нажатие — тоже повтор.
    func play() {
        wantsPlayback = true
        wasPlaying = true
        if player?.currentItem?.status == .failed, retry == nil {
            attempt = 0
            schedule(after: .zero, failure: .network)
        }
        player?.play()
    }

    /// Пауза с экрана или уход: отложенный повтор не запустит ролик на невидимом экране.
    func pause() {
        wantsPlayback = false
        retry?.cancel()
        retry = nil
        player?.pause()
    }

    // MARK: - Внутреннее

    private func record(_ time: CMTime) {
        guard let player, let item = player.currentItem, item.status == .readyToPlay, pendingSeek == nil else { return }
        position = time
        wasPlaying = player.timeControlStatus != .paused
    }

    private func watch(_ item: AVPlayerItem) {
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in self?.statusChanged(item) }
        }
        if let failureObserver { NotificationCenter.default.removeObserver(failureObserver) }
        // Обрыв посреди показа: item может остаться `.readyToPlay`, а показ — встать.
        failureObserver = NotificationCenter.default.addObserver(
            forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main
        ) { [weak self] notification in
            let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
            MainActor.assumeIsolated { self?.failed(item, error: error) }
        }
    }

    private func statusChanged(_ item: AVPlayerItem) {
        guard item === player?.currentItem else { return }
        switch item.status {
        case .readyToPlay:
            attempt = 0
            if let target = pendingSeek {
                // Позиция пишется снова только после перемотки: иначе первый тик нового
                // item записал бы ноль, и следующий сбой вернул бы ролик в начало.
                item.seek(to: target, toleranceBefore: .zero, toleranceAfter: .positiveInfinity) { [weak self] _ in
                    Task { @MainActor in self?.pendingSeek = nil }
                }
            }
        case .failed:
            failed(item, error: item.error)
        default:
            break
        }
    }

    private func failed(_ item: AVPlayerItem, error: Error?) {
        guard item === player?.currentItem, retry == nil, wantsPlayback else { return }
        let status = item.errorLog()?.events.last?.errorStatusCode
        let failure = Self.classify(error, httpStatus: status)
        guard failure != .content, attempt < Self.delays.count else { return }
        let delay = Self.delays[attempt]
        attempt += 1
        schedule(after: delay, failure: failure)
    }

    private func schedule(after delay: Duration, failure: Failure) {
        let resign = failure == .expiredLink ? resign : nil
        retry = Task { [weak self] in
            if delay > .zero { try? await Task.sleep(for: delay) }
            let fresh = await resign?()
            guard !Task.isCancelled else { return }
            self?.reload(with: fresh)
        }
    }

    private func reload(with fresh: URL?) {
        retry = nil
        guard let player, wantsPlayback,
              let url = fresh ?? (player.currentItem?.asset as? AVURLAsset)?.url
        else { return }
        let item = AVPlayerItem(url: url)
        pendingSeek = position > .zero ? position : nil
        watch(item)
        player.replaceCurrentItem(with: item)
        if wasPlaying || player.rate > 0 { player.play() }
    }

    /// Что за сбой: по коду HTTP из журнала ошибок item и по цепочке `NSError`.
    nonisolated static func classify(_ error: Error?, httpStatus: Int?) -> Failure {
        switch httpStatus {
        case 401, 403: return .expiredLink
        case 404, 410: return .content
        default: break
        }
        var current = error.map { $0 as NSError }
        while let error = current {
            if error.domain == AVFoundationErrorDomain, contentCodes.contains(error.code) { return .content }
            if error.domain == "CoreMediaErrorDomain" {
                // −12660 — HTTP 403 у загрузчика HLS; −12938 — HTTP 404; −12642 — плейлист
                // не разбирается.
                if error.code == -12660 { return .expiredLink }
                if error.code == -12938 || error.code == -12642 { return .content }
            }
            current = error.userInfo[NSUnderlyingErrorKey] as? NSError
        }
        return .network
    }

    /// Ошибки содержимого AVFoundation: файл не того формата, нет декодера, не разбирается.
    private nonisolated static let contentCodes: Set<Int> = [
        AVError.Code.fileFormatNotRecognized.rawValue,
        AVError.Code.failedToParse.rawValue,
        AVError.Code.decoderNotFound.rawValue,
        AVError.Code.decodeFailed.rawValue,
        AVError.Code.formatUnsupported.rawValue,
        AVError.Code.contentIsNotAuthorized.rawValue,
    ]
}

extension VideoRecovery {
    /// Свежая ссылка на ролик поста.
    static func post(_ postID: String, fileID: String) -> Resign {
        VideoResign { try? await FeedAPI().media(postID: postID, fileID: fileID).playbackURL }
    }

    /// Свежая ссылка на вложение чата: прежняя сбрасывается из кэша, иначе вернулась бы она же.
    static func chatAttachment(_ fileID: String) -> Resign {
        VideoResign {
            let urls = AppServices.attachmentURLs
            await urls.invalidate(fileID)
            guard let media = try? await urls.media(for: fileID) else { return nil }
            return media.hls.flatMap(URL.apiRooted) ?? media.url
        }
    }
}

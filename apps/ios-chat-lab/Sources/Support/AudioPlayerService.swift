import AVFoundation
import UIKit

extension Notification.Name {
    /// Изменилось состояние проигрывания голосового (`object` — `MessageID?`).
    static let audioPlaybackChanged = Notification.Name("ChatLab.audioPlaybackChanged")
}

/// Проигрывание голосовых: одно за раз, прогресс — по display link, по окончании —
/// следующее голосовое в ленте (как в Telegram).
@MainActor
final class AudioPlayerService: NSObject, AVAudioPlayerDelegate {
    static let shared = AudioPlayerService()

    private(set) var currentId: MessageID?
    private var player: AVAudioPlayer?
    private var displayLink: CADisplayLink?
    /// Скорость 1× / 1.5× / 2× (кнопка на панели проигрывания).
    private(set) var rate: Float = 1

    var isPlaying: Bool { player?.isPlaying ?? false }

    var progress: Double {
        guard let player, player.duration > 0 else { return 0 }
        return player.currentTime / player.duration
    }

    var currentTime: TimeInterval { player?.currentTime ?? 0 }

    func isPlaying(_ id: MessageID) -> Bool { currentId == id && isPlaying }

    func progress(for id: MessageID) -> Double { currentId == id ? progress : 0 }

    func toggle(messageId: MessageID, file: String) {
        if currentId == messageId, let player {
            if player.isPlaying { pause() } else { resume() }
            return
        }
        play(messageId: messageId, file: file)
    }

    func play(messageId: MessageID, file: String) {
        stop(notify: false)
        let url = MediaStorage.url(for: file)
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            let player = try AVAudioPlayer(contentsOf: url)
            player.delegate = self
            player.enableRate = true
            player.rate = rate
            player.prepareToPlay()
            player.play()
            self.player = player
            currentId = messageId
            ChatStore.shared.markConsumed(messageId)
            startDisplayLink()
        } catch {
            NSLog("ChatLab: не удалось проиграть \(file): \(error)")
            currentId = nil
        }
        notify()
    }

    func pause() {
        player?.pause()
        stopDisplayLink()
        notify()
    }

    func resume() {
        player?.play()
        startDisplayLink()
        notify()
    }

    func seek(to fraction: Double) {
        guard let player else { return }
        player.currentTime = max(0, min(1, fraction)) * player.duration
        notify()
    }

    func cycleRate() {
        rate = rate == 1 ? 1.5 : (rate == 1.5 ? 2 : 1)
        player?.rate = rate
        notify()
    }

    func stop(notify shouldNotify: Bool = true) {
        player?.stop()
        player = nil
        currentId = nil
        stopDisplayLink()
        if shouldNotify { notify() }
    }

    private func startDisplayLink() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 15, maximum: 30, preferred: 30)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func stopDisplayLink() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func tick() { notify() }

    private func notify() {
        NotificationCenter.default.post(name: .audioPlaybackChanged, object: currentId)
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        MainActor.assumeIsolated {
            let finished = currentId
            stop()
            // Следующее голосовое после законченного — играет само.
            guard let finished, let index = ChatStore.shared.index(of: finished) else { return }
            let messages = ChatStore.shared.messages
            if index + 1 < messages.count, case let .voice(media) = messages[index + 1].kind {
                play(messageId: messages[index + 1].id, file: media.file)
            }
        }
    }
}

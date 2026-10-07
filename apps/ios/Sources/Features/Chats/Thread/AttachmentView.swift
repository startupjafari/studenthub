import AVFoundation
import Observation
import SwiftUI

/// Вложения в пузыре.
///
/// Вид выводится из mime и имени, как на сервере: отдельного типа сообщения в
/// модели нет. Картинка берётся с диска, если файл уже здесь, и только иначе —
/// по подписанной ссылке.
struct AttachmentView: View {
    let attachment: AttachmentRecord
    let isOwn: Bool

    var body: some View {
        if attachment.isVoice {
            VoiceAttachmentView(attachment: attachment, isOwn: isOwn)
        } else if attachment.isImage {
            ImageAttachmentView(attachment: attachment)
        } else {
            FileAttachmentView(attachment: attachment, isOwn: isOwn)
        }
    }
}

private struct ImageAttachmentView: View {
    let attachment: AttachmentRecord

    @State private var remoteURL: URL?

    var body: some View {
        Group {
            if let local = attachment.localPath, let image = UIImage(contentsOfFile: local) {
                Image(uiImage: image).resizable().scaledToFill()
            } else if let remoteURL {
                AsyncImage(url: remoteURL) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        placeholder(systemImage: "photo")
                    default:
                        placeholder(systemImage: "photo")
                    }
                }
            } else {
                placeholder(systemImage: "photo")
            }
        }
        .frame(maxWidth: 240)
        .frame(height: 180)
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        .task {
            guard attachment.localPath == nil, remoteURL == nil else { return }
            remoteURL = await AppServices.attachmentURLs.url(for: attachment.id)
        }
        .accessibilityLabel(Text(String(localized: "chats.photo", defaultValue: "Фотография")))
    }

    private func placeholder(systemImage: String) -> some View {
        ZStack {
            Rectangle().fill(Palette.muted)
            Image(systemName: systemImage).foregroundStyle(Palette.mutedForeground)
        }
    }
}

private struct FileAttachmentView: View {
    let attachment: AttachmentRecord
    let isOwn: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "doc.fill")
                .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.primary)
            VStack(alignment: .leading, spacing: 0) {
                Text(attachment.name ?? String(localized: "chats.file", defaultValue: "Файл"))
                    .font(Typography.body)
                    .lineLimit(1)
                    .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
                if let size = attachment.size {
                    Text(verbatim: ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                        .font(Typography.meta)
                        .foregroundStyle(isOwn ? Palette.primaryForeground.opacity(0.8) : Palette.mutedForeground)
                }
            }
        }
        .padding(.vertical, Spacing.xs)
    }
}

/// Голосовое: кнопка и полоса прогресса.
///
/// Волны у входящих пока нет: её значения сервер не хранит, а считать их нужно
/// декодированием файла — отдельная работа. Своя запись показывает настоящую волну
/// в момент записи (`VoiceRecorder`).
private struct VoiceAttachmentView: View {
    let attachment: AttachmentRecord
    let isOwn: Bool

    @State private var player = VoicePlayer()
    @State private var remoteURL: URL?

    var body: some View {
        HStack(spacing: Spacing.md) {
            Button {
                Task { await toggle() }
            } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .foregroundStyle(isOwn ? Palette.primary : Palette.primaryForeground)
                    .frame(width: ControlHeight.md, height: ControlHeight.md)
                    .background(isOwn ? Palette.primaryForeground : Palette.primary, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(player.isPlaying
                ? String(localized: "chats.voice.pause", defaultValue: "Пауза")
                : String(localized: "chats.voice.play", defaultValue: "Слушать")))

            VStack(alignment: .leading, spacing: Spacing.xs) {
                ProgressView(value: player.progress)
                    .tint(isOwn ? Palette.primaryForeground : Palette.primary)
                Text(verbatim: player.caption)
                    .font(Typography.tabular(Typography.meta))
                    .foregroundStyle(isOwn ? Palette.primaryForeground.opacity(0.8) : Palette.mutedForeground)
            }
            .frame(width: 160)
        }
        .padding(.vertical, Spacing.xs)
    }

    private func toggle() async {
        if player.isPlaying {
            player.pause()
            return
        }
        if let local = attachment.localPath {
            player.play(url: URL(fileURLWithPath: local))
            return
        }
        if remoteURL == nil {
            remoteURL = await AppServices.attachmentURLs.url(for: attachment.id)
        }
        if let remoteURL {
            player.play(url: remoteURL)
        }
    }
}

/// Проигрыватель одного голосового.
@Observable
final class VoicePlayer {
    private(set) var isPlaying = false
    private(set) var progress: Double = 0
    private(set) var caption = "0:00"

    private var player: AVPlayer?
    private var ticker: Task<Void, Never>?

    deinit {
        ticker?.cancel()
    }

    @MainActor
    func play(url: URL) {
        if player == nil {
            player = AVPlayer(url: url)
        }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        player?.play()
        isPlaying = true
        startTicking()
    }

    @MainActor
    func pause() {
        player?.pause()
        isPlaying = false
        ticker?.cancel()
    }

    @MainActor
    private func startTicking() {
        ticker?.cancel()
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled, let player = self?.player {
                let current = player.currentTime().seconds
                let total = player.currentItem?.duration.seconds ?? 0
                if total.isFinite, total > 0 {
                    self?.progress = min(1, current / total)
                }
                self?.caption = VoicePlayer.time(current)
                if total.isFinite, total > 0, current >= total - 0.05 {
                    self?.isPlaying = false
                    self?.progress = 0
                    await player.seek(to: .zero)
                    return
                }
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
    }

    private static func time(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let whole = Int(seconds)
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }
}

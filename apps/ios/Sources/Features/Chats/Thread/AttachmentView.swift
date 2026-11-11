import AVFoundation
import Observation
import SwiftUI

/// Вложения в пузыре.
///
/// Вид выводится из mime, имени и флага «как файл», как в вебе: отдельного типа
/// сообщения в модели нет. Картинка, отправленная «как файл», — строка файла, а не
/// превью. Картинка берётся с диска, если файл уже здесь, и только иначе — по
/// подписанной ссылке.
struct AttachmentView: View {
    let attachment: AttachmentRecord
    let isOwn: Bool
    /// Своё вложение ещё грузится: кольцо прогресса с крестиком отмены.
    var upload: AttachmentUploadState?
    /// Открыть во весь экран: фото, документ, видео — системным просмотром.
    var open: () -> Void = {}

    var body: some View {
        if attachment.isVoice {
            VoiceAttachmentView(attachment: attachment, isOwn: isOwn)
        } else if attachment.showsAsPhoto {
            ImageAttachmentView(attachment: attachment, upload: upload, open: open)
        } else {
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

/// Фото в пузыре. Свой файл на диске и чужой по ссылке идут одной дорогой — через кэш
/// картинок с уменьшением под размер пузыря: полный кадр камеры (12 Мп) ради рамки
/// 240 pt занимал бы 50 МБ памяти, и не на главном потоке.
private struct ImageAttachmentView: View {
    let attachment: AttachmentRecord
    let upload: AttachmentUploadState?
    let open: () -> Void

    @State private var remoteURL: URL?
    /// Спойлер открыт касанием — дальше снимок открывается как обычно.
    @State private var revealed = false
    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let width: CGFloat = 240

    private var isHidden: Bool { attachment.spoiler && !revealed }

    private var localURL: URL? {
        guard let path = attachment.localPath, FileManager.default.fileExists(atPath: path) else { return nil }
        return URL(filePath: path)
    }

    var body: some View {
        let url = localURL ?? remoteURL
        RemoteImage(
            url: url,
            cacheKey: "att:\(attachment.id)",
            placeholder: attachment.placeholder,
            maxPixelSize: Self.width * displayScale
        )
        // Ссылка приезжает позже первого показа — картинка должна её заметить.
        .id(url)
        .frame(maxWidth: Self.width)
        .frame(height: 180)
        // Спойлер — размыт до первого касания, как в вебе и Telegram.
        .blur(radius: isHidden ? 24 : 0)
        .overlay {
            if isHidden {
                Label(String(localized: "chats.spoiler", defaultValue: "Спойлер"), systemImage: "eye.slash")
                    .font(Typography.meta.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
                    .background(.black.opacity(0.4), in: Capsule())
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        .contentShape(RoundedRectangle(cornerRadius: Radius.lg))
        .overlay {
            if let upload {
                UploadRing(fraction: upload.fraction, cancel: upload.cancel)
            }
        }
        .onTapGesture {
            if isHidden {
                withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) { revealed = true }
            } else {
                open()
            }
        }
        .task {
            guard localURL == nil, remoteURL == nil else { return }
            remoteURL = await AppServices.attachmentURLs.url(for: attachment.id)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(String(localized: "chats.photo", defaultValue: "Фотография")))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(.default, open)
    }
}

private struct FileAttachmentView: View {
    let attachment: AttachmentRecord
    let isOwn: Bool
    let upload: AttachmentUploadState?
    let open: () -> Void

    var body: some View {
        // Пока файл грузится, вместо значка — кольцо с крестиком (как в Telegram), а
        // строка не открывается: отдельной кнопкой внутри кнопки касания путались бы.
        if let upload {
            HStack(spacing: Spacing.md) {
                UploadRing(
                    fraction: upload.fraction,
                    tint: isOwn ? Palette.primaryForeground : Palette.primary,
                    backdrop: nil,
                    diameter: ControlHeight.md,
                    cancel: upload.cancel
                )
                caption
            }
            .padding(.vertical, Spacing.xs)
        } else {
            Button(action: open) {
                HStack(spacing: Spacing.md) {
                    Image(systemName: symbol)
                        .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.primary)
                    caption
                }
                .padding(.vertical, Spacing.xs)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private var caption: some View {
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

    private var symbol: String {
        if attachment.mime.hasPrefix("video/") { return "play.rectangle.fill" }
        if attachment.isImage { return "photo.fill" }
        return "doc.fill"
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

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

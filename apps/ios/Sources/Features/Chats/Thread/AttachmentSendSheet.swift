import AVFoundation
import ImageIO
import Observation
import Photos
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Файл, выбранный к отправке. Уже лежит копией в каталоге исходящих: оттуда его
/// покажет лента до загрузки и возьмёт «Повторить» после сбоя.
struct StagedAttachment: Identifiable {
    let id = UUID()
    let file: URL
    let mime: String
    let name: String
    let size: Int
    let preview: UIImage?
    var width: Int?
    var height: Int?
    var spoiler = false

    var isVideo: Bool { mime.hasPrefix("video/") }
    var isMedia: Bool { mime.hasPrefix("image/") || isVideo }
}

/// Подготовка выбранного к отправке: всё кладётся в каталог исходящих.
///
/// Снимок из галереи и с камеры переводится в JPEG, ролик — в MP4 (сервер HEIC и MOV не
/// берёт), файл из «Файлов» копируется как есть. Копия — потоком с диска на диск: крупный
/// документ в память не читается.
enum AttachmentStaging {
    enum Failure: LocalizedError {
        case tooLarge(name: String, limit: Int)

        var errorDescription: String? {
            switch self {
            case .tooLarge(let name, let limit):
                let size = ByteCountFormatter.string(fromByteCount: Int64(limit), countStyle: .file)
                return String(
                    localized: "chats.attach.tooLarge",
                    defaultValue: "Файл «\(name)» больше \(size) — такой не отправить"
                )
            }
        }
    }

    /// Предел файла — `FILE_UPLOAD.MAX_BYTES` сервера: 25 МБ у аудио, 500 МБ у видео,
    /// документов и архивов. Отсекаем при выборе, а не после получасовой заливки.
    /// Снимки из галереи и с камеры сжимаются, их предел здесь не проверяем.
    static func limit(for mime: String) -> Int {
        mime.hasPrefix("audio/") ? 25 * 1024 * 1024 : 500 * 1024 * 1024
    }

    static func stage(_ item: PhotosPickerItem) async throws -> StagedAttachment {
        if let movie = try await MediaPreparation.movieFile(from: item) {
            defer { try? FileManager.default.removeItem(at: movie) }
            let output = AttachmentUploader.outboxURL(forName: "video.mp4")
            try await MediaPreparation.exportMP4(from: movie, to: output)
            let size = fileSize(output)
            guard size <= limit(for: "video/mp4") else {
                try? FileManager.default.removeItem(at: output)
                throw Failure.tooLarge(name: "video.mp4", limit: limit(for: "video/mp4"))
            }
            return StagedAttachment(
                file: output,
                mime: "video/mp4",
                name: "video.mp4",
                size: size,
                preview: MediaPreparation.thumbnail(ofVideoAt: output)
            )
        }
        guard let data = try await item.loadTransferable(type: Data.self) else {
            throw MediaPreparation.Failure.unreadable
        }
        return try keep(MediaPreparation.prepareImage(data))
    }

    /// Снимок или ролик из сетки недавних «Фото». Ролик перекодируется в MP4 (сервер MOV
    /// не берёт), GIF уходит как есть — иначе анимация превратилась бы в один кадр.
    static func stage(_ asset: PHAsset, highQuality: Bool = false) async throws -> StagedAttachment {
        if asset.mediaType == .video {
            let source = try await PhotoAssets.movieFile(for: asset)
            defer { try? FileManager.default.removeItem(at: source) }
            let output = AttachmentUploader.outboxURL(forName: "video.mp4")
            try await MediaPreparation.exportMP4(from: source, to: output)
            let size = fileSize(output)
            guard size <= limit(for: "video/mp4") else {
                try? FileManager.default.removeItem(at: output)
                throw Failure.tooLarge(name: "video.mp4", limit: limit(for: "video/mp4"))
            }
            return StagedAttachment(
                file: output,
                mime: "video/mp4",
                name: "video.mp4",
                size: size,
                preview: MediaPreparation.thumbnail(ofVideoAt: output),
                width: asset.pixelWidth,
                height: asset.pixelHeight
            )
        }
        let (data, uti) = try await PhotoAssets.imageData(for: asset)
        if uti == UTType.gif.identifier {
            let url = AttachmentUploader.outboxURL(forName: "animation.gif")
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            let source = CGImageSourceCreateWithData(data as CFData, nil)
            return StagedAttachment(
                file: url,
                mime: "image/gif",
                name: "animation.gif",
                size: data.count,
                preview: source.flatMap(thumbnail(of:)),
                width: asset.pixelWidth,
                height: asset.pixelHeight
            )
        }
        return try keep(MediaPreparation.prepareImage(data, highQuality: highQuality))
    }

    /// Снимок камеры.
    static func stage(_ image: UIImage) async throws -> StagedAttachment {
        try keep(MediaPreparation.prepareImage(image))
    }

    /// Файл из «Файлов» (`fileImporter`).
    static func stage(fileAt url: URL) async throws -> StagedAttachment {
        // Чужой каталог открывается только так; свой (песочница приложения) читается и
        // без разрешения — тогда вызов вернёт `false`, и это не ошибка.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        let name = url.lastPathComponent
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let size = fileSize(url)
        guard size <= limit(for: mime) else { throw Failure.tooLarge(name: name, limit: limit(for: mime)) }

        let copy = AttachmentUploader.outboxURL(forName: name)
        try FileManager.default.copyItem(at: url, to: copy)

        var staged = StagedAttachment(file: copy, mime: mime, name: name, size: size, preview: nil)
        if mime.hasPrefix("image/"), let source = CGImageSourceCreateWithURL(copy as CFURL, nil) {
            let pixels = pixelSize(of: source)
            staged = StagedAttachment(
                file: copy,
                mime: mime,
                name: name,
                size: size,
                preview: thumbnail(of: source),
                width: pixels?.width,
                height: pixels?.height
            )
        } else if mime.hasPrefix("video/") {
            staged = StagedAttachment(
                file: copy,
                mime: mime,
                name: name,
                size: size,
                preview: MediaPreparation.thumbnail(ofVideoAt: copy)
            )
        }
        return staged
    }

    /// Убрать копии невыбранного: отправку отменили или файл убрали из листа.
    static func discard(_ items: [StagedAttachment]) {
        for item in items {
            try? FileManager.default.removeItem(at: item.file)
        }
    }

    // MARK: - Внутреннее

    private static func keep(_ prepared: PreparedMedia) throws -> StagedAttachment {
        let url = AttachmentUploader.outboxURL(forName: prepared.filename)
        try prepared.data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        let source = CGImageSourceCreateWithData(prepared.data as CFData, nil)
        let pixels = source.flatMap(pixelSize(of:))
        return StagedAttachment(
            file: url,
            mime: prepared.mime,
            name: prepared.filename,
            size: prepared.data.count,
            preview: prepared.preview,
            width: pixels?.width,
            height: pixels?.height
        )
    }

    private static func fileSize(_ url: URL) -> Int {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
    }

    /// Размер кадра из заголовка файла — без раскодирования картинки.
    private static func pixelSize(of source: CGImageSource) -> (width: Int, height: Int)? {
        guard
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int
        else { return nil }
        return (width, height)
    }

    /// Миниатюра для листа: полный кадр в 12 Мп ради плитки в 80 pt не раскодируем.
    private static func thumbnail(of source: CGImageSource) -> UIImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 300,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary).map(UIImage.init(cgImage:))
    }
}

/// Что собираются отправить: выбранные файлы, подпись и способ отправки. Живёт, пока
/// открыт лист; закрыли без отправки — копии файлов убираются.
@MainActor
@Observable
final class AttachmentDraft: Identifiable {
    let id = UUID()
    private(set) var items: [StagedAttachment] = []
    var caption: String
    /// «Отправить как файл»: получатель видит строки файлов, а не превью (§9).
    var asFiles = false
    /// Сколько выбранного ещё готовится (перекодирование ролика занимает секунды).
    private(set) var preparing = 0
    var failure: String?
    /// Отправлено — копии файлов теперь принадлежат загрузчику.
    var isSent = false
    /// Лист закрыт без отправки.
    var isClosed = false

    init(caption: String) {
        self.caption = caption
    }

    /// Документы и так уходят файлами: для них переключатели способа отправки не значат
    /// ничего, и показывать заведомо неработающие пункты нечестно (как в вебе).
    var hasMedia: Bool { items.contains(where: \.isMedia) }
    var showsAsFiles: Bool { asFiles || !hasMedia }
    var canSend: Bool { !items.isEmpty && preparing == 0 }

    var allSpoilered: Bool {
        let media = items.filter(\.isMedia)
        return !media.isEmpty && media.allSatisfy(\.spoiler)
    }

    func setSpoilerAll(_ on: Bool) {
        for index in items.indices where items[index].isMedia {
            items[index].spoiler = on
        }
    }

    func toggleSpoiler(_ id: StagedAttachment.ID) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].spoiler.toggle()
    }

    func remove(_ id: StagedAttachment.ID) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        AttachmentStaging.discard([items.remove(at: index)])
    }

    func discardAll() {
        AttachmentStaging.discard(items)
        items = []
    }

    func add(photos: [PhotosPickerItem]) async {
        await add(photos.count) { index in try await AttachmentStaging.stage(photos[index]) }
    }

    func add(assets: [PHAsset], highQuality: Bool = false) async {
        await add(assets.count) { index in try await AttachmentStaging.stage(assets[index], highQuality: highQuality) }
    }

    func add(files: [URL]) async {
        await add(files.count) { index in try await AttachmentStaging.stage(fileAt: files[index]) }
    }

    func add(image: UIImage) async {
        await add(1) { _ in try await AttachmentStaging.stage(image) }
    }

    /// Порядок в листе — порядок выбора: готовятся по очереди, и быстрый снимок не
    /// обгоняет перекодируемый перед ним ролик.
    private func add(_ count: Int, stage: (Int) async throws -> StagedAttachment) async {
        preparing += count
        for index in 0..<count {
            do {
                let staged = try await stage(index)
                // Лист закрыли, пока файл готовился, — копия больше не нужна.
                if isSent || isClosed {
                    AttachmentStaging.discard([staged])
                } else {
                    items.append(staged)
                }
            } catch {
                failure = error.userMessage
            }
            preparing -= 1
        }
    }

    /// Файлы, как они уйдут: спойлер — только у снимков и роликов и не «как файл».
    var outgoing: [OutgoingAttachment] {
        items.map { item in
            OutgoingAttachment(
                data: nil,
                mime: item.mime,
                name: item.name,
                width: item.width,
                height: item.height,
                cachedPath: item.file.path,
                spoiler: item.spoiler && item.isMedia && !showsAsFiles
            )
        }
    }

    /// Сколько сообщений уйдёт: альбомы по десять, документы — своей пачкой.
    var messageCount: Int {
        ChatThreadModel.batches(of: outgoing, asFiles: showsAsFiles).count
    }
}

/// Лист отправки вложений, как в Telegram и диалоге отправки веба: миниатюры выбранного,
/// удаление отдельных, спойлер, «как файл», подпись и «Отправить».
struct AttachmentSendSheet: View {
    @Bindable var draft: AttachmentDraft
    let onSend: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var more: [PhotosPickerItem] = []
    /// Окно «Фото» открывает лист, а не строка формы: строка перерисовывается, пока окно
    /// открыто, и оно зависало на «Загрузке».
    @State private var pickingMore = false

    private var media: [StagedAttachment] { draft.items.filter(\.isMedia) }
    private var rows: [StagedAttachment] { draft.showsAsFiles ? draft.items : draft.items.filter { !$0.isMedia } }

    var body: some View {
        NavigationStack {
            Form {
                if !draft.showsAsFiles, !media.isEmpty {
                    Section {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Spacing.md) {
                                ForEach(media) { item in
                                    MediaTile(
                                        item: item,
                                        onRemove: { draft.remove(item.id) },
                                        onToggleSpoiler: { draft.toggleSpoiler(item.id) }
                                    )
                                }
                            }
                            .padding(.vertical, Spacing.xs)
                        }
                        .listRowInsets(EdgeInsets(top: Spacing.md, leading: Spacing.lg, bottom: Spacing.md, trailing: Spacing.lg))
                    }
                }

                if !rows.isEmpty {
                    Section {
                        ForEach(rows) { item in
                            FileRow(item: item) { draft.remove(item.id) }
                        }
                    }
                }

                Section {
                    if draft.preparing > 0 {
                        HStack(spacing: Spacing.md) {
                            ProgressView()
                            Text(String(localized: "chats.attach.preparing", defaultValue: "Подготовка файлов…"))
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                    Button {
                        pickingMore = true
                    } label: {
                        Label(
                            String(localized: "chats.attach.addMore", defaultValue: "Добавить фото или видео"),
                            systemImage: "plus"
                        )
                    }
                }

                if draft.hasMedia {
                    Section {
                        if !draft.asFiles {
                            Toggle(
                                String(localized: "chats.attach.spoiler", defaultValue: "Скрыть под спойлер"),
                                isOn: Binding(get: { draft.allSpoilered }, set: { draft.setSpoilerAll($0) })
                            )
                        }
                        Toggle(
                            String(localized: "chats.attach.asFiles", defaultValue: "Отправить как файл"),
                            isOn: $draft.asFiles
                        )
                    } footer: {
                        Text(draft.asFiles
                            ? String(localized: "chats.attach.asFilesHint", defaultValue: "Без сжатия: собеседник увидит файлы, а не превью.")
                            : String(localized: "chats.attach.spoilerHint", defaultValue: "Спойлер можно поставить и на отдельный снимок — значком глаза на миниатюре."))
                    }
                }

                if draft.messageCount > 1 {
                    Section {
                        Text(ChatPlural.messagesToSend(draft.messageCount))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                captionBar
            }
            .alert(
                String(localized: "feed.actionFailed", defaultValue: "Не получилось"),
                isPresented: Binding(get: { draft.failure != nil }, set: { if !$0 { draft.failure = nil } })
            ) {
                Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
            } message: {
                Text(draft.failure ?? "")
            }
        }
        .photosPicker(
            isPresented: $pickingMore,
            selection: $more,
            maxSelectionCount: AttachmentUploader.albumLimit,
            matching: .any(of: [.images, .videos])
        )
        .onChange(of: more) {
            let picked = more
            guard !picked.isEmpty else { return }
            more = []
            Task { await draft.add(photos: picked) }
        }
        // Убрали всё — отправлять нечего, лист закрывается сам.
        .onChange(of: draft.items.isEmpty) { _, empty in
            if empty, draft.preparing == 0 { dismiss() }
        }
    }

    /// Заголовок называет, что именно уходит: «Отправить как файл» над тремя снимками
    /// обещало бы не то, что произойдёт.
    private var title: String {
        if draft.showsAsFiles { return ChatPlural.sendFiles(draft.items.count) }
        let number = media.count.formatted()
        if media.allSatisfy(\.isVideo) {
            return String(localized: "chats.attach.sendVideos", defaultValue: "Отправить \(number) видео")
        }
        return String(localized: "chats.attach.sendPhotos", defaultValue: "Отправить \(number) фото")
    }

    private var captionBar: some View {
        HStack(alignment: .bottom, spacing: Spacing.md) {
            TextField(
                text: $draft.caption,
                prompt: Text(verbatim: String(localized: "chats.attach.caption", defaultValue: "Подпись")),
                axis: .vertical
            ) {
                Text(verbatim: String(localized: "chats.attach.caption", defaultValue: "Подпись"))
            }
            .labelsHidden()
            .lineLimit(1...5)
            .font(Typography.body)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
            .frame(minHeight: ControlHeight.lg)
            .glassSurface(in: RoundedRectangle(cornerRadius: ControlHeight.lg / 2, style: .continuous))

            Button(action: onSend) {
                Image(systemName: "arrow.up")
                    .font(Typography.body.weight(.bold))
                    .foregroundStyle(Palette.primaryForeground)
                    .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                    .glassSurface(tint: Palette.primary, in: Circle())
            }
            .buttonStyle(.pressableIcon)
            .disabled(!draft.canSend)
            .opacity(draft.canSend ? 1 : 0.4)
            .accessibilityLabel(Text(String(localized: "chats.send", defaultValue: "Отправить")))
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
    }
}

/// Миниатюра снимка или ролика: крестик — убрать, глаз — спрятать под спойлер. Скрытый
/// снимок размыт и здесь: видно, что получит собеседник.
private struct MediaTile: View {
    let item: StagedAttachment
    let onRemove: () -> Void
    let onToggleSpoiler: () -> Void

    private static let side: CGFloat = 96

    var body: some View {
        ZStack {
            Palette.muted
            if let preview = item.preview {
                Image(uiImage: preview)
                    .resizable()
                    .scaledToFill()
                    .frame(width: Self.side, height: Self.side)
                    .clipped()
                    .blur(radius: item.spoiler ? 12 : 0)
            }
            if item.isVideo {
                Image(systemName: "play.fill")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: ControlHeight.sm, height: ControlHeight.sm)
                    .background(Palette.overlay.opacity(0.5), in: Circle())
                    .accessibilityHidden(true)
            }
        }
        .frame(width: Self.side, height: Self.side)
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay(alignment: .topTrailing) {
            tileButton(
                symbol: "xmark",
                label: String(localized: "chats.attach.remove", defaultValue: "Убрать"),
                action: onRemove
            )
        }
        .overlay(alignment: .bottomTrailing) {
            tileButton(
                symbol: item.spoiler ? "eye.slash.fill" : "eye",
                label: item.spoiler
                    ? String(localized: "chats.attach.spoilerOff", defaultValue: "Показать без спойлера")
                    : String(localized: "chats.attach.spoilerOn", defaultValue: "Скрыть под спойлер"),
                action: onToggleSpoiler
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(item.isVideo
            ? String(localized: "chats.attach.video", defaultValue: "Видео")
            : String(localized: "chats.photo", defaultValue: "Фотография")))
    }

    private func tileButton(symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Palette.overlay.opacity(0.55), in: Circle())
                // Видимый кружок маленький, а касание — по размеру пальца.
                .frame(width: ControlHeight.sm, height: ControlHeight.sm)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }
}

/// Строка файла: миниатюра или значок, имя, размер, корзина.
private struct FileRow: View {
    let item: StagedAttachment
    let onRemove: () -> Void

    /// Аудио можно прослушать до отправки.
    @State private var player = VoicePreviewPlayer()
    @State private var duration: TimeInterval?

    private var isAudio: Bool { item.mime.hasPrefix("audio/") }

    var body: some View {
        HStack(spacing: Spacing.lg) {
            Group {
                if isAudio {
                    Button {
                        if player.duration == 0 { player.load(item.file, duration: duration ?? 0) }
                        player.toggle()
                    } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .foregroundStyle(Palette.primaryForeground)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Palette.primary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(player.isPlaying
                        ? String(localized: "chats.voice.pause", defaultValue: "Пауза")
                        : String(localized: "chats.voice.play", defaultValue: "Слушать")))
                } else if let preview = item.preview {
                    Image(uiImage: preview)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: item.isVideo ? "play.rectangle.fill" : "doc.fill")
                        .font(.title3)
                        .foregroundStyle(Palette.primary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Palette.muted)
                }
            }
            .frame(width: ControlHeight.lg, height: ControlHeight.lg)
            .clipShape(isAudio ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous)))
            .accessibilityHidden(!isAudio)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.name)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(verbatim: details)
                    .font(Typography.tabular(Typography.meta))
                    .foregroundStyle(Palette.mutedForeground)
                if isAudio, player.isPlaying || player.progress > 0 {
                    ProgressView(value: player.progress)
                        .tint(Palette.primary)
                }
            }
            Spacer(minLength: Spacing.md)
            Button(action: onRemove) {
                Image(systemName: "trash")
                    .foregroundStyle(Palette.destructive)
                    .frame(width: ControlHeight.sm, height: ControlHeight.sm)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "chats.attach.remove", defaultValue: "Убрать")))
        }
        .task(id: item.id) {
            guard isAudio else { return }
            let seconds = try? await AVURLAsset(url: item.file).load(.duration).seconds
            if let seconds, seconds.isFinite { duration = seconds }
        }
        .onDisappear { player.stop() }
    }

    /// «MP3 · 3:24 · 4,1 МБ» — расширение, длительность (у звука) и размер.
    private var details: String {
        var parts: [String] = []
        let ext = item.file.pathExtension.uppercased()
        if !ext.isEmpty { parts.append(ext) }
        if let duration { parts.append(VoiceRecordingStrip.clock(duration).components(separatedBy: ",").first ?? "") }
        parts.append(ByteCountFormatter.string(fromByteCount: Int64(item.size), countStyle: .file))
        return parts.joined(separator: " · ")
    }
}

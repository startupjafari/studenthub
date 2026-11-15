import AVFoundation
import Observation
import SwiftUI

/// Недавние файлы листа вложений: «Недавно отправленные» во вкладке «Файл» и «Ваши
/// чаты» во вкладке «Звук». Поиск по имени — на сервере (по всей истории, а не по
/// загруженному), страницы — по курсору при прокрутке.
@MainActor
@Observable
final class RecentFilesModel {
    let kind: RecentChatFileDTO.Kind
    private(set) var items: [RecentChatFileDTO] = []
    private(set) var isLoading = false
    private(set) var failure: String?
    private(set) var hasMore = false
    /// Файл скачивается для отправки — строка с индикатором, повторное нажатие не качает второй раз.
    private(set) var downloading: String?
    var query = ""

    private var cursor: String?
    private var generation = 0
    private let api: RecentChatFilesFetching

    init(kind: RecentChatFileDTO.Kind, api: RecentChatFilesFetching = ChatsAPI()) {
        self.kind = kind
        self.api = api
    }

    var term: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Первая страница по текущему запросу; ответ на прежний запрос не ляжет поверх нового.
    func reload() async {
        generation += 1
        let mine = generation
        isLoading = true
        failure = nil
        do {
            let page = try await api.recentFiles(kind: kind, query: term.isEmpty ? nil : term, cursor: nil)
            guard mine == generation else { return }
            items = page.items
            cursor = page.meta?.cursor
            hasMore = page.meta?.hasNext ?? false
        } catch is CancellationError {
            return
        } catch {
            guard mine == generation else { return }
            failure = error.userMessage
        }
        if mine == generation { isLoading = false }
    }

    func loadMore() async {
        guard hasMore, !isLoading, let cursor else { return }
        let mine = generation
        isLoading = true
        defer { if mine == generation { isLoading = false } }
        guard let page = try? await api.recentFiles(kind: kind, query: term.isEmpty ? nil : term, cursor: cursor),
              mine == generation
        else { return }
        let known = Set(items.map(\.id))
        items += page.items.filter { !known.contains($0.id) }
        self.cursor = page.meta?.cursor
        hasMore = page.meta?.hasNext ?? false
    }

    /// Скачать файл для повторной отправки — под исходным именем: получатель увидит его
    /// таким же, как в первый раз.
    func download(_ file: RecentChatFileDTO) async -> URL? {
        guard downloading == nil else { return nil }
        downloading = file.id
        defer { downloading = nil }
        do {
            let signed = try await AppServices.attachmentURLs.media(for: file.id)
            let media = PostDTO.Media(id: file.id, url: signed.url.absoluteString, mime: file.mime)
            let fetched = try await MediaDownload.file(for: media)
            guard let name = file.name, !name.isEmpty else { return fetched }
            let folder = FileManager.default.temporaryDirectory.appending(path: "recent-\(file.id)", directoryHint: .isDirectory)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let target = folder.appending(path: name)
            try? FileManager.default.removeItem(at: target)
            try FileManager.default.moveItem(at: fetched, to: target)
            return target
        } catch {
            failure = error.userMessage
            return nil
        }
    }
}

/// Прослушивание трека до отправки: одна дорожка за раз, отправку не вызывает.
@MainActor
@Observable
final class AudioPreviewPlayer {
    private(set) var playingID: String?
    private var player: AVPlayer?
    private var endObserver: NSObjectProtocol?

    func toggle(_ file: RecentChatFileDTO) async {
        if playingID == file.id {
            stop()
            return
        }
        stop()
        guard let signed = try? await AppServices.attachmentURLs.media(for: file.id) else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        let item = AVPlayerItem(url: signed.url)
        let player = AVPlayer(playerItem: item)
        self.player = player
        playingID = file.id
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.stop() }
        }
        player.play()
    }

    func stop() {
        player?.pause()
        player = nil
        playingID = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
    }
}

/// Список недавних файлов с поиском. Нажатие на строку — файл к отправке (через лист
/// отправки с подписью), у аудио кнопка слева — прослушать.
struct RecentFilesList: View {
    @State var model: RecentFilesModel
    let title: String
    let onPick: (URL) -> Void

    @State private var player = AudioPreviewPlayer()

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(title)
                .font(Typography.meta.weight(.semibold))
                .foregroundStyle(Palette.mutedForeground)
                .textCase(.uppercase)
                .padding(.horizontal, Spacing.xl)
                .padding(.top, Spacing.md)
            ExpressionSearchField(
                query: $model.query,
                prompt: String(localized: "chats.attach.recentSearch", defaultValue: "Поиск файлов")
            )
            .accessibilityIdentifier("chat.attach.recent.search")
            if let failure = model.failure, model.items.isEmpty {
                Text(failure)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.destructive)
                    .padding(.horizontal, Spacing.xl)
            } else if model.items.isEmpty, !model.isLoading {
                Text(model.term.isEmpty
                    ? String(localized: "chats.attach.recentEmpty", defaultValue: "Здесь появятся файлы, которые вы отправляли")
                    : String(localized: "services.notFound", defaultValue: "Ничего не нашлось"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .padding(.horizontal, Spacing.xl)
                    .accessibilityIdentifier("chat.attach.recent.empty")
            }
            LazyVStack(spacing: 0) {
                ForEach(model.items) { file in
                    row(file)
                        .onAppear {
                            if file.id == model.items.last?.id { Task { await model.loadMore() } }
                        }
                }
                if model.isLoading {
                    ProgressView().padding(Spacing.lg)
                }
            }
            .background(Palette.secondary, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))
        }
        .task(id: model.term) {
            // Поиск с задержкой: не новый запрос на каждую букву.
            if !model.term.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            await model.reload()
        }
        .onDisappear { player.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.attach.recent.\(model.kind.rawValue)")
    }

    private func row(_ file: RecentChatFileDTO) -> some View {
        HStack(spacing: Spacing.lg) {
            if model.kind == .audio {
                Button {
                    Task { await player.toggle(file) }
                } label: {
                    Image(systemName: player.playingID == file.id ? "pause.fill" : "play.fill")
                        .font(.body.weight(.bold))
                        .foregroundStyle(Palette.primaryForeground)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Palette.primary))
                }
                .buttonStyle(.pressableIcon)
                .accessibilityLabel(Text(player.playingID == file.id
                    ? String(localized: "chats.attach.pause", defaultValue: "Пауза")
                    : String(localized: "chats.attach.play", defaultValue: "Прослушать")))
                .accessibilityIdentifier("chat.attach.recent.play.\(file.id)")
            } else {
                Text(Self.badge(for: file))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Palette.primaryForeground)
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Palette.primary))
                    .accessibilityHidden(true)
            }
            Button {
                Task {
                    if let url = await model.download(file) { onPick(url) }
                }
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.name ?? String(localized: "chats.attach.unnamed", defaultValue: "Файл"))
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                            .lineLimit(1)
                        Text(details(file))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(1)
                    }
                    Spacer()
                    if model.downloading == file.id { ProgressView() }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("chat.attach.recent.row.\(file.id)")
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
    }

    /// «2,4 МБ · 3:05 · 12 нояб.» — размер, длительность у аудио, дата отправки.
    private func details(_ file: RecentChatFileDTO) -> String {
        var parts: [String] = []
        if let size = file.size { parts.append(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)) }
        if let ms = file.durationMs, ms > 0 {
            let seconds = ms / 1000
            parts.append(String(format: "%d:%02d", seconds / 60, seconds % 60))
        }
        parts.append(file.createdAt.formatted(.dateTime.day().month(.abbreviated)))
        return parts.joined(separator: " · ")
    }

    /// Расширение плашкой — TXT, PDF, RAR, как в Telegram.
    static func badge(for file: RecentChatFileDTO) -> String {
        let ext = (file.name as NSString?)?.pathExtension.uppercased() ?? ""
        if !ext.isEmpty { return String(ext.prefix(4)) }
        return file.mime.split(separator: "/").last.map { String($0.prefix(4)).uppercased() } ?? "FILE"
    }
}

import SwiftUI
import UIKit

// MARK: - Модель

/// Общие материалы чата: медиа, файлы, голосовые и ссылки, как вкладки в вебе.
///
/// Каждая вкладка — свой загрузчик с подгрузкой страниц: переключение вкладок не
/// перечитывает уже загруженное, а ответ старой вкладки не попадёт в новую. Здесь же
/// то, что живёт дольше одной строки: общий проигрыватель голосовых (играет одна
/// запись), просмотр медиа, «Поделиться» и открытие файла.
@MainActor
@Observable
final class ChatSharedContent {
    /// Как в вебе: страница в 30 записей.
    static let pageSize = 30

    let media: PagedLoader<ChatMediaItemDTO>
    let files: PagedLoader<ChatMediaItemDTO>
    let voice: PagedLoader<ChatMediaItemDTO>
    let links: PagedLoader<ChatLinkItemDTO>

    /// Один на весь список: запуск другой записи останавливает прежнюю.
    let player = VoicePlayer()
    /// Запись, выбранная в проигрывателе, — играет или стоит на паузе.
    private(set) var playingID: String?
    let opener = RemoteFileOpener()
    var viewer: ChatMediaViewerTarget?
    var sharing: ExportedFile?
    /// Готовим просмотр или файл для «Поделиться» — индикатор поверх экрана.
    private(set) var isPreparing = false
    var failure: String?

    @ObservationIgnored private let urls = AppServices.attachmentURLs

    init(chatID: String, api: ChatActing = ChatsAPI()) {
        media = PagedLoader(limit: Self.pageSize) { try await api.media(chatID: chatID, kind: .media, page: $0) }
        files = PagedLoader(limit: Self.pageSize) { try await api.media(chatID: chatID, kind: .file, page: $0) }
        voice = PagedLoader(limit: Self.pageSize) { try await api.media(chatID: chatID, kind: .voice, page: $0) }
        links = PagedLoader(limit: Self.pageSize) { try await api.links(chatID: chatID, page: $0) }
        player.onFinish = { [weak self] in self?.playNext() }
    }

    func loader(for kind: ChatMediaKind) -> PagedLoader<ChatMediaItemDTO> {
        switch kind {
        case .media: return media
        case .file: return files
        case .voice: return voice
        }
    }

    /// Первая страница вкладки — только при первом заходе на неё.
    func load(_ tab: ChatMediaKindTab) async {
        if let kind = tab.kind {
            await loader(for: kind).loadIfNeeded()
        } else {
            await links.loadIfNeeded()
        }
    }

    // MARK: Медиа

    /// Просмотр на весь экран со всеми загруженными снимками вкладки, начиная с
    /// выбранного. Ссылки подписываются по требованию: те, что видны в сетке, уже в
    /// кэше, остальные просим не все разом — сервер ограничивает частоту запросов.
    func openViewer(_ item: ChatMediaItemDTO) async {
        guard !isPreparing else { return }
        isPreparing = true
        defer { isPreparing = false }
        let urls = self.urls
        let items = media.items
        do {
            // Выбранный — первым и с причиной сбоя: без него просмотр открывать незачем.
            var resolved = [item.id: try await urls.media(for: item.id)]
            var pending = items.map(\.id).filter { $0 != item.id }[...]
            await withTaskGroup(of: (String, AttachmentMedia?).self) { group in
                func next() {
                    guard let id = pending.popFirst() else { return }
                    group.addTask { (id, try? await urls.media(for: id)) }
                }
                for _ in 0..<6 { next() }
                for await (id, value) in group {
                    if let value { resolved[id] = value }
                    next()
                }
            }
            // Снимок, чья ссылка не подписалась, пропускаем: пустая страница в просмотре
            // хуже, чем на одну меньше.
            let shown = items.compactMap { entry in resolved[entry.id].map { entry.viewerMedia($0) } }
            guard let start = shown.firstIndex(where: { $0.id == item.id }) else { return }
            viewer = ChatMediaViewerTarget(media: shown, start: start)
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    // MARK: Файлы

    /// Системным просмотром (PDF, Office, картинки): скачать по свежей ссылке.
    func open(_ item: ChatMediaItemDTO) async {
        let urls = self.urls
        let id = item.id
        await opener.open(name: item.fileName) { try await urls.media(for: id).url }
    }

    /// «Поделиться» — сам файл под его именем, а не ссылка: подписанная живёт минуты.
    func share(_ item: ChatMediaItemDTO) async {
        guard !isPreparing else { return }
        isPreparing = true
        defer { isPreparing = false }
        do {
            let remote = try await urls.media(for: item.id).url
            sharing = ExportedFile(url: try await RemoteFileOpener.download(name: item.fileName, from: remote))
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    // MARK: Голосовые

    /// Касание строки: та же запись — пауза или продолжение, другая — с начала.
    func toggleVoice(_ item: ChatMediaItemDTO) async {
        if playingID == item.id, player.isPlaying {
            player.pause()
            return
        }
        if playingID != item.id {
            player.stop()
            playingID = item.id
        }
        do {
            let url = try await urls.media(for: item.id).url
            // Пока ссылка ехала, могли выбрать другую запись или уйти с вкладки.
            guard playingID == item.id else { return }
            player.play(url: url)
        } catch is CancellationError {
            return
        } catch {
            if playingID == item.id { playingID = nil }
            failure = error.userMessage
        }
    }

    func stopVoice() {
        player.stop()
        playingID = nil
    }

    /// Доиграла — следующая по списку, как в вебе; после последней проигрыватель молчит.
    private func playNext() {
        let items = voice.items
        guard
            let current = playingID,
            let index = items.firstIndex(where: { $0.id == current }),
            items.indices.contains(index + 1)
        else {
            stopVoice()
            return
        }
        let next = items[index + 1]
        Task { await toggleVoice(next) }
    }
}

/// Что открыть в полноэкранном просмотре.
struct ChatMediaViewerTarget: Identifiable {
    let id = UUID()
    let media: [PostDTO.Media]
    let start: Int
}

private extension ChatMediaItemDTO {
    var fileName: String { AttachmentFileName.of(id: id, name: name, mime: mime) }

    /// Тот же вид, что у медиа поста, — для общего просмотра: копии, постер и HLS
    /// из ответа на подпись ссылки.
    func viewerMedia(_ signed: AttachmentMedia) -> PostDTO.Media {
        PostDTO.Media(
            id: id,
            url: signed.url.absoluteString,
            mime: mime,
            width: width,
            height: height,
            placeholder: placeholder,
            durationMs: durationMs,
            sources: signed.sources.isEmpty ? nil : signed.sources,
            poster: signed.poster.isEmpty ? nil : signed.poster,
            hls: signed.hls
        )
    }

    /// «12 окт. · 2,4 МБ · 0:32».
    var detail: String {
        var parts = [createdAt.formatted(date: .abbreviated, time: .omitted)]
        if let size {
            parts.append(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
        }
        if let durationMs {
            parts.append(Duration.milliseconds(durationMs).formatted(.time(pattern: .minuteSecond)))
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Показ

extension View {
    /// Просмотр медиа, «Поделиться», просмотр файла и ошибки действий над материалами.
    func chatSharedContentDialogs(_ shared: ChatSharedContent) -> some View {
        modifier(ChatSharedContentDialogs(shared: shared))
    }
}

private struct ChatSharedContentDialogs: ViewModifier {
    @Bindable var shared: ChatSharedContent

    func body(content: Content) -> some View {
        content
            .remoteFilePreview(shared.opener)
            .fullScreenCover(item: $shared.viewer) { target in
                MediaViewer(media: target.media, start: target.start)
            }
            .sheet(item: $shared.sharing) { file in
                ShareSheet(items: [file.url])
                    .presentationDetents([.medium, .large])
            }
            .actionFailureAlert($shared.failure)
            .overlay {
                if shared.isPreparing {
                    ProgressView()
                        .padding(Spacing.xl)
                        .glassSurface(interactive: false, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                }
            }
    }
}

/// Список выбранной вкладки: сетка фото и видео по три в ряд, строки файлов, голосовых
/// и ссылок. Каждый ряд — отдельная строка `List`: так список остаётся ленивым, и
/// следующая страница просится, когда на экран выходит последний ряд, а не сразу.
struct ChatContentList: View {
    let shared: ChatSharedContent
    let tab: ChatMediaKindTab
    /// Закрыть информацию и открыть переписку на сообщении.
    let showInChat: (String) -> Void

    var body: some View {
        switch tab {
        case .media: mediaGrid
        case .files: fileRows
        case .voice: voiceRows
        case .links: linkRows
        }
    }

    // MARK: Медиа

    @ViewBuilder
    private var mediaGrid: some View {
        let loader = shared.media
        if loader.items.isEmpty {
            placeholder(loader)
        } else {
            ForEach(MediaGridRow.rows(loader.items)) { row in
                HStack(spacing: MediaGridRow.gap) {
                    ForEach(row.items) { item in
                        ChatMediaThumb(item: item)
                            .onTapGesture { Task { await shared.openViewer(item) } }
                            .contextMenu { showInChatButton(item.messageId) }
                            .accessibilityAction { Task { await shared.openViewer(item) } }
                    }
                    // Неполный последний ряд не растягивает плитки на всю ширину.
                    ForEach(row.items.count..<MediaGridRow.columns, id: \.self) { _ in
                        Color.clear.aspectRatio(1, contentMode: .fit)
                    }
                }
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: MediaGridRow.gap, trailing: 0))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .task(id: row.items.last?.id) {
                    if let last = row.items.last { await loader.loadMore(after: last) }
                }
            }
            footer(loader)
        }
    }

    // MARK: Файлы

    @ViewBuilder
    private var fileRows: some View {
        let loader = shared.files
        if loader.items.isEmpty {
            placeholder(loader)
        } else {
            ForEach(loader.items) { item in
                Button {
                    Task { await shared.open(item) }
                } label: {
                    HStack(spacing: Spacing.lg) {
                        IconTile(symbol: Self.fileSymbol(item.mime), size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.name ?? String(localized: "chats.preview.file", defaultValue: "Файл"))
                                .font(Typography.body)
                                .foregroundStyle(Palette.foreground)
                                .lineLimit(1)
                            Text(verbatim: item.detail)
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .contextMenu {
                    Button {
                        Task { await shared.share(item) }
                    } label: {
                        Label(String(localized: "feed.share", defaultValue: "Поделиться"), systemImage: "square.and.arrow.up")
                    }
                    showInChatButton(item.messageId)
                }
                .task { await loader.loadMore(after: item) }
            }
            footer(loader)
        }
    }

    private static func fileSymbol(_ mime: String) -> String {
        if mime == "application/pdf" { return "doc.richtext.fill" }
        if mime.hasPrefix("image/") { return "photo.fill" }
        if mime.hasPrefix("video/") { return "film.fill" }
        if mime.hasPrefix("audio/") { return "music.note" }
        if mime.contains("zip") || mime.contains("compressed") { return "doc.zipper" }
        return "doc.fill"
    }

    // MARK: Голосовые

    @ViewBuilder
    private var voiceRows: some View {
        let loader = shared.voice
        if loader.items.isEmpty {
            placeholder(loader)
        } else {
            ForEach(loader.items) { item in
                ChatVoiceRow(item: item, player: shared.player, isCurrent: shared.playingID == item.id) {
                    Task { await shared.toggleVoice(item) }
                }
                .contextMenu { showInChatButton(item.messageId) }
                .task { await loader.loadMore(after: item) }
            }
            footer(loader)
        }
    }

    // MARK: Ссылки

    @ViewBuilder
    private var linkRows: some View {
        let loader = shared.links
        if loader.items.isEmpty {
            placeholder(loader)
        } else {
            ForEach(loader.items) { link in
                ChatLinkRow(link: link)
                    .contextMenu {
                        if let url = link.url {
                            Button {
                                UIPasteboard.general.url = url
                            } label: {
                                Label(String(localized: "feed.copyLink", defaultValue: "Копировать ссылку"), systemImage: "doc.on.doc")
                            }
                        }
                        showInChatButton(link.messageId)
                    }
                    .task { await loader.loadMore(after: link) }
            }
            footer(loader)
        }
    }

    // MARK: Общее

    private func showInChatButton(_ messageID: String) -> some View {
        Button {
            showInChat(messageID)
        } label: {
            Label(String(localized: "chats.info.showInChat", defaultValue: "Показать в чате"), systemImage: "text.bubble")
        }
    }

    /// Загрузка, пусто и сбой — без карточки, по центру места под вкладками: тонкая
    /// карточка с одним индикатором смотрелась поломкой.
    private func placeholder<Item>(_ loader: PagedLoader<Item>) -> some View {
        Group {
            if let failure = loader.failure {
                DashboardFailurePlaceholder(message: failure) { await loader.reload() }
            } else if loader.isLoaded {
                Text(String(localized: "chats.info.empty", defaultValue: "Здесь пока пусто"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    /// Хвост списка: следующая страница не пришла — «Повторить», идёт — индикатор.
    @ViewBuilder
    private func footer<Item>(_ loader: PagedLoader<Item>) -> some View {
        if let pageFailure = loader.pageFailure {
            PageFailureRow(message: pageFailure) { await loader.retryMore() }
                .listRowSeparator(.hidden)
        } else if loader.hasMore, loader.isLoading {
            ProgressView()
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
        }
    }
}

/// Ряд сетки медиа: три плитки с зазором 2 pt, как медиа в Telegram и профиле.
private struct MediaGridRow: Identifiable {
    static let columns = 3
    static let gap: CGFloat = 2

    let items: [ChatMediaItemDTO]
    var id: String { items.first?.id ?? "" }

    static func rows(_ items: [ChatMediaItemDTO]) -> [MediaGridRow] {
        stride(from: 0, to: items.count, by: columns).map { start in
            MediaGridRow(items: Array(items[start..<min(start + columns, items.count)]))
        }
    }
}

/// Плитка сетки медиа: уменьшенная копия снимка или постер видео — не оригинал,
/// вкладка показывает десятки плиток разом. Ссылки подписываются по требованию,
/// картинка кэшируется по id файла.
private struct ChatMediaThumb: View {
    let item: ChatMediaItemDTO

    @State private var signed: AttachmentMedia?
    @Environment(\.displayScale) private var displayScale

    /// Ширина плитки — треть экрана телефона.
    private static let points: CGFloat = 140

    private var thumbnail: URL? {
        guard let signed else { return nil }
        if item.isVideo {
            return (signed.poster.best(forPoints: Self.points)?.url).flatMap(URL.init(string:))
        }
        return signed.sources.best(forPoints: Self.points).flatMap { URL(string: $0.url) } ?? signed.url
    }

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if item.isVideo, let signed, signed.poster.isEmpty {
                    // Видео без постера: сам ролик картинкой не загрузить — заглушка.
                    Rectangle().fill(Palette.muted)
                } else {
                    RemoteImage(
                        url: thumbnail,
                        cacheKey: "chatmedia:\(item.id)",
                        placeholder: item.placeholder,
                        maxPixelSize: Self.points * displayScale
                    )
                    // Ссылка приезжает позже первого показа — картинка должна её заметить.
                    .id(thumbnail)
                }
            }
            .overlay(alignment: .bottomLeading) {
                if item.isVideo {
                    HStack(spacing: 2) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 8, weight: .bold))
                        if let duration = item.durationMs {
                            Text(verbatim: Duration.milliseconds(duration).formatted(.time(pattern: .minuteSecond)))
                                .font(Typography.tabular(.caption2.weight(.semibold)))
                        }
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, Spacing.xs)
                    .padding(.vertical, 2)
                    .background(.black.opacity(0.45), in: Capsule())
                    .padding(Spacing.xs)
                }
            }
            .clipped()
            .contentShape(Rectangle())
            .task { signed = try? await AppServices.attachmentURLs.media(for: item.id) }
            .accessibilityElement()
            .accessibilityLabel(Text(item.isVideo
                ? String(localized: "chats.preview.video", defaultValue: "Видео")
                : String(localized: "chats.preview.photo", defaultValue: "Фото")))
            .accessibilityAddTraits(.isButton)
    }
}

/// Строка ссылки: касание открывает её в браузере, как в Telegram. Сервер отдаёт
/// только сообщения с превью; адрес, который не разобрать, — просто текстом.
private struct ChatLinkRow: View {
    let link: ChatLinkItemDTO

    var body: some View {
        if let url = link.url {
            Link(destination: url) { label(url: url) }
        } else {
            label(url: nil)
        }
    }

    private func label(url: URL?) -> some View {
        HStack(spacing: Spacing.lg) {
            IconTile(symbol: "link", size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(link.linkPreview?.title ?? url?.host() ?? link.linkPreview?.url ?? "")
                    .font(Typography.body.weight(.medium))
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                Text(verbatim: [url?.host() ?? link.linkPreview?.url, link.createdAt.formatted(date: .abbreviated, time: .omitted)]
                    .compactMap { $0 }
                    .joined(separator: " · "))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

private extension ChatLinkItemDTO {
    var url: URL? { linkPreview.flatMap { URL(string: $0.url) } }
}

/// Строка голосового: кнопка, кто прислал, а у выбранной записи — полоса и время.
/// Проигрыватель общий на список (`ChatSharedContent.player`), строка его только
/// показывает.
private struct ChatVoiceRow: View {
    let item: ChatMediaItemDTO
    let player: VoicePlayer
    let isCurrent: Bool
    let toggle: () -> Void

    private var isPlaying: Bool { isCurrent && player.isPlaying }

    private var title: String {
        if let name = item.sender?.name, !name.isEmpty { return name }
        return String(localized: "chats.preview.voice", defaultValue: "Голосовое сообщение")
    }

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: Spacing.lg) {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .foregroundStyle(Palette.primaryForeground)
                    .frame(width: 40, height: 40)
                    .background(Palette.primary, in: Circle())
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(title)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(1)
                    if isCurrent {
                        ProgressView(value: player.progress)
                            .tint(Palette.primary)
                        Text(verbatim: progressCaption)
                            .font(Typography.tabular(Typography.meta))
                            .foregroundStyle(Palette.mutedForeground)
                    } else {
                        Text(verbatim: item.detail)
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(verbatim: isCurrent ? progressCaption : item.detail))
        .accessibilityHint(Text(isPlaying
            ? String(localized: "chats.voice.pause", defaultValue: "Пауза")
            : String(localized: "chats.voice.play", defaultValue: "Слушать")))
    }

    /// «0:05 / 0:32» — сколько прослушано из всей записи.
    private var progressCaption: String {
        guard let duration = item.durationMs else { return player.caption }
        return "\(player.caption) / \(Duration.milliseconds(duration).formatted(.time(pattern: .minuteSecond)))"
    }
}

import AVFoundation
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
    let music: PagedLoader<ChatMediaItemDTO>
    let gifs: PagedLoader<ChatMediaItemDTO>
    let links: PagedLoader<ChatLinkItemDTO>
    /// Опросы — сами сообщения: вопрос, варианты, закрыт ли.
    let polls: PagedLoader<ChatMessageDTO>

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
        voice = PagedLoader(limit: Self.pageSize) { try await api.media(chatID: chatID, kind: .voiceNote, page: $0) }
        music = PagedLoader(limit: Self.pageSize) { try await api.media(chatID: chatID, kind: .music, page: $0) }
        gifs = PagedLoader(limit: Self.pageSize) { try await api.media(chatID: chatID, kind: .gif, page: $0) }
        links = PagedLoader(limit: Self.pageSize) { try await api.links(chatID: chatID, page: $0) }
        polls = PagedLoader(limit: Self.pageSize) { try await api.polls(chatID: chatID, page: $0) }
        player.onFinish = { [weak self] in self?.playNext() }
    }

    func loader(for kind: ChatMediaKind) -> PagedLoader<ChatMediaItemDTO> {
        switch kind {
        case .media: return media
        case .file: return files
        case .voice, .voiceNote: return voice
        case .music: return music
        case .gif: return gifs
        }
    }

    /// Первая страница вкладки — только при первом заходе на неё.
    func load(_ tab: ChatMediaKindTab) async {
        if let kind = tab.kind {
            await loader(for: kind).loadIfNeeded()
        } else if tab == .polls {
            await polls.loadIfNeeded()
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
        // Следующая — в том же списке, где играла: голосовые или музыка.
        let items = music.items.contains { $0.id == playingID } ? music.items : voice.items
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
        case .music: audioRows(shared.music, isMusic: true)
        case .voice: audioRows(shared.voice, isMusic: false)
        case .links: linkRows
        case .gifs: gifGrid
        case .polls: pollRows
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

    // MARK: Голосовые и музыка

    @ViewBuilder
    private func audioRows(_ loader: PagedLoader<ChatMediaItemDTO>, isMusic: Bool) -> some View {
        if loader.items.isEmpty {
            placeholder(loader)
        } else {
            ForEach(loader.items) { item in
                ChatVoiceRow(item: item, player: shared.player, isCurrent: shared.playingID == item.id, isMusic: isMusic) {
                    Task { await shared.toggleVoice(item) }
                }
                .contextMenu { showInChatButton(item.messageId) }
                .task { await loader.loadMore(after: item) }
            }
            footer(loader)
        }
    }

    // MARK: GIF

    @ViewBuilder
    private var gifGrid: some View {
        let loader = shared.gifs
        if loader.items.isEmpty {
            placeholder(loader)
        } else {
            ForEach(MediaGridRow.rows(loader.items)) { row in
                HStack(spacing: MediaGridRow.gap) {
                    ForEach(row.items) { item in
                        ChatGifThumb(item: item)
                            .onTapGesture { Task { await shared.open(item) } }
                            .contextMenu { showInChatButton(item.messageId) }
                            .accessibilityAddTraits(.isButton)
                    }
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

    // MARK: Опросы

    @ViewBuilder
    private var pollRows: some View {
        let loader = shared.polls
        if loader.items.isEmpty {
            placeholder(loader)
        } else {
            ForEach(loader.items, id: \.id) { message in
                if let poll = message.poll {
                    Button {
                        showInChat(message.id)
                    } label: {
                        HStack(spacing: Spacing.lg) {
                            IconTile(symbol: "chart.bar.fill", size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(poll.question)
                                    .font(Typography.body)
                                    .foregroundStyle(Palette.foreground)
                                    .lineLimit(2)
                                Text(verbatim: Self.pollCaption(poll, message: message))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .task { await loader.loadMore(after: message) }
                }
            }
            footer(loader)
        }
    }

    /// «Закрыт · 4 варианта · 12 нояб.» — состояние, размер и дата.
    private static func pollCaption(_ poll: MessageExtras.Poll, message: ChatMessageDTO) -> String {
        var parts: [String] = []
        if poll.closed == true { parts.append(String(localized: "chats.poll.closed", defaultValue: "Опрос завершён")) }
        parts.append(String(localized: "chats.poll.optionsCount", defaultValue: "Вариантов: \(poll.options.count)"))
        parts.append(message.createdAt.formatted(date: .abbreviated, time: .omitted))
        return parts.joined(separator: " · ")
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

/// Плитка вкладки GIF — анимированная, из оригинала (уменьшенные копии анимацию теряют).
private struct ChatGifThumb: View {
    let item: ChatMediaItemDTO

    @State private var image: UIImage?

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let image {
                    AnimatedImageView(image: image)
                } else {
                    Palette.muted
                }
            }
            .clipped()
            .accessibilityLabel(Text(String(localized: "chats.preview.gif", defaultValue: "GIF")))
            .task(id: item.id) {
                let key = "gif-tab:\(item.id)"
                if let cached = AnimatedGIF.cached(key) {
                    image = cached
                    return
                }
                guard
                    let url = try? await AppServices.attachmentURLs.media(for: item.id).url,
                    let (data, _) = try? await URLSession.shared.data(from: url)
                else { return }
                image = await Task.detached(priority: .utility) {
                    AnimatedGIF.decode(data, maxPixelSize: 300, key: key)
                }.value
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
/// вкладка показывает десятки плиток разом. Картинку плитке готовит
/// `ChatMediaThumbnails`: уже загруженная показывается сразу, с первого кадра, новая —
/// проявляется. До неё — размытое превью из ответа, у видео — тёмная плитка с ▶.
private struct ChatMediaThumb: View {
    let item: ChatMediaItemDTO

    @State private var image: UIImage?
    @State private var failed = false
    @Environment(\.displayScale) private var displayScale
    @Environment(\.motionReduced) private var reduceMotion

    init(item: ChatMediaItemDTO) {
        self.item = item
        // Плитка, вернувшаяся на экран, рисуется сразу готовой — без мигания подложкой.
        _image = State(initialValue: ChatMediaThumbnails.cached(item.id))
    }

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                ZStack {
                    if let image {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .transition(.opacity)
                    } else {
                        placeholder
                    }
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
            .task(id: item.id) { [pixels = ChatMediaThumbnails.points * displayScale] in
                guard image == nil else { return }
                let loaded = await ChatMediaThumbnails.shared.image(for: item, pixels: pixels)
                guard !Task.isCancelled else { return }
                withAnimation(Motion.respecting(.easeOut(duration: Motion.Duration.feedback), reduceMotion: reduceMotion)) {
                    image = loaded
                    failed = loaded == nil
                }
            }
            .accessibilityElement()
            .accessibilityLabel(Text(item.isVideo
                ? String(localized: "chats.preview.video", defaultValue: "Видео")
                : String(localized: "chats.preview.photo", defaultValue: "Фото")))
            .accessibilityAddTraits(.isButton)
    }

    /// Пока картинки нет: размытое превью (LQIP) из ответа, иначе ровная подложка.
    /// Превью размыто заранее, один раз: живой `.blur` на каждой плитке сетки — лишний
    /// проход вне экрана на каждом кадре прокрутки. Видео без кадра — тёмная плитка
    /// с ▶ по центру, а не серый квадрат: видно, что это ролик, ещё до обложки.
    @ViewBuilder
    private var placeholder: some View {
        if let preview = LQIP.blurred(from: item.placeholder) {
            Image(uiImage: preview)
                .resizable()
                .scaledToFill()
        } else if item.isVideo {
            ZStack {
                LinearGradient(
                    colors: [Color(white: 0.22), Color(white: 0.1)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                Image(systemName: "play.fill")
                    .font(.title3)
                    .foregroundStyle(.white.opacity(0.85))
            }
        } else {
            ZStack {
                Rectangle().fill(Palette.muted)
                if failed {
                    Image(systemName: "photo")
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
        }
    }
}

/// Миниатюры сетки «Медиа».
///
/// Раньше каждая плитка сама подписывала ссылку при каждом показе: страница в 30
/// плиток — 30 запросов разом, повторный показ — ещё раз, пока первый не вернулся.
/// Сервер ограничивает частоту запросов, ответы 429 шли на повтор с паузами — плитки
/// секундами стояли пустыми, а после `try?` и навсегда. Здесь на файл одна загрузка
/// (вернувшаяся плитка ждёт ту же), разом — не больше четырёх, свежие плитки первыми,
/// а готовая картинка — в общем кэше по id файла. Загрузка не отменяется, когда плитка
/// ушла с экрана: вернувшись, она застанет картинку готовой.
///
/// Видео без постера (медиа-система ещё не нарезала или старый ролик) — первый кадр
/// самого ролика (`AVAssetImageGenerator` по подписанной ссылке): читается только
/// начало файла, не весь ролик.
@MainActor
final class ChatMediaThumbnails {
    static let shared = ChatMediaThumbnails()

    /// Ширина плитки — треть экрана телефона.
    nonisolated static let points: CGFloat = 140
    private nonisolated static let maxConcurrent = 4

    private var running: [String: Task<UIImage?, Never>] = [:]
    private var freeSlots = ChatMediaThumbnails.maxConcurrent
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private let urls = AppServices.attachmentURLs

    nonisolated static func cacheKey(_ id: String) -> String { "chatmedia:\(id)" }

    /// Готовая миниатюра из памяти — без ожидания.
    nonisolated static func cached(_ id: String) -> UIImage? {
        ImageMemoryCache.shared.image(for: cacheKey(id))
    }

    func image(for item: ChatMediaItemDTO, pixels: CGFloat) async -> UIImage? {
        if let cached = Self.cached(item.id) { return cached }
        if let task = running[item.id] { return await task.value }
        let task = Task { () -> UIImage? in
            await acquire()
            defer { release() }
            return await load(item, pixels: pixels)
        }
        running[item.id] = task
        let image = await task.value
        running[item.id] = nil
        return image
    }

    private func load(_ item: ChatMediaItemDTO, pixels: CGFloat) async -> UIImage? {
        let key = Self.cacheKey(item.id)
        guard let signed = try? await urls.media(for: item.id) else { return nil }
        if item.isVideo {
            if let poster = signed.poster.best(forPoints: Self.points).flatMap({ URL(string: $0.url) }),
               let image = await ImageMemoryCache.shared.load(poster, key: key, maxPixelSize: pixels) {
                return image
            }
            guard let frame = await Self.firstFrame(of: signed.url, pixels: pixels) else { return nil }
            ImageMemoryCache.shared.store(frame, for: key)
            return frame
        }
        let url = signed.sources.best(forPoints: Self.points).flatMap { URL(string: $0.url) } ?? signed.url
        let image = await ImageMemoryCache.shared.load(url, key: key, maxPixelSize: pixels)
        // Просмотр, открытый с плитки, первым кадром покажет её картинку.
        if image != nil { ImageMemoryCache.shared.noteTile(key, forFile: item.id) }
        return image
    }

    /// Первый кадр ролика по ссылке. Допуск по времени оставлен системным: ближайший
    /// опорный кадр декодируется без чтения середины файла.
    private nonisolated static func firstFrame(of url: URL, pixels: CGFloat) async -> UIImage? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: pixels, height: pixels)
        guard let frame = try? await generator.image(at: .zero) else { return nil }
        // Раскодировать здесь, вне главного: иначе это сделает первая отрисовка плитки.
        let image = UIImage(cgImage: frame.image)
        return await image.byPreparingForDisplay() ?? image
    }

    /// Свободное место среди одновременных загрузок; нет — ждём в очереди.
    private func acquire() async {
        if freeSlots > 0 {
            freeSlots -= 1
            return
        }
        await withCheckedContinuation { continuation in
            waiting.append(continuation)
        }
    }

    /// Место освободилось — его получает последняя вставшая в очередь плитка: она на
    /// экране сейчас, а ранние могли уже уехать при быстрой прокрутке.
    private func release() {
        if let next = waiting.popLast() {
            next.resume()
        } else {
            freeSlots += 1
        }
    }
}

/// Строка ссылки: касание открывает её через `ExternalLinkOpener` — во встроенном Safari
/// поверх приложения, как в Telegram, человек не уходит из чата. Сервер отдаёт только сообщения с превью;
/// адрес, который не разобрать, — просто текстом.
private struct ChatLinkRow: View {
    let link: ChatLinkItemDTO

    var body: some View {
        if let url = link.url {
            Button {
                ExternalLinkOpener.open(url)
            } label: {
                label(url: url)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
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

    /// Музыка — по названию файла, голосовое — по автору.
    var isMusic = false

    private var isPlaying: Bool { isCurrent && player.isPlaying }

    private var title: String {
        if isMusic, let file = item.name, !file.isEmpty { return file }
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

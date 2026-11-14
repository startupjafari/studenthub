import AVKit
import SwiftUI
import UIKit
import VisionKit

/// Просмотр фото и видео на весь экран — инструменты веб-просмотрщика (листание,
/// счётчик, увеличение, скачивание), перенесённые на привычные жесты и системные
/// листы iOS.
///
/// Панели как в Telegram: сверху — «назад», капсула (в чате — автор и время снимка и под
/// ней «746 из 752» по всем медиа чата, иначе «2 / 14») и «…» (в чате — «Показать в
/// чате» и «Ответить»; сохранить в «Фото», скопировать, оригинал). Снизу в чате —
/// «Поделиться» (лист с сеткой чатов), «Live Text» и «Удалить»; в ленте — «Поделиться»
/// системным листом. Касание снимка прячет и показывает панели, не сдвигая сам снимок.
/// Щипок и двойное касание увеличивают, увеличенный снимок двигается пальцем, а
/// листание и смахивание вниз (закрыть) ждут, пока его вернут к исходному размеру. Видео
/// играет системный `AVPlayerViewController`: его контролы — пауза, ±10 с, полоса
/// прокрутки, время, скорость, AirPlay, картинка в картинке, — и своих поверх них нет.
///
/// Из чата листание не кончается альбомом сообщения: соседние медиа чата догружаются в
/// обе стороны (`ChatMediaGallery`). Страницы помечены id файла, а не номером: окно
/// растёт и в начало, и номер текущей страницы при этом сдвигался бы.
struct MediaViewer: View {
    let media: [PostDTO.Media]
    let start: Int
    /// Открыт из переписки: медиа чата, автор, время и действия с сообщением.
    var context: MediaViewerContext?
    /// Свежая ссылка на ролик взамен истёкшей; у медиа чата — по id вложения.
    var resign: ((PostDTO.Media) -> VideoRecovery.Resign)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.motionReduced) private var reduceMotion
    /// Id показанного снимка.
    @State private var selection: String?
    @State private var dragOffset: CGFloat = 0
    /// Смещение пальца в момент, когда жест признан: `DragGesture(minimumDistance:)`
    /// начинает с 20 pt, и без вычета снимок прыгал бы на них под пальцем.
    @State private var dragOrigin: CGFloat?
    /// Жест идёт. Сбрасывается и при отмене системой (звонок, центр уведомлений), когда
    /// `onEnded` не приходит, — иначе снимок остался бы висеть смещённым.
    @GestureState private var isDragging = false
    @State private var viewHeight: CGFloat = 800
    @State private var showsControls = true
    @State private var isZoomed = false
    /// Снимки, для которых попросили оригинал вместо уменьшенной копии.
    @State private var originals: Set<String> = []
    @State private var isBusy = false
    @State private var sharing: ExportedFile?
    /// Лист «Поделиться» с сеткой чатов — поверх просмотра, сам просмотр не закрывается,
    /// как в Telegram.
    @State private var shareTarget: ChatShareTarget?
    /// Альбом из нескольких медиа: сначала «эту фотографию» или «все N».
    @State private var askingShareScope = false
    @State private var askingDelete = false
    /// Live Text поверх снимка: текст на фото выделяется и копируется, как в «Фото».
    @State private var showsLiveText = false
    @State private var notice: String?
    @State private var failure: String?

    init(
        media: [PostDTO.Media],
        start: Int,
        context: MediaViewerContext? = nil,
        resign: ((PostDTO.Media) -> VideoRecovery.Resign)? = nil
    ) {
        self.media = media
        self.start = start
        self.context = context
        self.resign = resign ?? (context == nil ? nil : { VideoRecovery.chatAttachment($0.id) })
        // Первый кадр — сразу на выбранном снимке, а не на первом с прыжком после появления.
        let shown = context?.gallery.entries.map(\.media) ?? media
        _selection = State(initialValue: shown.isEmpty ? nil : shown[min(max(start, 0), shown.count - 1)].id)
    }

    private var gallery: ChatMediaGallery? { context?.gallery }

    /// Что листается: медиа чата из окна галереи или переданный список (лента, профиль).
    private var items: [PostDTO.Media] {
        gallery?.entries.map(\.media) ?? media
    }

    private var current: PostDTO.Media? {
        guard let selection else { return nil }
        return items.first { $0.id == selection }
    }

    private var currentEntry: ChatMediaWindow.Entry? {
        guard let selection else { return nil }
        return gallery?.window.entry(selection)
    }

    /// Затемнение фона тает, пока снимок тянут вниз. Отдельным свойством с явным
    /// `Double`: в выражении `1 - min(abs(x) / 400, 0.6)` Swift 6.1 (Xcode 16) не мог
    /// выбрать между `CGFloat` и `Double`.
    private var backdropOpacity: Double {
        1 - min(Double(abs(dragOffset)) / 400, 0.6)
    }

    var body: some View {
        withDialogs(viewer)
    }

    private var viewer: some View {
        ZStack {
            Color.black
                .opacity(backdropOpacity)
                .ignoresSafeArea()

            TabView(selection: $selection) {
                ForEach(items, id: \.id) { item in
                    page(item)
                        .tag(Optional(item.id))
                }
            }
            // Точки страниц не нужны: номер — в панели сверху.
            .tabViewStyle(.page(indexDisplayMode: .never))
            .accessibilityIdentifier("media.viewer")
            .ignoresSafeArea()
            .offset(y: dragOffset)
            .simultaneousGesture(dismissDrag, including: isZoomed || showsLiveText ? .none : .all)

            if showsLiveText, let current, !current.isVideo {
                LiveTextLayer(media: current)
                    .ignoresSafeArea()
                    .transition(.opacity)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewHeight = $0 }
        .onChange(of: isDragging) { _, dragging in
            // Отмена системой: `onEnded` не было — возвращаем снимок на место.
            guard !dragging, dragOrigin != nil else { return }
            dragOrigin = nil
            withAnimation(Motion.respecting(Motion.interactive, reduceMotion: reduceMotion)) { dragOffset = 0 }
        }
        // Панель — поверх снимка и не участвует в раскладке: прячется и появляется, не
        // двигая снимок. У видео она видна всегда — касания забирает плеер.
        .overlay(alignment: .top) {
            if showsControls || current?.isVideo == true || showsLiveText {
                topBar
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .bottom) {
            if showsControls || current?.isVideo == true || showsLiveText {
                bottomBar
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice)
                    .font(Typography.meta.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, Spacing.xl)
                    .padding(.vertical, Spacing.md)
                    .floatingGlass(in: Capsule())
                    .padding(.bottom, MediaViewerBar.height + Spacing.xl)
                    .transition(.opacity)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .statusBarHidden(!showsControls)
        .task {
            guard let gallery, let first = selection else { return }
            await gallery.start(at: first)
        }
        .onChange(of: selection) { _, id in
            isZoomed = false
            showsLiveText = false
            if let gallery, let id {
                Task { await gallery.show(id) }
            }
        }
        .animation(Motion.respecting(Motion.fade, reduceMotion: reduceMotion), value: showsControls)
        .animation(Motion.respecting(Motion.fade, reduceMotion: reduceMotion), value: notice)
        .animation(Motion.respecting(Motion.fade, reduceMotion: reduceMotion), value: showsLiveText)
    }

    private func withDialogs<V: View>(_ view: V) -> some View {
        view
            .sheet(item: $sharing) { file in
                ShareSheet(items: [file.url])
                    .presentationDetents([.medium, .large])
            }
            .sheet(item: $shareTarget) { target in
                shareSheet(for: target)
            }
            .confirmationDialog(
                String(localized: "chats.viewer.shareScope", defaultValue: "Что отправить?"),
                isPresented: $askingShareScope,
                titleVisibility: .hidden,
                presenting: currentEntry
            ) { entry in
                shareScopeButtons(for: entry)
            }
            .confirmationDialog(
                String(localized: "chats.viewer.deleteTitle", defaultValue: "Удалить сообщение?"),
                isPresented: $askingDelete,
                titleVisibility: .visible,
                presenting: currentEntry
            ) { entry in
                deleteButtons(for: entry)
            } message: { entry in
                let count = gallery?.window.album(of: entry.id).count ?? 1
                if count > 1 {
                    Text(String(
                        localized: "chats.viewer.deleteAlbum",
                        defaultValue: "Сообщение удалится целиком — вместе с остальными вложениями альбома (всего \(count))"
                    ))
                }
            }
            .actionFailureAlert($failure)
    }

    @ViewBuilder
    private func page(_ item: PostDTO.Media) -> some View {
        if item.isVideo, let url = item.playbackURL {
            // Видео — под панелью, а не под ней: контролы плеера и кнопки панели не
            // перекрывают друг друга.
            ViewerVideo(id: item.id, url: url, isActive: selection == item.id, resign: resign?(item))
                .safeAreaPadding(.top, MediaViewerBar.height)
                .safeAreaPadding(.bottom, MediaViewerBar.height)
        } else {
            ZoomableImage(
                media: item,
                showsOriginal: originals.contains(item.id),
                isZoomed: selection == item.id ? $isZoomed : .constant(false),
                toggleControls: { showsControls.toggle() }
            )
        }
    }

    /// Снимок идёт за пальцем 1:1 от точки, где жест признан; на отпускании решает
    /// `GesturePhysics` — по положению и скорости, как возврат свайпом в Telegram:
    /// короткий бросок закрывает, медленная оттяжка возвращает.
    private var dismissDrag: some Gesture {
        DragGesture(minimumDistance: 20)
            .updating($isDragging) { _, state, _ in state = true }
            .onChanged { value in
                if dragOrigin == nil {
                    guard abs(value.translation.height) > abs(value.translation.width) else { return }
                    dragOrigin = value.translation.height
                }
                dragOffset = value.translation.height - (dragOrigin ?? 0)
            }
            .onEnded { value in
                guard dragOrigin != nil else { return }
                dragOrigin = nil
                // Скорость — по направлению оттяжки: бросок обратно к центру отменяет.
                let direction: CGFloat = dragOffset < 0 ? -1 : 1
                let velocity = value.velocity.height * direction
                if GesturePhysics.shouldComplete(translation: abs(dragOffset), velocity: velocity, extent: viewHeight) {
                    dismiss()
                } else {
                    let animation = Motion.release(from: dragOffset, to: 0, velocity: value.velocity.height)
                    withAnimation(Motion.respecting(animation, reduceMotion: reduceMotion)) {
                        dragOffset = 0
                    }
                }
            }
    }

    // MARK: Панель

    private var topBar: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            MediaViewerBar.button(symbol: "chevron.left", title: String(localized: "common.close", defaultValue: "Закрыть")) {
                dismiss()
            }
            .accessibilityIdentifier("media.close")
            Spacer(minLength: 0)
            titleCapsule
            Spacer(minLength: 0)
            if isBusy {
                ProgressView()
                    .tint(.white)
                    .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                    .floatingGlass(in: Circle())
            } else {
                MediaViewerBar.circle(symbol: "ellipsis")
                    .accessibilityHidden(true)
                    .overlay {
                        MenuOverlay(menu: moreMenu.uiMenu, accessibilityLabel: String(localized: "chats.info.more", defaultValue: "Ещё"))
                    }
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.top, Spacing.sm)
    }

    /// В чате — автор и время снимка, под ними «N из M» по всем медиа чата, как в
    /// Telegram; иначе номер в списке.
    @ViewBuilder
    private var titleCapsule: some View {
        if let gallery, let entry = currentEntry {
            VStack(spacing: Spacing.xs) {
                VStack(spacing: 0) {
                    Text(gallery.title(of: entry))
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text(MediaViewerContext.when(entry.date))
                        .font(Typography.tabular(.caption2))
                        .opacity(0.7)
                        .lineLimit(1)
                }
                .padding(.horizontal, Spacing.xl)
                .frame(height: ControlHeight.xl)
                .floatingGlass(in: Capsule())
                .accessibilityElement(children: .combine)
                if let counter = gallery.window.counter(for: entry.id) {
                    Text(String(
                        localized: "chats.viewer.counter",
                        defaultValue: "\(counter.index) из \(counter.total)"
                    ))
                    .font(Typography.tabular(.caption.weight(.semibold)))
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, 3)
                    .floatingGlass(in: Capsule())
                    .contentTransition(.numericText())
                }
            }
            .foregroundStyle(.white)
        } else if items.count > 1, let index = items.firstIndex(where: { $0.id == selection }) {
            Text(verbatim: "\(index + 1) / \(items.count)")
                .font(Typography.tabular(.subheadline.weight(.semibold)))
                .foregroundStyle(.white)
                .padding(.horizontal, Spacing.lg)
                .frame(height: ControlHeight.md)
                .floatingGlass(in: Capsule())
        }
    }

    /// Снизу. В чате, как в Telegram: слева «Поделиться», по центру Live Text, справа
    /// «Удалить». В ленте — только «Поделиться» системным листом справа.
    @ViewBuilder
    private var bottomBar: some View {
        if gallery != nil {
            HStack {
                slot {
                    if currentEntry?.messageID != nil {
                        MediaViewerBar.button(symbol: "arrowshape.turn.up.right", title: String(localized: "feed.share", defaultValue: "Поделиться")) {
                            beginShare()
                        }
                        .disabled(isBusy)
                    }
                }
                Spacer(minLength: 0)
                if supportsLiveText {
                    MediaViewerBar.toggle(
                        symbol: "text.viewfinder",
                        title: String(localized: "chats.viewer.liveText", defaultValue: "Текст на снимке"),
                        isOn: showsLiveText
                    ) {
                        showsLiveText.toggle()
                    }
                }
                Spacer(minLength: 0)
                slot {
                    if currentEntry?.messageID != nil, context?.onDelete != nil {
                        MediaViewerBar.button(symbol: "trash", title: String(localized: "feed.delete", defaultValue: "Удалить")) {
                            askingDelete = true
                        }
                        .disabled(isBusy)
                    }
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.sm)
        } else {
            HStack {
                Spacer(minLength: 0)
                MediaViewerBar.button(symbol: "square.and.arrow.up", title: String(localized: "feed.share", defaultValue: "Поделиться")) {
                    Task { await share() }
                }
                .disabled(isBusy)
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.sm)
        }
    }

    /// Место кнопки по краю: пустое держит ширину, чтобы Live Text оставался по центру.
    private func slot<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .frame(width: ControlHeight.xl, height: ControlHeight.xl)
    }

    /// Live Text — у снимков (не роликов), на устройствах, где система его умеет.
    private var supportsLiveText: Bool {
        guard let current, !current.isVideo, current.originalURL != nil else { return false }
        return ImageAnalyzer.isSupported
    }

    @HeroMenuBuilder
    private var moreMenu: [HeroMenuElement] {
        if let messageID = currentEntry?.messageID {
            if let onShowInChat = context?.onShowInChat {
                HeroMenuItem(String(localized: "chats.viewer.showInChat", defaultValue: "Показать в чате"), symbol: "text.bubble") {
                    onShowInChat(messageID)
                    dismiss()
                }
            }
            if let onReply = context?.onReply {
                HeroMenuItem(String(localized: "chats.reply", defaultValue: "Ответить"), symbol: "arrowshape.turn.up.left") {
                    onReply(messageID)
                    dismiss()
                }
            }
            if context?.onShowInChat != nil || context?.onReply != nil {
                HeroMenuDivider()
            }
        }
        if let item = current {
            HeroMenuItem(String(localized: "media.save", defaultValue: "Сохранить в «Фото»"), symbol: "square.and.arrow.down") {
                Task { await saveToPhotos(item) }
            }
            if !item.isVideo {
                HeroMenuItem(String(localized: "media.copyImage", defaultValue: "Скопировать изображение"), symbol: "doc.on.doc") {
                    Task { await copyImage(item) }
                }
            }
            if item.originalURL != nil {
                HeroMenuItem(String(localized: "media.copyLink", defaultValue: "Скопировать ссылку"), symbol: "link") {
                    copyLink(item)
                }
            }
            // Оригинал — только когда сейчас показана уменьшенная копия.
            if !item.isVideo, item.sources?.isEmpty == false, !originals.contains(item.id) {
                HeroMenuDivider()
                HeroMenuItem(String(localized: "media.original", defaultValue: "Показать оригинал"), symbol: "photo") {
                    originals.insert(item.id)
                }
            }
        }
    }

    // MARK: Поделиться из чата

    /// Альбом из нескольких медиа — сначала выбор «эту фотографию» или «все N», как в
    /// Telegram; одиночное — сразу лист.
    private func beginShare() {
        guard let gallery, let entry = currentEntry, let messageID = entry.messageID else { return }
        let album = gallery.window.album(of: entry.id)
        if album.count > 1 {
            askingShareScope = true
        } else {
            shareTarget = .message(messageID, fileIDs: [entry.id])
        }
    }

    @ViewBuilder
    private func shareScopeButtons(for entry: ChatMediaWindow.Entry) -> some View {
        let album = gallery?.window.album(of: entry.id) ?? [entry]
        Button(entry.media.isVideo
            ? String(localized: "chats.viewer.pickThisVideo", defaultValue: "Выбрать это видео")
            : String(localized: "chats.viewer.pickThisPhoto", defaultValue: "Выбрать эту фотографию")
        ) {
            shareTarget = .file(entry.id)
        }
        if let messageID = entry.messageID {
            Button(MediaPlural.album(album.map(\.media))) {
                shareTarget = .message(messageID, fileIDs: album.map(\.id))
            }
        }
        Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
    }

    /// Целое сообщение уходит пересылкой (с «Переслано от»), один снимок из альбома —
    /// новым сообщением с этим файлом: пересылка сервера берёт сообщения целиком.
    private func shareSheet(for target: ChatShareTarget) -> some View {
        ChatShareSheet(
            send: { chatIDs, comment, requestID in
                guard let gallery else { return ForwardOutcome() }
                let outcome: ForwardOutcome
                switch target {
                case .message(let messageID, _):
                    outcome = await gallery.forward(messageIDs: [messageID], to: chatIDs, comment: comment, requestID: requestID)
                case .file(let id):
                    outcome = await gallery.sendCopies(of: id, to: chatIDs, caption: comment)
                }
                if outcome.isComplete { show(ChatPlural.forwardedTo(outcome.delivered.count)) }
                return outcome
            },
            exportFiles: {
                guard let gallery else { return [] }
                return try await gallery.exportFiles(target.fileIDs)
            }
        )
    }

    // MARK: Удаление

    @ViewBuilder
    private func deleteButtons(for entry: ChatMediaWindow.Entry) -> some View {
        if entry.senderID == gallery?.viewerID {
            Button(String(localized: "chats.delete.forEveryone", defaultValue: "Удалить у всех"), role: .destructive) {
                Task { await delete(entry, forEveryone: true) }
            }
        }
        Button(String(localized: "chats.delete.forMe", defaultValue: "Удалить у меня"), role: .destructive) {
            Task { await delete(entry, forEveryone: false) }
        }
        Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
    }

    /// Удаляется сообщение целиком: его медиа уходят из листания, просмотр встаёт на
    /// соседний снимок; больше нечего показывать — закрывается.
    @MainActor
    private func delete(_ entry: ChatMediaWindow.Entry, forEveryone: Bool) async {
        guard let gallery, let messageID = entry.messageID, let onDelete = context?.onDelete else { return }
        isBusy = true
        let failed = await onDelete(messageID, forEveryone)
        isBusy = false
        if let failed {
            failure = failed
            return
        }
        if let next = gallery.remove(messageID: messageID, showing: entry.id) {
            selection = next
        } else {
            dismiss()
        }
    }

    // MARK: Действия

    @MainActor
    private func share() async {
        guard let item = current else { return }
        await run {
            sharing = ExportedFile(url: try await MediaDownload.file(for: item))
        }
    }

    @MainActor
    private func saveToPhotos(_ item: PostDTO.Media) async {
        await run {
            try await PhotoLibrarySaver.save([try await MediaDownload.file(for: item)])
            show(String(localized: "media.saved", defaultValue: "Сохранено в «Фото»"))
        }
    }

    @MainActor
    private func copyImage(_ item: PostDTO.Media) async {
        await run {
            let file = try await MediaDownload.file(for: item)
            guard let image = UIImage(contentsOfFile: file.path) else { throw URLError(.cannotDecodeContentData) }
            UIPasteboard.general.image = image
            show(String(localized: "media.copied", defaultValue: "Скопировано"))
        }
    }

    private func copyLink(_ item: PostDTO.Media) {
        guard let url = item.originalURL else { return }
        UIPasteboard.general.url = url
        show(String(localized: "media.copied", defaultValue: "Скопировано"))
    }

    @MainActor
    private func run(_ action: () async throws -> Void) async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await action()
        } catch {
            failure = error.userMessage
        }
    }

    /// Короткая подсказка внизу — «Скопировано», «Сохранено».
    private func show(_ message: String) {
        notice = message
        Task {
            try? await Task.sleep(for: .seconds(1.6))
            if notice == message { notice = nil }
        }
    }
}

// MARK: - Открыт из чата

/// Просмотр открыт из переписки: медиа чата и что можно сделать с их сообщениями.
/// «Показать в чате» и «Ответить» экран чата выполняет, когда просмотр закроется;
/// «Поделиться» открывается поверх просмотра.
struct MediaViewerContext {
    let gallery: ChatMediaGallery
    /// Серверный id сообщения снимка.
    var onShowInChat: ((String) -> Void)?
    var onReply: ((String) -> Void)?
    /// Удалить сообщение снимка (серверный id; у всех или у себя). Ответ — текст ошибки.
    var onDelete: ((String, Bool) async -> String?)?

    /// «сегодня в 14:06», «вчера в 9:12», «3 нояб. в 18:40» — как в Telegram.
    static func when(_ date: Date, calendar: Calendar = .current) -> String {
        let time = date.formatted(date: .omitted, time: .shortened)
        if calendar.isDateInToday(date) {
            return String(localized: "chats.viewer.today", defaultValue: "сегодня в \(time)")
        }
        if calendar.isDateInYesterday(date) {
            return String(localized: "chats.viewer.yesterday", defaultValue: "вчера в \(time)")
        }
        let day = calendar.isDate(date, equalTo: Date(), toGranularity: .year)
            ? date.formatted(.dateTime.day().month(.abbreviated))
            : date.formatted(.dateTime.day().month(.abbreviated).year())
        return String(localized: "chats.viewer.dateAt", defaultValue: "\(day) в \(time)")
    }
}

/// Что отправить из просмотра: сообщение целиком (все его медиа) или один файл альбома.
enum ChatShareTarget: Identifiable, Equatable {
    case message(String, fileIDs: [String])
    case file(String)

    var id: String {
        switch self {
        case .message(let messageID, _): "message:\(messageID)"
        case .file(let fileID): "file:\(fileID)"
        }
    }

    var fileIDs: [String] {
        switch self {
        case .message(_, let fileIDs): fileIDs
        case .file(let fileID): [fileID]
        }
    }
}

/// «4 фотографии», «2 видео», «3 файла» — пункт «отправить весь альбом».
enum MediaPlural {
    static func album(_ items: [PostDTO.Media]) -> String {
        let count = items.count
        let number = count.formatted()
        if items.allSatisfy({ !$0.isVideo }) {
            switch form(count) {
            case .one: return String(localized: "chats.viewer.photos.one", defaultValue: "\(number) фотография")
            case .few: return String(localized: "chats.viewer.photos.few", defaultValue: "\(number) фотографии")
            case .many: return String(localized: "chats.viewer.photos.many", defaultValue: "\(number) фотографий")
            }
        }
        if items.allSatisfy(\.isVideo) {
            return String(localized: "chats.viewer.videos", defaultValue: "\(number) видео")
        }
        switch form(count) {
        case .one: return String(localized: "chats.viewer.files.one", defaultValue: "\(number) файл")
        case .few: return String(localized: "chats.viewer.files.few", defaultValue: "\(number) файла")
        case .many: return String(localized: "chats.viewer.files.many", defaultValue: "\(number) файлов")
        }
    }

    private enum Form { case one, few, many }

    private static func form(_ count: Int) -> Form {
        let tens = count % 100
        let ones = count % 10
        if (11...14).contains(tens) { return .many }
        if ones == 1 { return .one }
        if (2...4).contains(ones) { return .few }
        return .many
    }
}

// MARK: - Live Text

/// Снимок с системным Live Text (VisionKit): текст и коды на фото подсвечиваются, их
/// можно выделить, скопировать, перевести — как в «Фото». Поверх страницы, на чёрном,
/// вписан так же, как сам снимок; полный кадр качается тем же путём, что и «Поделиться».
private struct LiveTextLayer: View {
    let media: PostDTO.Media

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            Color.black
            if let image {
                LiveTextImageView(image: image)
            } else if failed {
                Image(systemName: "text.viewfinder")
                    .font(.largeTitle)
                    .foregroundStyle(.white.opacity(0.6))
            } else {
                ProgressView().tint(.white)
            }
        }
        .task(id: media.id) {
            do {
                let file = try await MediaDownload.file(for: media)
                let path = file.path
                image = await Task.detached(priority: .userInitiated) { UIImage(contentsOfFile: path) }.value
                failed = image == nil
            } catch {
                failed = true
            }
        }
    }
}

private struct LiveTextImageView: UIViewRepresentable {
    let image: UIImage

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView(image: image)
        view.contentMode = .scaleAspectFit
        view.isUserInteractionEnabled = true
        view.addInteraction(context.coordinator.interaction)
        context.coordinator.analyze(image)
        return view
    }

    func updateUIView(_ view: UIImageView, context: Context) {
        guard view.image !== image else { return }
        view.image = image
        context.coordinator.analyze(image)
    }

    static func dismantleUIView(_ view: UIImageView, coordinator: Coordinator) {
        coordinator.task?.cancel()
    }

    @MainActor
    final class Coordinator {
        let interaction = ImageAnalysisInteraction()
        var task: Task<Void, Never>?

        /// Разбор — один раз на снимок; пока идёт, снимок уже виден, подсветка придёт.
        func analyze(_ image: UIImage) {
            task?.cancel()
            interaction.analysis = nil
            task = Task { @MainActor [interaction] in
                let analyzer = ImageAnalyzer()
                let configuration = ImageAnalyzer.Configuration([.text, .machineReadableCode])
                guard let analysis = try? await analyzer.analyze(image, configuration: configuration),
                    !Task.isCancelled
                else { return }
                interaction.analysis = analysis
                interaction.preferredInteractionTypes = .automatic
                interaction.selectableItemsHighlighted = true
            }
        }
    }
}

// MARK: - Кнопки панели

private enum MediaViewerBar {
    static let height: CGFloat = ControlHeight.xl + Spacing.sm * 2

    static func circle(symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.headline)
            .foregroundStyle(.white)
            .frame(width: ControlHeight.xl, height: ControlHeight.xl)
            .floatingGlass(in: Circle())
    }

    static func button(symbol: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { circle(symbol: symbol) }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(title))
    }

    /// Кнопка-переключатель (Live Text): включённая — светлая с тёмным значком, как
    /// системная кнопка Live Text в «Фото».
    static func toggle(symbol: String, title: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.headline)
                .foregroundStyle(isOn ? Color.black : Color.white)
                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                .background(Circle().fill(Color.white.opacity(isOn ? 1 : 0)))
                .floatingGlass(in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

// MARK: - Снимок

/// Снимок с увеличением: щипок, двойное касание в точку (и обратно), перемещение
/// увеличенного пальцем. Края не уезжают дальше, чем позволяет увеличение.
private struct ZoomableImage: View {
    let media: PostDTO.Media
    let showsOriginal: Bool
    @Binding var isZoomed: Bool
    let toggleControls: () -> Void

    @Environment(\.motionReduced) private var reduceMotion
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var size: CGSize = .zero

    private static let maxScale: CGFloat = 5
    private static let doubleTapScale: CGFloat = 2.5
    private static let copyPoints: CGFloat = 840

    var body: some View {
        image
            .scaleEffect(scale)
            .offset(offset)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
            .gesture(magnify)
            .highPriorityGesture(pan, including: scale > 1 ? .all : .none)
            .onTapGesture(count: 2, coordinateSpace: .local) { location in
                toggleZoom(at: location)
            }
            .onTapGesture(perform: toggleControls)
            .onChange(of: scale) { _, value in isZoomed = value > 1.01 }
            .onDisappear { reset() }
            .accessibilityLabel(Text(String(localized: "feed.photo", defaultValue: "Фотография")))
            .accessibilityAddTraits(.isImage)
    }

    @ViewBuilder
    private var image: some View {
        if showsOriginal, let original = media.originalURL {
            RemoteImage(url: original, cacheKey: "\(media.id):original", placeholder: media.placeholder, contentMode: .fit)
        } else {
            RemoteImage(
                url: media.imageURL(width: Self.copyPoints),
                cacheKey: media.cacheKey(Self.copyPoints),
                placeholder: media.placeholder,
                contentMode: .fit,
                interim: tileImage
            )
        }
    }

    /// Картинка плитки, с которой открыли просмотр: первым кадром — она, чёткая, а не
    /// размытое превью, пока грузится копия 840 pt. Плитка чата и «Медиа» записывают
    /// свой ключ (`noteTile`), плитка ленты лежит под ключом копии ширины карточки.
    private var tileImage: UIImage? {
        ImageMemoryCache.shared.tileImage(forFile: media.id)
            ?? ImageMemoryCache.shared.image(for: media.cacheKey(cardImagePoints))
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                scale = min(max(lastScale * value.magnification, 1), Self.maxScale)
                offset = clamped(offset)
            }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1.01 { animateReset() } else { lastOffset = offset }
            }
    }

    private var pan: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = clamped(CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                ))
            }
            .onEnded { _ in lastOffset = offset }
    }

    /// Двойное касание: увеличить так, чтобы точка касания встала в центр, или вернуть.
    private func toggleZoom(at location: CGPoint) {
        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) {
            if scale > 1.01 {
                reset()
            } else {
                scale = Self.doubleTapScale
                lastScale = scale
                offset = clamped(CGSize(
                    width: (size.width / 2 - location.x) * (scale - 1),
                    height: (size.height / 2 - location.y) * (scale - 1)
                ))
                lastOffset = offset
            }
        }
    }

    private func clamped(_ value: CGSize) -> CGSize {
        let maxX = max(0, (size.width * scale - size.width) / 2)
        let maxY = max(0, (size.height * scale - size.height) / 2)
        return CGSize(width: min(max(value.width, -maxX), maxX), height: min(max(value.height, -maxY), maxY))
    }

    private func animateReset() {
        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) { reset() }
    }

    private func reset() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
    }
}

// MARK: - Видео

/// Ролик в системном плеере. `AVPlayer` создаётся один раз на страницу и не
/// пересоздаётся при перерисовке экрана; уходя со страницы, ролик встаёт на паузу.
/// Ролик уже запускали в карточке ленты — берём её плеер (`VideoPlaybackCenter.borrow`):
/// та же позиция и уже скачанное начало, без новой загрузки и чёрного кадра; вернувшись
/// в ленту, карточка продолжит с того же места.
private struct ViewerVideo: View {
    let id: String
    let url: URL
    let isActive: Bool
    var resign: VideoRecovery.Resign?

    @State private var player: AVPlayer?

    /// Повтор после сбоя сети и переподпись ссылки (IOS_RULES 9.6.13). У плеера, взятого
    /// у карточки, наблюдатель уже есть — тот же.
    private var recovery: VideoRecovery? {
        player.map { VideoRecovery.attach(to: $0, resign: resign) }
    }

    var body: some View {
        SystemPlayer(player: player)
            .onAppear {
                if player == nil { player = VideoPlaybackCenter.shared.borrow(id) ?? AVPlayer(url: url) }
                if isActive { recovery?.play() }
            }
            .onChange(of: isActive) { _, active in
                if active { recovery?.play() } else { recovery?.pause() }
            }
            .onDisappear {
                recovery?.pause()
                VideoPlaybackCenter.shared.giveBack(id)
            }
    }
}

/// `AVPlayerViewController` целиком: системные контролы, AirPlay, картинка в картинке и
/// выбор скорости. Кадр вписан без искажения пропорций.
private struct SystemPlayer: UIViewControllerRepresentable {
    let player: AVPlayer?

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.videoGravity = .resizeAspect
        controller.allowsPictureInPicturePlayback = true
        controller.entersFullScreenWhenPlaybackBegins = false
        controller.exitsFullScreenWhenPlaybackEnds = false
        controller.speeds = AVPlaybackSpeed.systemDefaultSpeeds
        controller.view.backgroundColor = .clear
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
    }
}

// MARK: - Файл

/// Медиафайл целиком — для «Поделиться», «Фото» и буфера обмена. Ложится во временную
/// папку с расширением по типу: по нему «Фото» и получатель понимают, что это.
enum MediaDownload {
    static func file(for media: PostDTO.Media) async throws -> URL {
        guard let remote = media.originalURL else { throw URLError(.badURL) }
        let destination = FileManager.default.temporaryDirectory
            .appending(path: "studenthub-\(media.id).\(fileExtension(for: media, remote: remote))")
        // Файл уже на устройстве — копия под понятным именем, без сети.
        if remote.isFileURL {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.copyItem(at: remote, to: destination)
            return destination
        }
        let (temporary, response) = try await URLSession.shared.download(from: remote)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }

    private static func fileExtension(for media: PostDTO.Media, remote: URL) -> String {
        if !remote.pathExtension.isEmpty { return remote.pathExtension.lowercased() }
        switch media.mime {
        case "image/png": return "png"
        case "image/webp": return "webp"
        case "image/heic": return "heic"
        case "image/gif": return "gif"
        case "video/quicktime": return "mov"
        case let mime? where mime.hasPrefix("video/"): return "mp4"
        default: return media.isVideo ? "mp4" : "jpg"
        }
    }
}

extension PostDTO.Media {
    /// Оригинал файла — для скачивания, «Фото» и ссылки. Относительный путь
    /// дополняется адресом API.
    var originalURL: URL? {
        guard let url, !url.isEmpty else { return nil }
        return URL.apiRooted(url)
    }
}

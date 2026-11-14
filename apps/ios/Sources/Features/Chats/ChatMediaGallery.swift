import Foundation
import Observation

// MARK: - Окно медиа

/// Медиа чата, загруженные вокруг открытого снимка, — от старых к новым, как листается
/// просмотр: влево — старее, вправо — новее. Номер «746 из 752» считается от самого
/// старого медиа чата (`GET /chats/:id/media/:fileId/position`), и окну достаточно знать
/// номер своего первого элемента.
///
/// Отдельным значением без сети — чтобы склейку страниц и счётчик проверяли тесты.
struct ChatMediaWindow: Equatable {
    struct Entry: Identifiable, Equatable {
        /// Id файла — он же курсор страниц `GET /chats/:id/media`.
        let id: String
        /// Снимок для просмотра. Пока ссылка не подписана, `url` пуст: страница
        /// показывает размытое превью, пока подпись не придёт.
        var media: PostDTO.Media
        /// Серверный id сообщения; `nil` — своё, ещё не дошедшее до сервера.
        let messageID: String?
        let senderID: String?
        let senderName: String?
        let date: Date
        /// Ссылка подписана (или файл на устройстве) — снимок можно показывать целиком.
        var isResolved = false
    }

    /// От старых к новым.
    private(set) var entries: [Entry]
    /// Номер `entries[0]` среди всех медиа чата, с единицы. `nil` — сервер номер не дал
    /// (своё неотправленное, нет сети): тогда счётчик — по альбому сообщения.
    private(set) var firstIndex: Int?
    private(set) var total: Int?

    init(entries: [Entry]) {
        self.entries = entries
    }

    func entry(_ id: String) -> Entry? {
        entries.first { $0.id == id }
    }

    func offset(of id: String) -> Int? {
        entries.firstIndex { $0.id == id }
    }

    /// «N из M» для снимка: по всему чату, если номер известен, иначе по альбому его
    /// сообщения (как было до счётчика сервера). Один снимок без номера — без счётчика.
    func counter(for id: String) -> (index: Int, total: Int)? {
        guard let offset = offset(of: id) else { return nil }
        if let firstIndex, let total {
            return (firstIndex + offset, total)
        }
        let album = album(of: id)
        guard album.count > 1, let inAlbum = album.firstIndex(where: { $0.id == id }) else { return nil }
        return (inAlbum + 1, album.count)
    }

    /// Медиа того же сообщения, что и снимок, — альбом целиком, в порядке окна.
    func album(of id: String) -> [Entry] {
        guard let entry = entry(id) else { return [] }
        guard let messageID = entry.messageID else { return [entry] }
        return entries.filter { $0.messageID == messageID }
    }

    /// Окно, собранное заново вокруг снимка: страница старее и страница новее него
    /// (обе — свежие первыми, как отдаёт сервер). Уже подписанные снимки сохраняются.
    mutating func rebuild(
        around center: Entry,
        index: Int,
        total: Int,
        older: [Entry],
        newer: [Entry]
    ) {
        let known = Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var seen: Set<String> = []
        var result: [Entry] = []
        for entry in older.reversed() + [center] + newer.reversed() where seen.insert(entry.id).inserted {
            result.append(known[entry.id].map { Self.keepingResolved($0, over: entry) } ?? entry)
        }
        entries = result
        let centerOffset = result.firstIndex { $0.id == center.id } ?? 0
        firstIndex = index - centerOffset
        self.total = total
    }

    /// Страница старее первого элемента (свежие первыми) — в начало окна.
    mutating func prepend(older page: [Entry]) {
        let known = Set(entries.map(\.id))
        let added = page.reversed().filter { !known.contains($0.id) }
        guard !added.isEmpty else { return }
        entries.insert(contentsOf: added, at: 0)
        if let firstIndex { self.firstIndex = max(1, firstIndex - added.count) }
    }

    /// Страница новее последнего элемента (свежие первыми) — в конец окна.
    mutating func append(newer page: [Entry]) {
        let known = Set(entries.map(\.id))
        let added = page.reversed().filter { !known.contains($0.id) }
        guard !added.isEmpty else { return }
        entries.append(contentsOf: added)
        // Пока окно листали, в чат могли прислать новое: всего не меньше, чем видно.
        if let firstIndex, let total { self.total = max(total, firstIndex + entries.count - 1) }
    }

    /// Подписанная ссылка пришла.
    mutating func resolve(_ id: String, with media: PostDTO.Media) {
        guard let offset = offset(of: id) else { return }
        entries[offset].media = media
        entries[offset].isResolved = true
    }

    /// Сообщение удалили (у всех или у себя): его медиа уходят из окна и из счёта. Номер
    /// первого элемента не меняется — у оставшихся старее всё по-прежнему.
    @discardableResult
    mutating func remove(messageID: String) -> Int {
        let before = entries.count
        entries.removeAll { $0.messageID == messageID }
        let removed = before - entries.count
        if let total { self.total = max(0, total - removed) }
        if entries.isEmpty { firstIndex = nil }
        return removed
    }

    private static func keepingResolved(_ old: Entry, over fresh: Entry) -> Entry {
        guard old.isResolved else { return fresh }
        var merged = fresh
        merged.media = old.media
        merged.isResolved = true
        return merged
    }
}

// MARK: - Галерея чата

/// Просмотр медиа из переписки: окно медиа чата вокруг открытого снимка и его догрузка
/// в обе стороны по мере листания, подпись ссылок по требованию, удаление сообщения.
///
/// Открывается мгновенно — альбомом сообщения, который уже подписан; номер в чате и
/// соседние медиа приходят следом.
@MainActor
@Observable
final class ChatMediaGallery {
    /// Страница соседних медиа — как во вкладке «Медиа» информации о чате.
    static let pageSize = 30
    /// До края окна осталось столько снимков — пора догружать следующую страницу.
    static let prefetchDistance = 4

    let chatID: String
    let viewerID: String
    private(set) var window: ChatMediaWindow

    var entries: [ChatMediaWindow.Entry] { window.entries }

    @ObservationIgnored private let api: ChatActing
    @ObservationIgnored private var olderCursor: String?
    @ObservationIgnored private var newerCursor: String?
    @ObservationIgnored private var hasOlder = false
    @ObservationIgnored private var hasNewer = false
    @ObservationIgnored private var loadingOlder = false
    @ObservationIgnored private var loadingNewer = false
    @ObservationIgnored private var resolving: Set<String> = []
    @ObservationIgnored private var started = false

    init(chatID: String, viewerID: String, entries: [ChatMediaWindow.Entry], api: ChatActing = ChatsAPI()) {
        self.chatID = chatID
        self.viewerID = viewerID
        self.window = ChatMediaWindow(entries: entries)
        self.api = api
    }

    /// Автор для шапки: «Вы» — своё, иначе имя.
    func title(of entry: ChatMediaWindow.Entry) -> String {
        if entry.senderID == viewerID { return String(localized: "chats.you", defaultValue: "Вы") }
        return entry.senderName ?? ""
    }

    /// Номер в чате и соседние страницы вокруг открытого снимка. Своё неотправленное
    /// сервер не знает — тогда просмотр остаётся альбомом сообщения.
    func start(at id: String) async {
        guard !started else { return }
        started = true
        guard let center = window.entry(id), center.messageID != nil else { return }
        do {
            let position = try await api.mediaPosition(chatID: chatID, fileID: id, kind: .media)
            guard let index = position.index, let total = position.total, index > 0 else { return }
            async let olderPage = api.media(chatID: chatID, kind: .media, cursor: id, direction: .older, limit: Self.pageSize)
            async let newerPage = api.media(chatID: chatID, kind: .media, cursor: id, direction: .newer, limit: Self.pageSize)
            let (older, newer) = try await (olderPage, newerPage)
            window.rebuild(
                around: center,
                index: index,
                total: total,
                older: older.items.map(Self.entry),
                newer: newer.items.map(Self.entry)
            )
            olderCursor = older.meta?.cursor ?? older.items.last?.id
            hasOlder = older.meta?.hasNext ?? false
            newerCursor = newer.meta?.prevCursor ?? newer.items.first?.id
            hasNewer = newer.meta?.hasPrev ?? false
        } catch {
            // Без номера и соседей просмотр остаётся альбомом — он уже на экране.
            return
        }
        await show(id)
    }

    /// Снимок на экране: подписать его и соседей, у края окна — догрузить страницу.
    func show(_ id: String) async {
        guard let offset = window.offset(of: id) else { return }
        let nearby = entries[max(0, offset - 2)...min(entries.count - 1, offset + 2)]
        // Текущий — первым: его ждут глазами.
        await resolve(id)
        for entry in nearby where entry.id != id {
            Task { await resolve(entry.id) }
        }
        if offset < Self.prefetchDistance { await loadOlder() }
        if entries.count - 1 - offset < Self.prefetchDistance { await loadNewer() }
    }

    /// Сообщение удалено: его медиа уходят из окна. Ответ — снимок, который показать
    /// вместо удалённого (следующий, а у конца — предыдущий); `nil` — показывать нечего.
    func remove(messageID: String, showing current: String) -> String? {
        let offset = window.offset(of: current) ?? 0
        window.remove(messageID: messageID)
        guard !entries.isEmpty else { return nil }
        if let still = window.entry(current) { return still.id }
        return entries[min(offset, entries.count - 1)].id
    }

    // MARK: Поделиться

    /// Переслать сообщения целиком — с подписью «Переслано от», как из меню сообщения.
    func forward(messageIDs: [String], to chatIDs: [String], comment: String?, requestID: UUID) async -> ForwardOutcome {
        guard !messageIDs.isEmpty, !chatIDs.isEmpty else { return ForwardOutcome() }
        do {
            let result = try await api.forward(messageIDs: messageIDs, to: chatIDs, comment: comment, requestID: requestID)
            return ForwardOutcome(
                delivered: result.results.filter(\.ok).map(\.chatId),
                failed: result.results.filter { !$0.ok }.map(\.chatId)
            )
        } catch {
            return ForwardOutcome(failure: error.userMessage)
        }
    }

    /// Один снимок из альбома — новым сообщением в каждый выбранный чат. Пересылка у
    /// сервера — сообщениями целиком, и «эта фотография» ушла бы со всем альбомом.
    /// Файл качается один раз, дальше — обычная отправка вложения (`AttachmentUploader`):
    /// сообщение сразу встаёт в чат получателя, загрузка идёт своим ходом, сбой даёт
    /// «Повторить» в том чате.
    func sendCopies(of id: String, to chatIDs: [String], caption: String?) async -> ForwardOutcome {
        guard let entry = await resolved(id), !chatIDs.isEmpty else { return ForwardOutcome() }
        let file: URL
        do {
            file = try await MediaDownload.file(for: entry.media)
        } catch {
            return ForwardOutcome(failure: error.userMessage)
        }
        let uploader = AttachmentUploader()
        var outcome = ForwardOutcome()
        for chatID in chatIDs {
            // Своя копия на каждое сообщение: отмена одного стирает свою копию, не чужую.
            let copy = AttachmentUploader.outboxURL(forName: file.lastPathComponent)
            guard (try? FileManager.default.copyItem(at: file, to: copy)) != nil else {
                outcome.failed.append(chatID)
                continue
            }
            let attachment = OutgoingAttachment(
                mime: entry.media.mime ?? (entry.media.isVideo ? "video/mp4" : "image/jpeg"),
                name: file.lastPathComponent,
                width: entry.media.width,
                height: entry.media.height,
                cachedPath: copy.path
            )
            guard let messageID = await uploader.enqueue(
                [attachment],
                chatID: chatID,
                senderID: viewerID,
                caption: caption,
                replyToID: nil
            ) else {
                outcome.failed.append(chatID)
                continue
            }
            Task { await uploader.deliver(messageID: messageID) }
            outcome.delivered.append(chatID)
        }
        return outcome
    }

    /// Файлы снимков — для «Сохранить в галерею» и системного «Поделиться».
    func exportFiles(_ ids: [String]) async throws -> [URL] {
        var files: [URL] = []
        for id in ids {
            guard let entry = await resolved(id) else { throw URLError(.fileDoesNotExist) }
            files.append(try await MediaDownload.file(for: entry.media))
        }
        return files
    }

    /// Снимок с подписанной ссылкой: подписать, если ещё нет.
    private func resolved(_ id: String) async -> ChatMediaWindow.Entry? {
        await resolve(id)
        guard let entry = window.entry(id), entry.isResolved else { return nil }
        return entry
    }

    // MARK: Внутреннее

    private func loadOlder() async {
        guard hasOlder, !loadingOlder, let cursor = olderCursor else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        guard let page = try? await api.media(chatID: chatID, kind: .media, cursor: cursor, direction: .older, limit: Self.pageSize) else {
            return
        }
        window.prepend(older: page.items.map(Self.entry))
        olderCursor = page.meta?.cursor ?? page.items.last?.id
        hasOlder = page.meta?.hasNext ?? false
    }

    private func loadNewer() async {
        guard hasNewer, !loadingNewer, let cursor = newerCursor else { return }
        loadingNewer = true
        defer { loadingNewer = false }
        guard let page = try? await api.media(chatID: chatID, kind: .media, cursor: cursor, direction: .newer, limit: Self.pageSize) else {
            return
        }
        window.append(newer: page.items.map(Self.entry))
        newerCursor = page.meta?.prevCursor ?? page.items.first?.id ?? cursor
        hasNewer = page.meta?.hasPrev ?? false
    }

    /// Свой файл на диске — сразу, чужой — по свежей подписанной ссылке с копиями и HLS.
    private func resolve(_ id: String) async {
        guard let entry = window.entry(id), !entry.isResolved, resolving.insert(id).inserted else { return }
        defer { resolving.remove(id) }
        let stored = try? await AppServices.database.reader.read { db in try AttachmentRecord.fetchOne(db, key: id) }
        if let path = stored?.localPath, FileManager.default.fileExists(atPath: path) {
            let media = PostDTO.Media(
                id: entry.media.id,
                url: URL(filePath: path).absoluteString,
                mime: entry.media.mime,
                width: entry.media.width,
                height: entry.media.height,
                placeholder: entry.media.placeholder,
                durationMs: entry.media.durationMs
            )
            window.resolve(id, with: media)
            return
        }
        guard let signed = try? await AppServices.attachmentURLs.media(for: id) else { return }
        let media = entry.media
        window.resolve(id, with: PostDTO.Media(
            id: media.id,
            url: signed.url.absoluteString,
            mime: media.mime,
            width: media.width,
            height: media.height,
            placeholder: media.placeholder,
            durationMs: media.durationMs,
            sources: signed.sources.isEmpty ? nil : signed.sources,
            poster: signed.poster.isEmpty ? nil : signed.poster,
            hls: signed.hls
        ))
    }

    private static func entry(_ item: ChatMediaItemDTO) -> ChatMediaWindow.Entry {
        ChatMediaWindow.Entry(
            id: item.id,
            media: PostDTO.Media(
                id: item.id,
                url: nil,
                mime: item.mime,
                width: item.width,
                height: item.height,
                placeholder: item.placeholder,
                durationMs: item.durationMs
            ),
            messageID: item.messageId.isEmpty ? nil : item.messageId,
            senderID: item.sender?.id,
            senderName: item.sender?.name,
            date: item.createdAt
        )
    }
}

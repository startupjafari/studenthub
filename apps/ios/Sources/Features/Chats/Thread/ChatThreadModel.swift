import Foundation
import GRDB
import Observation

/// Экран переписки.
///
/// Как и список, читает только базу: открывается мгновенно и в самолёте показывает
/// то, что успело скачаться. Сеть догоняет разницу и пишет её в базу — лента
/// перерисовывается сама.
@Observable
final class ChatThreadModel {
    let chatID: String

    private(set) var days: [MessageTimeline.Day] = []
    private(set) var title: String?
    private(set) var isLoadingOlder = false
    private(set) var failure: String?
    /// Первое непрочитанное на момент открытия. Лента прокручивается к нему один
    /// раз: дальше человек управляет сам.
    private(set) var openingAnchor: String?

    /// Текст в поле ввода. Черновик пишется в базу с задержкой: человек печатает
    /// быстрее, чем имеет смысл ходить в хранилище, но потерять написанное нельзя.
    var draft = ""
    /// На какое сообщение отвечаем.
    private(set) var replyTo: MessageRecord?
    /// Какое своё сообщение правим: поле ввода держит его текст, «отправить» — сохранить.
    private(set) var editing: MessageRecord?
    /// Строка чата — для шапки (тип, участники, онлайн) и галочек прочтения.
    private(set) var chat: ChatRecord?
    /// Закреплённые, от свежего к старому. Плашка показывает первое.
    private(set) var pinned: [ChatMessageDTO] = []
    /// Куда прокрутить ленту по просьбе человека: закреплённое, найденное, ответ.
    private(set) var focus: MessageFocus?
    /// Неудавшееся действие над сообщением — показывается и закрывается.
    var actionFailure: String?
    /// Собеседник личного чата — для статуса в шапке («был(а) недавно»).
    private(set) var peer: ChatMemberDTO?

    private let viewerID: String
    private let database: AppDatabase
    private let api: ChatMessagesFetching
    private let store: MessageStore
    private let outbox: MessageOutbox
    private let uploader: AttachmentUploader
    private let realtime: RealtimeCoordinator
    private let actions: ChatActing

    private var messagesTask: Task<Void, Never>?
    private var chatTask: Task<Void, Never>?
    private var olderCursor: String?
    private var reachedBeginning = false
    private var didPickAnchor = false
    private var draftTask: Task<Void, Never>?
    private var markReadRetry: Task<Void, Never>?
    private var lastReadSent: String?
    private var lastReadAt: Date?
    private var lastActionAt: Date?
    private var messages: [MessageRecord] = []

    init(
        chatID: String,
        viewerID: String,
        database: AppDatabase = AppServices.database,
        api: ChatMessagesFetching = ChatsAPI(),
        store: MessageStore? = nil,
        outbox: MessageOutbox? = nil,
        uploader: AttachmentUploader? = nil,
        realtime: RealtimeCoordinator = AppServices.realtime,
        actions: ChatActing = ChatsAPI()
    ) {
        self.chatID = chatID
        self.viewerID = viewerID
        self.database = database
        self.api = api
        self.store = store ?? MessageStore(database: database)
        self.outbox = outbox ?? MessageOutbox(database: database)
        self.uploader = uploader ?? AttachmentUploader(database: database)
        self.realtime = realtime
        self.actions = actions
    }

    deinit {
        messagesTask?.cancel()
        chatTask?.cancel()
        draftTask?.cancel()
        markReadRetry?.cancel()
    }

    @MainActor
    func start() {
        observeMessages()
        observeChat()
        loadDraft()
    }

    /// Вход в чат: комната сокета плюс обычное открытие.
    @MainActor
    func enter() async {
        await realtime.open(chatID: chatID)
        await open()
    }

    /// Уход с экрана: комнату отпускаем и гасим свою подпись — иначе собеседник
    /// будет видеть «печатает…» у закрытого чата.
    @MainActor
    func leave() async {
        await realtime.send(action: nil, chatID: chatID)
        await realtime.close(chatID: chatID)
    }

    /// Связь вернулась — догоняем пропущенное. События за время обрыва никто не
    /// переприсылает (PROJECT.md §9.2c).
    @MainActor
    func catchUpAfterReconnect() async {
        let known = (try? await store.lastSeq(chatID: chatID)) ?? 0
        guard known > 0 else { return await loadLatest() }
        await catchUp(since: known)
    }

    /// Кто сейчас печатает или записывает голосовое в этом чате.
    var othersAction: String? {
        realtime.actions[chatID]?.values.first
    }

    /// Открытие чата: догнать разницу, а если истории толком нет — скачать последнюю
    /// страницу.
    ///
    /// «Толком нет» — меньше страницы на руках при первом открытии: список чатов кладёт
    /// в базу последнее сообщение каждого чата, и `lastSeq` у ни разу не открытого чата
    /// уже есть. Догонялка от него ничего не скачает, и лента показала бы одно сообщение.
    @MainActor
    func open() async {
        let known = (try? await store.lastSeq(chatID: chatID)) ?? 0
        let firstOpen = olderCursor == nil && !reachedBeginning
        if known == 0 || messages.isEmpty || (firstOpen && messages.count < ChatsAPI.messagePageLimit) {
            await loadLatest()
        } else {
            await catchUp(since: known)
        }
        // Неотправленное с прошлого раза дослать молча: человек нажал «отправить»
        // когда-то давно, и спрашивать его об этом снова незачем. Файлы, чья загрузка
        // оборвалась закрытием приложения, сами не уедут — им «Повторить».
        await uploader.failAbandoned(chatID: chatID)
        await outbox.flush(chatID: chatID)
    }

    // MARK: - Отправка

    @MainActor
    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if let editing {
            await saveEdit(of: editing, text: text)
            return
        }

        let answering = replyTo?.remoteId
        draft = ""
        replyTo = nil
        draftTask?.cancel()
        await persistDraft("")

        await outbox.send(text: text, chatID: chatID, senderID: viewerID, replyToID: answering)
        // Сообщение ушло — подпись «печатает…» снимаем явно, не дожидаясь таймера.
        lastActionAt = nil
        await realtime.send(action: nil, chatID: chatID)
    }

    /// Отправить вложение. Подпись к нему — текущий текст поля ввода: так же, как
    /// в вебе, отдельной формы для подписи нет.
    @MainActor
    func attach(_ attachment: OutgoingAttachment) async {
        let caption = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let answering = replyTo?.remoteId
        draft = ""
        replyTo = nil
        await persistDraft("")

        // Подпись о загрузке — не сразу: сжатый снимок улетает за доли секунды, и
        // она успела бы только мигнуть (PROJECT.md §9.1a).
        let action = Self.action(for: attachment.mime, name: attachment.name)
        let notifier = Task { [realtime, chatID] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await realtime.send(action: action, chatID: chatID)
        }

        await uploader.send(
            attachment,
            chatID: chatID,
            senderID: viewerID,
            caption: caption.isEmpty ? nil : caption,
            replyToID: answering
        )

        notifier.cancel()
        await realtime.send(action: nil, chatID: chatID)
    }

    /// Отправить выбранное в листе вложений. Подпись — из листа: начатый в поле ввода
    /// текст переезжает туда при открытии, поэтому поле после отправки пустеет.
    ///
    /// Сообщения встают в ленту сразу все, а уезжают по очереди: альбомы по десять
    /// вложений, документы, выбранные заодно со снимками, — своей пачкой (как в вебе).
    /// Подпись и ответ достаются только первому сообщению: повторённая у каждого альбома
    /// подпись превратилась бы в одинаковые строки подряд.
    @MainActor
    func send(attachments: [OutgoingAttachment], caption: String, asFiles: Bool) async {
        guard !attachments.isEmpty else { return }
        let text = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        let answering = replyTo?.remoteId
        replyTo = nil
        if editing == nil {
            draft = ""
            draftTask?.cancel()
            await persistDraft("")
        }

        var queued: [String] = []
        for (index, batch) in Self.batches(of: attachments, asFiles: asFiles).enumerated() {
            let id = await uploader.enqueue(
                batch,
                chatID: chatID,
                senderID: viewerID,
                caption: index == 0 && !text.isEmpty ? text : nil,
                replyToID: index == 0 ? answering : nil,
                asFiles: asFiles
            )
            if let id { queued.append(id) }
        }

        let first = attachments[0]
        let action = asFiles ? "UPLOADING_FILE" : Self.action(for: first.mime, name: first.name)
        let notifier = Task { [realtime, chatID] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await realtime.send(action: action, chatID: chatID)
        }
        for id in queued {
            await uploader.deliver(messageID: id)
        }
        notifier.cancel()
        await realtime.send(action: nil, chatID: chatID)
    }

    /// Разложить вложения по сообщениям: не больше десяти в одном. «Как файл» уходит всё
    /// вместе списком; иначе снимки и ролики — альбомами, документы — отдельно.
    static func batches(of files: [OutgoingAttachment], asFiles: Bool) -> [[OutgoingAttachment]] {
        func chunks(_ list: [OutgoingAttachment]) -> [[OutgoingAttachment]] {
            stride(from: 0, to: list.count, by: AttachmentUploader.albumLimit).map {
                Array(list[$0..<min($0 + AttachmentUploader.albumLimit, list.count)])
            }
        }
        if asFiles { return chunks(files) }
        let isMedia = { (file: OutgoingAttachment) in file.mime.hasPrefix("image/") || file.mime.hasPrefix("video/") }
        return chunks(files.filter(isMedia)) + chunks(files.filter { !isMedia($0) })
    }

    /// Крестик на загружаемом сообщении: загрузка прерывается, сообщение уходит из ленты.
    /// Если загрузки уже нет (оборвана перезапуском), сообщение просто убирается.
    @MainActor
    func cancelUpload(_ message: MessageRecord) async {
        guard message.remoteId == nil else { return }
        if !AttachmentUploads.shared.cancel(message.id) {
            await uploader.discard(messageID: message.id)
        }
    }

    private static func action(for mime: String, name: String?) -> String {
        if mime.hasPrefix("audio/") { return "RECORDING_VOICE" }
        if mime.hasPrefix("image/") { return "UPLOADING_PHOTO" }
        if mime.hasPrefix("video/") { return "UPLOADING_VIDEO" }
        return "UPLOADING_FILE"
    }

    @MainActor
    func retry(_ message: MessageRecord) async {
        // Сообщение с файлом повторяет загрузчик: текстовая отправка унесла бы одну подпись.
        if days.lazy.flatMap(\.items).first(where: { $0.message.id == message.id })?.attachments.isEmpty == false {
            await uploader.retry(messageID: message.id)
        } else {
            await outbox.retry(message)
        }
    }

    @MainActor
    func reply(to message: MessageRecord) {
        // Отвечать можно только на то, что уже знает сервер: у неотправленного нет
        // идентификатора, на который сослаться.
        guard message.remoteId != nil, message.deletedAt == nil else { return }
        replyTo = message
    }

    @MainActor
    func cancelReply() {
        replyTo = nil
    }

    // MARK: - Действия над сообщением

    /// Окно правки на сервере — десять минут, пересланное не правится вовсе.
    static let editWindow: TimeInterval = 10 * 60

    func canEdit(_ message: MessageRecord, now: Date = Date()) -> Bool {
        message.senderId == viewerID
            && message.remoteId != nil
            && message.deletedAt == nil
            && message.systemType == nil
            && message.extras?.isForwarded != true
            && now.timeIntervalSince(message.createdAt) < Self.editWindow
    }

    func canDelete(_ message: MessageRecord) -> Bool {
        message.senderId == viewerID && message.deletedAt == nil && message.systemType == nil
    }

    @MainActor
    func beginEdit(_ message: MessageRecord) {
        guard canEdit(message) else { return }
        replyTo = nil
        editing = message
        draft = message.content
    }

    @MainActor
    func cancelEdit() {
        editing = nil
        draft = ""
    }

    /// Правка уходит сокетом; текст в базе меняется сразу, а подтверждение придёт
    /// событием `message:updated` и перепишет строку серверной версией.
    @MainActor
    private func saveEdit(of message: MessageRecord, text: String) async {
        editing = nil
        draft = ""
        guard text != message.content, let remoteID = message.remoteId else { return }
        let id = message.id
        try? await database.writer.write { db in
            guard var row = try MessageRecord.fetchOne(db, key: id) else { return }
            row.content = text
            row.editedAt = Date()
            try row.update(db)
        }
        await realtime.edit(messageID: remoteID, content: text)
    }

    /// Удаление — для всех: «удалить у себя» одно сообщение сервер не умеет.
    /// Неотправленное удаляется только локально — серверу о нём нечего сказать.
    @MainActor
    func delete(_ message: MessageRecord) async {
        guard canDelete(message) else { return }
        let id = message.id
        if message.remoteId == nil {
            _ = try? await database.writer.write { db in try MessageRecord.deleteOne(db, key: id) }
            return
        }
        try? await database.writer.write { db in
            guard var row = try MessageRecord.fetchOne(db, key: id) else { return }
            row.deletedAt = Date()
            try row.update(db)
        }
        if let remoteID = message.remoteId {
            await realtime.delete(messageID: remoteID)
        }
    }

    /// Реакция одна на человека: та же снимает, другая заменяет. Ответ сервера —
    /// сообщение целиком, оно и ложится в базу.
    @MainActor
    func react(_ message: MessageRecord, emoji: String) async {
        guard let remoteID = message.remoteId, message.deletedAt == nil else { return }
        do {
            let updated = try await actions.react(messageID: remoteID, emoji: emoji)
            try await database.writer.write { db in try MessageStore.upsert(updated, in: db) }
        } catch {
            actionFailure = self.message(for: error)
        }
    }

    func myReaction(on message: MessageRecord) -> String? {
        message.extras?.reactions.first { $0.userIds.contains(viewerID) }?.emoji
    }

    /// Новый опрос в чате. Сообщение с ним приходит сокетом, как любое другое.
    @MainActor
    func createPoll(question: String, options: [String], multiple: Bool, anonymous: Bool) async -> Bool {
        do {
            try await actions.createPoll(chatID: chatID, question: question, options: options, multiple: multiple, anonymous: anonymous)
            return true
        } catch {
            actionFailure = message(for: error)
            return false
        }
    }

    @MainActor
    func togglePin(_ message: MessageRecord) async {
        guard let remoteID = message.remoteId else { return }
        do {
            try await actions.setPinned(message.pinnedAt == nil, messageID: remoteID)
            await loadPinned()
        } catch {
            actionFailure = self.message(for: error)
        }
    }

    @MainActor
    func loadPinned() async {
        if let list = try? await actions.pinned(chatID: chatID) {
            pinned = list
        }
    }

    /// Перейти к сообщению: если оно уже в базе — прокрутить, иначе скачать окно
    /// истории вокруг него.
    @MainActor
    func jump(to remoteID: String) async {
        if let local = messages.first(where: { $0.remoteId == remoteID }) {
            focus = MessageFocus(id: local.id)
            return
        }
        do {
            let page = try await actions.around(messageID: remoteID, chatID: chatID)
            try await store.save(messages: page.items, chatID: chatID)
            focus = MessageFocus(id: remoteID)
        } catch {
            actionFailure = self.message(for: error)
        }
    }

    /// Пересылка одного или нескольких сообщений. В каждый чат — по очереди в порядке
    /// ленты: сервер ставит пересланному своё время, и порядок отправки станет порядком
    /// в чате получателя.
    @MainActor
    func forward(_ messages: [MessageRecord], to chatIDs: [String]) async -> Bool {
        let remoteIDs = messages.filter(Self.canForward).compactMap(\.remoteId)
        guard !remoteIDs.isEmpty else { return false }
        do {
            for target in chatIDs {
                for remoteID in remoteIDs {
                    try await actions.forward(messageID: remoteID, to: target)
                }
            }
            return true
        } catch {
            actionFailure = self.message(for: error)
            return false
        }
    }

    /// Переслать можно только дошедшее до сервера и не удалённое.
    static func canForward(_ message: MessageRecord) -> Bool {
        message.remoteId != nil && message.deletedAt == nil && message.systemType == nil
    }

    // MARK: - Выбор нескольких

    /// Выбранные сообщения (локальные идентификаторы); `nil` — режим выбора выключен.
    private(set) var selection: Set<String>?

    var isSelecting: Bool { selection != nil }

    /// Системные события — не реплики: как и в вебе, их не выбирают.
    static func isSelectable(_ message: MessageRecord) -> Bool {
        message.systemType == nil
    }

    /// Вход в режим выбора из меню сообщения: оно сразу отмечено.
    @MainActor
    func beginSelection(with message: MessageRecord) {
        guard Self.isSelectable(message) else { return }
        selection = [message.id]
    }

    /// Касание пузыря в режиме выбора. Сняли последнюю отметку — режим закрывается,
    /// как в вебе: пустой выбор ни к чему не ведёт.
    @MainActor
    func toggleSelection(of message: MessageRecord) {
        guard var current = selection, Self.isSelectable(message) else { return }
        if current.contains(message.id) {
            current.remove(message.id)
        } else {
            current.insert(message.id)
        }
        selection = current.isEmpty ? nil : current
    }

    /// Выбранное исчезло из базы (удалено, неотправленное стёрто) — снимаем отметку,
    /// иначе счётчик и «Удалить» считали бы то, чего на экране нет.
    @MainActor
    private func pruneSelection() {
        guard let selection else { return }
        let alive = selection.intersection(messages.map(\.id))
        guard alive != selection else { return }
        self.selection = alive.isEmpty ? nil : alive
    }

    @MainActor
    func endSelection() {
        selection = nil
    }

    /// Выбранные в порядке ленты, а не в порядке касаний.
    var selectedMessages: [MessageRecord] {
        guard let selection else { return [] }
        return messages.filter { selection.contains($0.id) }
    }

    /// Тексты выбранных по времени, через пустую строку. Без текста (фото, удалённое)
    /// не дают пустых абзацев.
    var selectedText: String {
        selectedMessages
            .filter { $0.deletedAt == nil && !$0.content.isEmpty }
            .map(\.content)
            .joined(separator: "\n\n")
    }

    var canForwardSelection: Bool {
        selectedMessages.contains(where: Self.canForward)
    }

    /// Удалить выбранное можно, только если всё оно своё и ещё не удалено: чужое
    /// сервер отклонит, и часть выбора молча осталась бы на месте.
    var canDeleteSelection: Bool {
        let chosen = selectedMessages
        return !chosen.isEmpty && chosen.allSatisfy(canDelete)
    }

    /// Удаление выбранного — тем же путём, что и одиночное, по одному сообщению.
    @MainActor
    func deleteSelected() async {
        let chosen = selectedMessages
        guard !chosen.isEmpty, chosen.allSatisfy(canDelete) else { return }
        selection = nil
        for message in chosen {
            await delete(message)
        }
    }

    @MainActor
    func report(_ message: MessageRecord, reason: String) async -> Bool {
        guard let remoteID = message.remoteId else { return false }
        do {
            try await FeedAPI().report(.message, id: remoteID, reason: reason)
            return true
        } catch {
            actionFailure = self.message(for: error)
            return false
        }
    }

    /// Собеседник личного чата: из списка участников, а пока его нет — автор любого
    /// чужого сообщения. Идентификатора собеседника в строке списка нет, а для онлайна
    /// нужен именно он.
    var peerID: String? {
        guard chat?.kind == .private else { return nil }
        if let peer { return peer.id }
        return messages.first { $0.senderId != viewerID && $0.systemType == nil }?.senderId
    }

    /// Участники личного чата — ради собеседника: время «был(а)» приходит только так.
    /// У групп список не берём: он может быть на сотни человек, а шапке хватает числа.
    @MainActor
    func loadPeer() async {
        let id = chatID
        var kind = chat?.kind
        if kind == nil {
            kind = try? await database.reader.read { db in try ChatRecord.fetchOne(db, key: id)?.kind }
        }
        guard kind == .private, let list = try? await actions.members(chatID: chatID) else { return }
        peer = list.first { $0.id != viewerID }
    }

    /// Дата сообщения, к которому лента открылась (первое непрочитанное).
    var openingAnchorDate: Date? {
        guard let openingAnchor else { return nil }
        return messages.first { $0.id == openingAnchor }?.createdAt
    }

    /// Сколько чужих сообщений пришло позже отметки — счётчик на кнопке «вниз».
    func unseenCount(after cutoff: Date) -> Int {
        messages.reduce(0) { count, message in
            let counts = message.senderId != viewerID && message.systemType == nil
                && message.deletedAt == nil && message.createdAt > cutoff
            return count + (counts ? 1 : 0)
        }
    }

    var isPeerOnline: Bool {
        if let peerID { return realtime.onlineUsers.contains(peerID) || chat?.online == true }
        return chat?.online == true
    }

    // MARK: - Черновик

    /// Отметить прочитанным до последнего чужого сообщения.
    ///
    /// Шлём не чаще раза в 800 мс и только то, что действительно новее прошлой
    /// отметки: сервер двигает её только вперёд, а лишние события — это трафик на
    /// каждом прокруте.
    @MainActor
    func markRead() async {
        guard let last = messages.last(where: { $0.senderId != viewerID && $0.remoteId != nil }),
            let id = last.remoteId,
            id != lastReadSent
        else { return }
        if let sentAt = lastReadAt, Date().timeIntervalSince(sentAt) < 0.8 {
            // Слишком часто — не теряем отметку, а досылаем её после паузы: иначе
            // последнее из пачки сообщений осталось бы непрочитанным.
            guard markReadRetry == nil else { return }
            markReadRetry = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(900))
                guard let self, !Task.isCancelled else { return }
                self.markReadRetry = nil
                await self.markRead()
            }
            return
        }
        lastReadSent = id
        lastReadAt = Date()
        await realtime.markRead(chatID: chatID, messageID: id)
    }

    /// Последнее чужое сообщение, уже получившее id на сервере: новое пришло — пока
    /// чат открыт, оно прочитано.
    var newestIncomingID: String? {
        messages.last { $0.senderId != viewerID && $0.remoteId != nil }?.remoteId
    }

    /// Возврат в чат из вложенного экрана («Информация», профиль): уход вперёд по стеку
    /// отпустил комнату, а без неё не придут ни «печатает…», ни счётчик прочтения.
    @MainActor
    func rejoin() async {
        await realtime.open(chatID: chatID)
        await catchUpAfterReconnect()
        await markRead()
    }

    @MainActor
    func draftChanged() {
        noteTyping()
        draftTask?.cancel()
        let text = draft
        draftTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await self?.persistDraft(text)
        }
    }

    /// Подтверждение набора отправляется не чаще раза в три секунды (§9.1a):
    /// получатель гасит подпись через четыре, и чаще подтверждать незачем.
    @MainActor
    private func noteTyping() {
        if let sentAt = lastActionAt, Date().timeIntervalSince(sentAt) < 3 { return }
        lastActionAt = Date()
        Task { [realtime, chatID] in await realtime.send(action: "TYPING", chatID: chatID) }
    }

    @MainActor
    private func loadDraft() {
        Task { @MainActor [weak self, database, chatID] in
            let stored = try? await database.reader.read { db in
                try DraftRecord.fetchOne(db, key: chatID)
            }
            guard let self, self.draft.isEmpty, let stored else { return }
            self.draft = stored.text
        }
    }

    @MainActor
    private func persistDraft(_ text: String) async {
        let chatID = chatID
        try? await database.writer.write { db in
            if text.isEmpty {
                _ = try DraftRecord.deleteOne(db, key: chatID)
                return
            }
            try DraftRecord(
                chatId: chatID,
                text: text,
                replyToId: nil,
                updatedAt: Date(),
                // Серверу черновик ещё не донесён — это ниже.
                isSynced: false
            ).upsert(db)
        }
        // Серверу — чтобы черновик был виден в вебе, а после отправки (пустой текст)
        // не вернулся старым серверным при следующей синхронизации списка. Не вышло —
        // запись остаётся несинхронизированной, следующий набор повторит.
        guard (try? await actions.saveDraft(chatID: chatID, text: text)) != nil, !text.isEmpty else { return }
        try? await database.writer.write { db in
            guard var record = try DraftRecord.fetchOne(db, key: chatID), record.text == text else { return }
            record.isSynced = true
            try record.update(db)
        }
    }

    /// Подгрузка вверх. Вызывается, когда лента подъехала к началу загруженного.
    @MainActor
    func loadOlder() async {
        guard !isLoadingOlder, !reachedBeginning else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }

        do {
            let page = try await api.messages(
                chatID: chatID,
                cursor: olderCursor,
                limit: ChatsAPI.messagePageLimit
            )
            try await store.save(messages: page.items, chatID: chatID)
            olderCursor = page.meta?.cursor
            reachedBeginning = page.meta?.hasNext != true
            failure = nil
        } catch is CancellationError {
            // Экран ушёл, и запрос отменили — это не сбой: не пугаем красной строкой.
            return
        } catch {
            failure = message(for: error)
        }
    }

    // MARK: - Синхронизация

    @MainActor
    private func loadLatest() async {
        do {
            let page = try await api.messages(chatID: chatID, cursor: nil, limit: ChatsAPI.messagePageLimit)
            try await store.save(messages: page.items, chatID: chatID)
            olderCursor = page.meta?.cursor
            reachedBeginning = page.meta?.hasNext != true
            failure = nil
        } catch is CancellationError {
            // Экран ушёл, и запрос отменили — это не сбой: не пугаем красной строкой.
            return
        } catch {
            failure = message(for: error)
        }
    }

    @MainActor
    private func catchUp(since: Int) async {
        do {
            // Отметка времени для правок и удалений — время самого свежего известного
            // сообщения. Своего времени последней синхронизации мы не храним, а всё,
            // что отредактировали позже этого момента, в ответ попадёт.
            let newest = messages.last?.createdAt
            let updates = try await api.updates(chatID: chatID, since: since, sinceTs: newest)
            if updates.overflow {
                // Разрыв больше серверного лимита: склеивать нечего, честнее
                // перекачать хвост заново.
                try await store.clearHistory(chatID: chatID)
                olderCursor = nil
                reachedBeginning = false
                await loadLatest()
                return
            }
            try await store.apply(updates, chatID: chatID)
            failure = nil
        } catch is CancellationError {
            // Экран ушёл, и запрос отменили — это не сбой: не пугаем красной строкой.
            return
        } catch {
            failure = message(for: error)
        }
    }

    // MARK: - Наблюдение за базой

    @MainActor
    private func observeMessages() {
        messagesTask?.cancel()
        let request = store.messages(chatID: chatID)
        let id = chatID
        // Сообщения и вложения читаем одним наблюдением: раздельные дали бы кадр,
        // где картинка уже пришла, а сообщения под неё ещё нет.
        let observation = ValueObservation.tracking { db -> ThreadSnapshot in
            let messages = try request.fetchAll(db)
            let attachments = try AttachmentRecord.fetchAll(
                db,
                sql: """
                    SELECT a.* FROM attachment a
                    JOIN message m ON m.id = a.messageId
                    WHERE m.chatId = ?
                    """,
                arguments: [id]
            )
            return ThreadSnapshot(
                messages: messages,
                attachments: Dictionary(grouping: attachments, by: \.messageId)
            )
        }
        // Сильная ссылка живёт только на шаг цикла: держи её задача весь бесконечный
        // поток, модель (и её наблюдения) не освободились бы и после ухода из чата.
        messagesTask = Task { @MainActor [weak self, database] in
            for await snapshot in AsyncValues.stream(of: observation, in: database.reader) {
                guard let self else { return }
                self.messages = snapshot.messages
                self.pruneSelection()
                self.days = MessageTimeline.build(
                    from: snapshot.messages,
                    attachments: snapshot.attachments,
                    viewerID: self.viewerID
                )
                self.pickAnchorIfNeeded()
            }
        }
    }

    @MainActor
    private func observeChat() {
        chatTask?.cancel()
        let id = chatID
        let observation = ValueObservation.tracking { db in try ChatRecord.fetchOne(db, key: id) }
        chatTask = Task { @MainActor [weak self, database] in
            for await chat in AsyncValues.stream(of: observation, in: database.reader) {
                guard let self else { return }
                self.chat = chat
                self.title = chat?.title
                self.unreadCount = chat?.unreadCount ?? 0
                self.pickAnchorIfNeeded()
            }
        }
    }

    private var unreadCount = 0

    /// Якорь выбирается один раз за открытие: пересчитывать его на каждое новое
    /// сообщение значило бы дёргать ленту под пальцем.
    @MainActor
    private func pickAnchorIfNeeded() {
        // Без строки чата неизвестно, сколько непрочитанного: якорь «ничего нового»
        // зафиксировался бы навсегда.
        guard !didPickAnchor, !messages.isEmpty, chat != nil else { return }
        didPickAnchor = true
        openingAnchor = MessageTimeline.firstUnreadID(
            in: messages,
            viewerID: viewerID,
            unreadCount: unreadCount
        )
    }

    private func message(for error: Error) -> String {
        error.userMessage
    }
}

/// Просьба прокрутить ленту к сообщению. Токен отличает повторную просьбу к тому же
/// сообщению — иначе второй переход к закреплённому ничего бы не делал.
struct MessageFocus: Equatable {
    let id: String
    let token = UUID()
}

/// Поток значений наблюдения GRDB.
///
/// Общий для всех экранов: ошибка чтения локальной базы не повод падать — список и
/// лента просто перестают обновляться, а показывают то, что уже прочитали.
enum AsyncValues {
    static func stream<T>(
        of observation: ValueObservation<ValueReducers.Fetch<T>>,
        in reader: any DatabaseReader
    ) -> AsyncStream<T> {
        AsyncStream { continuation in
            let cancellable = observation.start(
                in: reader,
                scheduling: .async(onQueue: .main),
                onError: { _ in continuation.finish() },
                onChange: { value in continuation.yield(value) }
            )
            continuation.onTermination = { _ in cancellable.cancel() }
        }
    }
}


/// Срез переписки: сообщения и их вложения, прочитанные одним запросом.
struct ThreadSnapshot: Equatable {
    let messages: [MessageRecord]
    let attachments: [String: [AttachmentRecord]]
}

import CoreLocation
import Foundation
import GRDB
import Observation
import os

/// Экран переписки.
///
/// Как и список, читает только базу: открывается мгновенно и в самолёте показывает
/// то, что успело скачаться. Сеть догоняет разницу и пишет её в базу — лента
/// перерисовывается сама.
@Observable
final class ChatThreadModel {
    let chatID: String

    private(set) var days: [MessageTimeline.Day] = []
    /// Растёт с каждой новой лентой: экран сравнивает число, а не тысячи сообщений, и не
    /// пересобирает снапшот, когда сама лента не менялась (`MessageListView`).
    private(set) var daysRevision = 0
    /// Последняя запрошенная сборка ленты: запоздавшая фоновая сборка старого среза не
    /// перезапишет новую.
    @ObservationIgnored private var buildGeneration = 0
    /// Сколько свежих сообщений разобрать до показа ленты: экран и запас на прокрутку.
    private static let preparedOnScreen = 60
    /// Идущая фоновая сборка ленты: новый срез отменяет прежнюю, уход с экрана — любую.
    @ObservationIgnored private var buildTask: Task<Void, Never>?
    private(set) var title: String?
    private(set) var isLoadingOlder = false
    private(set) var failure: String?
    /// Первое непрочитанное на момент открытия. Лента прокручивается к нему один
    /// раз: дальше человек управляет сам.
    private(set) var openingAnchor: String?

    /// Черновик чата и текст правки — порознь (IOS_RULES 9.8.6). Черновик пишется в базу
    /// с задержкой: человек печатает быстрее, чем имеет смысл ходить в хранилище, но
    /// потерять написанное нельзя.
    private(set) var input = ComposerInput()
    /// Текст в поле ввода — к нему привязано поле. При правке это текст правки, иначе
    /// черновик чата.
    var composerText: String {
        get { input.text }
        set { input.text = newValue }
    }
    /// На какое сообщение отвечаем.
    private(set) var replyTo: MessageRecord?
    /// Какое своё сообщение правим: поле ввода держит его текст (`input.editText`),
    /// «отправить» — сохранить.
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
    /// Группа: кто из участников в сети на момент запроса — для «N в сети» в шапке.
    /// Дальше его двигают события присутствия, перезапрос — только при входе в чат и
    /// после обрыва связи.
    private(set) var presence: ChatPresenceSnapshot?
    /// Группа: до какого момента дочитал каждый из других участников. События
    /// прочтения накладываются поверх (`readTimes`), перезапроса на каждое нет.
    private(set) var readReceipts: [ChatReadDTO] = []
    /// Последний запрос списка прочитавших не удался: текст для листа «Прочитали».
    private(set) var readsFailure: String?
    private(set) var readsOffline = false
    /// Просьбы прокрутить к последнему сообщению от самой модели: возврат к свежему из
    /// окна истории, своя отправка. Каждое новое значение — одна прокрутка.
    private(set) var bottomRequests = 0
    /// Открытие чата ещё не догнало сервер, а в базе — меньше страницы: обычно одно
    /// превью из списка чатов. Такую ленту не показываем — иначе первым кадром встаёт
    /// одно сообщение у верха пустого экрана, а через миг его сменяет вся страница.
    private(set) var isPreparing = true
    /// Идёт запись голосового: над микрофоном — замок, кнопка «вниз» на это время уходит,
    /// чтобы не налезать на него.
    private(set) var isRecordingVoice = false
    /// Свои отложенные сообщения в этом чате: часы в поле ввода и их список.
    let scheduled: ChatScheduledMessages

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
    /// Догон в пути: повторная просьба не шлёт второй запрос, а просит пройти ещё раз с
    /// позиции, какой она станет после этого.
    private var catchingUp = false
    private var catchUpAgain = false
    /// Повтор догона после временной ошибки и его пауза: 2 → 60 с с разбросом, без
    /// предела попыток (IOS_RULES 9.3.1).
    private var catchUpRetry: Task<Void, Never>?
    private var catchUpDelay = OutboxService.firstRetryDelay
    private var lastReadSent: String?
    /// Нижняя строка, реально видимая в ленте (`MessageListView`). Прочитанным считается
    /// только она и что выше; `nil` — лента ещё не показана, отмечать нечего.
    private var lowestVisibleID: String?
    private var lastReadAt: Date?
    private var lastActionAt: Date?
    private var voiceAnnouncer: Task<Void, Never>?
    private var messages: [MessageRecord] = []
    /// Последний срез базы целиком — из него лента пересобирается, когда сдвигается
    /// граница окна истории, а сама база не менялась.
    private var snapshot: ThreadSnapshot?

    // Окно истории. Переход к далёкому сообщению или дате заменяет переписку в базе
    // окном вокруг цели (`MessageStore.replaceHistory`). Пока окно не догрузилось до
    // свежего, всё новее его верхней границы прячется: сообщения из сокета и превью
    // списка ложатся в базу, но между ними и окном — неизвестная «дыра», и показывать
    // их встык нельзя. Догрузка вниз двигает границу страницами, пока сервер не скажет,
    // что новее ничего нет.
    /// Верхняя граница окна (`seq`); `nil` — лента доходит до свежего.
    private var ceiling: Int?
    /// Курсор догрузки вниз — id самого нового сообщения окна.
    private var newerCursor: String?
    private var isLoadingNewer = false
    /// Смена окна. Страница, запрошенная до неё, в новое окно не ложится: она пришла
    /// бы из другого места истории и оставила бы ту самую «дыру».
    private var windowGeneration = 0
    /// Прошлый раз переписку закрыли посреди окна: пока сбрасываемся к свежему, старое
    /// окно не показываем, чтобы лента не мелькнула им.
    private var pendingWindowReset: DetachedWindows.Mark?
    /// Окно меняется: база уже переписана, а граница окна ещё старая (или наоборот).
    /// Срезы из наблюдения в это время запоминаются, но в ленту не идут: кадр, где новое
    /// окно обрезано старой границей или старое показано без границы, уводил ленту в
    /// случайное место истории — и своё отправленное сообщение так и не появлялось.
    private var snapshotHolds = 0
    /// Сеть на открытии молчит дольше разумного — показываем то, что есть в базе.
    private var preparingTimeout: Task<Void, Never>?
    /// Нижняя граница наблюдаемого окна (`seq`), `nil` — весь чат (шаг 2.2 плана аудита).
    /// Раньше наблюдение читало всю историю чата, сохранённую в базе, на каждое её
    /// изменение — и лента дорожала с каждой когда-либо пролистанной страницей. Теперь
    /// окно начинается у свежего края и опускается, когда лента подъезжает к его верху.
    /// После замены переписки окном истории граница снимается: в базе тогда только оно.
    @ObservationIgnored private var floor: Int?
    /// Сколько ждать первую страницу, пока в базе одно превью (шаг 2.9, флаг).
    static var preparingWait: Duration {
        PerformanceFlags.chatThinHistoryShortWait ? .milliseconds(600) : .milliseconds(2500)
    }
    /// Сколько свежих сообщений наблюдать при открытии (плюс всё непрочитанное).
    private static let liveWindow = 150

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
        self.scheduled = ChatScheduledMessages(chatID: chatID, api: actions)
    }

    deinit {
        buildTask?.cancel()
        messagesTask?.cancel()
        chatTask?.cancel()
        draftTask?.cancel()
        markReadRetry?.cancel()
        catchUpRetry?.cancel()
        preparingTimeout?.cancel()
        voiceAnnouncer?.cancel()
    }

    /// Лента показывает окно истории, а не свежие сообщения: кнопка «вниз» ведёт к
    /// свежему, а новые сообщения не подматывают ленту за собой.
    var isDetached: Bool { ceiling != nil }

    @MainActor
    func start() {
        pendingWindowReset = DetachedWindows.mark(for: chatID)
        if pendingWindowReset == nil { floor = initialFloor() }
        observeMessages()
        observeChat()
        loadDraft()
        preparingTimeout = Task { @MainActor [weak self] in
            try? await Task.sleep(for: Self.preparingWait)
            guard !Task.isCancelled else { return }
            await self?.finishPreparing()
        }
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
        // В окне истории догонять нечего: разница от его верха — это вся «дыра» до
        // свежего, её дочитает догрузка вниз.
        guard !isDetached else { return }
        await catchUp()
    }

    /// Кто сейчас печатает или записывает голосовое в этом чате.
    @MainActor
    var othersAction: String? {
        realtime.activity(for: chatID).action
    }

    /// Открытие чата: догнать разницу, а если истории толком нет — скачать последнюю
    /// страницу.
    ///
    /// «Толком нет» — меньше страницы на руках при первом открытии: список чатов кладёт
    /// в базу последнее сообщение каждого чата, и лента показала бы одно сообщение.
    @MainActor
    func open() async {
        if let mark = pendingWindowReset {
            await resumeAfterDetachedWindow(mark)
        } else {
            await syncOnOpen()
        }
        preparingTimeout?.cancel()
        await finishPreparing()
        // Неотправленное с прошлого раза дослать молча: человек нажал «отправить»
        // когда-то давно, и спрашивать его об этом снова незачем. Файлы, чья загрузка
        // оборвалась закрытием приложения, сами не уедут — им «Повторить».
        await uploader.failAbandoned(chatID: chatID)
        await outbox.flush(chatID: chatID)
    }

    @MainActor
    private func syncOnOpen() async {
        let known = (try? await store.syncSeq(chatID: chatID)) ?? 0
        let firstOpen = olderCursor == nil && !reachedBeginning
        if known == 0 || messages.isEmpty || (firstOpen && messages.count < ChatsAPI.messagePageLimit) {
            await loadLatest()
            // Последняя страница могла не примкнуть к позиции: между ними — пропущенное
            // за офлайн, а лента сортирует по времени и разрыва не видит. Догон закроет
            // его (или скажет «переполнение»); примкнула — это один пустой ответ.
            if known > 0 { await catchUp() }
        } else {
            await catchUp()
        }
    }

    /// Чат открыт заново, а в базе — окно истории с прошлого раза. Чат открывается на
    /// свежем, как в Telegram, поэтому окно заменяется последней страницей. Без сети
    /// остаётся окно — с прежней границей, чтобы «дыра» за ним так и не показалась.
    @MainActor
    private func resumeAfterDetachedWindow(_ mark: DetachedWindows.Mark) async {
        if await resetToLatest() == false {
            ceiling = mark.ceiling
            newerCursor = mark.cursor
        }
        pendingWindowReset = nil
        applySnapshot()
    }

    /// Открытие догнало сервер (или сеть не ответила вовремя): лента показывает базу.
    /// Срез читаем заново, а не берём последний из наблюдения: страница только что
    /// записана, и наблюдение могло ещё не донести её — тогда первым кадром снова
    /// встало бы одно превью.
    @MainActor
    private func finishPreparing() async {
        guard isPreparing else { return }
        let fresh = await freshSnapshot()
        guard isPreparing else { return }
        if let fresh { snapshot = fresh }
        isPreparing = false
        applySnapshot()
    }

    // MARK: - Отправка

    /// `silent` — «Отправить без звука»: доставка без уведомления и пуша у получателей.
    @MainActor
    func send(silent: Bool = false) async {
        guard let text = OutgoingText.sendable(composerText) else { return }
        if let editing {
            await saveEdit(of: editing, text: text)
            return
        }

        // Поле и полоса ответа пустеют сразу, до сети: человек видит, что нажатие
        // принято, даже если возврат из окна истории ещё скачивает последнюю страницу.
        let answering = replyTo?.remoteId
        input.draft = ""
        replyTo = nil
        draftTask?.cancel()

        // Своё новое сообщение встаёт в конец свежей переписки — из окна истории его не
        // было бы видно. Как в Telegram, отправка возвращает к свежему и всегда ведёт
        // ленту вниз, где бы человек ни стоял.
        await returnToLatest()
        bottomRequests += 1
        // Черновик стирается параллельно: его запрос к серверу не должен задерживать
        // появление сообщения в ленте.
        Task { @MainActor [weak self] in await self?.persistDraft("") }

        await outbox.send(text: text, chatID: chatID, senderID: viewerID, replyToID: answering, silent: silent)
        // Сообщение ушло — подпись «печатает…» снимаем явно, не дожидаясь таймера.
        lastActionAt = nil
        await realtime.send(action: nil, chatID: chatID)
    }

    /// Отправить вложение. Подпись к нему — текущий текст поля ввода: так же, как
    /// в вебе, отдельной формы для подписи нет.
    @MainActor
    func attach(_ attachment: OutgoingAttachment) async {
        // В правке подписью черновик не становится: он ждёт конца правки в поле.
        let caption = editing == nil ? OutgoingText.normalized(input.draft) : ""
        let answering = replyTo?.remoteId
        replyTo = nil
        if editing == nil {
            input.draft = ""
            draftTask?.cancel()
            Task { @MainActor [weak self] in await self?.persistDraft("") }
        }
        await returnToLatest()
        bottomRequests += 1

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
    /// `grouped: false` — «Отправить без группировки»: каждое вложение своим сообщением.
    func send(attachments: [OutgoingAttachment], caption: String, asFiles: Bool, grouped: Bool = true) async {
        guard !attachments.isEmpty else { return }
        let text = OutgoingText.normalized(caption)
        let answering = replyTo?.remoteId
        replyTo = nil
        if editing == nil {
            input.draft = ""
            draftTask?.cancel()
            Task { @MainActor [weak self] in await self?.persistDraft("") }
        }
        await returnToLatest()
        bottomRequests += 1

        var queued: [String] = []
        let batches = grouped ? Self.batches(of: attachments, asFiles: asFiles) : attachments.map { [$0] }
        for (index, batch) in batches.enumerated() {
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

    /// Крестик на плитке своего альбома: этот файл не уходит, остальные едут дальше.
    /// Последний оставшийся — то же, что отмена всего сообщения.
    @MainActor
    func cancelUpload(_ file: AttachmentRecord, in message: MessageRecord) async {
        guard message.remoteId == nil else { return }
        let files = days.lazy.flatMap(\.items).first(where: { $0.message.id == message.id })?.attachments ?? []
        guard files.count > 1, files.contains(where: { $0.id == file.id }) else {
            await cancelUpload(message)
            return
        }
        let uploads = AttachmentUploads.shared
        // Идёт или ждёт очереди — сначала загрузке: поздно (файлы в хранилище, сообщение
        // уже отправляется) — ничего не трогаем, сервер запишет его целиком.
        if uploads.runningIDs.contains(message.id), !uploads.removeFile(file.id, from: message.id) { return }
        await uploader.removeFile(file.id, messageID: message.id)
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
            && Self.isEditableKind(message.extras)
            && now.timeIntervalSince(message.createdAt) < Self.editWindow
    }

    /// Сообщения особого вида правка испортила бы: она меняет только `content`, а опрос,
    /// чек-лист, стикер, геопозиция и контакт живут в своих полях. Явный запрет по виду,
    /// а не ветка по умолчанию (IOS_RULES 7.7.13): новый особый вид добавляется сюда.
    static func isEditableKind(_ extras: MessageExtras?) -> Bool {
        guard let extras else { return true }
        return extras.poll == nil
            && extras.checklist == nil
            && extras.sticker == nil
            && extras.location == nil
            && extras.contact == nil
    }

    func canDelete(_ message: MessageRecord) -> Bool {
        message.senderId == viewerID && message.deletedAt == nil && message.systemType == nil
    }

    @MainActor
    func beginEdit(_ message: MessageRecord) {
        guard canEdit(message) else { return }
        replyTo = nil
        editing = message
        // Черновик чата не трогаем: текст правки — отдельно, после правки черновик
        // вернётся в поле.
        input.beginEdit(message.content)
    }

    @MainActor
    func cancelEdit() {
        editing = nil
        input.endEdit()
    }

    /// Правка уходит сокетом; текст в базе меняется сразу, а подтверждение придёт
    /// событием `message:updated` и перепишет строку серверной версией.
    ///
    /// Метка правки — на миг позже прежней серверной, а не часы телефона: поздний ответ
    /// страницы (со старой меткой) её не откатит, а серверное подтверждение (позже по
    /// часам сервера) примется, даже если часы телефона спешат (IOS_RULES 9.5.1).
    @MainActor
    private func saveEdit(of message: MessageRecord, text: String) async {
        editing = nil
        input.endEdit()
        guard text != message.content, let remoteID = message.remoteId else { return }
        let id = message.id
        try? await database.writer.write { db in
            guard var row = try MessageRecord.fetchOne(db, key: id) else { return }
            row.content = text
            row.editedAt = (row.editedAt ?? row.createdAt).addingTimeInterval(0.001)
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
    func createPoll(question: String, description: String?, options: [String], multiple: Bool, anonymous: Bool) async -> Bool {
        do {
            try await actions.createPoll(
                chatID: chatID, question: question, description: description,
                options: options, multiple: multiple, anonymous: anonymous
            )
            return true
        } catch {
            actionFailure = message(for: error)
            return false
        }
    }

    // MARK: - Геопозиция, контакт, список, стикер, GIF

    /// Отправка особого сообщения (не текст и не файл): сервер отвечает готовым
    /// сообщением, оно сразу ложится в базу — сокет потом принесёт его же, без дубля.
    /// `nonce` защищает от повтора: второй такой же запрос сервер не превратит во второе
    /// сообщение.
    @MainActor
    @discardableResult
    private func sendSpecial(_ request: (_ replyToID: String?, _ nonce: String) async throws -> ChatMessageDTO) async -> ChatMessageDTO? {
        let answering = replyTo?.remoteId
        let nonce = UUID().uuidString.lowercased()
        do {
            let sent = try await request(answering, nonce)
            replyTo = nil
            await returnToLatest()
            bottomRequests += 1
            try? await store.save(messages: [sent], chatID: chatID)
            return sent
        } catch {
            actionFailure = message(for: error)
            return nil
        }
    }

    @MainActor
    func sendLocation(latitude: Double, longitude: Double, title: String?, address: String?) async -> Bool {
        await sendSpecial { [actions, chatID] reply, nonce in
            try await actions.sendLocation(
                chatID: chatID, latitude: latitude, longitude: longitude, title: title, address: address,
                livePeriod: nil, accuracy: nil, replyToID: reply, nonce: nonce
            )
        } != nil
    }

    /// Живая геопозиция на `period` секунд: сообщение уходит сразу, дальше точку двигает
    /// `LiveLocationSharing` (и в фоне — с синим индикатором системы).
    @MainActor
    func sendLiveLocation(_ location: CLLocation, period: Int) async -> Bool {
        let sent = await sendSpecial { [actions, chatID] reply, nonce in
            try await actions.sendLocation(
                chatID: chatID, latitude: location.coordinate.latitude, longitude: location.coordinate.longitude,
                title: nil, address: nil, livePeriod: period,
                accuracy: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil,
                replyToID: reply, nonce: nonce
            )
        }
        guard let sent else { return false }
        let until = sent.location?.liveUntil ?? Date().addingTimeInterval(TimeInterval(period))
        LiveLocationSharing.shared.start(messageID: sent.id, chatID: chatID, until: until)
        return true
    }

    @MainActor
    func sendContact(_ contact: ContactCardDraft) async -> Bool {
        await sendSpecial { [actions, chatID] reply, nonce in
            try await actions.sendContact(chatID: chatID, contact: contact, replyToID: reply, nonce: nonce)
        } != nil
    }

    @MainActor
    func sendChecklist(title: String, items: [String], othersCanAdd: Bool, othersCanMark: Bool) async -> Bool {
        await sendSpecial { [actions, chatID] reply, nonce in
            try await actions.sendChecklist(
                chatID: chatID, title: title, items: items, othersCanAdd: othersCanAdd,
                othersCanMark: othersCanMark, replyToID: reply, nonce: nonce
            )
        } != nil
    }

    @MainActor
    func sendSticker(id: String) async -> Bool {
        await sendSpecial { [actions, chatID] reply, nonce in
            try await actions.sendSticker(chatID: chatID, stickerID: id, replyToID: reply, nonce: nonce)
        } != nil
    }

    @MainActor
    func sendExternalGif(id: String) async -> Bool {
        await sendSpecial { [actions, chatID] reply, nonce in
            try await actions.sendExternalGif(chatID: chatID, gifID: id, replyToID: reply, nonce: nonce)
        } != nil
    }

    @MainActor
    func sendGif(fileID: String) async -> Bool {
        await sendSpecial { [actions, chatID] reply, nonce in
            try await actions.sendGif(chatID: chatID, fileID: fileID, replyToID: reply, nonce: nonce)
        } != nil
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

    /// «Отправить позже»: текст из поля ввода (и ответ, если он выбран) уходит в отложенные,
    /// поле пустеет только после ответа сервера — при ошибке написанное не теряется.
    @MainActor
    func scheduleDraft(at date: Date, silent: Bool = false) async throws {
        guard editing == nil, let text = OutgoingText.sendable(input.draft) else { return }
        try await scheduled.schedule(text, at: date, replyToID: replyTo?.remoteId, silent: silent)
        input.draft = ""
        replyTo = nil
        draftTask?.cancel()
        Task { @MainActor [weak self] in await self?.persistDraft("") }
    }

    /// Отложенное отправлено сейчас: сообщение ложится в ленту сразу, не дожидаясь
    /// сокета, и лента едет к нему, как после обычной отправки.
    @MainActor
    func showSent(_ message: ChatMessageDTO) async {
        await returnToLatest()
        bottomRequests += 1
        try? await store.save(messages: [message], chatID: chatID)
    }

    /// «Открепить все сообщения»: права — как у открепления одного, решает сервер. Плашка
    /// пустеет сразу; события `message:unpinned` по каждому сообщению снимут булавки в ленте.
    @MainActor
    func unpinAll() async -> Bool {
        do {
            _ = try await actions.unpinAll(chatID: chatID)
            pinned = []
            await loadPinned()
            return true
        } catch {
            actionFailure = self.message(for: error)
            return false
        }
    }

    /// Перейти к сообщению: если оно уже в ленте — прокрутить, иначе скачать окно
    /// истории вокруг него и показать вместо переписки.
    @MainActor
    func jump(to remoteID: String) async {
        if let local = messages.first(where: { $0.remoteId == remoteID }) {
            focus = MessageFocus(id: local.id)
            return
        }
        do {
            let page = try await actions.around(messageID: remoteID, chatID: chatID)
            try await applyWindow(page, focusing: remoteID)
        } catch is CancellationError {
            return
        } catch {
            actionFailure = self.message(for: error)
        }
    }

    /// Перейти к дате: первое сообщение этого дня (или ближайшее после него) — к верху
    /// ленты, как в вебе. Если день уже лежит в ленте целиком — без запроса.
    @MainActor
    func jump(toDay day: Date) async {
        let start = Calendar.current.startOfDay(for: day)
        let coversDay = (messages.first.map { $0.createdAt < start } ?? false) || reachedBeginning
        if coversDay, let local = messages.first(where: { $0.createdAt >= start && $0.remoteId != nil }) {
            focus = MessageFocus(id: local.id, atTop: true)
            return
        }
        do {
            let page = try await api.messages(chatID: chatID, aroundDate: start, limit: ChatsAPI.dateWindowLimit)
            // Позже даты сообщений нет — сервер отдал последнюю страницу: к самому свежему.
            let target = page.items.filter { $0.createdAt >= start }.min { $0.createdAt < $1.createdAt }
                ?? page.items.max { $0.createdAt < $1.createdAt }
            try await applyWindow(page, focusing: target?.id, atTop: target.map { $0.createdAt >= start } ?? false)
        } catch is CancellationError {
            return
        } catch {
            actionFailure = self.message(for: error)
        }
    }

    // MARK: - Окно истории

    /// Показать окно истории вместо переписки. Окно, дошедшее до свежего (сервер говорит,
    /// что новее ничего нет), — это обычная лента, а не окно.
    ///
    /// Цель перехода (`focusing`, серверный id) ставится тем же шагом, что и новая лента:
    /// раздельно лента успела бы показать низ окна, а потом поехать к цели.
    @MainActor
    private func applyWindow(
        _ page: Page<ChatMessageDTO>,
        focusing remoteID: String? = nil,
        atTop: Bool = false
    ) async throws {
        windowGeneration += 1
        snapshotHolds += 1
        do {
            try await store.replaceHistory(with: page.items, chatID: chatID)
        } catch {
            releaseSnapshot()
            throw error
        }
        // В базе теперь только окно — граница не нужна.
        setFloor(nil)
        olderCursor = page.meta?.cursor
        reachedBeginning = page.meta?.hasNext != true
        if page.meta?.hasPrev == true, let cursor = page.meta?.prevCursor,
            let top = page.items.compactMap(\.seq).max()
        {
            detach(ceiling: top, cursor: cursor)
        } else {
            attach()
        }
        await showFreshSnapshot()
        // Своё сообщение лежит под локальным ключом — ищем строку по серверному id.
        if let remoteID, let local = snapshot?.messages.first(where: { $0.remoteId == remoteID }) {
            focus = MessageFocus(id: local.id, atTop: atTop)
        }
    }

    /// Срез переписки прямо из базы, мимо наблюдения: оно доносит запись асинхронно,
    /// и сразу после неё последний срез в модели ещё старый.
    @MainActor
    private func freshSnapshot() async -> ThreadSnapshot? {
        let request = store.messages(chatID: chatID, from: floor)
        let id = chatID
        let floor = floor
        return try? await database.reader.read { db in
            try ChatThreadModel.readSnapshot(request, chatID: id, floor: floor, in: db)
        }
    }

    /// Окно сменилось: показать базу как она есть сейчас, вместе с новой границей.
    @MainActor
    private func showFreshSnapshot() async {
        let fresh = await freshSnapshot()
        if let fresh { snapshot = fresh }
        releaseSnapshot()
    }

    /// Снять задержку срезов (`snapshotHolds`) и пересобрать ленту.
    @MainActor
    private func releaseSnapshot() {
        snapshotHolds = max(0, snapshotHolds - 1)
        applySnapshot()
    }

    /// Догрузка вниз из окна истории. Вызывается, когда лента подъехала к его низу.
    @MainActor
    func loadNewer() async {
        guard let cursor = newerCursor, !isLoadingNewer else { return }
        let generation = windowGeneration
        isLoadingNewer = true
        defer { isLoadingNewer = false }
        do {
            let page = try await api.newerMessages(chatID: chatID, after: cursor, limit: ChatsAPI.messagePageLimit)
            guard generation == windowGeneration else { return }
            // Страница и сдвиг границы — одним кадром: срез со страницей, но со старой
            // границей, на миг показал бы окно без неё.
            snapshotHolds += 1
            do {
                try await store.save(messages: page.items, chatID: chatID)
            } catch {
                releaseSnapshot()
                throw error
            }
            let top = page.items.compactMap(\.seq).max() ?? ceiling
            if page.meta?.hasPrev == true, let next = page.meta?.prevCursor, let top {
                detach(ceiling: top, cursor: next)
                await showFreshSnapshot()
            } else {
                attach()
                await showFreshSnapshot()
                // Окно сомкнулось со свежим. Пришедшее, пока сервер собирал страницу, и
                // пропущенное сокетом в окне догоняем разницей от позиции — её подняли
                // страницы окна, примыкавшие друг к другу.
                if top != nil { await catchUp() }
            }
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = message(for: error)
        }
    }

    /// Вернуться из окна истории к свежим сообщениям: кнопка «вниз», отправка.
    @MainActor
    func returnToLatest() async {
        guard isDetached else { return }
        if await resetToLatest() {
            bottomRequests += 1
        }
    }

    /// Заменить переписку последней страницей. `false` — сеть не ответила, база цела.
    @MainActor
    private func resetToLatest() async -> Bool {
        windowGeneration += 1
        let generation = windowGeneration
        do {
            let page = try await api.messages(chatID: chatID, cursor: nil, limit: ChatsAPI.messagePageLimit)
            // Пока шёл запрос, человек перешёл к сообщению: его окно важнее.
            guard generation == windowGeneration else { return true }
            // Корень бага «отправил из окна истории — лента уехала в старую дату»: после
            // замены базы лента собиралась из прошлого среза наблюдения (старое окно), но
            // уже без границы, и прокрутка вниз шла по нему. Следом приходила настоящая
            // последняя страница, и лента оставалась где-то посреди неё. Теперь срезы
            // держатся, пока база и граница не сменятся вместе, а лента собирается из
            // свежего чтения базы.
            snapshotHolds += 1
            do {
                try await store.replaceHistory(with: page.items, chatID: chatID)
            } catch {
                releaseSnapshot()
                throw error
            }
            setFloor(nil)
            olderCursor = page.meta?.cursor
            reachedBeginning = page.meta?.hasNext != true
            attach()
            await showFreshSnapshot()
            failure = nil
            return true
        } catch is CancellationError {
            return false
        } catch {
            failure = message(for: error)
            return false
        }
    }

    @MainActor
    private func detach(ceiling top: Int, cursor: String) {
        ceiling = top
        newerCursor = cursor
        // Отметка переживает экран и перезапуск: открытый заново чат сначала сбросит
        // окно, а не покажет его встык со свежими.
        DetachedWindows.set(DetachedWindows.Mark(ceiling: top, cursor: cursor), for: chatID)
    }

    @MainActor
    private func attach() {
        ceiling = nil
        newerCursor = nil
        DetachedWindows.set(nil, for: chatID)
    }

    /// Пересылка одного или нескольких сообщений. В каждый чат — по очереди в порядке
    /// ленты: сервер ставит пересланному своё время, и порядок отправки станет порядком
    /// в чате получателя.
    @MainActor
    func forward(_ messages: [MessageRecord], to chatIDs: [String], comment: String?, requestID: UUID) async -> ForwardOutcome {
        // По времени, а не по порядку касаний: у получателя они встанут так же, как здесь.
        let remoteIDs = messages
            .filter(Self.canForward)
            .sorted { $0.createdAt < $1.createdAt }
            .compactMap(\.remoteId)
        guard !remoteIDs.isEmpty, !chatIDs.isEmpty else { return ForwardOutcome() }
        do {
            let result = try await actions.forward(
                messageIDs: Array(remoteIDs.prefix(100)),
                to: chatIDs,
                comment: comment,
                requestID: requestID
            )
            return ForwardOutcome(
                delivered: result.results.filter(\.ok).map(\.chatId),
                failed: result.results.filter { !$0.ok }.map(\.chatId)
            )
        } catch {
            return ForwardOutcome(failure: self.message(for: error))
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

    /// Касание пузыря в режиме выбора. Сняли последнюю отметку — режим остаётся, как в
    /// Telegram: в шапке «Выберите сообщения», выход — «Отмена».
    @MainActor
    func toggleSelection(of message: MessageRecord) {
        guard var current = selection, Self.isSelectable(message) else { return }
        if current.contains(message.id) {
            current.remove(message.id)
        } else {
            current.insert(message.id)
        }
        selection = current
    }

    /// Выбранное исчезло из базы (удалено, неотправленное стёрто) — снимаем отметку,
    /// иначе счётчик и «Удалить» считали бы то, чего на экране нет.
    @MainActor
    private func pruneSelection() {
        guard let selection else { return }
        let alive = selection.intersection(messages.map(\.id))
        guard alive != selection else { return }
        self.selection = alive
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

    /// Удалить выбранное у себя можно всегда, у всех — только если всё оно своё: чужое
    /// сервер не удалит, и часть выбора молча осталась бы на месте.
    var canDeleteSelection: Bool {
        selectedMessages.contains { $0.deletedAt == nil && $0.systemType == nil }
    }

    var canDeleteSelectionForEveryone: Bool {
        let chosen = selectedMessages
        return !chosen.isEmpty && chosen.allSatisfy(canDelete)
    }

    /// Удаление выбранного: у всех — тем же путём, что и одиночное; у себя — одним
    /// запросом.
    @MainActor
    func deleteSelected(forEveryone: Bool) async {
        let chosen = selectedMessages.filter { $0.deletedAt == nil && $0.systemType == nil }
        guard !chosen.isEmpty else { return }
        if forEveryone, !chosen.allSatisfy(canDelete) { return }
        selection = nil
        if forEveryone {
            for message in chosen { await delete(message) }
        } else {
            await hide(chosen)
        }
    }

    /// «Удалить у меня»: сервер прячет сообщения только для меня, у собеседников они
    /// остаются. Неотправленное просто стирается локально — серверу о нём нечего знать.
    @MainActor
    func hide(_ chosen: [MessageRecord]) async {
        let local = chosen.filter { $0.remoteId == nil }.map(\.id)
        if !local.isEmpty {
            _ = try? await database.writer.write { db in try MessageRecord.deleteAll(db, keys: local) }
        }
        let remote = chosen.compactMap(\.remoteId)
        guard !remote.isEmpty else { return }
        do {
            var hidden: [String] = []
            // Сервер принимает до сотни за раз.
            for start in stride(from: 0, to: remote.count, by: 100) {
                let chunk = Array(remote[start..<min(start + 100, remote.count)])
                hidden += try await actions.hide(messageIDs: chunk, chatID: chatID).hiddenIds
            }
            try await store.removeHidden(remoteIDs: hidden, chatID: chatID)
        } catch {
            actionFailure = self.message(for: error)
        }
    }

    /// Сообщение по серверному id — из ленты, иначе из базы (просмотр медиа листает и
    /// далёкую историю).
    @MainActor
    func message(remoteID: String) async -> MessageRecord? {
        if let shown = messages.first(where: { $0.remoteId == remoteID }) { return shown }
        let chatID = chatID
        return try? await database.reader.read { db in
            try MessageRecord
                .filter(MessageRecord.Columns.chatId == chatID)
                .filter(MessageRecord.Columns.remoteId == remoteID)
                .fetchOne(db)
        }
    }

    /// Удаление из просмотра медиа. Сообщение в базе — тем же путём, что из меню; нет
    /// его там (далёкая история, до которой лента не доходила) — запросом к серверу.
    /// Ответ — текст ошибки для показа или `nil`.
    @MainActor
    func delete(remoteID: String, forEveryone: Bool) async -> String? {
        if forEveryone, let record = await message(remoteID: remoteID) {
            guard canDelete(record) else { return nil }
            await delete(record)
            return nil
        }
        do {
            if forEveryone {
                _ = try await actions.deleteForEveryone(messageIDs: [remoteID], chatID: chatID)
            } else {
                let hidden = try await actions.hide(messageIDs: [remoteID], chatID: chatID).hiddenIds
                try await store.removeHidden(remoteIDs: hidden, chatID: chatID)
            }
            return nil
        } catch {
            return self.message(for: error)
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

    /// Группа: кто в сети и кто до куда дочитал — для шапки и галочек. У личного чата
    /// хватает собеседника (`loadPeer`) и `othersReadAt`.
    @MainActor
    func loadGroupStatus() async {
        guard await isGroupChat() else { return }
        let api = actions
        let id = chatID
        let started = Date()
        // Оба запроса разом: шапка и галочки ждут их на входе в чат.
        async let presenceList = try? api.presence(chatID: id)
        await loadReads()
        if let list = await presenceList {
            presence = ChatPresenceSnapshot(list, takenAt: started)
        }
    }

    /// Свежий список прочитавших — при входе и при открытии листа «Прочитали».
    @MainActor
    func loadReads() async {
        do {
            readReceipts = try await actions.reads(chatID: chatID)
            readsFailure = nil
        } catch is CancellationError {
            return
        } catch {
            readsFailure = error.userMessage
            readsOffline = error.isOffline
        }
    }

    @MainActor
    private func isGroupChat() async -> Bool {
        let id = chatID
        var kind = chat?.kind
        if kind == nil {
            kind = try? await database.reader.read { db in try ChatRecord.fetchOne(db, key: id)?.kind }
        }
        guard let kind else { return false }
        return kind != .private && kind != .saved
    }

    /// До какого момента дочитал каждый другой участник группы: снимок с сервера,
    /// сдвинутый вперёд событиями прочтения.
    @MainActor
    private var readTimes: [String: Date] {
        var times: [String: Date] = [:]
        for receipt in readReceipts where receipt.id != viewerID {
            if let at = receipt.lastReadAt { times[receipt.id] = at }
        }
        for (user, at) in realtime.signals(for: chatID).memberReads where user != viewerID {
            if (times[user] ?? .distantPast) < at { times[user] = at }
        }
        return times
    }

    /// Отметки прочтения других участников по возрастанию — для числа у галочек.
    @MainActor
    var readMarks: [Date] {
        readTimes.values.sorted()
    }

    /// Кто прочитал сообщение — свежие сверху, как в Telegram. Только известные по
    /// списку с сервера: у того, о ком пришло лишь событие, нет ни имени, ни аватара.
    @MainActor
    func readers(of message: MessageRecord) -> [MessageReader] {
        let times = readTimes
        return readReceipts.compactMap { receipt in
            guard let at = times[receipt.id], at >= message.createdAt else { return nil }
            return MessageReader(id: receipt.id, name: receipt.name, avatarURL: receipt.avatarUrl, readAt: at)
        }
        .sorted { $0.readAt > $1.readAt }
    }

    /// «N в сети» в группе: сколько участников, кроме меня, сейчас в сети.
    @MainActor
    var othersOnline: Int? {
        presence?.othersOnline(excluding: viewerID) { [realtime] in realtime.presence(of: $0).mark }
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

    @MainActor
    var isPeerOnline: Bool {
        if let peerID { return realtime.presence(of: peerID).isOnline || chat?.online == true }
        return chat?.online == true
    }

    // MARK: - Черновик

    /// Лента сообщила нижнюю видимую строку — отметить прочитанным до неё.
    @MainActor
    func noteVisible(lowest id: String?) {
        guard id != lowestVisibleID else { return }
        lowestVisibleID = id
        Task { await markRead() }
    }

    /// Отметить прочитанным до последнего чужого сообщения, реально видимого в ленте
    /// (IOS_RULES 6.6.1).
    ///
    /// Шлём не чаще раза в 800 мс и только то, что действительно новее прошлой
    /// отметки: сервер двигает её только вперёд, а лишние события — это трафик на
    /// каждом прокруте. Из окна истории не шлём вовсе: оно не свежее, и отметка по нему
    /// утверждала бы о прочтении того, чего лента не показывала (9.4.17).
    @MainActor
    func markRead() async {
        guard !isDetached,
            let id = ReadVisibility.readMark(in: messages, lowestVisible: lowestVisibleID, viewerID: viewerID),
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
        // Догон с отметкой и статус группы друг от друга не зависят — параллельно.
        await withTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                await self.catchUpAfterReconnect()
                await self.markRead()
            }
            // Пока экрана не было, комната была отпущена: прочтения и входы мимо прошли.
            group.addTask { @MainActor in await self.loadGroupStatus() }
        }
    }

    /// Шапка чата: закреплённое, собеседник, статус группы. Друг от друга и от истории
    /// не зависят — грузятся разом, а не цепочкой из запросов (P1-5 аудита).
    @MainActor
    func loadHeader() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in await self.loadPinned() }
            group.addTask { @MainActor in await self.loadPeer() }
            group.addTask { @MainActor in await self.loadGroupStatus() }
            group.addTask { @MainActor in await self.scheduled.load() }
        }
    }

    @MainActor
    func draftChanged() {
        noteTyping()
        // Правка — не черновик: ни в базу, ни на сервер, иначе её текст был бы виден в вебе
        // черновиком чата. Отложенную запись настоящего черновика тоже не отменяем — она
        // донесёт набранное до правки.
        guard let text = input.draftToPersist else { return }
        draftTask?.cancel()
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

    /// «Записывает голосовое…» у собеседников. Получатель гасит подпись через четыре
    /// секунды, поэтому, пока идёт запись, подтверждение повторяется каждые три.
    @MainActor
    func announceVoice(_ recording: Bool) {
        isRecordingVoice = recording
        voiceAnnouncer?.cancel()
        voiceAnnouncer = nil
        guard recording else {
            Task { [realtime, chatID] in await realtime.send(action: nil, chatID: chatID) }
            return
        }
        voiceAnnouncer = Task { [realtime, chatID] in
            while !Task.isCancelled {
                await realtime.send(action: "RECORDING_VOICE", chatID: chatID)
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    @MainActor
    private func loadDraft() {
        Task { @MainActor [weak self, database, chatID] in
            let stored = try? await database.reader.read { db in
                try DraftRecord.fetchOne(db, key: chatID)
            }
            guard let self, self.input.draft.isEmpty, let stored else { return }
            self.input.draft = stored.text
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
        // запись остаётся несинхронизированной, следующий набор повторит. Длиннее лимита
        // сервер черновик не примет — его не шлём, он живёт в базе, пока его не сократят.
        guard OutgoingText.draftFits(text) else { return }
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
        guard !isLoadingOlder, pendingWindowReset == nil else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        // Старые сообщения уже в базе (прошлые открытия) — окно опускается без сети.
        if await lowerFloorFromDatabase() { return }
        guard !reachedBeginning else { return }
        let generation = windowGeneration

        do {
            let page = try await api.messages(
                chatID: chatID,
                cursor: olderCursor,
                limit: ChatsAPI.messagePageLimit
            )
            // Пока страница шла, ленту заменили окном: она из другого места истории.
            guard generation == windowGeneration else { return }
            try await store.save(messages: page.items, chatID: chatID)
            olderCursor = page.meta?.cursor
            reachedBeginning = page.meta?.hasNext != true
            // Страница легла ниже окна — окно опускается до неё, иначе её не было бы видно.
            if let floor, let oldest = page.items.compactMap(\.seq).min(), oldest < floor {
                setFloor(oldest)
            }
            failure = nil
        } catch is CancellationError {
            // Экран ушёл, и запрос отменили — это не сбой: не пугаем красной строкой.
            return
        } catch {
            failure = message(for: error)
        }
    }

    // MARK: - Окно наблюдения

    /// Граница окна на открытии: ≈150 свежих и всё непрочитанное с запасом — первое
    /// непрочитанное должно попасть в ленту, к нему она и откроется. Чтение строки чата
    /// синхронное: одна строка по ключу, а граница нужна до первого среза.
    @MainActor
    private func initialFloor() -> Int? {
        guard PerformanceFlags.chatWindowedObservation else { return nil }
        let id = chatID
        guard let chat = try? database.reader.read({ db in try ChatRecord.fetchOne(db, key: id) }) else { return nil }
        let span = max(Self.liveWindow, chat.unreadCount + 20)
        guard chat.lastSeq > span else { return nil }
        return chat.lastSeq - span
    }

    /// Опустить границу окна. Наблюдение перезапускается с новым запросом; лента
    /// прирастает сверху, и её позицию держит `MessageListView` (верхнее видимое сообщение).
    @MainActor
    private func setFloor(_ newFloor: Int?) {
        guard newFloor != floor else { return }
        ScrollProbe.note("floor \(floor.map(String.init) ?? "nil") -> \(newFloor.map(String.init) ?? "nil")")
        floor = newFloor
        observeMessages()
    }

    /// Старее окна в базе что-то есть — опустить границу на страницу без сети.
    @MainActor
    private func lowerFloorFromDatabase() async -> Bool {
        guard let floor else { return false }
        guard let lower = try? await store.lowerFloor(chatID: chatID, below: floor, by: ChatsAPI.messagePageLimit) else {
            return false
        }
        setFloor(lower)
        return true
    }

    // MARK: - Синхронизация

    @MainActor
    private func loadLatest() async {
        do {
            try await fetchLatest()
            failure = nil
        } catch {
            syncFailed(error)
        }
    }

    /// Последняя страница чата.
    @MainActor
    private func fetchLatest() async throws {
        let page = try await api.messages(chatID: chatID, cursor: nil, limit: ChatsAPI.messagePageLimit)
        try await store.save(messages: page.items, chatID: chatID, isHead: true)
        olderCursor = page.meta?.cursor
        reachedBeginning = page.meta?.hasNext != true
    }

    /// Догнать разницу с позиции в базе. Позиция читается здесь же, а не передаётся
    /// снаружи: сокет двигает её только по порядку (`SyncPosition`), поэтому прочитанная
    /// в любой момент она не перескакивает пропущенное (IOS_RULES 9.3.2, 9.3.3).
    @MainActor
    private func catchUp() async {
        if catchingUp {
            catchUpAgain = true
            return
        }
        catchingUp = true
        defer { catchingUp = false }
        repeat {
            catchUpAgain = false
            await catchUpPass()
        } while catchUpAgain
    }

    @MainActor
    private func catchUpPass() async {
        do {
            let mark = try await store.catchUpMark(chatID: chatID)
            // Сверки ещё не было (первая страница не дошла) — начинаем с неё.
            guard mark.since > 0 else {
                try await fetchLatest()
                return syncSucceeded()
            }
            let updates = try await api.updates(chatID: chatID, since: mark.since, sinceTs: mark.sinceTs)
            if updates.overflow {
                // Разрыв больше серверного лимита: склеивать нечего. Сначала скачать
                // последнюю страницу, потом одной транзакцией заменить ею историю — без
                // сети человек остаётся со своей офлайн-историей, а не с пустым чатом
                // (IOS_RULES 9.3.10).
                let page = try await api.messages(chatID: chatID, cursor: nil, limit: ChatsAPI.messagePageLimit)
                try await store.resetHistory(
                    with: page.items,
                    chatID: chatID,
                    latestSeq: updates.latestSeq,
                    syncedAt: updates.syncedAt
                )
                olderCursor = page.meta?.cursor
                reachedBeginning = page.meta?.hasNext != true
            } else {
                try await store.apply(updates, chatID: chatID)
            }
            syncSucceeded()
        } catch {
            syncFailed(error)
        }
    }

    @MainActor
    private func syncSucceeded() {
        failure = nil
        catchUpRetry?.cancel()
        catchUpRetry = nil
        catchUpDelay = OutboxService.firstRetryDelay
    }

    /// Синхронизация не сдаётся на временной ошибке: повтор с растущей паузой, пока
    /// сервер не ответит по существу или экран не уйдёт (IOS_RULES 9.3.1). Отказ по
    /// существу (403, 422) не повторяется — человек видит строку ошибки.
    @MainActor
    private func syncFailed(_ error: Error) {
        switch ActionFailureKind(error) {
        case .cancelled:
            // Экран ушёл, и запрос отменили — это не сбой: не пугаем красной строкой.
            return
        case .transient:
            failure = message(for: error)
            scheduleCatchUpRetry()
        case .rejected:
            failure = message(for: error)
        }
    }

    @MainActor
    private func scheduleCatchUpRetry() {
        guard catchUpRetry == nil else { return }
        let delay = OutboxService.jittered(catchUpDelay)
        catchUpDelay = min(catchUpDelay * 2, OutboxService.maxRetryDelay)
        catchUpRetry = Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard let self, !Task.isCancelled else { return }
            self.catchUpRetry = nil
            // Окно истории догоняет себя само догрузкой вниз.
            guard !self.isDetached else { return }
            await self.catchUp()
        }
    }

    // MARK: - Наблюдение за базой

    @MainActor
    private func observeMessages() {
        messagesTask?.cancel()
        let request = store.messages(chatID: chatID, from: floor)
        let id = chatID
        let floor = floor
        // Сообщения и вложения читаем одним наблюдением: раздельные дали бы кадр,
        // где картинка уже пришла, а сообщения под неё ещё нет.
        // Наблюдение будит любая запись в `message`/`attachment`, в том числе в чужом
        // чате: одинаковый срез отсеивается вне главного потока и до ленты не доходит.
        let observation = ValueObservation.tracking { db -> ThreadSnapshot in
            try ChatThreadModel.readSnapshot(request, chatID: id, floor: floor, in: db)
        }
        .removeDuplicates()
        // Сильная ссылка живёт только на шаг цикла: держи её задача весь бесконечный
        // поток, модель (и её наблюдения) не освободились бы и после ухода из чата.
        messagesTask = Task { @MainActor [weak self, database] in
            for await snapshot in AsyncValues.stream(of: observation, in: database.reader) {
                guard let self else { return }
                self.snapshot = snapshot
                self.applySnapshot()
            }
        }
    }

    /// Срез переписки: сообщения в порядке ленты и их вложения.
    private static func readSnapshot(
        _ request: QueryInterfaceRequest<MessageRecord>,
        chatID: String,
        floor: Int?,
        in db: Database
    ) throws -> ThreadSnapshot {
        let signpost = Signposts.chats.beginInterval("ThreadSnapshotRead")
        let messages = try request.fetchAll(db)
        // Вложения — только сообщений окна, та же граница, что у запроса сообщений.
        let attachments = try AttachmentRecord.fetchAll(
            db,
            sql: """
                SELECT a.* FROM attachment a
                JOIN message m ON m.id = a.messageId
                WHERE m.chatId = ? AND (? IS NULL OR m.seq >= ? OR m.seq IS NULL)
                """,
            arguments: [chatID, floor, floor]
        )
        Signposts.chats.endInterval(
            "ThreadSnapshotRead", signpost,
            "messages: \(messages.count), attachments: \(attachments.count)"
        )
        return ThreadSnapshot(
            messages: messages,
            attachments: Dictionary(grouping: attachments, by: \.messageId)
        )
    }

    /// Пересобрать ленту из среза базы. В окне истории — только то, что не новее его
    /// границы. Своё неотправленное видно всегда: оно уйдёт в конец свежей переписки,
    /// но спрятанное, пока нет сети, выглядело бы потерянным.
    @MainActor
    private func applySnapshot() {
        guard let snapshot, snapshotHolds == 0 else { return }
        let visible: [MessageRecord]
        if pendingWindowReset != nil || holdsThinHistory(snapshot) {
            visible = []
        } else if let ceiling {
            visible = snapshot.messages.filter { $0.sendState != .sent || ($0.seq ?? .max) <= ceiling }
        } else {
            visible = snapshot.messages
        }
        messages = visible
        pruneSelection()
        pickAnchorIfNeeded()
        // Лента собирается вне главного потока: на тысячах сообщений группировка по
        // дням и авторам стоила кадров на каждое изменение базы. Порядок срезов
        // сохраняется номером сборки — опоздавшая старая лента не встанет поверх новой.
        buildGeneration &+= 1
        let generation = buildGeneration
        let attachments = snapshot.attachments
        let viewer = viewerID
        let onScreen = Self.preparedOnScreen
        // В сборку уходят только значения (записи базы и строки), ссылок на модель нет;
        // `self` — слабо и только на главном потоке, после сборки.
        buildTask?.cancel()
        buildTask = Task.detached(priority: .userInitiated) { [weak self] in
            guard !Task.isCancelled else { return }
            let signpost = Signposts.chats.beginInterval("TimelineBuild")
            let built = MessageTimeline.build(from: visible, attachments: attachments, viewerID: viewer)
            Signposts.chats.endInterval("TimelineBuild", signpost, "messages: \(visible.count)")
            guard !Task.isCancelled else { return }
            // Разбор текста — здесь же, вне главного потока (п. 3): сначала то, что у
            // свежего края и встанет на экран первым, — до показа, потом остальное.
            // Разобранное уже лежит в кеше, повторная сборка только сверяет ключи.
            let texts = visible.map(\.content)
            RichText.prepare(texts.suffix(onScreen))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard let self, self.buildGeneration == generation else { return }
                self.days = built
                self.daysRevision &+= 1
            }
            RichText.prepare(texts.dropLast(onScreen).reversed())
        }
    }

    /// На открытии в базе меньше страницы, а сервер знает больше (`lastSeq` — номер
    /// последнего сообщения чата): это превью из списка, а не история. Ждём страницу.
    /// Пока строки чата нет, сравнивать не с чем — тоже ждём: открытие закончится само.
    @MainActor
    private func holdsThinHistory(_ snapshot: ThreadSnapshot) -> Bool {
        guard isPreparing else { return false }
        guard let chat else { return true }
        return snapshot.messages.count < min(ChatsAPI.messagePageLimit, chat.lastSeq)
    }

    @MainActor
    private func observeChat() {
        chatTask?.cancel()
        let id = chatID
        // Запись в строку другого чата (счётчик, прочтение) эту строку не меняет.
        let observation = ValueObservation.tracking { db in try ChatRecord.fetchOne(db, key: id) }
            .removeDuplicates()
        chatTask = Task { @MainActor [weak self, database] in
            for await chat in AsyncValues.stream(of: observation, in: database.reader) {
                guard let self else { return }
                self.chat = chat
                self.title = chat?.title
                self.unreadCount = chat?.unreadCount ?? 0
                // Пока открытие ждёт страницу, решение «показывать ли базу» зависит от
                // строки чата — она могла прийти позже сообщений.
                if self.isPreparing { self.applySnapshot() }
                self.pickAnchorIfNeeded()
            }
        }
    }

    private var unreadCount = 0

    /// Непрочитанное по счётчику сервера. Нужен кнопке «вниз» в окне истории: свежие
    /// сообщения там спрятаны за границей окна, и по ленте их не посчитать.
    var unreadInChat: Int { unreadCount }

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
    /// К верху ленты, а не по центру: переход к дате показывает день с начала.
    var atTop = false
    let token = UUID()
}

/// Чаты, оставленные посреди окна истории (`ChatThreadModel`, «Окно истории»).
///
/// В `UserDefaults`: это не данные, а пометка «база этого чата не сплошная». Открытый
/// заново чат по ней сбрасывает окно к свежему, а без сети — восстанавливает его границу.
enum DetachedWindows {
    struct Mark: Codable, Equatable {
        let ceiling: Int
        let cursor: String
    }

    private static let key = "chats.detached-windows"

    static func mark(for chatID: String) -> Mark? {
        all()[chatID]
    }

    static func set(_ mark: Mark?, for chatID: String) {
        var marks = all()
        guard marks[chatID] != mark else { return }
        marks[chatID] = mark
        if marks.isEmpty {
            UserDefaults.standard.removeObject(forKey: key)
        } else if let data = try? JSONEncoder().encode(marks) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    private static func all() -> [String: Mark] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [:] }
        return (try? JSONDecoder().decode([String: Mark].self, from: data)) ?? [:]
    }
}

/// Поток значений наблюдения GRDB.
///
/// Общий для всех экранов: ошибка чтения локальной базы не повод падать — список и
/// лента просто перестают обновляться, а показывают то, что уже прочитали.
enum AsyncValues {
    static func stream<Reducer: ValueReducer>(
        of observation: ValueObservation<Reducer>,
        in reader: any DatabaseReader
    ) -> AsyncStream<Reducer.Value> {
        AsyncStream { continuation in
            let cancellable = observation.start(
                in: reader,
                scheduling: .async(onQueue: .main),
                onError: { _ in continuation.finish() },
                onChange: { value in
                    // Значение наблюдения дошло до главного потока (после отсева, если
                    // он есть): сколько раз экран будят изменения базы.
                    Signposts.chats.emitEvent("DBChangeObserved", "\(String(describing: type(of: value)), privacy: .public)")
                    continuation.yield(value)
                }
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

/// Участник группы, прочитавший сообщение, — строка листа «Прочитали».
struct MessageReader: Identifiable, Equatable {
    let id: String
    let name: String
    let avatarURL: String?
    let readAt: Date
}

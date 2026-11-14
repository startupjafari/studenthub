import Foundation

/// Локальный «собеседник»: исходная история, входящие, «печатает…», доставка и прочтение
/// исходящих, медленная сеть и ошибки отправки. Без сети: всё — таймеры и детерминированный
/// генератор.
@MainActor
final class MockChatService {
    static let shared = MockChatService()

    nonisolated static let peer = Peer(
        id: 777, firstName: "Алина", lastName: "Соколова", username: "alina_sokol",
        phone: "+7 700 555 01 23", bio: "Фотографирую горы и кофе ☕️ Алматы", avatarFile: "photo_03.jpg"
    )

    // MARK: Настройки симуляции (Debug Menu)

    /// Отправка уходит в 6–8 раз дольше; входящие медиа «загружаются» с задержкой.
    var slowNetwork = false
    /// Следующая отправка завершится ошибкой.
    var failNextSend = false
    /// Собеседник иногда отвечает сам (выключено в UI-тестах: тесты не терпят случайностей).
    var autoReplies = !LaunchOptions.uiTesting
    /// Собеседник «прочитывает» исходящие.
    var peerReadsMessages = true

    private(set) var presence: PeerPresence = .online {
        didSet {
            guard presence != oldValue else { return }
            presenceObservers.values.forEach { $0(presence) }
        }
    }

    private var presenceObservers: [UUID: (PeerPresence) -> Void] = [:]
    private var typingWorkItem: DispatchWorkItem?
    private var pendingTimers: [DispatchWorkItem] = []
    private var incomingCursor = 0
    private var rng = SeededGenerator(seed: UInt64(Date().timeIntervalSince1970))
    private var store: ChatStore { ChatStore.shared }

    private init() {}

    func observePresence(_ observer: @escaping (PeerPresence) -> Void) -> ObservationToken {
        let id = UUID()
        presenceObservers[id] = observer
        observer(presence)
        return ObservationToken { [weak self] in
            MainActor.assumeIsolated { _ = self?.presenceObservers.removeValue(forKey: id) }
        }
    }

    // MARK: Исходящие

    func didSend(_ message: Message) {
        let id = message.id
        let base = slowNetwork ? 3.2 : 0.45
        if failNextSend {
            failNextSend = false
            after(base) { [weak self] in
                self?.store.updateStatus(id, to: .failed)
                Haptics.error()
            }
            return
        }
        after(base) { [weak self] in self?.store.updateStatus(id, to: .sent) }
        after(base + (slowNetwork ? 1.5 : 0.7)) { [weak self] in self?.store.updateStatus(id, to: .delivered) }
        guard peerReadsMessages, !store.settings.isBlocked else { return }
        after(base + (slowNetwork ? 3 : 1.6)) { [weak self] in
            guard let self else { return }
            self.store.markOutgoingRead(upTo: id)
            self.presence = .online
            self.maybeAutoReply(to: message)
        }
    }

    private func maybeAutoReply(to message: Message) {
        guard autoReplies, rng.chance(0.55) else { return }
        // Иногда собеседник ставит реакцию вместо ответа.
        if rng.chance(0.25), case .text = message.kind {
            after(0.6) { [weak self] in
                guard let self else { return }
                self.store.setPeerReaction(message.id, emoji: self.rng.pick(["👍", "❤️", "😂", "🔥", "👌"]))
            }
            return
        }
        let text = rng.pick(MockCorpus.autoReplies)
        startTyping(for: min(4, 0.9 + Double(text.count) * 0.04))
        after(min(4, 0.9 + Double(text.count) * 0.04)) { [weak self] in
            self?.deliverIncoming(Message(id: 0, author: .peer, date: Date(), text: text, status: .read))
        }
    }

    // MARK: Входящие

    /// Одно входящее из пула (по кругу), с короткой «печатью» перед ним.
    func receiveOne(withTyping: Bool = true) {
        let text = MockCorpus.incomingPool[incomingCursor % MockCorpus.incomingPool.count]
        incomingCursor += 1
        let message = Message(id: 0, author: .peer, date: Date(), text: text, status: .read)
        if withTyping {
            startTyping(for: 1.2)
            after(1.2) { [weak self] in self?.deliverIncoming(message) }
        } else {
            deliverIncoming(message)
        }
    }

    /// Пачка входящих подряд — проверка вставки нескольких строк и счётчика у кнопки «вниз».
    func receive(count: Int) {
        var batch: [Message] = []
        for offset in 0..<count {
            let text = MockCorpus.incomingPool[(incomingCursor + offset) % MockCorpus.incomingPool.count]
            batch.append(Message(id: 0, author: .peer, date: Date().addingTimeInterval(Double(offset) * 0.01), text: text, status: .read))
        }
        incomingCursor += count
        stopTyping()
        store.receive(batch: batch)
        if let last = batch.last {
            LocalNotifications.shared.notifyIfNeeded(about: last, count: count)
        }
    }

    func receivePhoto() {
        let spec = rng.pick(MediaCatalog.photos)
        let caption = rng.chance(0.5) ? rng.pick(MockCorpus.captions) : ""
        presence = .choosingPhoto
        after(slowNetwork ? 3 : 1) { [weak self] in
            self?.deliverIncoming(Message(id: 0, author: .peer, date: Date(), text: caption, kind: spec.messageKind, status: .read))
        }
    }

    func receiveVoice() {
        let spec = rng.pick(MediaCatalog.voices)
        presence = .recordingVoice
        after(slowNetwork ? 3 : 1.5) { [weak self] in
            self?.deliverIncoming(Message(id: 0, author: .peer, date: Date(), text: "", kind: spec.messageKind, status: .read, isConsumed: false))
        }
    }

    func receiveVideoNote() {
        let spec = rng.pick(MediaCatalog.videoNotes)
        presence = .recordingVideo
        after(slowNetwork ? 3 : 1.5) { [weak self] in
            self?.deliverIncoming(Message(id: 0, author: .peer, date: Date(), text: "", kind: spec.messageKind, status: .read, isConsumed: false))
        }
    }

    private func deliverIncoming(_ message: Message) {
        guard !store.settings.isBlocked else {
            stopTyping()
            return
        }
        stopTyping()
        store.receive(message)
        if let last = store.lastMessage {
            LocalNotifications.shared.notifyIfNeeded(about: last, count: 1)
        }
    }

    // MARK: «Печатает…»

    var isTyping: Bool { presence.isActivity }

    func toggleTyping() {
        if presence.isActivity {
            stopTyping()
        } else {
            startTyping(for: nil)
        }
    }

    /// `duration == nil` — печатает, пока не выключат (Debug Menu).
    func startTyping(for duration: TimeInterval?) {
        typingWorkItem?.cancel()
        presence = .typing
        guard let duration else { return }
        let item = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                if self?.presence.isActivity == true { self?.presence = .online }
            }
        }
        typingWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.5, execute: item)
    }

    func stopTyping() {
        typingWorkItem?.cancel()
        if presence.isActivity { presence = .online }
    }

    func setPresence(_ presence: PeerPresence) { self.presence = presence }

    // MARK: Сброс

    func reset() {
        pendingTimers.forEach { $0.cancel() }
        pendingTimers.removeAll()
        stopTyping()
        slowNetwork = false
        failNextSend = false
        incomingCursor = 0
        presence = .online
        store.resetToInitial()
    }

    private func after(_ delay: TimeInterval, _ block: @escaping @MainActor () -> Void) {
        let item = DispatchWorkItem { MainActor.assumeIsolated { block() } }
        pendingTimers.append(item)
        if pendingTimers.count > 64 { pendingTimers.removeFirst(pendingTimers.count - 64) }
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    // MARK: Исходная история

    /// Не меньше 300 сообщений за ~7 недель: диалоги из `MockCorpus`, между ними — фото,
    /// альбомы, видео, GIF, голосовые, кружки, файлы, ссылки, ответы, пересылки, правки и реакции.
    /// Детерминированно: сброс всегда даёт ту же историю (кроме привязки ко «сейчас»).
    nonisolated static func initialState(now: Date = Date()) -> ChatState {
        ChatState(
            peer: peer, messages: generateHistory(now: now), pinnedIds: [], settings: ChatSettings(),
            forwardedCounts: [:]
        ).withDefaultPins()
    }

    nonisolated static let targetMessageCount = 340

    nonisolated static func generateHistory(now: Date) -> [Message] {
        var rng = SeededGenerator(seed: 20_261_115)
        let calendar = Calendar(identifier: .gregorian)
        let totalDays = 48
        var messages: [Message] = []
        var dialogueCursor = 0
        let dialogues = MockCorpus.dialogues
        var photoCursor = 0, videoCursor = 0, gifCursor = 0, voiceCursor = 0, roundCursor = 0, fileCursor = 0
        var nextGroupId: Int64 = 1

        func add(_ author: Author, _ date: Date, _ text: String, _ kind: MessageKind = .text) {
            var message = Message(
                id: MessageID(messages.count + 1), author: author, date: date, text: text, kind: kind, status: .read
            )
            // Ответ на одно из недавних.
            if rng.chance(0.08), messages.count > 5 {
                let candidates = messages.suffix(20).filter { !$0.isService }
                if let target = candidates.randomElement(using: &rng) { message.replyTo = target.id }
            }
            if case .text = kind, author == .me, rng.chance(0.05) {
                message.editedAt = date.addingTimeInterval(90)
            }
            if rng.chance(0.11) {
                let emoji = rng.pick(["👍", "❤️", "😂", "🔥", "😮", "😢", "🙏", "👌", "🎉", "🤔"])
                let both = rng.chance(0.2)
                message.reactions = [MessageReaction(emoji: emoji, byMe: author == .peer || both, byPeer: author == .me || both)]
            }
            messages.append(message)
        }

        func addMedia(_ author: Author, _ date: inout Date) {
            let roll = rng.next() % 100
            switch roll {
            case 0..<30:
                let spec = MediaCatalog.photos[photoCursor % MediaCatalog.photos.count]
                photoCursor += 1
                add(author, date, rng.chance(0.4) ? rng.pick(MockCorpus.captions) : "", spec.messageKind)
            case 30..<40:
                // Альбом 2–5 фото/видео: подпись у последнего.
                let count = rng.int(2...5)
                let groupId = nextGroupId
                nextGroupId += 1
                let caption = rng.chance(0.6) ? rng.pick(MockCorpus.captions) : ""
                for index in 0..<count {
                    let kind: MessageKind
                    if index == 1, rng.chance(0.3) {
                        kind = MediaCatalog.videos[videoCursor % MediaCatalog.videos.count].messageKind
                        videoCursor += 1
                    } else {
                        kind = MediaCatalog.photos[photoCursor % MediaCatalog.photos.count].messageKind
                        photoCursor += 1
                    }
                    var message = Message(
                        id: MessageID(messages.count + 1), author: author, date: date,
                        text: index == count - 1 ? caption : "", kind: kind, status: .read, groupId: groupId
                    )
                    if index == count - 1, rng.chance(0.3) {
                        message.reactions = [MessageReaction(emoji: "😍", byMe: author == .peer, byPeer: author == .me)]
                    }
                    messages.append(message)
                }
            case 40..<50:
                let spec = MediaCatalog.videos[videoCursor % MediaCatalog.videos.count]
                videoCursor += 1
                add(author, date, rng.chance(0.3) ? rng.pick(MockCorpus.captions) : "", spec.messageKind)
            case 50..<58:
                let spec = MediaCatalog.gifs[gifCursor % MediaCatalog.gifs.count]
                gifCursor += 1
                add(author, date, "", spec.messageKind)
            case 58..<76:
                let spec = MediaCatalog.voices[voiceCursor % MediaCatalog.voices.count]
                voiceCursor += 1
                add(author, date, "", spec.messageKind)
            case 76..<84:
                let spec = MediaCatalog.videoNotes[roundCursor % MediaCatalog.videoNotes.count]
                roundCursor += 1
                add(author, date, "", spec.messageKind)
            default:
                let spec = MediaCatalog.files[fileCursor % MediaCatalog.files.count]
                fileCursor += 1
                add(author, date, rng.chance(0.3) ? rng.pick(MockCorpus.captions) : "", spec.messageKind)
            }
            date.addTimeInterval(Double(rng.int(20...200)))
        }

        func addSession(startingAt start: Date, limit: Date?) {
            var date = start
            let dialogue = dialogues[dialogueCursor % dialogues.count]
            dialogueCursor += 1
            for line in dialogue {
                if let limit, date > limit { break }
                add(line.author, date, line.text)
                date.addTimeInterval(Double(rng.int(8...150)))
                if rng.chance(0.16) {
                    addMedia(rng.chance(0.5) ? .me : .peer, &date)
                }
                if rng.chance(0.025) {
                    add(rng.chance(0.5) ? .me : .peer, date, rng.pick(MockCorpus.emojiOnly))
                    date.addTimeInterval(Double(rng.int(5...60)))
                }
            }
            if rng.chance(0.12) {
                add(rng.chance(0.5) ? .me : .peer, date, rng.pick(MockCorpus.linkMessages))
            }
            if rng.chance(0.06) {
                add(rng.chance(0.5) ? .me : .peer, date.addingTimeInterval(30), rng.pick(MockCorpus.longTexts))
            }
            if rng.chance(0.08) {
                var message = Message(
                    id: MessageID(messages.count + 1), author: rng.chance(0.5) ? .me : .peer,
                    date: date.addingTimeInterval(45), text: rng.pick(MockCorpus.forwardedTexts), status: .read
                )
                message.forward = ForwardInfo(
                    authorName: rng.pick(MockCorpus.forwardSources),
                    date: date.addingTimeInterval(-Double(rng.int(3600...400_000)))
                )
                messages.append(message)
            }
        }

        let perDay = Double(targetMessageCount) / Double(totalDays)
        for dayOffset in stride(from: totalDays, through: 1, by: -1) {
            guard let day = calendar.date(byAdding: .day, value: -dayOffset, to: calendar.startOfDay(for: now)) else { continue }
            if rng.chance(0.12) { continue } // дни без переписки
            let budget = Int(perDay * Double(totalDays - dayOffset + 1))
            var hour = rng.int(8...12)
            while messages.count < budget, hour < 23 {
                let start = day.addingTimeInterval(Double(hour * 3600 + rng.int(0...3000)))
                addSession(startingAt: start, limit: day.addingTimeInterval(23.9 * 3600))
                hour += rng.int(2...5)
            }
        }
        // Сегодня: последняя сессия заканчивается за несколько минут до «сейчас».
        var todayStart = now.addingTimeInterval(-2.5 * 3600)
        if !calendar.isDate(todayStart, inSameDayAs: now) { todayStart = calendar.startOfDay(for: now) }
        while messages.count < targetMessageCount {
            addSession(startingAt: todayStart, limit: now.addingTimeInterval(-60))
            todayStart = min(now.addingTimeInterval(-600), todayStart.addingTimeInterval(1800))
        }

        // Даты строго растут: сессии одного дня могли наложиться.
        for index in messages.indices.dropFirst() where messages[index].date <= messages[index - 1].date {
            messages[index].date = messages[index - 1].date.addingTimeInterval(Double(rng.int(5...40)))
        }
        if let last = messages.last, last.date > now {
            let shift = last.date.timeIntervalSince(now) + 120
            for index in messages.indices { messages[index].date.addTimeInterval(-shift) }
        }

        // Статусы хвоста: последнее исходящее доставлено, но ещё не прочитано.
        if let lastOutgoing = messages.lastIndex(where: { $0.isOutgoing }) {
            messages[lastOutgoing].status = .delivered
        }
        // Одно непрослушанное входящее голосовое и кружок в конце.
        if let lastVoice = messages.lastIndex(where: { if case .voice = $0.kind { return !$0.isOutgoing } else { return false } }) {
            messages[lastVoice].isConsumed = false
        }
        // Неотправленное сообщение сегодня — показать ошибку отправки.
        if let failedIndex = messages.indices.reversed().dropFirst(6).first(where: { messages[$0].isOutgoing && messages[$0].kind == .text }) {
            messages[failedIndex].status = .failed
            messages[failedIndex].reactions = []
        }
        // Номера по порядку.
        for index in messages.indices {
            messages[index].id = MessageID(index + 1)
        }
        return messages
    }
}

private extension ChatState {
    /// Два закрепа: первое длинное сообщение и последняя ссылка.
    func withDefaultPins() -> ChatState {
        var copy = self
        if let long = messages.first(where: { $0.text.count > 300 }) { copy.pinnedIds.append(long.id) }
        if let link = messages.last(where: { $0.text.contains("https://") }) { copy.pinnedIds.append(link.id) }
        return copy
    }
}

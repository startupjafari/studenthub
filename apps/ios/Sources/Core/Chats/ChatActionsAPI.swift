import Foundation

// Действия над чатами и сообщениями сверх списка и истории: реакции, закрепление,
// пересылка, участники, управление группой, поиск, опросы (PROJECT.md §8.3, §9).
// Правка и удаление сообщений идут через сокет — см. `RealtimeCoordinator`.

/// Участник чата.
struct ChatMemberDTO: Decodable, Equatable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?
    let avatarUrl: String?
    let role: String?
    let online: Bool?
    /// Есть, только когда человек не в сети и разрешил показывать время.
    let lastSeenAt: Date?
    let banned: Bool?
    let isAdmin: Bool?

    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

/// Заблокированный мной человек (`GET /chats/blocks`). Имя пустое у удалённого аккаунта:
/// блокировка переживает удаление, а строка в списке всё равно нужна, чтобы её снять.
struct BlockedUserDTO: Decodable, Equatable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?
    let avatarUrl: String?
    let blockedAt: Date?

    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

/// Человек из справочника вуза — для нового чата и добавления в группу.
struct DirectoryUserDTO: Decodable, Equatable, Identifiable {
    struct Named: Decodable, Equatable {
        let name: String?
    }

    let id: String
    let firstName: String?
    let lastName: String?
    let avatarUrl: String?
    let role: String?
    let group: Named?
    /// Справочник отдаёт группу плоским полем; `group` — у прежних ответов.
    var groupName: String? = nil

    /// Группа человека, чем бы её ни прислал сервер.
    var groupTitle: String? { groupName ?? group?.name }

    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

/// Файл из раздела «Медиа», «Файлы» или «Голосовые» в информации о чате.
struct ChatMediaItemDTO: Decodable, Equatable, Identifiable {
    let id: String
    let messageId: String
    let name: String?
    let mime: String
    let size: Int?
    let width: Int?
    let height: Int?
    let placeholder: String?
    let durationMs: Int?
    let createdAt: Date
    /// Кто прислал — подпись строки голосового.
    var sender: ChatPersonDTO? = nil

    var isVideo: Bool { mime.hasPrefix("video/") }
}

/// Ссылка из раздела «Ссылки».
struct ChatLinkItemDTO: Decodable, Equatable, Identifiable {
    let messageId: String
    let createdAt: Date
    let sender: ChatPersonDTO?
    let linkPreview: MessageExtras.LinkPreview?

    var id: String { messageId }
}

/// Результаты опроса.
struct PollResultsDTO: Decodable, Equatable {
    struct Option: Decodable, Equatable, Identifiable {
        let id: String
        let text: String
        let votes: Int
        let voters: [ChatPersonDTO]?
    }

    let id: String
    let anonymous: Bool
    let multiple: Bool
    let allowRevote: Bool
    let closed: Bool
    let totalVotes: Int
    let options: [Option]
    let myOptionIds: [String]
}

/// Кто дочитал групповой чат до какого момента.
struct ChatReadDTO: Decodable, Equatable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?
    let avatarUrl: String?
    let lastReadAt: Date?

    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

/// Статус «в сети» участника чата (`GET /chats/:id/presence`). Сервер отдаёт весь
/// состав без забаненных, вместе со смотрящим; чей статус смотрящему не положено
/// видеть, тот приходит «не в сети».
struct ChatPresenceDTO: Decodable, Equatable {
    let userId: String
    let online: Bool
}

/// День календаря переписки со снимком: `day` — местная дата `YYYY-MM-DD`, `url` —
/// миниатюра самого свежего снимка дня.
struct ChatCalendarDayDTO: Decodable, Equatable {
    let day: String
    let url: String
}

/// Вид раздела вложений в информации о чате.
enum ChatMediaKind: String {
    /// `voice` — всё аудио (так его понимает веб), `voiceNote` — только голосовые,
    /// `music` — аудиофайлы без голосовых, `gif` — анимации.
    case media, file, voice, music, gif
    case voiceNote = "voice_note"
}

/// Куда листать общие материалы от курсора: к старым (как раньше) или к новым —
/// просмотр медиа чата идёт в обе стороны от открытого снимка.
enum ChatMediaDirection: String {
    case older, newer
}

/// Место медиа среди всех медиа чата: `index` с единицы от самого старого, `total` —
/// сколько их всего. Терпимо к неполному ответу: без чисел счётчик просто не показывается.
struct ChatMediaPositionDTO: Decodable, Equatable {
    let index: Int?
    let total: Int?

    init(index: Int?, total: Int?) {
        self.index = index
        self.total = total
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        index = try? container.decodeIfPresent(Int.self, forKey: .index)
        total = try? container.decodeIfPresent(Int.self, forKey: .total)
    }

    private enum CodingKeys: String, CodingKey { case index, total }
}

/// Реакции: сервер принимает любой emoji, одну реакцию на человека.
enum ChatReactions {
    /// Двойное нажатие на пузырь — как в вебе.
    static let doubleTap = "🔥"
}

protocol ChatActing: ChatMessaging, ChatThreadTooling {
    // Сообщения
    func react(messageID: String, emoji: String) async throws -> ChatMessageDTO
    func setPinned(_ pinned: Bool, messageID: String) async throws
    func pinned(chatID: String) async throws -> [ChatMessageDTO]
    func forward(messageID: String, to chatID: String) async throws
    func searchMessages(_ query: String, chatID: String?) async throws -> [ChatMessageDTO]
    func searchInChat(_ query: String, chatID: String, senderID: String?, cursor: String?) async throws -> Page<ChatMessageDTO>
    func around(messageID: String, chatID: String) async throws -> Page<ChatMessageDTO>
    func reads(chatID: String) async throws -> [ChatReadDTO]
    // Чат
    func presence(chatID: String) async throws -> [ChatPresenceDTO]
    func members(chatID: String) async throws -> [ChatMemberDTO]
    func media(chatID: String, kind: ChatMediaKind, page: PageRequest) async throws -> Page<ChatMediaItemDTO>
    /// Соседние медиа для просмотра: страница от курсора (id файла) в сторону `direction`.
    func media(chatID: String, kind: ChatMediaKind, cursor: String?, direction: ChatMediaDirection, limit: Int) async throws -> Page<ChatMediaItemDTO>
    /// Номер медиа среди всех медиа чата — счётчик «746 из 752» в просмотре.
    func mediaPosition(chatID: String, fileID: String, kind: ChatMediaKind) async throws -> ChatMediaPositionDTO
    func links(chatID: String, page: PageRequest) async throws -> Page<ChatLinkItemDTO>
    func mute(chatID: String, minutes: Int?, importantOnly: Bool) async throws
    func clearHistory(chatID: String) async throws
    func clearHistory(chatID: String, from: Date, to: Date) async throws
    func mediaCalendar(chatID: String, from: Date, to: Date) async throws -> [ChatCalendarDayDTO]
    func deleteChat(chatID: String) async throws
    func acceptRequest(chatID: String) async throws
    func declineRequest(chatID: String) async throws
    func setBlocked(_ blocked: Bool, userID: String) async throws
    func blockedUsers() async throws -> [BlockedUserDTO]
    func saveDraft(chatID: String, text: String) async throws
    // Создание и поиск людей
    func directory(_ query: String) async throws -> [DirectoryUserDTO]
    func createPrivate(with userID: String) async throws -> String
    func createGroup(title: String, memberIDs: [String]) async throws -> String
    func savedMessages() async throws -> String
    // Группа
    func updateGroup(chatID: String, title: String?, description: String?) async throws
    func addMember(chatID: String, userID: String) async throws
    func removeMember(chatID: String, userID: String) async throws
    func setAdmin(_ admin: Bool, chatID: String, userID: String) async throws
    func inviteCode(chatID: String) async throws -> String
    func resetInviteCode(chatID: String) async throws -> String
    func setBanned(_ banned: Bool, chatID: String, userID: String) async throws
    func transferOwnership(chatID: String, to userID: String) async throws
    func uploadGroupAvatar(chatID: String, jpeg: Data) async throws -> String
    func removeGroupAvatar(chatID: String) async throws
    func join(chatID: String, code: String) async throws
    // Папки
    func createFolder(name: String, chatIDs: [String]) async throws -> ChatFolderDTO
    func updateFolder(id: String, name: String?, chatIDs: [String]?, position: Int?) async throws -> ChatFolderDTO
    func deleteFolder(id: String) async throws
    // Опросы
    func poll(id: String) async throws -> PollResultsDTO
    func vote(pollID: String, optionIDs: [String]) async throws
    func createPoll(chatID: String, question: String, options: [String], multiple: Bool, anonymous: Bool) async throws
}

extension ChatsAPI: ChatActing {
    func react(messageID: String, emoji: String) async throws -> ChatMessageDTO {
        try await client.send(
            try .post("chats/messages/\(messageID)/reactions", json: ["emoji": emoji]),
            as: ChatMessageDTO.self
        )
    }

    func setPinned(_ pinned: Bool, messageID: String) async throws {
        let path = "chats/messages/\(messageID)/pin"
        try await client.send(pinned ? .post(path) : Endpoint(method: .delete, path: path))
    }

    func pinned(chatID: String) async throws -> [ChatMessageDTO] {
        try await client.send(.get("chats/\(chatID)/pinned"), as: [ChatMessageDTO].self)
    }

    func forward(messageID: String, to chatID: String) async throws {
        try await client.send(try .post("chats/\(chatID)/forward", json: ["messageId": messageID]))
    }

    func searchMessages(_ query: String, chatID: String?) async throws -> [ChatMessageDTO] {
        var items = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "limit", value: "50")]
        if let chatID { items.append(URLQueryItem(name: "chatId", value: chatID)) }
        return try await client.page(.get("chats/search", query: items), of: ChatMessageDTO.self).items
    }

    /// Поиск внутри одного чата — для поиска прямо в переписке. Свежие первыми, страницы
    /// по курсору: стрелка «вверх» дочитывает следующую, когда дошла до конца загруженного.
    func searchInChat(_ query: String, chatID: String, senderID: String?, cursor: String?) async throws -> Page<ChatMessageDTO> {
        var items = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "chatId", value: chatID),
            URLQueryItem(name: "limit", value: String(ChatsAPI.searchPageLimit)),
        ]
        if let senderID { items.append(URLQueryItem(name: "senderId", value: senderID)) }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await client.page(.get("chats/search", query: items), of: ChatMessageDTO.self)
    }

    /// Окно истории вокруг сообщения — переход к закреплённому, к найденному, по ссылке.
    func around(messageID: String, chatID: String) async throws -> Page<ChatMessageDTO> {
        try await client.page(
            .get(
                "chats/\(chatID)/messages",
                query: [URLQueryItem(name: "around", value: messageID), URLQueryItem(name: "limit", value: "50")]
            ),
            of: ChatMessageDTO.self
        )
    }

    func reads(chatID: String) async throws -> [ChatReadDTO] {
        try await client.send(.get("chats/\(chatID)/reads"), as: [ChatReadDTO].self)
    }

    func presence(chatID: String) async throws -> [ChatPresenceDTO] {
        try await client.send(.get("chats/\(chatID)/presence"), as: [ChatPresenceDTO].self)
    }

    func members(chatID: String) async throws -> [ChatMemberDTO] {
        try await client.send(.get("chats/\(chatID)/members"), as: [ChatMemberDTO].self)
    }

    func media(chatID: String, kind: ChatMediaKind, page: PageRequest) async throws -> Page<ChatMediaItemDTO> {
        let query = [URLQueryItem(name: "type", value: kind.rawValue)] + page.cursorQuery
        return try await client.page(.get("chats/\(chatID)/media", query: query), of: ChatMediaItemDTO.self)
    }

    func media(chatID: String, kind: ChatMediaKind, cursor: String?, direction: ChatMediaDirection, limit: Int) async throws -> Page<ChatMediaItemDTO> {
        var query = [
            URLQueryItem(name: "type", value: kind.rawValue),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        // К старым — значение сервера по умолчанию: параметр не шлём, как и раньше.
        if direction == .newer { query.append(URLQueryItem(name: "direction", value: direction.rawValue)) }
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await client.page(.get("chats/\(chatID)/media", query: query), of: ChatMediaItemDTO.self)
    }

    func mediaPosition(chatID: String, fileID: String, kind: ChatMediaKind) async throws -> ChatMediaPositionDTO {
        try await client.send(
            .get("chats/\(chatID)/media/\(fileID)/position", query: [URLQueryItem(name: "type", value: kind.rawValue)]),
            as: ChatMediaPositionDTO.self
        )
    }

    func links(chatID: String, page: PageRequest) async throws -> Page<ChatLinkItemDTO> {
        try await client.page(.get("chats/\(chatID)/links", query: page.cursorQuery), of: ChatLinkItemDTO.self)
    }

    /// Без `minutes` — навсегда. «Только важное» оставляет упоминания и ответы мне.
    func mute(chatID: String, minutes: Int?, importantOnly: Bool) async throws {
        struct Body: Encodable {
            let minutes: Int?
            let importantOnly: Bool?
        }
        try await client.send(
            try .post("chats/\(chatID)/mute", json: Body(minutes: minutes, importantOnly: importantOnly ? true : nil))
        )
    }

    /// Очистка у себя: у собеседников история остаётся.
    func clearHistory(chatID: String) async throws {
        try await client.send(try .post("chats/\(chatID)/clear", json: [String: String]()))
    }

    /// Очистка у себя за период: границы включительно, сервер сравнивает время сообщения.
    func clearHistory(chatID: String, from: Date, to: Date) async throws {
        let format = ISO8601DateFormatter.contract
        try await client.send(
            try .post(
                "chats/\(chatID)/clear",
                json: ["from": format.string(from: from), "to": format.string(from: to)]
            )
        )
    }

    /// Миниатюры снимков по дням — кружки календаря «Перейти к дате». `tzOffset` — как
    /// `getTimezoneOffset()` в браузере: день считает сервер, а рисуем местные даты.
    func mediaCalendar(chatID: String, from: Date, to: Date) async throws -> [ChatCalendarDayDTO] {
        struct Response: Decodable {
            let items: [ChatCalendarDayDTO]
        }
        let format = ISO8601DateFormatter.contract
        let offset = -TimeZone.current.secondsFromGMT(for: from) / 60
        let query = [
            URLQueryItem(name: "from", value: format.string(from: from)),
            URLQueryItem(name: "to", value: format.string(from: to)),
            URLQueryItem(name: "tzOffset", value: String(offset)),
        ]
        return try await client.send(.get("chats/\(chatID)/media/calendar", query: query), as: Response.self).items
    }

    /// Владелец группы удаляет её целиком, участник выходит, личный чат скрывается у
    /// себя вместе с историей — решает сервер по роли.
    func deleteChat(chatID: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "chats/\(chatID)"))
    }

    func acceptRequest(chatID: String) async throws {
        try await client.send(.post("chats/\(chatID)/request/accept"))
    }

    func declineRequest(chatID: String) async throws {
        try await client.send(.post("chats/\(chatID)/request/decline"))
    }

    func setBlocked(_ blocked: Bool, userID: String) async throws {
        let path = "chats/blocks/\(userID)"
        try await client.send(blocked ? .post(path) : Endpoint(method: .delete, path: path))
    }

    /// Сервер отдаёт до 200 последних блокировок одним массивом, без курсора.
    func blockedUsers() async throws -> [BlockedUserDTO] {
        try await client.send(.get("chats/blocks"), as: [BlockedUserDTO].self)
    }

    func saveDraft(chatID: String, text: String) async throws {
        try await client.send(
            Endpoint(
                method: .put,
                path: "chats/\(chatID)/draft",
                body: try JSONCoding.encoder.encode(["text": text])
            )
        )
    }

    /// Справочник «кому написать». Ответ — страница `{ items, hasMore }`, а не массив:
    /// разбор массивом падал на каждом запросе, и поиск людей в чатах всегда был пуст.
    func directory(_ query: String) async throws -> [DirectoryUserDTO] {
        struct Answer: Decodable {
            let items: [DirectoryUserDTO]
        }
        return try await client.send(
            .get("users/directory", query: [URLQueryItem(name: "q", value: query), URLQueryItem(name: "limit", value: "30")]),
            as: Answer.self
        ).items
    }

    /// Личный чат не дублируется: сервер вернёт уже существующий.
    func createPrivate(with userID: String) async throws -> String {
        try await create(type: "PRIVATE", title: nil, memberIDs: [userID])
    }

    func createGroup(title: String, memberIDs: [String]) async throws -> String {
        try await create(type: "GROUP", title: title, memberIDs: memberIDs)
    }

    func savedMessages() async throws -> String {
        try await client.send(.get("chats/saved"), as: Created.self).id
    }

    func updateGroup(chatID: String, title: String?, description: String?) async throws {
        struct Body: Encodable {
            let title: String?
            let description: String?
        }
        try await client.send(
            Endpoint(
                method: .patch,
                path: "chats/\(chatID)",
                body: try JSONCoding.encoder.encode(Body(title: title, description: description))
            )
        )
    }

    func addMember(chatID: String, userID: String) async throws {
        try await client.send(try .post("chats/\(chatID)/members", json: ["userId": userID]))
    }

    func removeMember(chatID: String, userID: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "chats/\(chatID)/members/\(userID)"))
    }

    func setAdmin(_ admin: Bool, chatID: String, userID: String) async throws {
        let path = "chats/\(chatID)/members/\(userID)/admin"
        try await client.send(admin ? .post(path) : Endpoint(method: .delete, path: path))
    }

    func inviteCode(chatID: String) async throws -> String {
        struct Invite: Decodable { let code: String }
        return try await client.send(.get("chats/\(chatID)/invite"), as: Invite.self).code
    }

    /// Новый код ссылки: прежняя перестаёт работать (сервер меняет его и сам — при
    /// исключении и бане, чтобы человек не вернулся по старой).
    func resetInviteCode(chatID: String) async throws -> String {
        struct Invite: Decodable { let code: String }
        return try await client.send(.post("chats/\(chatID)/invite/reset"), as: Invite.self).code
    }

    /// Бан в группе — только у создателя. Забаненный остаётся в составе с отметкой
    /// `banned`: так его видно в «Заблокированных», и снять бан есть с кого.
    func setBanned(_ banned: Bool, chatID: String, userID: String) async throws {
        let path = "chats/\(chatID)/members/\(userID)/ban"
        try await client.send(banned ? .post(path) : Endpoint(method: .delete, path: path))
    }

    /// Прежний владелец остаётся админом группы.
    func transferOwnership(chatID: String, to userID: String) async throws {
        try await client.send(.post("chats/\(chatID)/transfer/\(userID)"))
    }

    /// Аватар группы — multipart с полем `file`, как аватар профиля; только создатель.
    /// Возвращает новый адрес картинки.
    func uploadGroupAvatar(chatID: String, jpeg: Data) async throws -> String {
        struct Answer: Decodable { let avatarUrl: String }
        var form = MultipartForm()
        form.append(jpeg, name: "file", filename: "avatar.jpg", mime: "image/jpeg")
        return try await client.send(.multipart("chats/\(chatID)/avatar", form: form), as: Answer.self).avatarUrl
    }

    func removeGroupAvatar(chatID: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "chats/\(chatID)/avatar"))
    }

    func join(chatID: String, code: String) async throws {
        try await client.send(try .post("chats/\(chatID)/join", json: ["code": code]))
    }

    func createFolder(name: String, chatIDs: [String]) async throws -> ChatFolderDTO {
        struct Body: Encodable {
            let name: String
            let chatIds: [String]
        }
        return try await client.send(
            try .post("chats/folders", json: Body(name: name, chatIds: chatIDs)),
            as: ChatFolderDTO.self
        )
    }

    /// Состав уходит целиком, а не дельтой — так ждёт сервер. Пустые поля в тело не
    /// попадают: схема строгая, и `null` вместо «не менять» он отклонил бы.
    func updateFolder(id: String, name: String?, chatIDs: [String]?, position: Int?) async throws -> ChatFolderDTO {
        struct Body: Encodable {
            let name: String?
            let chatIds: [String]?
            let position: Int?
        }
        return try await client.send(
            Endpoint(
                method: .patch,
                path: "chats/folders/\(id)",
                body: try JSONCoding.encoder.encode(Body(name: name, chatIds: chatIDs, position: position))
            ),
            as: ChatFolderDTO.self
        )
    }

    /// Сами чаты остаются на месте — уходит только вкладка.
    func deleteFolder(id: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "chats/folders/\(id)"))
    }

    func poll(id: String) async throws -> PollResultsDTO {
        try await client.send(.get("chats/polls/\(id)"), as: PollResultsDTO.self)
    }

    /// Пустой список — отозвать голос.
    func vote(pollID: String, optionIDs: [String]) async throws {
        try await client.send(try .post("chats/polls/\(pollID)/vote", json: ["optionIds": optionIDs]))
    }

    func createPoll(chatID: String, question: String, options: [String], multiple: Bool, anonymous: Bool) async throws {
        struct Body: Encodable {
            let question: String
            let options: [String]
            let multiple: Bool
            let anonymous: Bool
        }
        try await client.send(
            try .post(
                "chats/\(chatID)/poll",
                json: Body(question: question, options: options, multiple: multiple, anonymous: anonymous)
            )
        )
    }

    private struct Created: Decodable { let id: String }

    private func create(type: String, title: String?, memberIDs: [String]) async throws -> String {
        struct Body: Encodable {
            let type: String
            let title: String?
            let memberIds: [String]
        }
        return try await client.send(
            try .post("chats", json: Body(type: type, title: title, memberIds: memberIDs)),
            as: Created.self
        ).id
    }
}

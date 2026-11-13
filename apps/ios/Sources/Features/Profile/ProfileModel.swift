import Foundation
import Observation

/// Вкладки профиля — те же, что в вебе (`widgets/user-profile`). Фото и видео —
/// один запрос, разделённый по типу: сервер отдаёт их вместе.
enum ProfileTab: String, CaseIterable, Identifiable {
    case posts
    case photos
    case videos
    case articles
    case polls

    var id: String { rawValue }

    var title: String {
        switch self {
        case .posts: return String(localized: "profile.tab.posts", defaultValue: "Посты")
        case .photos: return String(localized: "profile.tab.photos", defaultValue: "Фото")
        case .videos: return String(localized: "profile.tab.videos", defaultValue: "Видео")
        case .articles: return String(localized: "profile.tab.articles", defaultValue: "Статьи")
        case .polls: return String(localized: "profile.tab.polls", defaultValue: "Опросы")
        }
    }

    var symbol: String {
        switch self {
        case .posts: return "text.below.photo"
        case .photos: return "photo.on.rectangle"
        case .videos: return "play.rectangle"
        case .articles: return "doc.richtext"
        case .polls: return "chart.bar.xaxis"
        }
    }

    /// Заголовок пустой вкладки — про то, чего именно нет, а не общее «пусто».
    var emptyTitle: String {
        switch self {
        case .posts: return String(localized: "profile.noPosts", defaultValue: "Публикаций пока нет")
        case .photos: return String(localized: "profile.empty.photos", defaultValue: "Фото пока нет")
        case .videos: return String(localized: "profile.empty.videos", defaultValue: "Видео пока нет")
        case .articles: return String(localized: "profile.empty.articles", defaultValue: "Статей пока нет")
        case .polls: return String(localized: "profile.empty.polls", defaultValue: "Опросов пока нет")
        }
    }

    /// Подсказка в своём профиле: что сюда попадёт. В чужом подсказки нет — там
    /// человеку нечего с этим делать.
    var emptyHint: String {
        switch self {
        case .posts: return String(localized: "profile.empty.postsHint", defaultValue: "Ваши публикации появятся здесь")
        case .photos: return String(localized: "profile.empty.photosHint", defaultValue: "Загруженные фото появятся здесь")
        case .videos: return String(localized: "profile.empty.videosHint", defaultValue: "Загруженные видео появятся здесь")
        case .articles: return String(localized: "profile.empty.articlesHint", defaultValue: "Ваши статьи появятся здесь")
        case .polls: return String(localized: "profile.empty.pollsHint", defaultValue: "Ваши опросы появятся здесь")
        }
    }

    /// Что грузит вкладка. Фото и видео — один запрос: открыв одну из них, вторую
    /// второй раз не спрашиваем.
    fileprivate var source: ProfileTab {
        self == .videos ? .photos : self
    }

    /// Вкладки, которые делят запрос с этой.
    fileprivate var sharing: [ProfileTab] {
        source == .photos ? [.photos, .videos] : [self]
    }
}

/// Данные профиля: карточка, итоги вкладок, содержимое вкладок и дружба.
///
/// Вкладки грузятся лениво — при первом открытии: человек, зашедший посмотреть
/// группу и курс, не должен тянуть сотню фото.
@MainActor
@Observable
final class ProfileModel {
    let userID: String?

    private(set) var profile: UserProfileDTO?
    private(set) var counts: ProfileCountsDTO?
    private(set) var friendsCount: Int?
    private(set) var friendship: FriendshipStatusDTO?
    private(set) var media: [ProfileMediaDTO]?
    private(set) var articles: [ArticleCardDTO]?
    private(set) var polls: [ProfilePollDTO]?
    private(set) var failure: String?
    private(set) var isOffline = false
    private(set) var actionFailure: String?
    /// Карточка на экране — из сохранённого (или из оболочки), а обновить не вышло:
    /// короткая плашка, не замена экрана ошибкой.
    var staleNotice: String?
    private(set) var tabFailure: [ProfileTab: String] = [:]
    /// Вкладки, чей сбой — из-за связи.
    private(set) var offlineTabs: Set<ProfileTab> = []

    private let feed: FeedFetching
    private let content: ProfileContentFetching
    /// Дружба с этим человеком: статус меняется сразу (п. 23 аудита).
    private let friendshipSync: OptimisticSync<String, String>
    /// Голос в опросе: доли пересчитываются сразу, без перезагрузки вкладки (п. 24).
    private let voteSync: OptimisticSync<String, [String]>
    /// Id дружбы для «принять» и «убрать»: после заявки он новый, и следующий шаг
    /// (отозвать) должен взять уже его.
    @ObservationIgnored private var friendshipID: String?

    init(
        userID: String?,
        feed: FeedFetching = FeedAPI(),
        content: ProfileContentFetching = ProfileContentAPI(),
        pacing: OptimisticPacing = .standard
    ) {
        self.userID = userID
        self.feed = feed
        self.content = content
        friendshipSync = OptimisticSync(label: "profile.friendship", pacing: pacing)
        voteSync = OptimisticSync(label: "profile.vote", pacing: pacing)
    }

    var isMine: Bool { userID == nil }
    var resolvedID: String? { userID ?? profile?.id }

    /// Фото и видео разделяются один раз, при загрузке, а не при каждой отрисовке сетки.
    private(set) var photos: [ProfileMediaDTO]?
    private(set) var videos: [ProfileMediaDTO]?

    /// Вкладки, чей запрос уже в пути. Вкладку спрашивают и смена выбора, и появление
    /// её заглушки — без этого уходило два одинаковых запроса.
    private var loadingTabs: Set<ProfileTab> = []

    @MainActor
    func load() async {
        let feed = feed
        let userID = userID
        let request: () async throws -> UserProfileDTO = {
            if let userID { return try await feed.user(id: userID) }
            return try await feed.me()
        }
        // Чужой профиль, открытый раньше, — из кеша экранов сразу (свой уже взят из
        // оболочки, `adopt`).
        if profile == nil, let cached = await ScreenCache.cached(request), profile == nil {
            profile = cached
        }
        do {
            let value = try await ScreenCache.refreshing(request)
            profile = value
            failure = nil
            isOffline = false
        } catch is CancellationError {
            return
        } catch {
            if profile != nil { staleNotice = error.userMessage }
            failure = error.userMessage
            if case .transport = error as? APIError { isOffline = true }
            return
        }
        guard let id = resolvedID else { return }
        let stamp = friendshipSync.beginRead()
        async let counts = try? content.counts(userID: id)
        async let friendship: FriendshipStatusDTO? = isMine ? nil : try? content.friendship(with: id)
        async let friends: Int? = isMine ? try? content.friendsCount() : nil
        self.counts = await counts
        if let loaded = await friendship {
            // Пока шаг дружбы в пути, id из чтения, начатого раньше, может быть уже
            // устаревшим — его узнает сам шаг.
            if !friendshipSync.isPending(id) { friendshipID = loaded.friendshipId }
            let shown = friendshipSync.resolve(id, server: loaded.status, readAt: stamp)
            self.friendship = FriendshipStatusDTO(status: shown, friendshipId: loaded.friendshipId)
        } else if isMine {
            self.friendship = nil
        }
        self.friendsCount = await friends
    }

    /// Свой профиль поменяли на экране правки — шапка обновляется без запроса.
    @MainActor
    func adopt(_ profile: UserProfileDTO) {
        self.profile = profile
    }

    @MainActor
    func loadTab(_ tab: ProfileTab, force: Bool = false) async {
        guard let id = resolvedID, tab != .posts else { return }
        let source = tab.source
        guard force || !loadingTabs.contains(source) else { return }
        loadingTabs.insert(source)
        defer { loadingTabs.remove(source) }
        do {
            switch tab {
            case .posts:
                return
            case .photos, .videos:
                guard force || media == nil else { return }
                let loaded = try await content.media(userID: id)
                media = loaded
                photos = loaded.filter { !$0.isVideo }
                videos = loaded.filter(\.isVideo)
            case .articles:
                guard force || articles == nil else { return }
                articles = try await content.articles(userID: id)
            case .polls:
                guard force || polls == nil else { return }
                let stamp = voteSync.beginRead()
                let loaded = try await content.polls(userID: id)
                // Голос, ещё не решённый сервером, — поверх ответа.
                polls = loaded.map { poll in
                    let shown = voteSync.resolve(poll.id, server: poll.myVotes, readAt: stamp)
                    return shown == poll.myVotes ? poll : poll.applyingVote(shown)
                }
            }
            for affected in tab.sharing {
                tabFailure[affected] = nil
                offlineTabs.remove(affected)
            }
        } catch {
            // Сбой общего запроса — сбой обеих вкладок: открытая, пока он шёл, иначе
            // так и крутила бы загрузку.
            for affected in tab.sharing {
                tabFailure[affected] = error.userMessage
                if error.isOffline { offlineTabs.insert(affected) } else { offlineTabs.remove(affected) }
            }
        }
    }

    /// Голос: отметка и доли — сразу; отказ возвращает опрос как был. Вкладку
    /// перечитываем уже после подтверждения и фоном, без спиннера: свежие числа других
    /// голосов и право видеть итоги («итоги после голоса») — от сервера.
    @MainActor
    func vote(poll: ProfilePollDTO, optionIDs: [String]) async {
        guard !optionIDs.isEmpty else { return }
        let content = content
        let settlement = await voteSync.set(
            poll.id,
            to: optionIDs,
            current: poll.myVotes,
            apply: { [weak self] votes in self?.applyVote(pollID: poll.id, votes: votes) },
            send: { _, votes in
                // 409 здесь — отказ («Опрос завершён», «Вы уже проголосовали»), а не
                // успех: откат и причина на экране.
                try await content.vote(pollID: poll.id, optionIDs: votes)
                return nil
            },
            failed: { [weak self] error in self?.actionFailure = error.rollbackMessage }
        )
        // Подтвердили — свежие доли; откатили — правда сервера (опрос мог закрыться).
        if settlement == .confirmed || settlement == .rolledBack {
            await loadTab(.polls, force: true)
        }
    }

    @MainActor
    private func applyVote(pollID: String, votes: [String]) {
        guard var list = polls, let index = list.firstIndex(where: { $0.id == pollID }) else { return }
        guard list[index].myVotes != votes else { return }
        list[index] = list[index].applyingVote(votes)
        polls = list
    }

    // MARK: Дружба

    /// Добавить, принять, отозвать, убрать — кнопка меняется сразу.
    ///
    /// Переходы: «нет» → «заявка отправлена», «входящая» → «друзья», «друзья» и
    /// «исходящая» → «нет». Нажатие во время полёта меняет только итог, и уходит
    /// ровно один запрос на итоговое состояние. 409 на заявку — успех, только если
    /// сервер правда держит заявку или дружбу («уже отправлена»); «недавно отклонили» —
    /// отказ с причиной. Удаление уже удалённой (404) — успех. Id дружбы неизвестен —
    /// сначала читается с сервера: шаг не пропадает молча.
    @MainActor
    func friendshipAction() async {
        guard let id = userID, let current = friendship else { return }
        let target: String
        switch current.status {
        case "NONE": target = "PENDING_OUTGOING"
        case "PENDING_INCOMING": target = "ACCEPTED"
        default: target = "NONE"
        }
        let content = content
        await friendshipSync.set(
            id,
            to: target,
            current: current.status,
            apply: { [weak self] status in self?.applyFriendship(status) },
            send: { [weak self] from, to in
                var known = self?.friendshipID
                if known == nil, to != "PENDING_OUTGOING" {
                    let current = try await content.friendship(with: id)
                    self?.adoptFriendshipID(current)
                    known = current.friendshipId
                }
                switch (from, to) {
                case ("NONE", "PENDING_OUTGOING"):
                    do {
                        try await content.requestFriendship(with: id)
                    } catch where error.isAlreadyApplied(turningOn: true) {
                        let truth = try await content.friendship(with: id)
                        guard ["PENDING_OUTGOING", "ACCEPTED"].contains(truth.status) else { throw error }
                        self?.adoptFriendshipID(truth)
                        return truth.status
                    }
                case ("PENDING_INCOMING", "ACCEPTED"):
                    guard let known else { return "NONE" }
                    try await content.acceptFriendship(id: known)
                case (_, "NONE"):
                    // Id так и нет — на сервере дружбы уже нет.
                    guard let known else { return "NONE" }
                    do {
                        try await content.removeFriendship(id: known)
                    } catch where error.isAlreadyApplied(turningOn: false) {}
                default:
                    break
                }
                // Правда — у сервера: и статус (заявку могли принять встречно), и id
                // дружбы для следующего шага. Нет связи на этом чтении — верим своему.
                guard let truth = try? await content.friendship(with: id) else { return nil }
                self?.adoptFriendshipID(truth)
                return truth.status
            },
            failed: { [weak self] error in self?.actionFailure = error.rollbackMessage }
        )
    }

    /// Свежий id дружбы с сервера. Кнопка уже показывает этот статус — подставляем id и
    /// в неё; показывает другой (нажали ещё раз) — статус решит движок.
    @MainActor
    private func adoptFriendshipID(_ truth: FriendshipStatusDTO) {
        friendshipID = truth.friendshipId
        if friendship?.status == truth.status, friendship != truth {
            friendship = truth
        }
    }

    @MainActor
    private func applyFriendship(_ status: String) {
        guard friendship?.status != status else { return }
        friendship = FriendshipStatusDTO(status: status, friendshipId: status == "NONE" ? nil : friendshipID)
    }

    /// Ошибка действия, сделанного с экрана мимо модели (открыть чат).
    @MainActor
    func report(_ error: Error) {
        actionFailure = error.userMessage
    }

    @MainActor
    func dismissActionFailure() {
        actionFailure = nil
    }
}

extension ProfilePollDTO {
    /// Опрос с моим голосом `votes` вместо прежнего: доли пересчитаны на месте, как
    /// их пересчитает сервер. Пустой `votes` — голос снят (откат).
    func applyingVote(_ votes: [String]) -> ProfilePollDTO {
        let old = Set(myVotes)
        let new = Set(votes)
        let options = options.map { option in
            let delta = (new.contains(option.id) ? 1 : 0) - (old.contains(option.id) ? 1 : 0)
            return Option(id: option.id, text: option.text, votes: max(0, option.votes + delta))
        }
        let voterDelta = (new.isEmpty ? 0 : 1) - (old.isEmpty ? 0 : 1)
        return ProfilePollDTO(
            id: id,
            question: question,
            multiple: multiple,
            closed: closed,
            options: options,
            totalVotes: max(0, totalVotes + new.count - old.count),
            participants: participants.map { max(0, $0 + voterDelta) },
            myVotes: votes,
            canSeeResults: canSeeResults,
            canVote: canVote,
            createdAt: createdAt
        )
    }

}

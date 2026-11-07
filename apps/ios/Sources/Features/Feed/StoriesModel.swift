import Foundation
import Observation

/// Истории на главной: кольца, отметки просмотра и действия зрителя.
///
/// Событий сокета для историй сервер не шлёт (PROJECT.md §9) — кольца обновляются
/// вместе с лентой, по жесту «потянуть вниз».
@Observable
final class StoriesModel {
    private(set) var rings: [StoryRingDTO] = []
    private(set) var hasLoaded = false
    /// Раздел выключен флагом или не загрузился: полосы нет, а лента работает.
    private(set) var failure: String?
    private(set) var actionFailure: String?

    private let api: StoriesFetching
    private let feed: FeedFetching

    init(api: StoriesFetching = StoriesAPI(), feed: FeedFetching = FeedAPI()) {
        self.api = api
        self.feed = feed
    }

    @MainActor
    func refresh() async {
        do {
            rings = try await api.rings()
            failure = nil
        } catch {
            // Выключенный флаг отвечает 404 на соседних маршрутах, а список — пустым;
            // в обоих случаях полосы просто нет.
            failure = message(for: error)
        }
        hasLoaded = true
    }

    /// Своё кольцо — первое в выдаче сервера.
    func ownRing(viewerID: String) -> StoryRingDTO? {
        rings.first { $0.author.id == viewerID }
    }

    @MainActor
    func markViewed(_ story: StoryDTO, viewerID: String) async {
        guard story.seen != true else { return }
        update(storyID: story.id) { $0.seen = true }
        // Своё сервер не считает, но и отметка «просмотрено» в кольце от этого не врёт.
        guard ring(of: story.id)?.author.id != viewerID else { return }
        try? await api.markViewed(storyID: story.id)
    }

    func isMine(_ emoji: String, on story: StoryDTO) -> Bool {
        story.reactions?.first { $0.emoji == emoji }?.mine ?? false
    }

    @MainActor
    func toggle(_ emoji: String, on story: StoryDTO) async {
        let was = isMine(emoji, on: story)
        update(storyID: story.id) { $0.reactions = Self.reactions(story.reactions ?? [], emoji: emoji, mine: !was) }
        do {
            try await api.react(storyID: story.id, emoji: emoji, on: !was)
        } catch {
            update(storyID: story.id) { $0.reactions = story.reactions }
            actionFailure = message(for: error)
        }
    }

    @MainActor
    func vote(_ optionID: String, on story: StoryDTO) async {
        do {
            let updated = try await api.vote(storyID: story.id, optionID: optionID)
            update(storyID: story.id) { $0.poll = updated.poll }
        } catch {
            actionFailure = message(for: error)
        }
    }

    @MainActor
    func reply(_ text: String, to story: StoryDTO) async -> Bool {
        do {
            try await api.reply(storyID: story.id, text: text)
            return true
        } catch {
            actionFailure = message(for: error)
            return false
        }
    }

    @MainActor
    func delete(_ story: StoryDTO) async {
        do {
            try await api.delete(storyID: story.id)
            for index in rings.indices {
                rings[index].stories.removeAll { $0.id == story.id }
            }
            rings.removeAll { $0.stories.isEmpty }
        } catch {
            actionFailure = message(for: error)
        }
    }

    @MainActor
    func mute(_ authorID: String) async {
        do {
            try await api.mute(authorID: authorID)
            rings.removeAll { $0.author.id == authorID }
        } catch {
            actionFailure = message(for: error)
        }
    }

    @MainActor
    func report(_ story: StoryDTO, reason: String) async -> Bool {
        do {
            try await feed.report(.story, id: story.id, reason: reason)
            return true
        } catch {
            actionFailure = message(for: error)
            return false
        }
    }

    /// Новая история: файл в бакет историй, затем сама запись.
    @MainActor
    func publish(media: PreparedMedia?, text: String?, background: String?, audience: StoryAudience) async -> Bool {
        do {
            var fileID: String?
            if let media {
                fileID = try await feed.upload(media.data, mime: media.mime, filename: media.filename, bucket: .stories).id
            }
            try await api.create(
                fileID: fileID,
                text: text,
                background: media == nil ? background : nil,
                audience: audience
            )
            await refresh()
            return true
        } catch {
            actionFailure = message(for: error)
            return false
        }
    }

    @MainActor
    func dismissActionFailure() {
        actionFailure = nil
    }

    // MARK: - Внутреннее

    private func ring(of storyID: String) -> StoryRingDTO? {
        rings.first { $0.stories.contains { $0.id == storyID } }
    }

    @MainActor
    private func update(storyID: String, _ change: (inout StoryDTO) -> Void) {
        for ringIndex in rings.indices {
            guard let index = rings[ringIndex].stories.firstIndex(where: { $0.id == storyID }) else { continue }
            change(&rings[ringIndex].stories[index])
            rings[ringIndex].hasUnseen = rings[ringIndex].stories.contains { $0.seen != true }
        }
    }

    private static func reactions(_ current: [StoryDTO.Reaction], emoji: String, mine: Bool) -> [StoryDTO.Reaction] {
        var result = current.filter { $0.emoji != emoji }
        let count = current.first { $0.emoji == emoji }?.count ?? 0
        let next = max(0, count + (mine ? 1 : -1))
        if next > 0 { result.append(StoryDTO.Reaction(emoji: emoji, count: next, mine: mine)) }
        return result
    }

    private func message(for error: Error) -> String {
        (error as? APIError)?.displayMessage
            ?? (error as? LocalizedError)?.errorDescription
            ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
    }
}

import Foundation
import os

/// Кеш экранов: показать сохранённое сразу, обновить фоном (stale-while-revalidate,
/// итерация 5, `CHANGELOG-PERF.md`).
///
/// Сохраняются не модели, а сырые ответы GET (`ScreenCacheStore`): моделям не нужен
/// `Encodable`, и экран собирает значение из сохранённого тем же кодом, что из сети.
/// Режим задаётся на время загрузки экрана значением задачи (`@TaskLocal`), а клиент API
/// (`APIClient.perform`) его читает:
/// - `cached { … }` — тот же `load` экрана, но ответы — только с диска; сети нет совсем
///   (ни запросов, ни продления сессии). Чего-то нет — `nil`, экран ждёт сеть;
/// - `refreshing { … }` — обычная загрузка, успешные GET-ответы сохраняются.
///
/// Вне этих скобок клиент работает как раньше: кешируются только экраны, которые
/// попросили. Чувствительные маршруты не кешируются никогда (`allows`).
enum ScreenCache {
    enum Mode: Sendable {
        /// Только сохранённое, без сети.
        case cachedOnly
        /// Сеть, с сохранением ответов.
        case refresh
    }

    struct Scope: Sendable {
        let mode: Mode
        let owner: String
        let generation: Int
    }

    @TaskLocal static var scope: Scope?

    private static let signposter = Signposts.screenCache

    /// Значение экрана из сохранённых ответов, без сети. `nil` — нет (не входил, флаг
    /// выключен, какого-то ответа нет на диске, он не разобрался).
    static func cached<Value>(
        store: ScreenCacheStore = .shared,
        _ load: () async throws -> Value
    ) async -> Value? {
        guard PerformanceFlags.screenCache, let owner = store.owner else { return nil }
        let signpost = signposter.beginInterval("ScreenCacheRead")
        let value = try? await $scope.withValue(Scope(mode: .cachedOnly, owner: owner, generation: store.generation)) {
            try await load()
        }
        signposter.endInterval("ScreenCacheRead", signpost, "\(value == nil ? "miss" : "hit", privacy: .public)")
        return value
    }

    /// Загрузка по сети с сохранением GET-ответов для следующего открытия.
    static func refreshing<Value>(
        store: ScreenCacheStore = .shared,
        _ load: () async throws -> Value
    ) async throws -> Value {
        guard PerformanceFlags.screenCache, let owner = store.owner else { return try await load() }
        return try await $scope.withValue(Scope(mode: .refresh, owner: owner, generation: store.generation)) {
            try await load()
        }
    }

    /// Язык ответа: сервер выбирает тексты по `Accept-Language`, который ставит система.
    static var language: String {
        Bundle.main.preferredLocalizations.first ?? "ru"
    }

    /// Можно ли сохранять ответ этого маршрута. Не сохраняется (решение — в
    /// `CHANGELOG-PERF.md`, итерация 5):
    /// - вход, сессии, коды, приглашения, QR, проверка подлинности — одноразовое и секреты;
    /// - охрана, камеры, агенты камер — живое состояние и ПДн посетителей со своим сроком
    ///   хранения: копия на телефоне его обходила бы;
    /// - журнал аудита, выгрузки, скачивания файлов — чувствительное и крупное;
    /// - состояние платформы, версия клиента, условия и согласия — обязаны быть свежими;
    /// - чаты — у них своя база; счётчик непрочитанного — свой источник;
    /// - любой запрос с параметром-токеном (`t`, `token`, `code`).
    static func allows(path: String, query: [URLQueryItem]) -> Bool {
        let segments = path.split(separator: "/").map(String.init)
        guard let first = segments.first else { return false }
        if excludedRoots.contains(first) { return false }
        if segments.contains(where: excludedSegments.contains) { return false }
        if path.hasSuffix("unread-count") { return false }
        if query.contains(where: { tokenParameters.contains($0.name.lowercased()) }) { return false }
        return true
    }

    private static let excludedRoots: Set<String> = [
        "auth", "security", "cameras", "camera-agents", "invites", "audit", "verify", "student-id",
        "client-version", "platform", "terms", "onboarding", "mini", "chats", "consent", "legal",
    ]

    private static let excludedSegments: Set<String> = [
        "download", "export", "exports", "file", "qr", "token", "tokens", "2fa", "sessions", "check-in",
        "checkin", "passcode", "meeting",
    ]

    private static let tokenParameters: Set<String> = ["t", "token", "code", "otp"]
}

/// Ответа нет в сохранённом (или маршрут не сохраняется): режим «только сохранённое»
/// не идёт в сеть.
struct ScreenCacheMiss: Error {}

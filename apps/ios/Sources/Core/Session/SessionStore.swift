import Foundation
import os

/// Сессия пользователя: кто вошёл и каким токеном подписываются запросы.
///
/// Актор, а не класс с замком, ровно из-за одного требования плана: обновление
/// должно быть одно в полёте. Холодный старт поднимает несколько экранов разом, и
/// без этого они пошлют три параллельных `refresh`; сервер считает повторное
/// использование refresh-токена кражей и гасит сессию целиком — человек оказывается
/// на экране входа без всякой причины.
actor SessionStore: AuthorizationProvider {
    private let auth: SessionRefreshing
    private let secrets: SecretStore
    private let cookies: RefreshCookieStore

    private var token: AccessToken?
    private var inFlightRefresh: Task<AccessToken?, Never>?
    /// Номер последнего заведённого продления: снимает с полёта только своё.
    private var refreshGeneration = 0
    /// Последнее продление не дало ответа по существу: не было сети или сервер ответил
    /// 5xx. Сессия при этом жива — решить, что она кончилась, может только отказ сервера.
    private var refreshUndecided = false
    /// Сервер окончательно отказал в продлении: интерфейсу пора на экран входа.
    private var sessionEnded: (@Sendable () -> Void)?

    init(
        auth: SessionRefreshing = AuthAPI(),
        secrets: SecretStore = Keychain(),
        cookies: RefreshCookieStore = RefreshCookieJar.shared
    ) {
        self.auth = auth
        self.secrets = secrets
        self.cookies = cookies
    }

    /// Был ли вход на этом устройстве. По нему холодный старт решает, пробовать
    /// продлить сессию или сразу показать экран входа.
    var hasStoredSession: Bool {
        secrets.value(for: .sessionPresent) != nil
    }

    /// Разобранный токен — для тех, кому нужна роль и scope, а не строка.
    var currentToken: AccessToken? { token }

    /// Холодный старт: поднять сессию и вернуть разобранный токен.
    ///
    /// Отдельно от `accessToken()` ради одной строки — та отдаёт строку для
    /// заголовка, а корневому экрану нужна роль, чтобы решить, что показывать.
    /// Возврат `nil` означает ровно одно: показывать вход.
    func restoredToken() async -> AccessToken? {
        _ = await accessToken()
        return token
    }

    /// Холодный старт с ответом на вопрос «что показать».
    ///
    /// Вход на устройстве был и последний токен известен — интерфейс открывается сразу
    /// по нему, из базы, не дожидаясь сети: роль и id в токене есть, а чаты и расписание
    /// лежат локально. Токен ещё действует — он и подписывает запросы, продление не
    /// нужно. Истёк — продление уходит фоном; запросы экранов, пришедшие раньше ответа,
    /// ждут это же продление (`inFlightRefresh`). Отказ сервера в нём переведёт интерфейс
    /// на вход (`onSessionEnded`), а нет связи или 5xx — нет: сессия жива, пока сервер
    /// не сказал обратного.
    ///
    /// Без последнего токена (вход сборкой до него) — как раньше: ждём продления.
    func restore() async -> SessionRestoration {
        if hasStoredSession, let raw = secrets.value(for: .lastAccessToken), let known = AccessToken(raw: raw) {
            if known.isUsable() {
                token = known
                return .active(known)
            }
            // Продление заводится здесь же, синхронно: запрос экрана, пришедший следом,
            // застанет его в полёте и присоединится, а не пошлёт второе.
            _ = startRefresh()
            return .cached(known)
        }
        if let restored = await restoredToken() { return .active(restored) }
        return .none
    }

    // MARK: - AuthorizationProvider

    func accessToken() async -> String? {
        if let token, token.isUsable() { return token.raw }
        guard token != nil || hasStoredSession else { return nil }
        return await refreshedAccessToken()
    }

    func refreshedAccessToken() async -> String? {
        await startRefresh().value?.raw
    }

    /// Продление в полёте — одно на всех: новое заводится, только если прежнего нет.
    /// Задача сама снимает себя с полёта, когда закончит, — в том числе фоновая, которую
    /// никто не ждёт (`restore`).
    private func startRefresh() -> Task<AccessToken?, Never> {
        if let inFlightRefresh { return inFlightRefresh }
        refreshGeneration &+= 1
        let generation = refreshGeneration
        let task = Task<AccessToken?, Never> {
            let refreshed = await self.performRefresh()
            if self.refreshGeneration == generation { self.inFlightRefresh = nil }
            return refreshed
        }
        inFlightRefresh = task
        return task
    }

    /// Подписка на конец сессии, который случился не по кнопке «Выйти»: refresh-токен
    /// отозвали (выход на другом устройстве, смена пароля) или он истёк.
    func onSessionEnded(_ handler: @escaping @Sendable () -> Void) {
        sessionEnded = handler
    }

    // MARK: - Жизненный цикл сессии

    /// Принять сессию, выданную входом или обновлением.
    ///
    /// Сервер только что положил свежую refresh-cookie — переносим её в связку
    /// ключей, пока она на месте: хранилище cookie система вправе очистить, связку
    /// ключей — нет.
    @discardableResult
    func adopt(_ session: AuthSession) -> AccessToken? {
        guard let parsed = AccessToken(raw: session.accessToken) else { return nil }
        token = parsed
        refreshUndecided = false
        secrets.set(session.accessToken, for: .lastAccessToken)
        if let refreshCookie = cookies.value() {
            secrets.set(refreshCookie, for: .refreshToken)
        }
        secrets.set("1", for: .sessionPresent)
        return parsed
    }

    /// Выход. Сначала гасим сессию на сервере, затем чистим своё — порядок важен:
    /// после очистки отправить запрос уже нечем, и сессия осталась бы живой.
    ///
    /// `deviceToken` — токен пушей: сервер отвязывает его вместе с сессией. Сервер не
    /// ответил (нет сети) — выход откладывается: refresh-токен и токен пушей остаются в
    /// связке ключей, и выход досылается, когда связь вернётся. Иначе сессия жила бы на
    /// сервере ещё месяц, а пуши прежнего человека шли бы на этот телефон.
    /// `false` — выход отложен.
    @discardableResult
    func signOut(deviceToken: String? = nil) async -> Bool {
        restoreRefreshCookieIfNeeded()
        let refreshToken = cookies.value() ?? secrets.value(for: .refreshToken)
        var delivered = true
        do {
            try await auth.endSession(deviceToken: deviceToken, refreshToken: nil)
        } catch let error as APIError where error.isUndecided {
            if let refreshToken {
                postpone(PendingLogout(refreshToken: refreshToken, deviceToken: deviceToken))
                delivered = false
            }
        } catch {
            // Ответ по существу (сессия уже мертва, запрос отклонён) — гасить нечего.
        }
        forgetSession()
        return delivered
    }

    /// Дослать выходы, отложенные без сети. Каждый — своей refresh-cookie: сервер гасит
    /// сессию того, кто выходил, а не того, кто вошёл после него, и отвязывает токен
    /// пушей, только если тот ещё числится за вышедшим.
    func completePendingLogouts() async {
        var remaining: [PendingLogout] = []
        for pending in pendingLogouts {
            do {
                try await auth.endSession(deviceToken: pending.deviceToken, refreshToken: pending.refreshToken)
            } catch let error as APIError where error.isUndecided {
                remaining.append(pending)
            } catch {
                // Отказ по существу (сессия уже истекла) — повторять нечего.
            }
        }
        savePendingLogouts(remaining)
    }

    var hasPendingLogouts: Bool { !pendingLogouts.isEmpty }

    private var pendingLogouts: [PendingLogout] {
        guard let raw = secrets.value(for: .pendingLogouts), let data = raw.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([PendingLogout].self, from: data)) ?? []
    }

    private func postpone(_ logout: PendingLogout) {
        savePendingLogouts(pendingLogouts + [logout])
    }

    private func savePendingLogouts(_ list: [PendingLogout]) {
        guard !list.isEmpty else { return secrets.remove(.pendingLogouts) }
        guard
            let data = try? JSONEncoder().encode(list),
            let raw = String(data: data, encoding: .utf8)
        else { return }
        secrets.set(raw, for: .pendingLogouts)
    }

    private func performRefresh() async -> AccessToken? {
        restoreRefreshCookieIfNeeded()
        // Только исход, без токена: токенам в логах и метках не место.
        let signpost = Signposts.launch.beginInterval("TokenRefresh")
        do {
            let refreshed = adopt(try await auth.refresh())
            Signposts.launch.endInterval("TokenRefresh", signpost, "refreshed")
            return refreshed
        } catch {
            // Сессия невосстановима — забываем её, иначе каждый следующий запрос
            // будет заново ломиться в обновление.
            if let apiError = error as? APIError, apiError.code?.meansSessionExpired == true {
                Signposts.launch.endInterval("TokenRefresh", signpost, "expired")
                forgetSession()
                sessionEnded?()
            } else {
                Signposts.launch.endInterval("TokenRefresh", signpost, "failed")
                refreshUndecided = true
            }
            return nil
        }
    }

    /// Хранилище cookie опустело, а в связке ключей токен есть — возвращаем его на
    /// место. Без этого очистка кэша системой выглядела бы как выход из аккаунта.
    private func restoreRefreshCookieIfNeeded() {
        guard cookies.value() == nil, let stored = secrets.value(for: .refreshToken) else { return }
        cookies.restore(stored)
    }

    private func forgetSession() {
        token = nil
        refreshUndecided = false
        cookies.clear()
        secrets.remove(.refreshToken)
        secrets.remove(.sessionPresent)
        secrets.remove(.lastAccessToken)
    }
}

/// Чем закончился холодный старт.
enum SessionRestoration: Equatable {
    /// Сессия продлена — всё как обычно.
    case active(AccessToken)
    /// Последний токен истёк, интерфейс открыт по нему сразу, продление идёт фоном.
    case cached(AccessToken)
    /// Входа нет или сервер в сессии отказал — экран входа.
    case none
}

/// Выход, который не дошёл до сервера.
struct PendingLogout: Codable, Equatable {
    let refreshToken: String
    let deviceToken: String?
}

extension APIError {
    /// Ответа по существу нет: сеть, обрыв, 5xx. Решение о сессии за сервером, а он
    /// его не принял — значит, сессия ещё не решена.
    var isUndecided: Bool {
        switch self {
        case .transport:
            return true
        case .server(_, _, _, let statusCode):
            return statusCode >= 500
        case .malformedResponse(let statusCode):
            return statusCode >= 500
        default:
            return false
        }
    }
}

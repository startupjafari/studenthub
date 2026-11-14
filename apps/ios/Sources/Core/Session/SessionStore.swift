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
    /// Фоновое задание ОС вокруг продления. Реальное — в приложении
    /// (`UIKitBackgroundActivity`), в тестах — пустышка: хранилище сессии UIKit не знает.
    private let background: BackgroundActivity
    /// Пауза перед единственным повтором продления, ответ на которое потерялся.
    private let lossRetryDelay: Duration
    /// Предел «от отправки потерянного продления до повтора»: дольше — повтор вслепую не
    /// шлём (`lossRetryBudget`).
    private let lossRetryBudget: Duration
    /// Повтор после потерянного ответа уже назначен — второго не будет до успеха.
    private var retriedAfterLoss = false

    /// Эпоха сессии (правило 9.7.1). Её меняют выход, забытая сессия и вход: всё, что
    /// заведено в прежней эпохе, — продление, повтор после потери — по возвращении видит
    /// чужую эпоху и выбрасывает результат. Иначе продление, начатое до «Выйти» или до
    /// входа другого человека, записало бы в связку ключей сессию прежнего: следующий
    /// холодный старт открыл бы её.
    private var epoch = 0
    /// Ротированный refresh-токен, который не удалось записать в связку ключей
    /// (правило 10.2.2). Живёт только в памяти процесса; запись повторяется при
    /// следующем приёме сессии и после разблокировки устройства.
    private var unsavedRefreshToken: String?
    private static let log = Logger(subsystem: "kz.studenthub", category: "Session")

    private var token: AccessToken?
    private var inFlightRefresh: Task<AccessToken?, Never>?
    /// Номер последнего заведённого продления: снимает с полёта только своё.
    private var refreshGeneration = 0

    /// Сколько запрос экрана ждёт продления, прежде чем ответить «нет связи». Не
    /// дождался — продление не отменяется и доводится фоном.
    static let tokenWait: Duration = .seconds(10)

    /// Окно грации сервера для повторного предъявления refresh-токена —
    /// `REFRESH_REUSE_GRACE_MS` (по умолчанию 10 с, `apps/api/src/config/env.schema.ts`,
    /// `withinReuseGrace` в `auth.service.ts`). Внутри окна повтор получает уже выданного
    /// преемника, вне его сервер считает повтор кражей и гасит сессии на всех устройствах.
    /// Меняется окно на сервере — меняй здесь, `AuthAPI.refreshTimeout` и паузу повтора.
    static let serverReuseGrace: Duration = .seconds(10)
    /// Сколько может пройти от отправки потерянного продления до повтора: окно грации
    /// минус 2 с запаса на дорогу запросов и очередь сервера (правило 9.7.2).
    static let lossRetryBudget: Duration = .seconds(8)
    /// Пауза перед повтором: таймаут продления (6 с) + 1,5 с = 7,5 с — в бюджете.
    static let defaultLossRetryDelay: Duration = .milliseconds(1500)
    /// За сколько до истечения токен продлевается заранее, фоном: запросы не ждут
    /// продления, а сбитые на минуту-другую часы устройства не дают 401. Не больше трети
    /// срока жизни токена — короткоживущий иначе продлевался бы сразу после выдачи.
    static let earlyRefreshCap: TimeInterval = 5 * 60

    static func earlyRefreshWindow(for token: AccessToken) -> TimeInterval {
        min(earlyRefreshCap, token.lifetime / 3)
    }
    /// Последнее продление не дало ответа по существу: не было сети или сервер ответил
    /// 5xx. Сессия при этом жива — решить, что она кончилась, может только отказ сервера.
    private var refreshUndecided = false
    /// Сервер окончательно отказал в продлении: интерфейсу пора на экран входа.
    private var sessionEnded: (@Sendable () -> Void)?

    init(
        auth: SessionRefreshing = AuthAPI(),
        secrets: SecretStore = Keychain(),
        cookies: RefreshCookieStore = RefreshCookieJar.shared,
        background: BackgroundActivity = NoBackgroundActivity(),
        lossRetryDelay: Duration = SessionStore.defaultLossRetryDelay,
        lossRetryBudget: Duration = SessionStore.lossRetryBudget
    ) {
        self.auth = auth
        self.secrets = secrets
        self.cookies = cookies
        self.background = background
        self.lossRetryDelay = lossRetryDelay
        self.lossRetryBudget = lossRetryBudget
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
                refreshEarlyIfNeeded(known)
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
        if let token, token.isUsable() {
            refreshEarlyIfNeeded(token)
            return token.raw
        }
        guard token != nil || hasStoredSession else { return nil }
        return await Self.value(of: startRefresh(), waitingUpTo: Self.tokenWait)?.raw
    }

    func refreshedAccessToken(replacing used: String?) async -> String? {
        // 401 пришёл на старый токен, а сессию уже продлил кто-то другой — второе
        // продление не нужно, и при ротации оно было бы лишним обменом токена.
        if let token, token.isUsable(), let used, token.raw != used { return token.raw }
        return await Self.value(of: startRefresh(), waitingUpTo: Self.tokenWait)?.raw
    }

    /// Продлить и дождаться — без предела ожидания (вход, тесты).
    func refreshedAccessToken() async -> String? {
        await startRefresh().value?.raw
    }

    var isSessionPending: Bool {
        if secrets.isLocked { return true }
        return hasStoredSession && (inFlightRefresh != nil || refreshUndecided)
    }

    /// Токен ещё действует, но скоро истечёт — продление уходит фоном, запрос идёт со
    /// старым токеном и не ждёт.
    private func refreshEarlyIfNeeded(_ current: AccessToken) {
        let window = Self.earlyRefreshWindow(for: current)
        guard !current.isUsable(at: Date().addingTimeInterval(window)) else { return }
        _ = startRefresh()
    }

    /// Данные устройства разблокированы впервые после включения — доводим продление,
    /// отложенное из-за запертой связки ключей.
    func resumeAfterUnlock() {
        persistUnsavedRefreshToken()
        guard !secrets.isLocked, refreshUndecided, hasStoredSession, token?.isUsable() != true else { return }
        _ = startRefresh()
    }

    /// Ответ на продление потерялся (обрыв, таймаут): сервер мог уже ротировать токен.
    /// Один повтор через пару секунд — тем же единственным продлением — успевает в окно,
    /// где сервер отдаёт уже выданного преемника, а не считает повтор кражей.
    ///
    /// Ответ шёл дольше бюджета (`lossRetryBudget`) — повтор уже не успеет в окно грации
    /// и выглядел бы для сервера кражей. Вслепую его не шлём: следующее продление
    /// заведёт только запрос экрана или холодный старт.
    private func scheduleRetryAfterLoss(elapsed: Duration) {
        guard !retriedAfterLoss else { return }
        guard elapsed + lossRetryDelay <= lossRetryBudget else {
            Self.log.notice("refresh response lost past reuse grace, no blind retry")
            return
        }
        retriedAfterLoss = true
        let delay = lossRetryDelay
        let scheduledIn = epoch
        Task { [weak self] in
            try? await Task.sleep(for: delay)
            await self?.retryAfterLoss(in: scheduledIn)
        }
    }

    private func retryAfterLoss(in scheduledEpoch: Int) {
        guard scheduledEpoch == epoch, refreshUndecided, hasStoredSession, !secrets.isLocked else { return }
        _ = startRefresh()
    }

    /// Результат продления, но ждать не дольше `limit`: продление при этом не
    /// отменяется и доводится фоном.
    private static func value(of task: Task<AccessToken?, Never>, waitingUpTo limit: Duration) async -> AccessToken? {
        enum Outcome: Sendable {
            case finished(AccessToken?)
            case timedOut
        }
        return await withTaskGroup(of: Outcome.self) { group in
            group.addTask { .finished(await task.value) }
            group.addTask {
                try? await Task.sleep(for: limit)
                return .timedOut
            }
            let first = await group.next() ?? .timedOut
            group.cancelAll()
            if case .finished(let token) = first { return token }
            return nil
        }
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

    /// Принять сессию, выданную входом (пароль, QR, регистрация).
    ///
    /// Вход открывает новую эпоху: продление прежней сессии, ещё не вернувшееся из
    /// сети, свой результат уже не применит.
    @discardableResult
    func adopt(_ session: AuthSession) -> AccessToken? {
        guard let parsed = AccessToken(raw: session.accessToken) else { return nil }
        beginEpoch()
        return apply(session, parsed: parsed)
    }

    /// Записать сессию — входа или продления своей эпохи.
    ///
    /// Сервер только что положил свежую refresh-cookie — переносим её в связку
    /// ключей, пока она на месте: хранилище cookie система вправе очистить, связку
    /// ключей — нет.
    private func apply(_ session: AuthSession, parsed: AccessToken) -> AccessToken {
        token = parsed
        refreshUndecided = false
        secrets.set(session.accessToken, for: .lastAccessToken)
        if let refreshCookie = cookies.value() {
            persistRefreshToken(refreshCookie)
        } else {
            persistUnsavedRefreshToken()
        }
        secrets.set("1", for: .sessionPresent)
        return parsed
    }

    /// Ротированный refresh-токен — в связку ключей, с проверкой (правило 10.2.2).
    ///
    /// Не записался — в связке остался прежний, уже погашенный сервером. Оставить его
    /// нельзя: после выгрузки приложения холодный старт предъявил бы его вне окна
    /// грации, сервер принял бы это за кражу и порвал сессии на всех устройствах. Поэтому
    /// прежний стираем: худший исход — вход заново на этом телефоне, а не выход везде.
    /// Пока процесс жив, токен остаётся в памяти (cookie и `unsavedRefreshToken`), и
    /// запись повторяется при следующем приёме сессии и после разблокировки.
    private func persistRefreshToken(_ value: String) {
        if secrets.set(value, for: .refreshToken) {
            unsavedRefreshToken = nil
            return
        }
        unsavedRefreshToken = value
        secrets.remove(.refreshToken)
        // Только факт, без значения: токенам в логах не место.
        Self.log.error("rotated refresh token not persisted to keychain, stale one removed")
    }

    private func persistUnsavedRefreshToken() {
        guard let unsavedRefreshToken else { return }
        persistRefreshToken(unsavedRefreshToken)
    }

    /// Новая эпоха: продление прежней в полёте больше не общее — новый вход или выход
    /// его не ждут и не присоединяются к нему, а его результат будет выброшен.
    private func beginEpoch() {
        epoch &+= 1
        inFlightRefresh = nil
        retriedAfterLoss = false
    }

    /// Продление вернулось в чужую эпоху. Его ответ уже положил в банку cookie
    /// ротированный refresh-токен прежней сессии (`APIClient` впитывает `Set-Cookie`
    /// сразу) — возвращаем банке токен текущей эпохи, а без него опустошаем: иначе
    /// следующий запрос продлил бы сессию прежнего человека.
    private func discardStaleRefresh() {
        cookies.clear()
        if let current = unsavedRefreshToken ?? secrets.value(for: .refreshToken) {
            cookies.restore(current)
        }
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
        // Эпоха меняется до первого ожидания: продление, вернувшееся, пока сервер
        // гасит сессию, своё уже не запишет.
        beginEpoch()
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

    /// Продление под фоновым заданием iOS: приложение, ушедшее в фон посреди обмена
    /// токена, не замораживается до ответа — иначе ротированный сервером токен до нас
    /// не дошёл бы.
    private func performRefresh() async -> AccessToken? {
        let activity = await background.begin("session.refresh")
        let refreshed = await refreshNow()
        await background.end(activity)
        return refreshed
    }

    private func refreshNow() async -> AccessToken? {
        // Связка ключей заперта до первой разблокировки (запуск тихим пушем после
        // перезагрузки): refresh-cookie не прочитать, а продление без неё сервер отклонит —
        // и отказ выглядел бы концом сессии. Не продлеваем и ничего не стираем.
        if secrets.isLocked {
            refreshUndecided = true
            return nil
        }
        restoreRefreshCookieIfNeeded()
        let startedIn = epoch
        let startedAt = ContinuousClock.now
        // Только исход, без токена: токенам в логах и метках не место.
        let signpost = Signposts.launch.beginInterval("TokenRefresh")
        do {
            let session = try await auth.refresh()
            guard startedIn == epoch else {
                Signposts.launch.endInterval("TokenRefresh", signpost, "stale")
                discardStaleRefresh()
                return nil
            }
            guard let parsed = AccessToken(raw: session.accessToken) else {
                Signposts.launch.endInterval("TokenRefresh", signpost, "malformed")
                return nil
            }
            let refreshed = apply(session, parsed: parsed)
            Signposts.launch.endInterval("TokenRefresh", signpost, "refreshed")
            retriedAfterLoss = false
            return refreshed
        } catch {
            // Пока ждали ответа, человек вышел или вошёл другой: отказ или обрыв
            // относятся к прежней сессии — текущую они не гасят и повторов не заводят.
            guard startedIn == epoch else {
                Signposts.launch.endInterval("TokenRefresh", signpost, "stale")
                discardStaleRefresh()
                return nil
            }
            // Сессия невосстановима — забываем её, иначе каждый следующий запрос
            // будет заново ломиться в обновление.
            if let apiError = error as? APIError, apiError.code?.meansSessionExpired == true {
                Signposts.launch.endInterval("TokenRefresh", signpost, "expired")
                retriedAfterLoss = false
                forgetSession()
                sessionEnded?()
            } else {
                Signposts.launch.endInterval("TokenRefresh", signpost, "failed")
                refreshUndecided = true
                if case .transport? = error as? APIError {
                    scheduleRetryAfterLoss(elapsed: ContinuousClock.now - startedAt)
                }
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
        beginEpoch()
        token = nil
        unsavedRefreshToken = nil
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

extension SessionRestoration: RedactedDescription {
    var redactedDescription: String {
        switch self {
        case .active(let token): "SessionRestoration.active(\(token))"
        case .cached(let token): "SessionRestoration.cached(\(token))"
        case .none: "SessionRestoration.none"
        }
    }
}

extension PendingLogout: RedactedDescription {
    var redactedDescription: String {
        "PendingLogout(refreshToken: \(SecretMask.hidden), deviceToken: \(SecretMask.optional(deviceToken)))"
    }
}

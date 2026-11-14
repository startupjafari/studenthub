import Foundation
import Observation
import os

/// Состояние сессии для интерфейса.
///
/// Хранилище сессии — актор: к нему нельзя обратиться из `body` и нельзя подписаться
/// на изменения. Эта обёртка держит то единственное, что нужно корневому экрану, —
/// вошёл ли человек и с какой ролью, — и живёт на главном потоке.
///
/// `restoring` — не косметика. Без третьего состояния холодный старт на долю секунды
/// показывает экран входа уже вошедшему человеку: признак сессии лежит в связке
/// ключей, а токен приходит из сети.
@MainActor
@Observable
final class AppSessionModel {
    enum State: Equatable {
        case restoring
        case signedOut
        case signedIn(AccessToken)
    }

    private(set) var state: State = .restoring
    /// Сервер отказал в продлении, пока интерфейс ещё открывался (фоновое продление
    /// успело раньше `state = .signedIn`): выход доводится сразу после открытия.
    @ObservationIgnored private var endedWhileRestoring = false

    private let store: SessionStore

    init(store: SessionStore = AppServices.session) {
        self.store = store
    }

    /// Токен текущей сессии или `nil`, если человек не вошёл.
    var token: AccessToken? {
        if case .signedIn(let token) = state { return token }
        return nil
    }

    @MainActor
    func restore() async {
        await store.onSessionEnded { [weak self] in
            Task { @MainActor in await self?.sessionDidEnd() }
        }
        // Прежние сборки держали refresh-cookie в системном хранилище — на диске, в
        // резервной копии. Значение давно в связке ключей; файл больше не нужен.
        RefreshCookieJar.purgeSystemStorage()
        let signpost = Signposts.launch.beginInterval("SessionRestore")
        let restoration = await store.restore()
        // Только исход, без токена: токенам в логах и метках не место.
        let outcome: String = switch restoration {
        case .active: "active"
        case .cached: "cached"
        case .none: "none"
        }
        Signposts.launch.endInterval("SessionRestore", signpost, "\(outcome, privacy: .public)")
        switch restoration {
        case .active(let token), .cached(let token):
            // Без сети — по последнему токену: расписание и чаты в базе, а выбросить
            // человека на вход только потому, что он в метро, — значит отнять у него и их.
            await LocalData.claim(for: token.subject)
            // Незакончившиеся трансляции геопозиции — только свои: после `claim`, чтобы
            // чужие уже были стёрты.
            LiveLocationSharing.shared.resume(for: token.subject)
            state = .signedIn(token)
            if endedWhileRestoring {
                endedWhileRestoring = false
                await sessionDidEnd()
            }
        case .none:
            // Сессия не поднялась — отложенная ссылка из пуша никому не адресована.
            AppServices.router.reset()
            GifPanelCache.shared.clear()
            state = .signedOut
        }
        // Выход, отложенный без сети в прошлый раз, досылаем, пока есть возможность.
        await completePendingLogouts()
    }

    /// Связь вернулась (приложение снова на экране): досылаем отложенные выходы.
    @MainActor
    func completePendingLogouts() async {
        guard await store.hasPendingLogouts else { return }
        await store.completePendingLogouts()
    }

    /// Принять сессию, выданную входом. `false` означает, что токен не разобрался:
    /// доверять такой сессии нельзя — ни роли, ни срока жизни из неё не прочитать.
    @MainActor
    @discardableResult
    func adopt(_ session: AuthSession) async -> Bool {
        guard let token = await store.adopt(session) else { return false }
        // Вошёл другой человек, чем тот, чьи данные лежат на устройстве (прежний не
        // выходил, а сессия у него истекла), — его чаты и расписание стираются.
        await LocalData.claim(for: token.subject)
        LiveLocationSharing.shared.resume(for: token.subject)
        // Сбои этого человека — под его id, а не под id того, кто входил до него.
        Observability.identify(userID: token.subject)
        state = .signedIn(token)
        return true
    }

    /// Сессию закрыл сервер, а не человек. Без этого интерфейс оставался «вошедшим»:
    /// каждый экран ловил «Unauthorized», а каждый запрос — лишнюю попытку продления.
    /// Данные на устройстве не стираем: войдёт тот же человек — они ему пригодятся,
    /// другой — их сотрёт `LocalData.claim`.
    @MainActor
    private func sessionDidEnd() async {
        guard case .signedIn = state else {
            if state == .restoring { endedWhileRestoring = true }
            return
        }
        await AppServices.realtime.stop()
        LiveLocationSharing.shared.suspend()
        AppServices.router.reset()
        GifPanelCache.shared.clear()
        Observability.identify(userID: nil)
        state = .signedOut
    }

    @MainActor
    func signOut() async {
        // Сначала рвём реальное время: сокет с погашенным токеном сервер всё равно
        // отключит, но уже со своей стороны и с ошибкой в логе.
        await AppServices.realtime.stop()
        // И отвязываем устройство: иначе следующему человеку на этом телефоне
        // прилетят чужие уведомления. Дважды: отдельным запросом (его понимает и
        // сервер прежней версии) и вместе с выходом — тот без сети откладывается и
        // досылается без access-токена.
        let deviceToken = PushRegistrar.deviceToken
        await PushRegistrar().unregister()
        let delivered = await store.signOut(deviceToken: deviceToken)
        if !delivered {
            // Сервер о выходе пока не знает и шлёт пуши прежнего человека. Пока выход не
            // дослан, телефон их просто не принимает; следующий вход включит доставку.
            PushRegistrar.stopDelivery()
        }
        // Данные прежнего человека не должны достаться следующему (как clearAllTables
        // в Android): список чатов читается из базы и только дописывается.
        await LocalData.erase()
        // Память — тоже данные прежнего человека: открытый чат в стеке навигации и
        // его id в трекере ошибок.
        AppServices.router.reset()
        GifPanelCache.shared.clear()
        Observability.identify(userID: nil)
        state = .signedOut
    }
}

/// Данные человека на устройстве: база чатов и расписания, отметка синхронизации,
/// подписанные ссылки, бейдж. Чьи они — помнит `ownerKey`.
enum LocalData {
    private static let ownerKey = "storage.owner"

    /// Вошёл `userID`. База заполнена кем-то другим (или чья она — неизвестно: сборка
    /// до этой отметки) — стираем, сервер вернёт своё.
    @MainActor
    static func claim(for userID: String) async {
        if UserDefaults.standard.string(forKey: ownerKey) != userID {
            await erase()
        }
        UserDefaults.standard.set(userID, forKey: ownerKey)
        // Кеш экранов читается и пишется только под id вошедшего (ключ ответа включает его).
        ScreenCacheStore.shared.claim(owner: userID)
    }

    @MainActor
    static func erase() async {
        // Первым: ответы экранов прежнего человека не должны показаться ни на кадр, даже
        // пока стирается остальное.
        ScreenCacheStore.shared.erase()
        AppServices.unreadNotifications.reset()
        try? await AppServices.database.eraseAll()
        await AppServices.attachmentURLs.clear()
        // Фото, аватары и свои вложения прежнего человека — тоже его данные.
        ImageMemoryCache.shared.removeAll()
        // И с диска — все картинки, аватары тоже: платформа закрытая, а смена аккаунта не
        // должна показать чужое ни на кадр (итерация 6).
        ImageDiskCache.shared.eraseAll()
        // Разобранные тексты и превью фото — тоже его данные, хоть и в памяти.
        RichText.clearCache()
        LQIP.clearCache()
        MessageCodeBlocks.clearCache()
        // Трансляции геопозиции прежнего человека — встают и забываются: иначе GPS
        // продолжал бы слать точки в его переписку уже под чужой сессией.
        LiveLocationSharing.shared.erase()
        URLCache.shared.removeAllCachedResponses()
        try? FileManager.default.removeItem(at: AttachmentUploader.outboxDirectory)
        UserDefaults.standard.removeObject(forKey: ScheduleModel.syncedKey)
        UserDefaults.standard.removeObject(forKey: ScheduleModel.timeZoneKey)
        UserDefaults.standard.removeObject(forKey: WorkspaceView.libraryEnabledKey)
        UserDefaults.standard.removeObject(forKey: ownerKey)
        await BadgeCounter().reset()
    }
}

extension AppSessionModel.State: RedactedDescription {
    var redactedDescription: String {
        switch self {
        case .restoring: "State.restoring"
        case .signedOut: "State.signedOut"
        case .signedIn(let token): "State.signedIn(\(token))"
        }
    }
}

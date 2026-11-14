import CoreLocation
import Foundation
import Observation

/// Живая геопозиция: пока человек сам включил трансляцию (на 15 минут, час или 8 часов),
/// точка в сообщении двигается за ним — и в фоне, с синим индикатором системы.
///
/// Трансляции переживают перезапуск приложения: сроки лежат в настройках, и после
/// подъёма сессии незакончившиеся продолжаются — только у того же человека, кто их начал. Сервер не принимает обновления чаще раза в три секунды,
/// поэтому шлём не чаще раза в пять, а стоя на месте — раз в полминуты.
@MainActor
@Observable
final class LiveLocationSharing: NSObject, CLLocationManagerDelegate {
    static let shared = LiveLocationSharing()

    struct Session: Codable, Equatable {
        let messageID: String
        let chatID: String
        let until: Date
        /// Кто транслирует (`sub` токена). `nil` — запись сборки до этого поля: чья она,
        /// неизвестно, и после перезапуска она не продолжается.
        var ownerID: String?
    }

    /// Идущие трансляции по id сообщения.
    private(set) var sessions: [String: Session] = [:]
    private(set) var failure: String?

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var lastSent: [String: (at: Date, location: CLLocation)] = [:]
    @ObservationIgnored private var inFlight: Set<String> = []
    @ObservationIgnored private let api: ChatMessaging = ChatsAPI()
    @ObservationIgnored private var expiry: Task<Void, Never>?
    /// Чья сессия открыта сейчас: новые трансляции записываются на него.
    @ObservationIgnored private var owner: String?

    private static let storageKey = "chats.liveLocations"
    private static let minInterval: TimeInterval = 5
    private static let idleInterval: TimeInterval = 30
    private static let minDistance: CLLocationDistance = 15

    /// Варианты срока, как в Telegram.
    static let periods: [(seconds: Int, title: String)] = [
        (900, String(localized: "chats.live.15m", defaultValue: "15 минут")),
        (3600, String(localized: "chats.live.1h", defaultValue: "1 час")),
        (28800, String(localized: "chats.live.8h", defaultValue: "8 часов")),
    ]

    override private init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 10
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .other
    }

    func session(inChat chatID: String) -> Session? {
        sessions.values.filter { $0.chatID == chatID && $0.until > Date() }.min { $0.until < $1.until }
    }

    func isSharing(messageID: String) -> Bool {
        sessions[messageID].map { $0.until > Date() } ?? false
    }

    /// Сессия `userID` поднялась (холодный старт или вход): продолжить его незаконченные
    /// трансляции. Чужие — того, кто был в приложении до него, — не продолжаются
    /// никогда: геопозиция нового человека ушла бы в переписку прежнего.
    func resume(for userID: String) {
        owner = userID
        guard sessions.isEmpty,
            let data = UserDefaults.standard.data(forKey: Self.storageKey),
            let stored = try? JSONDecoder().decode([Session].self, from: data)
        else { return }
        let alive = Self.resumable(stored, owner: userID, now: Date())
        sessions = Dictionary(alive.map { ($0.messageID, $0) }, uniquingKeysWith: { first, _ in first })
        persist()
        updateTracking()
    }

    /// Что из сохранённого продолжить: только трансляции этого человека и только
    /// незакончившиеся.
    static func resumable(_ stored: [Session], owner: String, now: Date) -> [Session] {
        stored.filter { $0.ownerID == owner && $0.until > now }
    }

    /// Сессия кончилась без выхода (сервер отказал в продлении): трансляции встают —
    /// точки без токена всё равно не уйдут, а синий индикатор горел бы зря. Сохранённое
    /// не стираем: войдёт тот же человек — `resume(for:)` их продолжит.
    func suspend() {
        expiry?.cancel()
        expiry = nil
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        sessions = [:]
        lastSent = [:]
        failure = nil
        owner = nil
    }

    /// Выход или вход другого человека (`LocalData.erase`): трансляции останавливаются
    /// и забываются — и сроки в настройках, и отправленные точки.
    func erase() {
        suspend()
        UserDefaults.standard.removeObject(forKey: Self.storageKey)
    }

    func start(messageID: String, chatID: String, until: Date) {
        sessions[messageID] = Session(messageID: messageID, chatID: chatID, until: until, ownerID: owner)
        failure = nil
        persist()
        updateTracking()
    }

    /// «Остановить»: сервер закрывает трансляцию, у всех пузырь становится статичным.
    func stop(messageID: String) async {
        end(messageID)
        do {
            let location = try await api.stopLiveLocation(messageID: messageID)
            await LiveLocations.apply(location, messageID: messageID)
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    private func end(_ messageID: String) {
        sessions[messageID] = nil
        lastSent[messageID] = nil
        persist()
        updateTracking()
    }

    private func updateTracking() {
        expiry?.cancel()
        let active = sessions.values.filter { $0.until > Date() }
        guard !active.isEmpty else {
            manager.stopUpdatingLocation()
            manager.allowsBackgroundLocationUpdates = false
            sessions = [:]
            persist()
            return
        }
        // Фон — только при разрешении «при использовании» и только на время трансляции;
        // синий индикатор показывает человеку, что геопозиция уходит.
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            manager.startUpdatingLocation()
        } else if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        let nearest = active.map(\.until).min() ?? Date()
        expiry = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(max(1, nearest.timeIntervalSinceNow)))
            guard !Task.isCancelled, let self else { return }
            for session in self.sessions.values where session.until <= Date() {
                self.end(session.messageID)
            }
        }
    }

    private func persist() {
        let data = try? JSONEncoder().encode(Array(sessions.values))
        UserDefaults.standard.set(data, forKey: Self.storageKey)
    }

    private func deliver(_ location: CLLocation) {
        let now = Date()
        for session in sessions.values where session.until > now && !inFlight.contains(session.messageID) {
            if let previous = lastSent[session.messageID] {
                let elapsed = now.timeIntervalSince(previous.at)
                let moved = location.distance(from: previous.location)
                guard elapsed >= Self.minInterval, moved >= Self.minDistance || elapsed >= Self.idleInterval else { continue }
            }
            send(location, for: session)
        }
    }

    private func send(_ location: CLLocation, for session: Session) {
        inFlight.insert(session.messageID)
        lastSent[session.messageID] = (Date(), location)
        Task { @MainActor [api] in
            defer { self.inFlight.remove(session.messageID) }
            do {
                let updated = try await api.updateLiveLocation(
                    messageID: session.messageID,
                    latitude: location.coordinate.latitude,
                    longitude: location.coordinate.longitude,
                    heading: location.course >= 0 ? location.course : nil,
                    accuracy: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
                )
                await LiveLocations.apply(updated, messageID: session.messageID)
                if !updated.isLive() { self.end(session.messageID) }
            } catch let error as APIError where error.code == .unknown("LIVE_LOCATION_ENDED") || error.code == .conflict {
                // Трансляцию закончили на другом устройстве или истёк срок.
                self.end(session.messageID)
            } catch {
                // Сеть пропала — следующая точка уйдёт сама, когда появится связь.
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        Task { @MainActor [weak self] in self?.deliver(last) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor [weak self] in
            guard let self, !self.sessions.isEmpty else { return }
            let status = self.manager.authorizationStatus
            if status == .denied || status == .restricted {
                self.failure = String(
                    localized: "chats.live.denied",
                    defaultValue: "Нет доступа к геопозиции — трансляция остановлена"
                )
                for id in Array(self.sessions.keys) { await self.stop(messageID: id) }
            } else {
                self.updateTracking()
            }
        }
    }
}

/// Свежая точка живой геопозиции — в базу, в то сообщение, где она живёт: пузырь
/// перерисуется сам. Источник — свой ответ сервера или событие `location:updated`.
enum LiveLocations {
    static func apply(_ location: MessageExtras.Location, messageID: String) async {
        try? await LiveLocationQueries(database: AppServices.database).updateLocation(location, messageID: messageID)
    }
}

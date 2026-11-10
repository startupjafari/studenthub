import AVKit
import SwiftUI

/// Камеры вуза для охраны (веб `/security/cameras`): список камер с состоянием, просмотр
/// одной камеры и «стена» до четырёх камер сразу — столько же разрешает сервер.
struct SecurityCamerasView: View {
    @State private var cameras: [SecurityCameraDTO]?
    @State private var moduleEnabled = true
    @State private var failure: String?
    @State private var isOffline = false
    @State private var selecting = false
    @State private var selected: [String] = []
    @State private var limitNotice: String?

    private let api = SecurityAPI()
    /// Столько камер можно смотреть одновременно — столько же разрешает сервер.
    static let maxWatched = 4

    var body: some View {
        List {
            if let cameras {
                // Полоса — над любым содержимым: неудачное обновление над «камер нет»
                // иначе выглядело бы как свежий ответ.
                if let failure {
                    StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if !moduleEnabled {
                    EmptyStateView(
                        title: String(localized: "security.cameras.disabledTitle", defaultValue: "Камеры выключены"),
                        symbol: "video.slash",
                        hint: String(localized: "security.cameras.disabledHint", defaultValue: "Администратор вуза выключил камеры или ещё не включил их.")
                    )
                    .listRowBackground(Color.clear)
                } else if cameras.isEmpty {
                    EmptyStateView(
                        title: String(localized: "security.cameras.emptyTitle", defaultValue: "Камер пока нет"),
                        symbol: "video",
                        hint: String(localized: "security.cameras.emptyHint", defaultValue: "Администратор вуза ещё не добавил камеры.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(cameras) { camera in
                            if selecting {
                                Button {
                                    toggle(camera.id)
                                } label: {
                                    HStack(spacing: Spacing.md) {
                                        Image(systemName: selected.contains(camera.id) ? "checkmark.circle.fill" : "circle")
                                            .font(.title3)
                                            .foregroundStyle(selected.contains(camera.id) ? Palette.primary : Palette.mutedForeground)
                                            .accessibilityHidden(true)
                                        SecurityCameraRow(camera: camera)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(selected.contains(camera.id) ? .isSelected : [])
                            } else {
                                NavigationLink(value: AppRoute.security(.camera(id: camera.id))) {
                                    SecurityCameraRow(camera: camera)
                                }
                            }
                        }
                    } footer: {
                        Text(selecting
                            ? String(localized: "security.cameras.pickHint", defaultValue: "Отметьте до \(Self.maxWatched.formatted()) камер и нажмите «Смотреть».")
                            : String(localized: "security.cameras.subtitle", defaultValue: "Видео в реальном времени, без звука. Каждый просмотр записывается в журнал."))
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(SecurityScreen.cameras.title))
        .toolbar {
            if moduleEnabled, let cameras, cameras.count > 1 {
                ToolbarItem(placement: .topBarTrailing) {
                    if selecting {
                        Button(String(localized: "common.cancel", defaultValue: "Отмена")) {
                            selecting = false
                            selected = []
                        }
                    } else {
                        Button {
                            selecting = true
                            selected = []
                        } label: {
                            Image(systemName: "rectangle.grid.2x2")
                        }
                        .accessibilityLabel(Text(String(localized: "security.cameras.select", defaultValue: "Несколько")))
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if selecting, !selected.isEmpty {
                NavigationLink(value: AppRoute.security(.cameraWall(ids: selected))) {
                    Label(
                        String(localized: "security.cameras.watch", defaultValue: "Смотреть: \(selected.count.formatted())"),
                        systemImage: "play.rectangle.fill"
                    )
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.xs)
                }
                .glassProminentButton()
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.md)
            }
        }
        .alert(
            limitNotice ?? "",
            isPresented: Binding(get: { limitNotice != nil }, set: { if !$0 { limitNotice = nil } })
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .refreshable { await load() }
        .task {
            // Состояние камер меняет агент — список не должен застывать, пока охрана на посту.
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    private func toggle(_ id: String) {
        if let index = selected.firstIndex(of: id) {
            selected.remove(at: index)
        } else if selected.count >= Self.maxWatched {
            limitNotice = String(
                localized: "security.cameras.limit",
                defaultValue: "Одновременно можно смотреть не больше \(Self.maxWatched.formatted()) камер"
            )
        } else {
            selected.append(id)
        }
    }

    @MainActor
    private func load() async {
        do {
            async let settingsTask = api.cameraSettings()
            async let camerasTask = api.cameras()
            let (settings, all) = try await (settingsTask, camerasTask)
            moduleEnabled = settings.enabled
            cameras = all.filter(\.enabled)
            failure = nil
            isOffline = false
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

/// Камера в списке — как строка чата: значок с цветом состояния, название, когда был
/// последний сигнал, помещение и плашка состояния.
private struct SecurityCameraRow: View {
    let camera: SecurityCameraDTO

    var body: some View {
        let status = SecurityText.cameraStatus(camera.status)
        TelegramStyleRow(
            title: camera.name,
            subtitle: camera.room?.name,
            meta: camera.lastSeenAt.map { DisplayFormat.relative($0) }
        ) {
            RowSymbol(
                symbol: camera.status == "ONLINE" ? "video.fill" : "video.slash.fill",
                tint: camera.status == "ONLINE" ? TileTint.green : TileTint.gray
            )
        } accessory: {
            StatusBadge(text: status.text, tint: status.tint)
        }
    }
}

// MARK: - Одна камера и стена

/// Экран одной камеры: живое видео, водяной знак, сведения о камере.
struct SecurityCameraScreen: View {
    let cameraID: String

    @State private var viewer = ""
    private let api = SecurityAPI()

    var body: some View {
        RemoteContent(load: { try await api.cameras().first { $0.id == cameraID } }) { camera in
            if let camera {
                let status = SecurityText.cameraStatus(camera.status)
                List {
                    Section {
                        SecurityCameraPlayer(camera: camera, viewer: viewer)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    } footer: {
                        Text(String(localized: "security.cameras.subtitle", defaultValue: "Видео в реальном времени, без звука. Каждый просмотр записывается в журнал."))
                    }
                    Section {
                        if let room = camera.room {
                            DetailRow(title: String(localized: "security.camera.room", defaultValue: "Помещение"), value: room.name, symbol: "door.left.hand.closed")
                        }
                        HStack {
                            DetailRow(
                                title: String(localized: "security.camera.status", defaultValue: "Состояние"),
                                value: status.text,
                                symbol: "dot.radiowaves.left.and.right"
                            )
                            Circle()
                                .fill(status.tint)
                                .frame(width: 10, height: 10)
                                .accessibilityHidden(true)
                        }
                        if let seen = camera.lastSeenAt {
                            DetailRow(title: String(localized: "security.camera.lastSeen", defaultValue: "Последний сигнал"), value: DisplayFormat.dateTime(seen), symbol: "clock")
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .navigationTitle(Text(camera.name))
            } else {
                EmptyStateView(
                    title: String(localized: "security.camera.missing", defaultValue: "Камера отключена"),
                    symbol: "video.slash"
                )
            }
        }
        .navigationTitle(Text(SecurityScreen.camera(id: cameraID).title))
        .navigationBarTitleDisplayMode(.inline)
        .task { viewer = await SecurityViewerName.load() }
    }
}

/// Несколько камер сразу — как сетка окон в вебе.
struct SecurityCameraWallView: View {
    let ids: [String]

    @State private var viewer = ""
    private let api = SecurityAPI()

    var body: some View {
        RemoteContent(load: { try await api.cameras() }) { all in
            let byID = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            let open = ids.prefix(SecurityCamerasView.maxWatched).compactMap { byID[$0] }
            if open.isEmpty {
                EmptyStateView(
                    title: String(localized: "security.camera.missing", defaultValue: "Камера отключена"),
                    symbol: "video.slash"
                )
            } else {
                ScrollView {
                    // На широком экране окна встают сеткой 2×2, на телефоне — столбиком.
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: Spacing.md)], spacing: Spacing.md) {
                        ForEach(open) { camera in
                            SecurityCameraPlayer(camera: camera, viewer: viewer)
                        }
                    }
                    .padding(Spacing.lg)
                }
            }
        }
        .navigationTitle(Text(SecurityScreen.cameraWall(ids: ids).title))
        .navigationBarTitleDisplayMode(.inline)
        .task { viewer = await SecurityViewerName.load() }
    }
}

/// ФИО смотрящего для водяного знака — один запрос на запуск приложения.
@MainActor
private enum SecurityViewerName {
    static var cached: String?

    static func load() async -> String {
        if let cached { return cached }
        let name = (try? await SecurityAPI().viewer().name) ?? ""
        if !name.isEmpty { cached = name }
        return name
    }
}

/// Окно одной камеры: видео с ретранслятора, водяной знак, подпись и состояние.
private struct SecurityCameraPlayer: View {
    let camera: SecurityCameraDTO
    let viewer: String

    @State private var session = SecurityCameraSession()

    var body: some View {
        ZStack {
            Color.black
            VideoPlayer(player: session.player) {
                if session.message == nil, !viewer.isEmpty {
                    SecurityWatermark(viewer: viewer)
                }
            }
            .opacity(session.message == nil ? 1 : 0)
            if let message = session.message {
                VStack(spacing: Spacing.md) {
                    Image(systemName: session.isBlocked ? "video.slash" : "exclamationmark.triangle")
                        .font(.title2)
                    Text(message)
                        .font(Typography.meta)
                        .multilineTextAlignment(.center)
                    if !session.isBlocked {
                        Button(String(localized: "common.retry", defaultValue: "Повторить")) {
                            session.retry()
                        }
                        .glassButton()
                        .tint(.white)
                    }
                }
                .foregroundStyle(.white.opacity(0.85))
                .padding(Spacing.xl)
            } else if !session.isPlaying {
                VStack(spacing: Spacing.md) {
                    ProgressView().tint(.white)
                    Text(String(localized: "security.camera.connecting", defaultValue: "Подключение к камере…"))
                        .font(.caption)
                }
                .foregroundStyle(.white.opacity(0.8))
                .allowsHitTesting(false)
            }
        }
        .overlay(alignment: .topLeading) {
            HStack(spacing: Spacing.sm) {
                if session.isPlaying, session.message == nil {
                    Circle().fill(Color.red).frame(width: 8, height: 8)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text(camera.name).font(Typography.meta.weight(.semibold)).lineLimit(1)
                    if let room = camera.room {
                        Text(room.name).font(.caption).opacity(0.75).lineLimit(1)
                    }
                }
            }
            .foregroundStyle(.white)
            .padding(Spacing.md)
            .background(LinearGradient(colors: [.black.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom))
            .allowsHitTesting(false)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
        .accessibilityLabel(Text(camera.name))
        .task(id: "\(camera.id)#\(session.attempt)") {
            await session.run(cameraID: camera.id)
        }
    }
}

/// Водяной знак поверх видео: ФИО смотрящего и текущее время по всему кадру. Запись
/// экрана он не запрещает, но любой снимок несёт имя того, кто смотрел, и момент.
private struct SecurityWatermark: View {
    let viewer: String

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let stamp = "\(viewer) · \(context.date.formatted(.dateTime.day(.twoDigits).month(.twoDigits).hour().minute().second()))"
            Grid {
                ForEach(0..<3, id: \.self) { _ in
                    GridRow {
                        ForEach(0..<2, id: \.self) { _ in
                            Text(verbatim: stamp)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(.white.opacity(0.35))
                                .shadow(color: .black.opacity(0.6), radius: 1)
                                .lineLimit(1)
                                .fixedSize()
                                .rotationEffect(.degrees(-18))
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .clipped()
    }
}

/// Сессия просмотра камеры: начать, продлевать по таймеру, закончить при уходе с экрана.
///
/// Ретранслятор принимает токен в заголовке `Authorization`, а заголовок у `AVURLAsset`
/// задаётся один раз при создании. Токен живёт `expiresInSec` и меняется при каждом
/// продлении — поэтому незадолго до истечения текущего токена источник пересоздаётся со
/// свежим: короткая заминка раз в полторы минуты вместо обрыва видео.
@MainActor
@Observable
private final class SecurityCameraSession {
    let player: AVPlayer = {
        let player = AVPlayer()
        player.isMuted = true
        player.allowsExternalPlayback = false
        player.preventsDisplaySleepDuringVideoPlayback = true
        return player
    }()

    private(set) var message: String?
    private(set) var isBlocked = false
    private(set) var isPlaying = false
    /// Счётчик перезапуска: «Повторить» запускает сессию заново.
    private(set) var attempt = 0

    @ObservationIgnored private let api = SecurityAPI()
    @ObservationIgnored private var sessionID: String?
    @ObservationIgnored private var hlsURL: URL?
    @ObservationIgnored private var token = ""
    @ObservationIgnored private var itemStartedAt = Date.distantPast
    @ObservationIgnored private var reloads = 0

    func retry() {
        message = nil
        isBlocked = false
        attempt += 1
    }

    func run(cameraID: String) async {
        message = nil
        isBlocked = false
        isPlaying = false
        reloads = 0
        defer { teardown() }

        guard var ticket = await begin(cameraID: cameraID) else { return }
        var nextBeat = Date().addingTimeInterval(TimeInterval(ticket.heartbeatInSec))

        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(1))
            if Task.isCancelled { break }
            observePlayback()
            if message != nil { return }

            guard Date() >= nextBeat, let sessionID else { continue }
            do {
                let next = try await api.heartbeat(sessionID: sessionID)
                ticket = next
                token = next.token
                nextBeat = Date().addingTimeInterval(TimeInterval(next.heartbeatInSec))
                // Текущий источник ходит со старым токеном: до его истечения осталось меньше
                // двух продлений — пора пересоздать источник со свежим.
                let age = Date().timeIntervalSince(itemStartedAt)
                if age > TimeInterval(next.expiresInSec - next.heartbeatInSec * 2) {
                    attach()
                }
            } catch is CancellationError {
                break
            } catch {
                if let reason = Self.blockReason(error) {
                    fail(reason, blocked: true)
                    return
                }
                let code = (error as? APIError)?.code
                if code == .forbidden || code == .wrongScope || code == .unauthorized {
                    fail(error.userMessage, blocked: true)
                    return
                }
                if code == .notFound {
                    // Сессия истекла, пока продления не доходили, — открыть новую.
                    self.sessionID = nil
                    guard let fresh = await begin(cameraID: cameraID) else { return }
                    ticket = fresh
                    nextBeat = Date().addingTimeInterval(TimeInterval(fresh.heartbeatInSec))
                } else {
                    // Сбой сети или сервера — повтор через несколько секунд, а не через полный
                    // интервал: окно не должно гаснуть от одного сбоя.
                    nextBeat = Date().addingTimeInterval(5)
                }
            }
        }
        _ = ticket
    }

    private func begin(cameraID: String) async -> SecurityCameraTicketDTO? {
        do {
            let ticket = try await api.startView(cameraID: cameraID)
            if Task.isCancelled {
                let id = ticket.sessionId
                Task { try? await SecurityAPI().endView(sessionID: id) }
                return nil
            }
            sessionID = ticket.sessionId
            token = ticket.token
            hlsURL = URL(string: ticket.hlsUrl)
            attach()
            return ticket
        } catch is CancellationError {
            return nil
        } catch {
            if let reason = Self.blockReason(error) {
                fail(reason, blocked: true)
            } else {
                fail(error.userMessage, blocked: false)
            }
            return nil
        }
    }

    /// Источник видео с актуальным токеном в заголовке.
    private func attach() {
        guard let hlsURL else { return }
        let asset = AVURLAsset(
            url: hlsURL,
            options: ["AVURLAssetHTTPHeaderFieldsKey": ["Authorization": "Bearer \(token)"]]
        )
        let item = AVPlayerItem(asset: asset)
        // Держимся у края эфира: охране нужен «сейчас», а не запас в буфере.
        item.preferredForwardBufferDuration = 2
        item.automaticallyPreservesTimeOffsetFromLive = true
        player.replaceCurrentItem(with: item)
        player.play()
        itemStartedAt = Date()
    }

    /// Первые секунды плейлиста может не быть — агент только поднимает поток; поток может
    /// и перезапуститься посреди просмотра. Такой обрыв — не конец: источник пересоздаётся,
    /// пока не кончатся попытки.
    private func observePlayback() {
        let playing = player.timeControlStatus == .playing
        if playing != isPlaying { isPlaying = playing }
        if playing { reloads = 0 }
        guard player.currentItem?.status == .failed else { return }
        if reloads < 8 {
            reloads += 1
            attach()
        } else {
            fail(String(localized: "security.camera.failed", defaultValue: "Не удалось получить видео. Закройте окно и откройте снова."), blocked: false)
        }
    }

    private func fail(_ text: String, blocked: Bool) {
        message = text
        isBlocked = blocked
        isPlaying = false
        player.pause()
    }

    /// Закрыть сессию сразу: последний зритель ушёл — агент гасит поток, слот из четырёх
    /// одновременных просмотров освобождается.
    private func teardown() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        isPlaying = false
        if let id = sessionID {
            sessionID = nil
            Task { try? await SecurityAPI().endView(sessionID: id) }
        }
    }

    /// Почему просмотр не начался или закрылся: `409` с `details.field`.
    private static func blockReason(_ error: Error) -> String? {
        guard case .server(let code, _, let details, _)? = error as? APIError, code == .conflict else { return nil }
        switch details.first?.field {
        case "relay": return String(localized: "security.camera.blocked.relay", defaultValue: "Просмотр камер ещё не настроен на платформе.")
        case "module": return String(localized: "security.camera.blocked.module", defaultValue: "Камеры вуза выключены.")
        case "camera": return String(localized: "security.camera.blocked.camera", defaultValue: "Камера отключена.")
        case "views": return String(localized: "security.camera.blocked.views", defaultValue: "Открыто слишком много камер — закройте одну.")
        default: return nil
        }
    }
}

import Network
import Observation
import SwiftUI

// MARK: - Картинка QR

/// QR-код из картинки сервера (`common/qr/qr-image.ts`): модули — прямоугольники в
/// координатах модулей, «глаза» — скруглённые рамки, в центре — место под знак.
///
/// iOS не показывает SVG из данных, а генерировать код заново на телефоне нельзя: адрес
/// подтверждения сервер внутрь картинки кладёт, а наружу не отдаёт. Поэтому разбираем
/// ровно то, что нарисовал сервер, и рисуем те же фигуры нативно — без растра, без
/// искажения модулей, в любом размере.
struct QRCodeDrawing: Equatable {
    struct Module: Equatable {
        let rect: CGRect
        let cornerRadius: CGFloat
        /// Не `nil` — рамка этой толщины («глаз»), иначе заливка.
        let strokeWidth: CGFloat?
    }

    /// Сторона картинки в модулях, вместе с тихой зоной.
    let side: CGFloat
    let modules: [Module]
    /// Сторона бейджа знака в центре, в модулях.
    let badge: CGFloat

    /// `data:image/svg+xml;base64,…` → фигуры. `nil` — картинка не той формы: рисовать
    /// догадку вместо кода нельзя, экран покажет ошибку.
    init?(dataURL: String) {
        let prefix = "data:image/svg+xml;base64,"
        guard
            dataURL.hasPrefix(prefix),
            let data = Data(base64Encoded: String(dataURL.dropFirst(prefix.count))),
            let svg = String(data: data, encoding: .utf8)
        else { return nil }
        self.init(svg: svg)
    }

    init?(svg: String) {
        guard
            let viewBox = Self.attribute("viewBox", in: svg),
            let side = viewBox.split(separator: " ").last.flatMap({ Double($0) }), side > 0,
            let groupStart = svg.range(of: ##"<g fill="#000000">"##),
            let groupEnd = svg.range(of: "</g>", range: groupStart.upperBound..<svg.endIndex)
        else { return nil }

        let group = String(svg[groupStart.upperBound..<groupEnd.lowerBound])
        var modules: [Module] = []
        for element in group.components(separatedBy: "<rect").dropFirst() {
            guard
                let x = Self.number("x", in: element),
                let y = Self.number("y", in: element),
                let width = Self.number("width", in: element),
                let height = Self.number("height", in: element)
            else { continue }
            let isOutline = Self.attribute("fill", in: element) == "none"
            modules.append(Module(
                rect: CGRect(x: x, y: y, width: width, height: height),
                cornerRadius: Self.number("rx", in: element) ?? 0,
                strokeWidth: isOutline ? (Self.number("stroke-width", in: element) ?? 1) : nil
            ))
        }
        // Меньше трёх «глаз» и горсти модулей — это не QR-код.
        guard modules.count > 20 else { return nil }

        self.side = side
        self.modules = modules
        // Бейдж — тот же расчёт, что у сервера: ~24% стороны кода без тихой зоны.
        let margin: CGFloat = 2
        badge = max(5, ((side - margin * 2) * 0.24).rounded())
    }

    private static func attribute(_ name: String, in text: String) -> String? {
        guard let start = text.range(of: " \(name)=\"") else { return nil }
        let rest = text[start.upperBound...]
        guard let end = rest.firstIndex(of: "\"") else { return nil }
        return String(rest[..<end])
    }

    private static func number(_ name: String, in text: String) -> CGFloat? {
        attribute(name, in: text).flatMap(Double.init).map { CGFloat($0) }
    }
}

/// QR-код на белой подложке, строго 1:1. Модули рисуются векторно на `Canvas`, белое поле
/// вокруг (тихая зона из картинки сервера плюс отступ подложки) не даёт камере спутать
/// код с фоном.
struct QRCodeView: View {
    let drawing: QRCodeDrawing

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / drawing.side
            for module in drawing.modules {
                let rect = CGRect(
                    x: module.rect.minX * scale, y: module.rect.minY * scale,
                    width: module.rect.width * scale, height: module.rect.height * scale
                )
                let path = Path(roundedRect: rect, cornerRadius: module.cornerRadius * scale, style: .continuous)
                if let stroke = module.strokeWidth {
                    context.stroke(path, with: .color(.black), lineWidth: stroke * scale)
                } else {
                    context.fill(path, with: .color(.black))
                }
            }
            // Знак в центре — на месте, которое сервер оставил пустым.
            let badge = drawing.badge * scale
            let badgeRect = CGRect(
                x: (size.width - badge) / 2, y: (size.height - badge) / 2, width: badge, height: badge
            )
            context.fill(
                Path(roundedRect: badgeRect, cornerRadius: badge * 0.26, style: .continuous),
                with: .color(.white)
            )
            let glyph = badgeRect.insetBy(dx: badge * 0.17, dy: badge * 0.17)
            context.fill(StudentHubGlyph().path(in: glyph), with: .color(AuthPalette.brandBlue))
        }
        .aspectRatio(1, contentMode: .fit)
        // Тихая зона уже внутри картинки сервера (2 модуля) — подложке хватает узкого поля.
        .padding(Spacing.sm)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        // Белая подложка остаётся белой и в тёмной теме: камере нужен контраст.
        .environment(\.colorScheme, .light)
        .accessibilityElement()
        .accessibilityLabel(Text(String(localized: "auth.qr.imageLabel", defaultValue: "QR-код для входа")))
    }
}

// MARK: - Модель

/// Вход по QR: создать сессию, показать код и ждать подтверждения с другого телефона.
///
/// Ждём опросом `POST /auth/qr/claim` раз в три секунды: сервер отвечает «ещё не
/// подтверждено», «истекло» или выдаёт сессию — и это ровно те состояния, что нужны
/// экрану. Сокет ради одного события на две минуты не окупается; лимит маршрута —
/// 30 запросов в минуту, опрос укладывается в треть.
@MainActor
@Observable
final class QRSignInModel {
    enum State: Equatable {
        case loading
        case waiting(QRCodeDrawing)
        case signingIn
        case expired
        case failed(message: String, isOffline: Bool)
    }

    private(set) var state: State = .loading
    /// Когда код перестанет действовать — для обратного отсчёта.
    private(set) var expiresAt: Date?
    /// Связь пропала, пока код на экране. Код ещё действует: показываем его дальше и
    /// переспрашиваем сервер — подтверждение с телефона не потеряется.
    private(set) var isReconnecting = false

    private let api: AuthRecovering
    private let pollInterval: Duration

    init(api: AuthRecovering = AuthRecoveryAPI(), pollInterval: Duration = .seconds(3)) {
        self.api = api
        self.pollInterval = pollInterval
    }

    /// Новый код и ожидание. Живёт, пока жив `.task` экрана: ушёл со страницы — опрос
    /// остановился, вернулся — код создаётся заново.
    func run(into session: AppSessionModel) async {
        state = .loading
        expiresAt = nil
        isReconnecting = false
        let ticket: QRSignInTicket
        do {
            ticket = try await api.createQRSession()
        } catch is CancellationError {
            return
        } catch {
            state = .failed(message: Self.message(for: error, creating: true), isOffline: error.isOffline)
            return
        }
        guard let drawing = QRCodeDrawing(dataURL: ticket.qr) else {
            state = .failed(
                message: String(localized: "auth.qrError", defaultValue: "Не удалось создать QR-код"),
                isOffline: false
            )
            return
        }
        let deadline = Date().addingTimeInterval(TimeInterval(ticket.expiresIn))
        expiresAt = deadline
        state = .waiting(drawing)

        while !Task.isCancelled {
            try? await Task.sleep(for: pollInterval)
            guard !Task.isCancelled else { return }
            if Date() >= deadline {
                state = .expired
                return
            }
            do {
                let issued = try await api.claimQRSession(ticket)
                isReconnecting = false
                state = .signingIn
                if await session.adopt(issued) { return }
                state = .failed(
                    message: String(localized: "error.generic", defaultValue: "Что-то пошло не так. Попробуйте ещё раз"),
                    isOffline: false
                )
                return
            } catch let error as APIError where error.code == .badRequest {
                isReconnecting = false
                continue // ещё не подтверждено
            } catch let error as APIError where error.code == .notFound {
                state = .expired
                return
            } catch let error as APIError where error.code == .rateLimit {
                continue // сервер просит реже — следующий круг и так через паузу
            } catch is CancellationError {
                return
            } catch where error.isOffline {
                // Обрыв связи — не повод бросать код: он живёт на сервере до срока.
                isReconnecting = true
                continue
            } catch {
                state = .failed(message: Self.message(for: error, creating: false), isOffline: false)
                return
            }
        }
    }

    private static func message(for error: Error, creating: Bool) -> String {
        if error.isOffline { return error.userMessage }
        return creating
            ? String(localized: "auth.qrError", defaultValue: "Не удалось создать QR-код")
            : error.userMessage
    }
}

// MARK: - Экран

/// Есть ли сеть. Нужен, чтобы после «нет связи» повторить сам, как только она появится, —
/// а не ждать, пока человек догадается нажать «Повторить».
@MainActor
@Observable
private final class QRNetworkWatch {
    private(set) var isOnline = true
    private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in self?.isOnline = online }
        }
        monitor.start(queue: DispatchQueue(label: "kz.studenthub.qr-network"))
    }

    deinit {
        monitor.cancel()
    }
}

/// Вход по QR-коду: код показывает это устройство, подтверждает телефон, где человек
/// уже вошёл («Настройки → Вход по QR» или камера).
struct QRSignInView: View {
    let session: AppSessionModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model = QRSignInModel()
    @State private var network = QRNetworkWatch()
    /// Смена значения перезапускает `.task` — так работает «Обновить».
    @State private var attempt = 0
    /// Высота экрана: код занимает всю ширину панели, а на низком экране — сколько
    /// остаётся по высоте, чтобы всё поместилось без прокрутки.
    @State private var screenHeight: CGFloat = 800

    var body: some View {
        AuthScaffold {
            StudentHubBrandHeader(
                title: String(localized: "auth.qrTitle", defaultValue: "Вход по QR-коду"),
                subtitle: String(
                    localized: "auth.qrHint",
                    defaultValue: "Откройте StudentHub на телефоне, где вы уже вошли, и отсканируйте код камерой"
                ),
                showsWordmark: false,
                subtitleIsEssential: true,
                showsLogo: false
            )
        } panel: {
            codeArea
                .frame(maxWidth: codeSide)
                .frame(maxWidth: .infinity)
            status
                .frame(maxWidth: .infinity)
            StudentHubSecondaryButton(
                title: String(localized: "auth.qrBackToPassword", defaultValue: "Войти по паролю"),
                systemImage: "key"
            ) { dismiss() }
            StudentHubLegalLinks()
        }
        .navigationBarTitleDisplayMode(.inline)
        .animation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion), value: model.state)
        .animation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion), value: model.isReconnecting)
        .task(id: attempt) { await model.run(into: session) }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { screenHeight = $0 }
        // Связь вернулась после «нет связи» — новый код без нажатия.
        .onChange(of: network.isOnline) { _, online in
            if online, case .failed(_, true) = model.state { attempt += 1 }
        }
    }

    /// Сторона кода: вся ширина панели, но не больше, чем оставляет высота экрана за
    /// вычетом шапки и остальной формы (~330 pt).
    private var codeSide: CGFloat {
        max(200, screenHeight - 330)
    }

    /// Место под код одинакового размера во всех состояниях — экран не прыгает.
    private var codeArea: some View {
        ZStack {
            if case .waiting(let drawing) = model.state {
                QRCodeView(drawing: drawing)
                    .opacity(model.isReconnecting ? 0.35 : 1)
            } else {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(AuthPalette.field)
                    .aspectRatio(1, contentMode: .fit)
                    .overlay { placeholder }
            }
        }
    }

    @ViewBuilder
    private var placeholder: some View {
        switch model.state {
        case .loading:
            VStack(spacing: Spacing.md) {
                ProgressView().controlSize(.large)
                Text(String(localized: "auth.qr.creating", defaultValue: "Создаём код…"))
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
            }
        case .signingIn:
            AuthNotice(
                kind: .success,
                title: String(localized: "auth.qr.approved", defaultValue: "Вход подтверждён — открываем StudentHub"),
                isCentered: true
            )
        case .expired:
            AuthNotice(
                kind: .expired,
                title: String(localized: "auth.qrExpired", defaultValue: "QR-код истёк"),
                message: String(localized: "auth.qr.expiredHint", defaultValue: "Код действует две минуты. Создайте новый и отсканируйте его."),
                actionTitle: String(localized: "auth.qrRefresh", defaultValue: "Обновить"),
                action: { attempt += 1 },
                isCentered: true
            )
        case .failed(let message, let isOffline):
            if isOffline {
                AuthNotice.offline(retry: { attempt += 1 }, centered: true)
            } else {
                AuthNotice(
                    kind: .error,
                    title: message,
                    actionTitle: String(localized: "auth.qrRefresh", defaultValue: "Обновить"),
                    action: { attempt += 1 },
                    isCentered: true
                )
            }
        case .waiting:
            EmptyView()
        }
    }

    /// Строка под кодом — только пока код на экране: остальные состояния объясняет
    /// карточка в самом квадрате.
    @ViewBuilder
    private var status: some View {
        if case .waiting = model.state {
            VStack(spacing: Spacing.xs) {
                if model.isReconnecting {
                    HStack(spacing: Spacing.md) {
                        Image(systemName: "wifi.slash").foregroundStyle(Palette.warning).accessibilityHidden(true)
                        Text(String(localized: "auth.qr.reconnecting", defaultValue: "Нет связи — пробуем снова…"))
                            .font(.subheadline)
                            .foregroundStyle(Palette.foreground)
                    }
                } else {
                    HStack(spacing: Spacing.md) {
                        ProgressView()
                        Text(String(localized: "auth.qrWaiting", defaultValue: "Ожидаем подтверждения на телефоне…"))
                            .font(.subheadline)
                            .foregroundStyle(Palette.foreground)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let expiresAt = model.expiresAt {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let left = max(0, Int(expiresAt.timeIntervalSince(context.date)))
                        Text(String(
                            localized: "auth.qr.expiresIn",
                            defaultValue: "Код действует ещё \(DisplayFormat.minutesSeconds(left))"
                        ))
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(Palette.mutedForeground)
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        }
    }
}

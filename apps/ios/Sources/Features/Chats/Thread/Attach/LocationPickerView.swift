import CoreLocation
import MapKit
import Observation
import SwiftUI

/// Где человек сейчас — только пока открыт выбор точки. Разрешение спрашивается при
/// первом открытии «Геопозиции», не раньше; фонового слежения нет.
@MainActor
@Observable
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    private(set) var status: CLAuthorizationStatus
    private(set) var location: CLLocation?

    @ObservationIgnored private let manager = CLLocationManager()

    override init() {
        status = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func start() {
        if status == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else if isAllowed {
            manager.startUpdatingLocation()
        }
    }

    func stop() {
        manager.stopUpdatingLocation()
    }

    var isAllowed: Bool { status == .authorizedWhenInUse || status == .authorizedAlways }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in
            self?.status = status
            if self?.isAllowed == true { self?.manager.startUpdatingLocation() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        Task { @MainActor [weak self] in self?.location = last }
    }
}

/// Отправка точки: карта с булавкой по центру. «Моё местоположение» — по GPS, «Эта
/// точка» — куда сдвинули карту; адрес подписывается по координатам.
struct LocationPickerView: View {
    let onSend: (_ coordinate: CLLocationCoordinate2D, _ title: String?, _ address: String?) async -> Bool
    /// Живая геопозиция на выбранный срок (секунды).
    var onSendLive: ((_ location: CLLocation, _ period: Int) async -> Bool)?

    @State private var provider = LocationProvider()
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var center: CLLocationCoordinate2D?
    @State private var address: String?
    @State private var isMoving = false
    @State private var isSending = false
    @State private var geocodeTask: Task<Void, Never>?
    @State private var choosingLivePeriod = false

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Map(position: $camera) {
                    UserAnnotation()
                }
                .mapControls {
                    MapUserLocationButton()
                    MapCompass()
                }
                .onMapCameraChange(frequency: .continuous) { _ in
                    isMoving = true
                }
                .onMapCameraChange(frequency: .onEnd) { context in
                    isMoving = false
                    center = context.region.center
                    lookUpAddress(context.region.center)
                }

                // Булавка по центру: точка — то, что под её остриём.
                Image(systemName: "mappin")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Palette.destructive)
                    .offset(y: isMoving ? -24 : -17)
                    // Булавка подпрыгивает — игриво, поэтому с перелётом; без движения — сразу на месте.
                    .animation(Motion.isReducedNow ? nil : .spring(duration: 0.25, bounce: 0.4), value: isMoving)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            .padding(.horizontal, Spacing.lg)

            VStack(spacing: Spacing.md) {
                if !provider.isAllowed, provider.status != .notDetermined {
                    Text(String(
                        localized: "chats.location.denied",
                        defaultValue: "Нет доступа к геопозиции — можно выбрать точку на карте вручную."
                    ))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                }
                // Трансляция и точка с карты — карточкой, как списки в Telegram.
                if (provider.location != nil && onSendLive != nil) || center != nil {
                    VStack(spacing: 0) {
                        if provider.location != nil, onSendLive != nil {
                            sendRow(
                                title: String(localized: "chats.live.share", defaultValue: "Транслировать геопозицию"),
                                subtitle: String(
                                    localized: "chats.live.shareHint",
                                    defaultValue: "Участники увидят, как вы перемещаетесь, пока трансляция идёт"
                                ),
                                symbol: "location.circle"
                            ) {
                                choosingLivePeriod = true
                            }
                        }
                        if let center {
                            if provider.location != nil, onSendLive != nil {
                                Divider().padding(.leading, Spacing.xl + 28 + Spacing.lg)
                            }
                            sendRow(
                                title: String(localized: "chats.location.point", defaultValue: "Отправить эту точку"),
                                subtitle: address ?? Self.coordinates(center),
                                symbol: "mappin.and.ellipse"
                            ) {
                                await send(center, title: nil)
                            }
                        }
                    }
                    .background(Palette.secondary, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))
                }
                // Главное действие — большой капсулой внизу, как «Отправить геопозицию»
                // в Telegram; пока точка не определена — подпись об этом.
                if provider.isAllowed || provider.status == .notDetermined {
                    sendMineButton
                }
            }
            .padding(Spacing.lg)
        }
        .disabled(isSending)
        .overlay {
            if isSending { ProgressView() }
        }
        .confirmationDialog(
            String(localized: "chats.live.periodTitle", defaultValue: "Транслировать геопозицию"),
            isPresented: $choosingLivePeriod,
            titleVisibility: .visible
        ) {
            ForEach(LiveLocationSharing.periods, id: \.seconds) { period in
                Button(period.title) {
                    guard let location = provider.location else { return }
                    Task {
                        isSending = true
                        _ = await onSendLive?(location, period.seconds)
                        isSending = false
                    }
                }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: {
            Text(String(
                localized: "chats.live.consent",
                defaultValue: "Пока трансляция идёт, участники чата видят ваше местоположение — и когда приложение свёрнуто. Остановить можно в любой момент."
            ))
        }
        .onAppear { provider.start() }
        .onDisappear {
            provider.stop()
            geocodeTask?.cancel()
        }
    }

    private var sendMineButton: some View {
        Button {
            guard let location = provider.location else { return }
            Task { await send(location.coordinate, title: nil) }
        } label: {
            VStack(spacing: 0) {
                Text(String(localized: "chats.location.mine", defaultValue: "Отправить моё местоположение"))
                    .font(Typography.body.weight(.semibold))
                Group {
                    if let location = provider.location {
                        Text(String(
                            localized: "chats.location.accuracy",
                            defaultValue: "Точность \(Int(location.horizontalAccuracy.rounded())) м"
                        ))
                    } else {
                        Text(String(localized: "chats.location.locating", defaultValue: "Определение геопозиции…"))
                    }
                }
                .font(Typography.meta)
                .opacity(0.8)
            }
            .foregroundStyle(Palette.primaryForeground)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(Palette.primary.opacity(provider.location == nil ? 0.5 : 1), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(provider.location == nil)
    }

    private func sendRow(title: String, subtitle: String, symbol: String, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            HStack(spacing: Spacing.lg) {
                Image(systemName: symbol)
                    .font(.title3)
                    .foregroundStyle(Palette.primary)
                    .frame(width: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(Typography.body)
                        .foregroundStyle(Palette.primary)
                    Text(subtitle)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func send(_ coordinate: CLLocationCoordinate2D, title: String?) async {
        isSending = true
        let place = await Self.address(of: coordinate)
        _ = await onSend(coordinate, title ?? place.title, place.address)
        isSending = false
    }

    private func lookUpAddress(_ coordinate: CLLocationCoordinate2D) {
        geocodeTask?.cancel()
        geocodeTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let place = await Self.address(of: coordinate)
            guard !Task.isCancelled else { return }
            address = place.address
        }
    }

    /// Название места и адрес по координатам; без сети — пусто, это не мешает отправке.
    static func address(of coordinate: CLLocationCoordinate2D) async -> (title: String?, address: String?) {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        guard let mark = try? await CLGeocoder().reverseGeocodeLocation(location).first else { return (nil, nil) }
        let street = [mark.thoroughfare, mark.subThoroughfare].compactMap { $0 }.joined(separator: ", ")
        let parts = [street.isEmpty ? nil : street, mark.locality].compactMap { $0 }
        let address = parts.isEmpty ? nil : parts.joined(separator: ", ")
        let title = mark.areasOfInterest?.first ?? (mark.name != street ? mark.name : nil)
        return (title.map { String($0.prefix(200)) }, address.map { String($0.prefix(300)) })
    }

    static func coordinates(_ coordinate: CLLocationCoordinate2D) -> String {
        String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude)
    }
}

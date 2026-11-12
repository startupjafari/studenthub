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

    @State private var provider = LocationProvider()
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var center: CLLocationCoordinate2D?
    @State private var address: String?
    @State private var isMoving = false
    @State private var isSending = false
    @State private var geocodeTask: Task<Void, Never>?

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
                    .animation(.spring(duration: 0.25, bounce: 0.4), value: isMoving)
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
                if let location = provider.location {
                    sendRow(
                        title: String(localized: "chats.location.mine", defaultValue: "Отправить моё местоположение"),
                        subtitle: String(
                            localized: "chats.location.accuracy",
                            defaultValue: "Точность \(Int(location.horizontalAccuracy.rounded())) м"
                        ),
                        symbol: "location.fill"
                    ) {
                        await send(location.coordinate, title: nil)
                    }
                }
                if let center {
                    sendRow(
                        title: String(localized: "chats.location.point", defaultValue: "Отправить эту точку"),
                        subtitle: address ?? Self.coordinates(center),
                        symbol: "mappin.and.ellipse"
                    ) {
                        await send(center, title: nil)
                    }
                }
            }
            .padding(Spacing.lg)
        }
        .disabled(isSending)
        .overlay {
            if isSending { ProgressView() }
        }
        .onAppear { provider.start() }
        .onDisappear {
            provider.stop()
            geocodeTask?.cancel()
        }
    }

    private func sendRow(title: String, subtitle: String, symbol: String, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            HStack(spacing: Spacing.lg) {
                Image(systemName: symbol)
                    .foregroundStyle(Palette.primaryForeground)
                    .frame(width: 40, height: 40)
                    .background(Palette.primary, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.primary)
                    Text(subtitle)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
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

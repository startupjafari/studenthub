import Foundation
import Observation

/// Состояние подтверждения входа по QR.
///
/// Подтверждение не делается молча по факту сканирования: код со стороны может
/// оказаться чужим, и единственная защита здесь — человек, который видит, что
/// именно он подтверждает. Поэтому между сканированием и запросом стоит шаг
/// `confirming` с предупреждением, как на странице `/qr` в вебе.
@Observable
final class QRApproveModel {
    enum State: Equatable {
        case scanning
        case confirming(QRLoginTicket)
        case approving
        case approved
        case rejected
        case failed(String)
        /// Камеры нет или доступ к ней запрещён — сканировать нечем.
        case cameraUnavailable
    }

    private(set) var state: State = .scanning

    private let api: QRLoginApproving

    init(api: QRLoginApproving = AppServices.qrLogin) {
        self.api = api
    }

    /// Код распознан. Чужой QR (посещаемость, помещение, чья-то визитка) до запроса
    /// не доходит: разбор ссылки строгий.
    @MainActor
    func scanned(_ payload: String) {
        guard state == .scanning else { return }
        guard let ticket = QRLoginTicket(scanned: payload) else {
            state = .failed(String(
                localized: "auth.qrApproveInvalid",
                defaultValue: "Ссылка недействительна или устарела."
            ))
            return
        }
        state = .confirming(ticket)
    }

    @MainActor
    func approve() async {
        guard case .confirming(let ticket) = state else { return }
        state = .approving
        do {
            try await api.approve(ticket)
            state = .approved
        } catch {
            // Сессия QR живёт две минуты: самый частый отказ — истёкший код, и
            // серверный текст говорит об этом точнее, чем общая фраза.
            let message = (error as? APIError)?.displayMessage ?? String(
                localized: "auth.qrApproveError",
                defaultValue: "Не удалось подтвердить вход. Попробуйте снова."
            )
            state = .failed(message)
        }
    }

    @MainActor
    func reject() {
        state = .rejected
    }

    @MainActor
    func scanAgain() {
        state = .scanning
    }

    @MainActor
    func cameraUnavailable() {
        state = .cameraUnavailable
    }
}

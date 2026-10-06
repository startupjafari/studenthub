import AVFoundation
import SwiftUI
import UIKit

/// Камера, читающая QR. Своего интерфейса у неё нет — только изображение с камеры:
/// рамку, подсказку и кнопки рисует экран вокруг.
struct QRScannerView: UIViewControllerRepresentable {
    /// Код распознан. Вызывается один раз: после первого кода сканер гасится.
    let onScan: (String) -> Void
    /// Камеры нет или доступ запрещён. Симулятор попадает сюда всегда.
    let onUnavailable: () -> Void

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let controller = QRScannerViewController()
        controller.onScan = onScan
        controller.onUnavailable = onUnavailable
        return controller
    }

    func updateUIViewController(_ controller: QRScannerViewController, context: Context) {}
}

/// Сессия захвата живёт в контроллере, а не в SwiftUI-представлении: её нужно
/// запускать и останавливать по жизненному циклу экрана, иначе камера остаётся
/// включённой и ест батарею за закрытым экраном.
final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onScan: ((String) -> Void)?
    var onUnavailable: (() -> Void)?

    private let session = AVCaptureSession()
    /// Запуск и остановка блокируют поток на доли секунды — на главном это
    /// заметная заминка при открытии экрана.
    private let sessionQueue = DispatchQueue(label: "kz.studenthub.qr-scanner")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var hasDelivered = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        requestAccess()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stop()
    }

    // MARK: - Делегат

    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard
            let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
            let payload = object.stringValue
        else { return }
        Task { @MainActor [weak self] in
            self?.deliver(payload)
        }
    }

    // MARK: - Внутреннее

    private func requestAccess() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configure()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if granted {
                        self.configure()
                    } else {
                        self.onUnavailable?()
                    }
                }
            }
        default:
            // Отказ или родительский контроль: просить ещё раз бесполезно, дорога
            // одна — настройки системы.
            onUnavailable?()
        }
    }

    private func configure() {
        guard
            let device = AVCaptureDevice.default(for: .video),
            let input = try? AVCaptureDeviceInput(device: device),
            session.canAddInput(input)
        else {
            onUnavailable?()
            return
        }

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            onUnavailable?()
            return
        }

        session.beginConfiguration()
        session.addInput(input)
        session.addOutput(output)
        // Типы задаются только после добавления выхода — до этого список пуст.
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]
        session.commitConfiguration()

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)
        previewLayer = preview

        start()
    }

    private func deliver(_ payload: String) {
        guard !hasDelivered else { return }
        hasDelivered = true
        stop()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        onScan?(payload)
    }

    private func start() {
        let session = self.session
        sessionQueue.async {
            guard !session.isRunning else { return }
            session.startRunning()
        }
    }

    private func stop() {
        let session = self.session
        sessionQueue.async {
            guard session.isRunning else { return }
            session.stopRunning()
        }
    }
}

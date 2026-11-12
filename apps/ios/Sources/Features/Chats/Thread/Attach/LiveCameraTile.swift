import AVFoundation
import SwiftUI
import UIKit

/// Первая плитка «Галереи», как в Telegram: в ней сразу идёт живое изображение камеры —
/// задней, а если её нет, фронтальной. Нажатие открывает съёмку (`onCamera` сетки).
///
/// Доступа к камере ещё не спрашивали — спрашиваем при показе плитки: иначе живого
/// изображения не будет никогда. Отказали — плитка остаётся тёмной со значком.
struct LiveCameraTile: UIViewRepresentable {
    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.start()
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}

    static func dismantleUIView(_ view: PreviewView, coordinator: ()) {
        view.stop()
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

        private var previewLayer: AVCaptureVideoPreviewLayer {
            // `layerClass` выше гарантирует тип слоя.
            layer as! AVCaptureVideoPreviewLayer
        }

        private let session = AVCaptureSession()
        /// Запуск и остановка сессии блокируют поток — не на главном.
        private static let queue = DispatchQueue(label: "chats.attach.camera-tile")

        override init(frame: CGRect) {
            super.init(frame: frame)
            backgroundColor = .black
            isUserInteractionEnabled = false
            previewLayer.videoGravity = .resizeAspectFill
            previewLayer.session = session
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError() }

        func start() {
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                run()
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                    guard granted else { return }
                    DispatchQueue.main.async { self?.run() }
                }
            default:
                break
            }
        }

        func stop() {
            let session = session
            Self.queue.async {
                if session.isRunning { session.stopRunning() }
            }
        }

        private func run() {
            let session = session
            Self.queue.async {
                if session.inputs.isEmpty {
                    let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                        ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
                    guard let device, let input = try? AVCaptureDeviceInput(device: device) else { return }
                    session.beginConfiguration()
                    // Плитка в сотню точек: высокое разрешение тут только греет телефон.
                    if session.canSetSessionPreset(.medium) { session.sessionPreset = .medium }
                    if session.canAddInput(input) { session.addInput(input) }
                    session.commitConfiguration()
                }
                if !session.isRunning { session.startRunning() }
            }
        }
    }
}

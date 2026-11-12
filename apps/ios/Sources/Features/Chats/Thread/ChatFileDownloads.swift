import Foundation
import Observation

/// Скачивание файлов из переписки, как в Telegram: прогресс — кольцом прямо в строке
/// файла, касание во время скачивания отменяет его, скачанное хранится в кэшах и
/// открывается сразу, без повторной загрузки и без индикатора на весь экран.
@MainActor
@Observable
final class ChatFileDownloads {
    static let shared = ChatFileDownloads()

    enum State: Equatable {
        case downloading(Double)
        case done(URL)
    }

    private(set) var active: [String: Double] = [:]
    @ObservationIgnored private var tasks: [String: Task<Void, Never>] = [:]

    /// Что с файлом сейчас: качается, уже на устройстве или ещё нет (`nil`).
    func state(for file: AttachmentRecord) -> State? {
        if let fraction = active[file.id] { return .downloading(fraction) }
        if let path = file.localPath, FileManager.default.fileExists(atPath: path) {
            return .done(URL(filePath: path))
        }
        let cached = Self.cachedURL(for: file)
        if let cached, FileManager.default.fileExists(atPath: cached.path(percentEncoded: false)) {
            return .done(cached)
        }
        return nil
    }

    /// Скачать и открыть. Уже скачан — открывается сразу, качается — отменяется.
    func toggle(_ file: AttachmentRecord, open: @escaping (URL) -> Void, failed: @escaping (String) -> Void) {
        switch state(for: file) {
        case .done(let url):
            open(url)
        case .downloading:
            cancel(file.id)
        case nil:
            start(file, open: open, failed: failed)
        }
    }

    func cancel(_ id: String) {
        tasks[id]?.cancel()
        tasks[id] = nil
        active[id] = nil
    }

    private func start(_ file: AttachmentRecord, open: @escaping (URL) -> Void, failed: @escaping (String) -> Void) {
        let id = file.id
        active[id] = 0
        tasks[id] = Task { [weak self] in
            defer { self?.tasks[id] = nil }
            do {
                guard let remote = await AppServices.attachmentURLs.url(for: id),
                    let target = Self.cachedURL(for: file)
                else { throw URLError(.fileDoesNotExist) }
                let relay = DownloadProgressRelay { fraction in
                    Task { @MainActor [weak self] in
                        // Отменённое или законченное не оживляем запоздалым отсчётом.
                        guard let self, let shown = self.active[id], fraction - shown >= 0.01 else { return }
                        self.active[id] = fraction
                    }
                }
                let (temp, response) = try await URLSession.shared.download(from: remote, delegate: relay)
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    throw APIError.malformedResponse(statusCode: http.statusCode)
                }
                let folder = target.deletingLastPathComponent()
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try? FileManager.default.removeItem(at: target)
                try FileManager.default.moveItem(at: temp, to: target)
                self?.active[id] = nil
                open(target)
            } catch is CancellationError {
                self?.active[id] = nil
            } catch let error as URLError where error.code == .cancelled {
                self?.active[id] = nil
            } catch {
                self?.active[id] = nil
                failed(error.userMessage)
            }
        }
    }

    /// Куда кладётся скачанное: свой каталог на файл, внутри — настоящее имя (его видят
    /// просмотр и «Поделиться»).
    nonisolated static func cachedURL(for file: AttachmentRecord) -> URL? {
        let name = AttachmentFileName.of(file).replacingOccurrences(of: "/", with: "-")
        let folder = file.id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? file.id
        return FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appending(path: "chat-files", directoryHint: .isDirectory)
            .appending(path: folder, directoryHint: .isDirectory)
            .appending(path: name.isEmpty ? "file" : name)
    }
}

/// Доля скачанного из задачи `URLSession`: асинхронный `download` сам прогресса не даёт.
private final class DownloadProgressRelay: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let report: (Double) -> Void
    private var observation: NSKeyValueObservation?

    init(report: @escaping (Double) -> Void) {
        self.report = report
    }

    func urlSession(_ session: URLSession, didCreateTask task: URLSessionTask) {
        observation = task.progress.observe(\.fractionCompleted) { [report] progress, _ in
            report(progress.fractionCompleted)
        }
    }
}

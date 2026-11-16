import AVFoundation
import Foundation

/// Записанное до паузы — начало продолжения: файл, выбранный обрезкой фрагмент и волна
/// всего файла (чтобы вернуть прослушивание как было, если продолжение не запустилось).
struct VoiceSegment: Equatable {
    let url: URL
    /// Длина всего файла.
    let duration: TimeInterval
    /// Выбранный фрагмент — доли длины файла.
    let selection: ClosedRange<Double>
    let envelope: [Float]

    /// Выбранный фрагмент в секундах; `nil` — файл целиком (без обрезки и без
    /// перекодирования по краям).
    var range: ClosedRange<TimeInterval>? {
        guard selection.lowerBound > 0.000_1 || selection.upperBound < 0.999_9 else { return nil }
        return duration * selection.lowerBound...duration * selection.upperBound
    }

    /// Сколько секунд уйдёт из этого файла.
    var length: TimeInterval {
        guard let range else { return duration }
        return range.upperBound - range.lowerBound
    }

    /// Волна выбранного фрагмента: столбики, попавшие между ручками обрезки.
    static func slice(_ levels: [Float], to selection: ClosedRange<Double>) -> [Float] {
        guard !levels.isEmpty else { return [] }
        let count = Double(levels.count)
        let start = min(levels.count, max(0, Int((selection.lowerBound * count).rounded(.down))))
        let end = min(levels.count, max(start, Int((selection.upperBound * count).rounded(.up))))
        return Array(levels[start..<end])
    }
}

/// Склейка и обрезка голосового без перезаписи: части ставятся друг за другом в
/// `AVMutableComposition`, а `AVAssetExportSession` пишет один m4a (AAC) — тот же формат,
/// что у записи, и то же имя `voice-…`, по которому сервер и веб узнают голосовое.
enum VoiceClipComposer {
    struct Part: Equatable {
        let url: URL
        /// Какой отрезок файла взять; `nil` — весь файл.
        let range: ClosedRange<TimeInterval>?
    }

    struct Result: Equatable {
        let url: URL
        let duration: TimeInterval
    }

    /// Собрать части в новый файл во временном каталоге. `nil` — частей со звуком нет
    /// или экспорт не удался (тогда недописанный файл удалён). Исходные файлы не трогает.
    static func compose(_ parts: [Part]) async -> Result? {
        let composition = AVMutableComposition()
        guard let track = composition.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid
        ) else { return nil }

        var cursor = CMTime.zero
        for part in parts {
            let asset = AVURLAsset(url: part.url)
            guard let source = try? await asset.loadTracks(withMediaType: .audio).first,
                let full = try? await asset.load(.duration), full.seconds > 0
            else { continue }
            let range: CMTimeRange
            if let wanted = part.range {
                let start = CMTime(seconds: max(0, wanted.lowerBound), preferredTimescale: 44_100)
                let end = CMTime(seconds: min(full.seconds, wanted.upperBound), preferredTimescale: 44_100)
                guard end > start else { continue }
                range = CMTimeRange(start: start, end: end)
            } else {
                range = CMTimeRange(start: .zero, duration: full)
            }
            do {
                try track.insertTimeRange(range, of: source, at: cursor)
                cursor = cursor + range.duration
            } catch {
                continue
            }
        }
        guard cursor.seconds > 0,
            let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A)
        else { return nil }

        let output = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-\(UUID().uuidString).m4a")
        session.outputURL = output
        session.outputFileType = .m4a
        // Колбэк экспорта — не на главной очереди; ждём его, не держа её.
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously { continuation.resume() }
        }
        guard session.status == .completed else {
            try? FileManager.default.removeItem(at: output)
            return nil
        }
        return Result(url: output, duration: cursor.seconds)
    }
}

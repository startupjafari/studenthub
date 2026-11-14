import Foundation

/// Описание локального тестового медиа. Файлы не лежат в репозитории: `MediaFactory`
/// рисует и кодирует их на устройстве при первом запуске (фото — Core Graphics, видео —
/// AVAssetWriter, GIF — ImageIO, голос — AVAudioFile, документы — PDF/текст).
struct MediaSpec: Hashable {
    enum Kind: String { case photo, video, gif, voice, videoNote, file }

    var file: String
    var kind: Kind
    var width: Double = 0
    var height: Double = 0
    var duration: Double = 0
    /// Сюжет картинки/ролика (выбирает палитру и рисунок).
    var theme: Int = 0
    var fileName: String? = nil
    var fileSize: Int64? = nil
    var mimeType: String? = nil

    var ref: MediaRef {
        MediaRef(
            file: file, width: width, height: height, duration: duration,
            waveform: kind == .voice || kind == .videoNote ? MediaCatalog.waveform(seed: file, duration: duration) : nil,
            fileName: fileName, fileSize: fileSize, mimeType: mimeType
        )
    }

    var messageKind: MessageKind {
        switch kind {
        case .photo: return .photo(ref)
        case .video: return .video(ref)
        case .gif: return .gif(ref)
        case .voice: return .voice(ref)
        case .videoNote: return .videoNote(ref)
        case .file: return .file(ref)
        }
    }
}

enum MediaCatalog {
    static let photos: [MediaSpec] = (1...24).map { index in
        // Чередуем ориентации, как в настоящей переписке: альбомные, портретные, квадрат.
        let sizes: [(Double, Double)] = [(1280, 960), (960, 1280), (1080, 1080), (1280, 720), (900, 1350)]
        let size = sizes[index % sizes.count]
        return MediaSpec(file: String(format: "photo_%02d.jpg", index), kind: .photo, width: size.0, height: size.1, theme: index)
    }

    static let videos: [MediaSpec] = (1...5).map { index in
        let portrait = index % 2 == 0
        return MediaSpec(
            file: String(format: "video_%02d.mp4", index), kind: .video,
            width: portrait ? 540 : 960, height: portrait ? 960 : 540, duration: Double(4 + index * 2), theme: index + 3
        )
    }

    static let gifs: [MediaSpec] = (1...4).map { index in
        MediaSpec(file: String(format: "gif_%02d.gif", index), kind: .gif, width: 320, height: index % 2 == 0 ? 320 : 240, duration: 2, theme: index + 7)
    }

    static let voices: [MediaSpec] = (1...10).map { index in
        MediaSpec(file: String(format: "voice_%02d.m4a", index), kind: .voice, duration: Double([3, 7, 12, 5, 21, 9, 34, 4, 15, 58][index - 1]), theme: index)
    }

    static let videoNotes: [MediaSpec] = (1...4).map { index in
        MediaSpec(file: String(format: "round_%02d.mp4", index), kind: .videoNote, width: 384, height: 384, duration: Double(5 + index * 3), theme: index + 11)
    }

    static let files: [MediaSpec] = [
        MediaSpec(file: "doc_01.pdf", kind: .file, fileName: "Договор аренды.pdf", fileSize: 248_320, mimeType: "application/pdf"),
        MediaSpec(file: "doc_02.pdf", kind: .file, fileName: "Билеты Алматы — Астана.pdf", fileSize: 96_412, mimeType: "application/pdf"),
        MediaSpec(file: "doc_03.txt", kind: .file, fileName: "Список покупок.txt", fileSize: 1_204, mimeType: "text/plain"),
        MediaSpec(file: "doc_04.pdf", kind: .file, fileName: "Презентация проекта.pdf", fileSize: 1_843_200, mimeType: "application/pdf"),
        MediaSpec(file: "doc_05.csv", kind: .file, fileName: "Бюджет поездки.csv", fileSize: 3_310, mimeType: "text/csv"),
        MediaSpec(file: "doc_06.pdf", kind: .file, fileName: "Резюме.pdf", fileSize: 132_096, mimeType: "application/pdf"),
    ]

    static var all: [MediaSpec] { photos + videos + gifs + voices + videoNotes + files }

    /// Форма волны голосового: детерминированная по имени файла, 0…31 (5 бит), как в Telegram.
    /// Генератор звука (`MediaFactory`) кладёт в файл громкость по этой же огибающей,
    /// поэтому рисунок совпадает с тем, что слышно.
    static func waveform(seed: String, duration: Double) -> [UInt8] {
        var rng = SeededGenerator(seed: UInt64(truncatingIfNeeded: seed.hashValueStable))
        let count = 64
        var values: [UInt8] = []
        var level = 8.0
        for index in 0..<count {
            let phrase = sin(Double(index) / 5.0 + Double(rng.next() % 7)) * 0.5 + 0.5
            level = level * 0.55 + (Double(rng.next() % 32) * phrase) * 0.45
            // Паузы между фразами — тише.
            if index % 17 == 16 { level *= 0.2 }
            values.append(UInt8(max(1, min(31, level))))
        }
        return values
    }
}

/// Детерминированный генератор (SplitMix64): одинаковая история при каждом сбросе.
struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed &+ 0x9E37_79B9_7F4A_7C15 }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    mutating func chance(_ probability: Double) -> Bool {
        Double(next() % 10_000) / 10_000 < probability
    }

    mutating func int(_ range: ClosedRange<Int>) -> Int {
        range.lowerBound + Int(next() % UInt64(range.upperBound - range.lowerBound + 1))
    }

    mutating func pick<T>(_ array: [T]) -> T {
        array[Int(next() % UInt64(array.count))]
    }
}

extension String {
    /// Стабильный между запусками хеш (у `hashValue` случайная соль процесса).
    var hashValueStable: UInt64 {
        var hash: UInt64 = 0xCBF2_9CE4_8422_2325
        for byte in utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3
        }
        return hash
    }
}

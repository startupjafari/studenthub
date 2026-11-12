import AVFoundation
import Observation
import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

// MARK: - Голосовое в пузыре

/// Голосовое в пузыре, как в вебе и Telegram: кнопка, волна с заливкой проигранного,
/// перемотка касанием (и протяжкой вбок на iOS 18+), время «0:05 / 0:32» и скорость.
///
/// Проигрыватель у всех пузырей один (`VoicePlayback.shared`): запуск другой записи
/// останавливает прежнюю, а перерисовка ленты — прочтение, реакция — не обрывает
/// играющую, как обрывал бы проигрыватель в состоянии самой ячейки.
struct VoiceAttachmentView: View {
    let attachment: AttachmentRecord
    let isOwn: Bool

    @State private var profile: VoiceProfile?
    /// Палец ведёт по волне: показываем место под ним, перематываем — когда отпустит.
    @State private var scrub: Double?
    @State private var waveWidth: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var playback: VoicePlayback { VoicePlayback.shared }
    private var rate: VoicePlaybackRate { VoicePlaybackRate.shared }
    private var isCurrent: Bool { playback.currentID == attachment.id }
    private var player: VoicePlayer? { isCurrent ? playback.player : nil }
    private var isPlaying: Bool { player?.isPlaying ?? false }
    private var hasStarted: Bool { player?.hasStarted ?? false }

    /// Длительность: разобранная запись точнее, иначе — из вложения или от проигрывателя.
    private var duration: Double? {
        if let profile { return profile.duration }
        if let ms = attachment.durationMs, ms > 0 { return Double(ms) / 1000 }
        return player?.duration
    }

    private var bars: [Double] {
        let count = VoiceWave.barCount(duration: duration)
        if let profile { return VoiceWave.resample(profile.envelope, count: count) }
        return VoiceWave.seeded(attachment.id, count: count)
    }

    private var progress: Double {
        scrub ?? player?.progress ?? 0
    }

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.md) {
            Button {
                Task { await playback.toggle(attachment) }
            } label: {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .foregroundStyle(isOwn ? Palette.primary : Palette.primaryForeground)
                    .frame(width: ControlHeight.md, height: ControlHeight.md)
                    .background(isOwn ? Palette.primaryForeground : Palette.primary, in: Circle())
                    .contentTransition(.symbolEffect(.replace))
                    // Состояние меняет проигрыватель, а не касание в `withAnimation`: без
                    // своей анимации замена значка шла скачком, без перетекания.
                    .animation(Motion.respecting(.snappy(duration: 0.25), reduceMotion: reduceMotion), value: isPlaying)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(isPlaying
                ? String(localized: "chats.voice.pause", defaultValue: "Пауза")
                : String(localized: "chats.voice.play", defaultValue: "Слушать")))

            VStack(alignment: .leading, spacing: Spacing.xs) {
                wave
                Text(verbatim: caption)
                    .font(Typography.tabular(Typography.meta))
                    .foregroundStyle(isOwn ? Palette.primaryForeground.opacity(0.8) : Palette.mutedForeground)
            }

            // Скорость — только у начатого голосового, справа, как в вебе и Telegram.
            if hasStarted {
                VoiceRateButton(rate: rate, onPrimary: isOwn)
                    .transition(.opacity)
            }
        }
        .padding(.vertical, Spacing.xs)
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: hasStarted)
        .task(id: attachment.id) {
            profile = await VoiceProfiles.shared.profile(for: attachment)
        }
    }

    private var wave: some View {
        VoiceWaveform(
            bars: bars,
            progress: progress,
            played: isOwn ? Palette.primaryForeground : Palette.primary,
            rest: isOwn ? Palette.primaryForeground.opacity(0.35) : Palette.primary.opacity(0.25)
        )
        .frame(
            minWidth: 80,
            idealWidth: VoiceWave.width(bars: bars.count),
            maxWidth: VoiceWave.width(bars: bars.count)
        )
        .frame(height: 24)
        .contentShape(Rectangle())
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { waveWidth = $0 }
        .gesture(SpatialTapGesture().onEnded { value in
            seek(to: fraction(at: value.location.x))
        })
        .modifier(VoiceScrubbing(
            changed: { x in scrub = fraction(at: x) },
            ended: { x in
                let target = x.map(fraction(at:))
                scrub = nil
                if let target { seek(to: target) }
            }
        ))
        .accessibilityElement()
        .accessibilityLabel(Text(String(localized: "chats.voice.position", defaultValue: "Позиция воспроизведения")))
        .accessibilityValue(Text(verbatim: caption))
        .accessibilityAdjustableAction { direction in
            // VoiceOver: шаг — десятая часть записи.
            let step = direction == .increment ? 0.1 : -0.1
            seek(to: min(1, max(0, (player?.progress ?? 0) + step)))
        }
    }

    private func fraction(at x: CGFloat) -> Double {
        guard waveWidth > 0 else { return 0 }
        return Double(min(max(x / waveWidth, 0), 1))
    }

    private func seek(to fraction: Double) {
        Task { await playback.seek(attachment, to: fraction) }
    }

    /// До запуска — длительность, начатое — «0:05 / 0:32».
    private var caption: String {
        guard hasStarted, let player else { return VoiceWave.time(duration ?? 0) }
        let current = scrub.flatMap { fraction in duration.map { fraction * $0 } } ?? player.current
        guard let duration, duration > 0 else { return VoiceWave.time(current) }
        return "\(VoiceWave.time(current)) / \(VoiceWave.time(duration))"
    }
}

// MARK: - Аудиофайл в пузыре

/// Аудиофайл (не голосовое): проигрыватель прямо в пузыре, как музыка в Telegram, —
/// кнопка, название файла, полоса проигранного с перемоткой касанием и время.
///
/// Играет тем же общим проигрывателем, что и голосовые (`VoicePlayback.shared`): запуск
/// трека останавливает голосовое и наоборот. Пока файл грузится — кольцо отмены вместо
/// кнопки.
struct AudioFileAttachmentView: View {
    let attachment: AttachmentRecord
    let isOwn: Bool
    var upload: AttachmentUploadState?

    @State private var barWidth: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Ширина ровная, как у музыки в Telegram: короткое имя не сжимает плеер в точку, но
    /// и за пузырь на узком экране он не вылезает.
    private static let width: CGFloat = 236

    private var playback: VoicePlayback { VoicePlayback.shared }
    private var isCurrent: Bool { playback.currentID == attachment.id }
    private var player: VoicePlayer? { isCurrent ? playback.player : nil }
    private var isPlaying: Bool { player?.isPlaying ?? false }
    private var hasStarted: Bool { player?.hasStarted ?? false }

    private var duration: Double? {
        if let seconds = player?.duration, seconds > 0 { return seconds }
        if let ms = attachment.durationMs, ms > 0 { return Double(ms) / 1000 }
        return nil
    }

    private var title: String {
        attachment.name ?? String(localized: "chats.file", defaultValue: "Файл")
    }

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.md) {
            if let upload {
                UploadRing(
                    fraction: upload.fraction,
                    tint: isOwn ? Palette.primaryForeground : Palette.primary,
                    backdrop: nil,
                    diameter: ControlHeight.xl,
                    cancel: upload.cancel
                )
            } else {
                playButton
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Typography.body.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
                if hasStarted {
                    progressBar
                        .transition(.opacity)
                }
                HStack(spacing: 3) {
                    Image(systemName: "music.note")
                        .font(.caption2.weight(.semibold))
                        .accessibilityHidden(true)
                    Text(verbatim: caption)
                        .font(Typography.tabular(Typography.meta))
                        .contentTransition(.numericText())
                }
                .foregroundStyle(isOwn ? Palette.primaryForeground.opacity(0.8) : Palette.mutedForeground)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: Self.width, alignment: .leading)
        .padding(.vertical, Spacing.xs)
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: hasStarted)
    }

    private var playButton: some View {
        Button {
            Task { await playback.toggle(attachment) }
        } label: {
            Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(isOwn ? Palette.primary : Palette.primaryForeground)
                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                .background(isOwn ? Palette.primaryForeground : Palette.primary, in: Circle())
                .contentTransition(.symbolEffect(.replace))
                .animation(Motion.respecting(.snappy(duration: 0.25), reduceMotion: reduceMotion), value: isPlaying)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(isPlaying
            ? String(localized: "chats.voice.pause", defaultValue: "Пауза")
            : String(localized: "chats.voice.play", defaultValue: "Слушать")))
        .accessibilityValue(Text(title))
    }

    /// Тонкая полоса проигранного; касание перематывает.
    private var progressBar: some View {
        let fraction = min(max(player?.progress ?? 0, 0), 1)
        return Capsule()
            .fill(isOwn ? Palette.primaryForeground.opacity(0.3) : Palette.primary.opacity(0.2))
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(isOwn ? Palette.primaryForeground : Palette.primary)
                    .frame(width: max(3, barWidth * fraction))
            }
            .frame(height: 3)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { barWidth = $0 }
            .gesture(SpatialTapGesture().onEnded { value in
                guard barWidth > 0 else { return }
                let target = Double(min(max(value.location.x / barWidth, 0), 1))
                Task { await playback.seek(attachment, to: target) }
            })
            .accessibilityElement()
            .accessibilityLabel(Text(String(localized: "chats.voice.position", defaultValue: "Позиция воспроизведения")))
            .accessibilityValue(Text(verbatim: caption))
            .accessibilityAdjustableAction { direction in
                let step = direction == .increment ? 0.1 : -0.1
                let target = min(1, max(0, (player?.progress ?? 0) + step))
                Task { await playback.seek(attachment, to: target) }
            }
    }

    /// До запуска — длительность и размер, начатое — «0:05 / 3:20».
    private var caption: String {
        if hasStarted, let player {
            guard let duration, duration > 0 else { return VoiceWave.time(player.current) }
            return "\(VoiceWave.time(player.current)) / \(VoiceWave.time(duration))"
        }
        let size = attachment.size.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }
        return [duration.map(VoiceWave.time), size].compactMap { $0 }.joined(separator: " · ")
    }
}

/// Протяжка по волне. На iOS 18+ — распознаватель UIKit, который берёт только движение
/// вбок: вертикальное уходит ленте, и листать переписку, начав с волны, по-прежнему
/// можно. SwiftUI-перетаскивание забирало бы и его. На iOS 17 остаётся касание.
private struct VoiceScrubbing: ViewModifier {
    let changed: (CGFloat) -> Void
    let ended: (CGFloat?) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content.gesture(VoiceScrubGesture(changed: changed, ended: ended))
        } else {
            content
        }
    }
}

@available(iOS 18, *)
private struct VoiceScrubGesture: UIGestureRecognizerRepresentable {
    let changed: (CGFloat) -> Void
    /// `nil` — жест сорвался, перематывать некуда.
    let ended: (CGFloat?) -> Void

    func makeUIGestureRecognizer(context: Context) -> HorizontalPanGestureRecognizer {
        HorizontalPanGestureRecognizer()
    }

    func handleUIGestureRecognizerAction(_ recognizer: HorizontalPanGestureRecognizer, context: Context) {
        let x = context.converter.localLocation.x
        switch recognizer.state {
        case .began, .changed: changed(x)
        case .ended: ended(x)
        case .cancelled, .failed: ended(nil)
        default: break
        }
    }
}

/// Протяжка только вбок: заметное вертикальное движение до начала жеста — отказ, и
/// касание достаётся прокрутке ленты.
final class HorizontalPanGestureRecognizer: UIPanGestureRecognizer {
    private var origin: CGPoint?

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        origin = touches.first?.location(in: view)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        if state == .possible, let origin, let point = touches.first?.location(in: view) {
            let dx = abs(point.x - origin.x)
            let dy = abs(point.y - origin.y)
            if dy > 4, dy > dx {
                state = .failed
                return
            }
        }
        super.touchesMoved(touches, with: event)
    }

    override func reset() {
        super.reset()
        origin = nil
    }
}

/// Волна: полосы громкости, проигранная часть — той же волной поверх, обрезанной по
/// текущему месту, как в вебе. Одним `Canvas`: полос до сорока четырёх, и сорок
/// четыре вьюхи на каждое голосовое в ленте — лишнее.
struct VoiceWaveform: View {
    let bars: [Double]
    let progress: Double
    let played: Color
    let rest: Color

    var body: some View {
        Canvas { context, size in
            guard !bars.isEmpty else { return }
            let count = CGFloat(bars.count)
            let gap = VoiceWave.gap
            let width = max(1.5, (size.width - gap * (count - 1)) / count)
            var path = Path()
            for (index, level) in bars.enumerated() {
                let height = max(width, size.height * CGFloat(max(VoiceWave.floor, level)))
                let x = CGFloat(index) * (width + gap)
                let rect = CGRect(x: x, y: (size.height - height) / 2, width: width, height: height)
                path.addRoundedRect(in: rect, cornerSize: CGSize(width: width / 2, height: width / 2))
            }
            context.fill(path, with: .color(rest))
            let done = size.width * CGFloat(min(max(progress, 0), 1))
            guard done > 0 else { return }
            context.clip(to: Path(CGRect(x: 0, y: 0, width: done, height: size.height)))
            context.fill(path, with: .color(played))
        }
        .accessibilityHidden(true)
    }
}

/// Скорость голосовых по нажатию: 1× → 1,5× → 2×. Выбор общий и запоминается.
struct VoiceRateButton: View {
    let rate: VoicePlaybackRate
    let onPrimary: Bool

    var body: some View {
        Button {
            rate.cycle()
        } label: {
            Text(verbatim: rate.label)
                .font(Typography.tabular(.caption).weight(.semibold))
                .foregroundStyle(onPrimary ? Palette.primaryForeground : Palette.primary)
                .padding(.horizontal, Spacing.sm)
                .frame(minWidth: 40, minHeight: 24)
                .background(
                    onPrimary ? Palette.primaryForeground.opacity(0.2) : Palette.primary.opacity(0.1),
                    in: Capsule()
                )
                .contentTransition(.numericText())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(String(localized: "chats.voice.speed", defaultValue: "Скорость")))
        .accessibilityValue(Text(verbatim: rate.label))
    }
}

// MARK: - Волна: расчёт

/// Те же правила волны, что в вебе (`voice-profile.ts`): ширина растёт с длительностью,
/// громкость — RMS по отрезкам, опора — 95-й перцентиль, запасная волна — узор по id.
enum VoiceWave {
    static let barWidth: CGFloat = 3
    static let gap: CGFloat = 2
    /// Полоса не исчезает и в тишине: волна с провалами до нуля читается как обрыв.
    static let floor = 0.12

    /// Двадцать две полосы у короткого, сорок четыре — потолок примерно к двадцати
    /// секундам: дальше разницы на глаз уже нет.
    static func barCount(duration: Double?) -> Int {
        guard let duration, duration.isFinite, duration > 0 else { return 32 }
        return Int(min(44, 22 + duration * 1.1).rounded())
    }

    static func width(bars: Int) -> CGFloat {
        CGFloat(bars) * barWidth + CGFloat(max(bars - 1, 0)) * gap
    }

    /// Пересчёт огибающей под число полос: по отрезку берём максимум, а не среднее —
    /// иначе сглаживаются паузы между словами, по которым волна и читается как речь.
    static func resample(_ envelope: [Double], count: Int) -> [Double] {
        guard count > 0, !envelope.isEmpty else { return [] }
        return (0..<count).map { index in
            let from = index * envelope.count / count
            let to = min(envelope.count, max(from + 1, (index + 1) * envelope.count / count))
            return max(floor, envelope[from..<to].max() ?? 0)
        }
    }

    /// Запасная волна, когда запись не разобрать: детерминированный узор по id файла,
    /// тот же, что в вебе. У каждого голосового свой и не меняется между открытиями.
    static func seeded(_ seed: String, count: Int) -> [Double] {
        var hash: UInt32 = 2_166_136_261
        for unit in seed.utf16 {
            hash = (hash ^ UInt32(unit)) &* 16_777_619
        }
        return (0..<count).map { _ in
            hash = (hash &* 1_103_515_245 &+ 12345) & 0x7fff_ffff
            return 0.25 + Double(hash % 1000) / 1000 * 0.75
        }
    }

    /// «0:05».
    static func time(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let whole = Int(seconds)
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }
}

/// Огибающая записи: громкость по времени (0…1) и точная длительность.
struct VoiceProfile: Sendable, Equatable {
    let envelope: [Double]
    let duration: Double
}

/// Разбор голосовых ради волны. Свой файл читается с диска, чужой скачивается по
/// подписанной ссылке, крупный не разбирается вовсе — как в вебе.
///
/// Разобранное держим в памяти до выхода из приложения: лента переиспользует ячейки,
/// и прокрутка туда-обратно иначе качала бы одно и то же снова. `nil` в кэше —
/// «пробовали, не вышло» (чужой кодек, сеть): волна остаётся запасной.
actor VoiceProfiles {
    static let shared = VoiceProfiles()

    /// Потолок для разбора: голосовое весит десятки килобайт в секунду, а «голосовым»
    /// по имени может оказаться и большой файл.
    private static let maxDecodeBytes = 12 * 1024 * 1024
    /// Сколько отсчётов громкости снимаем: под число полос пересчитываем уже из них.
    private static let resolution = 128

    private var parsed: [String: VoiceProfile?] = [:]
    private var inFlight: [String: Task<VoiceProfile?, Never>] = [:]

    func profile(for attachment: AttachmentRecord) async -> VoiceProfile? {
        let id = attachment.id
        if let known = parsed[id] { return known }
        if let running = inFlight[id] { return await running.value }
        let localPath = attachment.localPath
        let size = attachment.size
        let ext = Self.fileExtension(attachment)
        let task = Task.detached(priority: .utility) {
            await Self.read(id: id, localPath: localPath, size: size, ext: ext)
        }
        inFlight[id] = task
        let result = await task.value
        parsed[id] = .some(result)
        inFlight[id] = nil
        return result
    }

    private static func fileExtension(_ attachment: AttachmentRecord) -> String {
        let fromName = ((attachment.name ?? "") as NSString).pathExtension
        if !fromName.isEmpty { return fromName }
        return attachment.mime.contains("mpeg") ? "mp3" : "m4a"
    }

    private static func read(id: String, localPath: String?, size: Int?, ext: String) async -> VoiceProfile? {
        if let localPath, FileManager.default.fileExists(atPath: localPath) {
            return decode(URL(filePath: localPath))
        }
        if let size, size > maxDecodeBytes { return nil }
        guard
            let remote = await AppServices.attachmentURLs.url(for: id),
            let (downloaded, response) = try? await URLSession.shared.download(from: remote),
            (response as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        // Формат AVAudioFile угадывает и по расширению, а у скачанного оно `.tmp`.
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-wave-\(UUID().uuidString).\(ext)")
        defer {
            try? FileManager.default.removeItem(at: downloaded)
            try? FileManager.default.removeItem(at: file)
        }
        guard (try? FileManager.default.moveItem(at: downloaded, to: file)) != nil else { return nil }
        return decode(file)
    }

    /// RMS по равным отрезкам записи — громкость на слух; одиночный щелчок не поднимает
    /// отрезок целиком. Читаем кусками, а не целиком: минута — это миллионы отсчётов.
    private static func decode(_ url: URL) -> VoiceProfile? {
        guard let file = try? AVAudioFile(forReading: url) else { return nil }
        let total = file.length
        let sampleRate = file.processingFormat.sampleRate
        let chunk: AVAudioFrameCount = 16_384
        guard total > 0, sampleRate > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunk)
        else { return nil }

        var sums = [Double](repeating: 0, count: resolution)
        var counts = [Int](repeating: 0, count: resolution)
        var position: AVAudioFramePosition = 0
        var bin = 0
        var nextBoundary = total / AVAudioFramePosition(resolution)
        while position < total {
            let want = AVAudioFrameCount(min(AVAudioFramePosition(chunk), total - position))
            guard (try? file.read(into: buffer, frameCount: want)) != nil,
                  buffer.frameLength > 0,
                  let samples = buffer.floatChannelData?[0]
            else { break }
            for index in 0..<Int(buffer.frameLength) {
                let frame = position + AVAudioFramePosition(index)
                while frame >= nextBoundary, bin < resolution - 1 {
                    bin += 1
                    nextBoundary = total * AVAudioFramePosition(bin + 1) / AVAudioFramePosition(resolution)
                }
                let value = Double(samples[index])
                sums[bin] += value * value
                counts[bin] += 1
            }
            position += AVAudioFramePosition(buffer.frameLength)
        }
        guard position > 0 else { return nil }
        let envelope = (0..<resolution).map { counts[$0] > 0 ? (sums[$0] / Double(counts[$0])).squareRoot() : 0 }
        return VoiceProfile(envelope: normalize(envelope), duration: Double(position) / sampleRate)
    }

    /// К 0…1 по 95-му перцентилю, а не по максимуму: стук по столу иначе прижал бы речь
    /// к полу. Запись тише порога — тишина: ровная нить, а не усиленный шум.
    private static func normalize(_ envelope: [Double]) -> [Double] {
        let sorted = envelope.sorted()
        let loud = sorted.isEmpty ? 0 : sorted[(sorted.count - 1) * 95 / 100]
        guard loud >= 1e-4 else { return envelope.map { _ in VoiceWave.floor } }
        return envelope.map { min(1, max(VoiceWave.floor, $0 / loud)) }
    }
}

// MARK: - Скорость

/// Скорость голосовых — одна на всё приложение и запоминается, как в вебе (там —
/// localStorage, здесь — UserDefaults): выбрали 1,5× — следующее голосовое играет так же.
@MainActor
@Observable
final class VoicePlaybackRate {
    static let shared = VoicePlaybackRate()
    static let rates: [Float] = [1, 1.5, 2]
    private static let key = "chats.voice-rate"

    private(set) var value: Float

    init() {
        let stored = UserDefaults.standard.float(forKey: Self.key)
        value = Self.rates.contains(stored) ? stored : 1
    }

    /// «1×», «1,5×», «2×» — с десятичным разделителем языка.
    var label: String { "\(Double(value).formatted(.number))×" }

    /// Следующая по кругу; играющая запись переходит на неё сразу.
    func cycle() {
        let index = Self.rates.firstIndex(of: value) ?? 0
        value = Self.rates[(index + 1) % Self.rates.count]
        UserDefaults.standard.set(value, forKey: Self.key)
        VoicePlayer.applyRateToActive(value)
    }
}

// MARK: - Проигрыватель

/// Голосовые пузырей ленты: один проигрыватель на всех и id играющей записи.
@MainActor
@Observable
final class VoicePlayback {
    static let shared = VoicePlayback()

    let player = VoicePlayer()
    /// Запись в проигрывателе — играет или стоит на паузе.
    private(set) var currentID: String?
    @ObservationIgnored private var currentURL: URL?

    init() {
        // Доиграла — пузырь возвращается к виду «не начато», как в вебе.
        player.onFinish = { [weak self] in self?.currentID = nil }
    }

    func toggle(_ attachment: AttachmentRecord) async {
        if currentID == attachment.id, let currentURL {
            if player.isPlaying { player.pause() } else { player.play(url: currentURL) }
            return
        }
        await start(attachment, from: nil)
    }

    /// Перемотка: у записи в проигрывателе — на месте (пауза остаётся паузой), у другой —
    /// запуск с этого места.
    func seek(_ attachment: AttachmentRecord, to fraction: Double) async {
        if currentID == attachment.id, currentURL != nil {
            player.seek(to: fraction)
            return
        }
        await start(attachment, from: fraction)
    }

    /// Ушли из переписки: голосовое не играет из-под другого экрана, как и в вебе.
    func stop() {
        player.stop()
        currentID = nil
        currentURL = nil
    }

    private func start(_ attachment: AttachmentRecord, from fraction: Double?) async {
        let url: URL?
        if let path = attachment.localPath, FileManager.default.fileExists(atPath: path) {
            url = URL(filePath: path)
        } else {
            url = await AppServices.attachmentURLs.url(for: attachment.id)
        }
        guard let url else { return }
        player.stop()
        currentID = attachment.id
        currentURL = url
        let known = attachment.durationMs.flatMap { $0 > 0 ? Double($0) / 1000 : nil }
        player.play(url: url, knownDuration: known, from: fraction)
    }
}

/// Проигрыватель одного голосового. Список голосовых в информации о чате держит один
/// такой на всех: следующая запись сначала останавливает прежнюю (`stop`). Играть во
/// всём приложении может только один: запуск любого ставит прежний на паузу.
@Observable
final class VoicePlayer {
    private(set) var isPlaying = false
    private(set) var progress: Double = 0
    private(set) var caption = "0:00"
    /// Сколько секунд проиграно.
    private(set) var current: Double = 0
    /// Длительность — из файла, а пока он её не сообщил — из вложения.
    private(set) var duration: Double?
    /// Запись доиграла до конца — список переходит к следующей.
    @ObservationIgnored var onFinish: (@MainActor () -> Void)?

    private var player: AVPlayer?
    private var ticker: Task<Void, Never>?

    /// Играющий сейчас — его ставит на паузу запуск другого.
    @MainActor private static weak var active: VoicePlayer?

    deinit {
        ticker?.cancel()
    }

    /// Начато: играет или стоит на паузе не в начале.
    var hasStarted: Bool { isPlaying || current > 0 }

    /// Запись голосового или звонок забирает звук — играющее ставим на паузу.
    @MainActor
    static func pauseActive() {
        active?.pause()
    }

    @MainActor
    static func applyRateToActive(_ rate: Float) {
        guard let player = active?.player else { return }
        player.defaultRate = rate
        if active?.isPlaying == true { player.rate = rate }
    }

    /// Звонок, будильник, Siri или выдернутые наушники ставят голосовое на паузу — с
    /// того же места оно и продолжится.
    @MainActor private static let interruptions: [NSObjectProtocol] = {
        let center = NotificationCenter.default
        return [
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { note in
                guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                    AVAudioSession.InterruptionType(rawValue: raw) == .began
                else { return }
                MainActor.assumeIsolated { VoicePlayer.pauseActive() }
            },
            center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { note in
                guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                    AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable
                else { return }
                MainActor.assumeIsolated { VoicePlayer.pauseActive() }
            },
        ]
    }()

    @MainActor
    func play(url: URL, knownDuration: Double? = nil, from fraction: Double? = nil) {
        _ = Self.interruptions
        if player == nil {
            player = AVPlayer(url: url)
            duration = knownDuration
        }
        if let other = Self.active, other !== self { other.pause() }
        Self.active = self
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        if let fraction { seek(to: fraction) }
        // `play()` берёт скорость из `defaultRate`.
        player?.defaultRate = VoicePlaybackRate.shared.value
        player?.play()
        isPlaying = true
        startTicking()
    }

    @MainActor
    func pause() {
        player?.pause()
        isPlaying = false
        ticker?.cancel()
    }

    /// Сбросить запись совсем: следующий `play(url:)` начнёт другую с начала.
    @MainActor
    func stop() {
        pause()
        player = nil
        progress = 0
        current = 0
        caption = "0:00"
        duration = nil
    }

    /// Перейти к доле записи. Без известной длительности перематывать не к чему.
    @MainActor
    func seek(to fraction: Double) {
        guard let player, let total = total(of: player) else { return }
        let clamped = min(max(fraction, 0), 1)
        let target = clamped * total
        player.seek(
            to: CMTime(seconds: target, preferredTimescale: 600),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
        progress = clamped
        current = target
        caption = VoiceWave.time(target)
    }

    private func total(of player: AVPlayer) -> Double? {
        if let seconds = player.currentItem?.duration.seconds, seconds.isFinite, seconds > 0 { return seconds }
        return duration
    }

    @MainActor
    private func startTicking() {
        ticker?.cancel()
        // Двадцать раз в секунду: заливка волны должна ехать, а не прыгать.
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled, let player = self?.player {
                self?.tick(player)
                if self?.isFinished(player) == true {
                    await player.seek(to: .zero)
                    self?.onFinish?()
                    return
                }
                try? await Task.sleep(for: .milliseconds(50))
            }
        }
    }

    @MainActor
    private func tick(_ player: AVPlayer) {
        let now = player.currentTime().seconds
        let total = total(of: player)
        if let total, total != duration { duration = total }
        guard now.isFinite else { return }
        current = now
        caption = VoiceWave.time(now)
        if let total { progress = min(1, now / total) }
    }

    /// Доиграла до конца — сбрасываемся к началу, как в вебе.
    @MainActor
    private func isFinished(_ player: AVPlayer) -> Bool {
        guard let total = total(of: player), current >= total - 0.05 else { return false }
        isPlaying = false
        progress = 0
        current = 0
        caption = "0:00"
        return true
    }
}

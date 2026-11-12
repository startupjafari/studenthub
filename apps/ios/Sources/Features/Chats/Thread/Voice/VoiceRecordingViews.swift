import SwiftUI
import UIKit

// MARK: - Микрофон

/// Микрофон панели ввода с жестами Telegram.
///
/// Держишь — идёт запись, отпустил — ушло. Палец вверх до замка — запись идёт без
/// пальца, влево за порог — отмена. Во время записи под пальцем большой синий круг, над
/// ним — замок. Кнопка остаётся тем же видом на всё время жеста: перестройка панели
/// вокруг не обрывает касание.
struct VoiceMicButton: View {
    let recorder: VoiceRecorder

    /// Где палец относительно точки нажатия — для круга, замка и «влево — отмена».
    @Binding var offset: CGSize
    @GestureState private var isTouching = false
    /// С какой фазы началось касание: в записи с замком и в прослушивании касание —
    /// это «отправить», а не новая запись.
    @State private var touchStartPhase: VoiceRecordingMachine.Phase?
    @State private var touchEnded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var bigCircle: CGFloat = 84

    private var phase: VoiceRecordingMachine.Phase { recorder.phase }

    var body: some View {
        icon
            .frame(width: ControlHeight.lg, height: ControlHeight.lg)
            .contentShape(Circle())
            .overlay { bigCircleView.allowsHitTesting(false) }
            .overlay(alignment: .bottom) { lockView }
            .overlay(alignment: .bottomTrailing) { hintView }
            .gesture(press)
            .onChange(of: isTouching) { _, touching in
                guard !touching else { return }
                // Система забрала касание (звонок, уведомление): `onEnded` не придёт.
                // Проверяем на следующем витке — обычное отпускание успеет отметиться.
                DispatchQueue.main.async {
                    if !touchEnded, recorder.phase == .recording {
                        recorder.touchCancelled()
                    }
                    offset = .zero
                }
            }
            .accessibilityElement()
            .accessibilityLabel(Text(accessibilityTitle))
            .accessibilityHint(Text(String(
                localized: "chats.voice.holdHint",
                defaultValue: "Удерживайте, чтобы записать; вверх — без рук, влево — отмена"
            )))
            .accessibilityAddTraits(.isButton)
            // VoiceOver не удержит и не проведёт пальцем — двойное касание сразу
            // начинает запись с замком, второе отправляет.
            .accessibilityAction {
                switch phase {
                case .lockedRecording, .stopped:
                    recorder.sendNow()
                default:
                    recorder.press()
                    recorder.drag(CGSize(width: 0, height: -VoiceRecordingMachine.lockDistance * 2))
                }
            }
    }

    private var press: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .updating($isTouching) { _, state, _ in state = true }
            .onChanged { value in
                if touchStartPhase == nil {
                    touchStartPhase = phase
                    touchEnded = false
                    if phase.startsRecordingOnPress { recorder.press() }
                }
                guard recorder.phase == .recording else { return }
                offset = value.translation
                recorder.drag(value.translation)
            }
            .onEnded { _ in
                touchEnded = true
                let started = touchStartPhase
                touchStartPhase = nil
                withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
                    offset = .zero
                }
                switch started {
                case .lockedRecording, .stopped:
                    recorder.sendNow()
                default:
                    if recorder.phase == .recording { recorder.release() }
                }
            }
    }

    @ViewBuilder
    private var icon: some View {
        switch phase {
        case .lockedRecording, .stopped, .preparing:
            Image(systemName: "arrow.up")
                .font(Typography.body.weight(.bold))
                .foregroundStyle(Palette.primaryForeground)
                .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                .glassSurface(tint: Palette.primary, in: Circle())
        default:
            Image(systemName: "mic")
                .font(.title3)
                .foregroundStyle(Palette.mutedForeground)
                .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                .composerGlass(in: Circle())
                .opacity(phase == .recording ? 0 : 1)
        }
    }

    /// Большой круг под пальцем. Пульсирует по громкости — видно, что микрофон слышит.
    @ViewBuilder
    private var bigCircleView: some View {
        if phase == .recording {
            let level = CGFloat(recorder.levels.last ?? 0)
            ZStack {
                Circle()
                    .fill(Palette.primary.opacity(0.18))
                    .frame(width: bigCircle, height: bigCircle)
                    .scaleEffect(reduceMotion ? 1 : 1 + level * 0.45)
                    .animation(.easeOut(duration: 0.12), value: level)
                Circle()
                    .fill(Palette.primary)
                    .frame(width: bigCircle, height: bigCircle)
                Image(systemName: "mic.fill")
                    .font(.title2)
                    .foregroundStyle(Palette.primaryForeground)
            }
            .offset(x: min(0, offset.width), y: min(0, max(offset.height, -VoiceRecordingMachine.lockDistance)))
            .transition(reduceMotion ? .opacity : .scale(scale: 0.4).combined(with: .opacity))
        }
    }

    /// Замок над микрофоном: тянется вверх за пальцем, после закрепления — «стоп».
    @ViewBuilder
    private var lockView: some View {
        switch phase {
        case .recording:
            let progress = min(1, max(0, -offset.height / VoiceRecordingMachine.lockDistance))
            VStack(spacing: Spacing.xs) {
                Image(systemName: progress > 0.6 ? "lock.fill" : "lock.open")
                    .font(.subheadline.weight(.semibold))
                    .contentTransition(.symbolEffect(.replace))
                Image(systemName: "chevron.up")
                    .font(.caption2.weight(.bold))
                    .opacity(1 - progress)
            }
            .foregroundStyle(Palette.mutedForeground)
            .frame(width: 36, height: 72 - progress * 24)
            .floatingGlass(in: Capsule())
            .offset(y: -(bigCircle / 2 + 36) - progress * 24)
            .allowsHitTesting(false)
            .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            .accessibilityHidden(true)
        case .lockedRecording:
            Button {
                recorder.stop()
            } label: {
                Image(systemName: "stop.fill")
                    .font(.subheadline)
                    .foregroundStyle(Palette.destructive)
                    .frame(width: 40, height: 40)
                    .floatingGlass(in: Circle())
            }
            .buttonStyle(.plain)
            .offset(y: -(ControlHeight.lg + Spacing.lg))
            .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
            .accessibilityLabel(Text(String(localized: "chats.voice.stop", defaultValue: "Остановить запись")))
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private var hintView: some View {
        if recorder.hint == .holdToRecord {
            Text(String(
                localized: "chats.voice.holdToRecord",
                defaultValue: "Удерживайте, чтобы записать голосовое"
            ))
            .font(Typography.meta)
            .foregroundStyle(Palette.foreground)
            .fixedSize()
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
            .floatingGlass(in: Capsule())
            .offset(y: -(ControlHeight.lg + Spacing.md))
            .allowsHitTesting(false)
            .transition(.opacity)
        }
    }

    private var accessibilityTitle: String {
        switch phase {
        case .lockedRecording, .stopped:
            String(localized: "chats.voice.send", defaultValue: "Отправить голосовое")
        default:
            String(localized: "chats.voice.record", defaultValue: "Записать голосовое")
        }
    }
}

private extension VoiceRecordingMachine.Phase {
    var startsRecordingOnPress: Bool {
        switch self {
        case .idle, .uploading, .failed: true
        default: false
        }
    }
}

// MARK: - Полоса записи

/// Место скрепки и поля во время записи: мигающая точка с таймером и «влево — отмена»
/// (палец держит) или «Отмена» (замок). В прослушивании — корзина, волна и время.
struct VoiceRecordingStrip: View {
    let recorder: VoiceRecorder
    let offset: CGSize

    @State private var blink = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            switch recorder.phase {
            case .stopped, .preparing:
                VoicePreviewStrip(recorder: recorder)
            default:
                recordingContent
            }
        }
        .frame(maxWidth: .infinity, minHeight: ControlHeight.lg)
        .composerGlass(in: Capsule())
    }

    private var recordingContent: some View {
        HStack(spacing: Spacing.md) {
            Circle()
                .fill(Palette.destructive)
                .frame(width: 10, height: 10)
                .opacity(blink ? 0.2 : 1)
                .animation(
                    reduceMotion ? nil : .easeInOut(duration: 0.6).repeatForever(autoreverses: true),
                    value: blink
                )
                .onAppear { blink = true }
                .accessibilityHidden(true)
            Text(verbatim: Self.clock(recorder.duration))
                .font(Typography.tabular(.body))
                .foregroundStyle(Palette.foreground)
                .accessibilityLabel(Text(String(
                    localized: "chats.voice.recordingFor",
                    defaultValue: "Идёт запись, \(Self.spoken(recorder.duration))"
                )))
            Spacer(minLength: Spacing.md)
            if recorder.phase == .lockedRecording {
                Button(String(localized: "common.cancel", defaultValue: "Отмена")) {
                    recorder.delete()
                }
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.primary)
                .transition(.opacity)
            } else {
                slideToCancel
            }
            Spacer(minLength: Spacing.md)
        }
        .padding(.leading, Spacing.lg)
        .padding(.trailing, Spacing.md)
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: recorder.phase)
    }

    /// «‹ Влево — отмена» едет за пальцем и гаснет у порога.
    private var slideToCancel: some View {
        let shift = min(0, offset.width)
        let fade = 1 - min(1, -shift / VoiceRecordingMachine.cancelDistance)
        return HStack(spacing: Spacing.xs) {
            Image(systemName: "chevron.left")
                .font(.footnote.weight(.semibold))
            Text(String(localized: "chats.voice.slideToCancel", defaultValue: "Влево — отмена"))
                .font(Typography.meta)
        }
        .foregroundStyle(Palette.mutedForeground)
        .offset(x: shift * 0.6)
        .opacity(fade)
        .fixedSize()
        .accessibilityHidden(true)
    }

    /// «0:07,42» — как таймер записи в Telegram.
    static func clock(_ seconds: TimeInterval) -> String {
        let whole = Int(seconds)
        let hundredths = Int((seconds - Double(whole)) * 100)
        return String(format: "%d:%02d,%02d", whole / 60, whole % 60, hundredths)
    }

    static func spoken(_ seconds: TimeInterval) -> String {
        Duration.seconds(Int(seconds)).formatted(.units(allowed: [.minutes, .seconds], width: .wide))
    }
}

/// Прослушивание остановленной записи: корзина, «играть», волна с прогрессом, время.
private struct VoicePreviewStrip: View {
    let recorder: VoiceRecorder

    private var player: VoicePreviewPlayer { recorder.preview }

    var body: some View {
        HStack(spacing: Spacing.md) {
            Button {
                recorder.delete()
            } label: {
                Image(systemName: "trash")
                    .foregroundStyle(Palette.destructive)
                    .frame(width: ControlHeight.sm, height: ControlHeight.sm)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "chats.voice.delete", defaultValue: "Удалить запись")))

            Button {
                player.toggle()
            } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.footnote)
                    .foregroundStyle(Palette.primaryForeground)
                    .frame(width: 28, height: 28)
                    .background(Palette.primary, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(player.isPlaying
                ? String(localized: "chats.voice.pause", defaultValue: "Пауза")
                : String(localized: "chats.voice.play", defaultValue: "Прослушать")))

            VoiceEnvelopeView(levels: recorder.envelope, progress: player.progress)
                .frame(height: 22)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    SpatialTapGesture().onEnded { _ in player.toggle() }
                )

            Text(verbatim: VoiceRecordingStrip.clock(player.isPlaying
                ? player.duration * player.progress
                : max(player.duration, recorder.duration))
                .components(separatedBy: ",").first ?? "")
                .font(Typography.tabular(Typography.meta))
                .foregroundStyle(Palette.mutedForeground)
        }
        .padding(.horizontal, Spacing.md)
    }
}

/// Волна всей записи, ужатая до ширины полосы; проигранное — фирменным цветом.
struct VoiceEnvelopeView: View {
    let levels: [Float]
    var progress: Double = 0

    var body: some View {
        GeometryReader { proxy in
            let count = max(1, Int(proxy.size.width / 4))
            let bars = Self.resample(levels, count: count)
            HStack(alignment: .center, spacing: 2) {
                ForEach(bars.indices, id: \.self) { index in
                    Capsule()
                        .fill(Double(index) / Double(bars.count) < progress ? Palette.primary : Palette.primary.opacity(0.35))
                        .frame(width: 2, height: max(3, proxy.size.height * CGFloat(bars[index])))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .accessibilityHidden(true)
    }

    /// Средние по корзинам: длинная запись ужимается, короткая растягивается.
    static func resample(_ levels: [Float], count: Int) -> [Float] {
        guard !levels.isEmpty, count > 0 else { return Array(repeating: 0.1, count: max(count, 0)) }
        return (0..<count).map { index in
            let start = index * levels.count / count
            let end = max(start + 1, (index + 1) * levels.count / count)
            let slice = levels[start..<min(end, levels.count)]
            return slice.reduce(0, +) / Float(slice.count)
        }
    }
}

// MARK: - Ошибки

extension View {
    /// Отказ в микрофоне — с переходом в настройки; остальное — коротко.
    func voiceRecordingAlerts(_ recorder: VoiceRecorder) -> some View {
        modifier(VoiceRecordingAlerts(recorder: recorder))
    }
}

private struct VoiceRecordingAlerts: ViewModifier {
    let recorder: VoiceRecorder

    func body(content: Content) -> some View {
        content.alert(
            title,
            isPresented: Binding(
                get: { if case .failed = recorder.phase { true } else { false } },
                set: { if !$0 { recorder.dismissFailure() } }
            )
        ) {
            if recorder.phase == .failed(.permissionDenied) {
                Button(String(localized: "chats.voice.openSettings", defaultValue: "Открыть настройки")) {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
            }
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(message)
        }
    }

    private var title: String {
        recorder.phase == .failed(.permissionDenied)
            ? String(localized: "chats.voice.noMicTitle", defaultValue: "Нет доступа к микрофону")
            : String(localized: "chats.voice.failedTitle", defaultValue: "Не получилось записать")
    }

    private var message: String {
        switch recorder.phase {
        case .failed(.permissionDenied):
            String(
                localized: "chats.voice.noMicMessage",
                defaultValue: "Разрешите доступ к микрофону в настройках, чтобы записывать голосовые."
            )
        case .failed(.emptyRecording):
            String(localized: "chats.voice.empty", defaultValue: "Запись получилась пустой.")
        default:
            String(
                localized: "chats.voice.busy",
                defaultValue: "Микрофон занят другим приложением или недоступен."
            )
        }
    }
}

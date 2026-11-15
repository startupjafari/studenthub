import SwiftUI

/// Камера историй: предпросмотр в рамке холста и управление вокруг него.
struct StoryCameraScreen: View {
    let model: StoryStudioModel
    let canvas: CGRect

    @State private var focusPoint: CGPoint?
    @State private var focusToken = 0

    var body: some View {
        ZStack(alignment: .topLeading) {
            preview
                .frame(width: canvas.width, height: canvas.height)
                .clipShape(RoundedRectangle(cornerRadius: StoryStageLayout.cornerRadius, style: .continuous))
                .offset(x: canvas.minX, y: canvas.minY)

            topBar
                .frame(width: canvas.width)
                .offset(x: canvas.minX, y: canvas.minY + Spacing.md)

            if model.state == .cameraCollage {
                collagePicker
                    .frame(width: canvas.width)
                    .offset(x: canvas.minX, y: canvas.minY + 62)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            bottomControls
                .frame(width: canvas.width)
                .offset(x: canvas.minX, y: canvas.maxY - 104)

            modeSwitcher
                .frame(width: canvas.width, height: StoryStageLayout.bottomBar)
                .offset(x: canvas.minX, y: canvas.maxY)
                .opacity(model.state == .recording ? 0 : 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("story.camera")
    }

    // MARK: Предпросмотр и коллаж

    @ViewBuilder
    private var preview: some View {
        ZStack {
            Color.black
            if let collage = model.collage {
                collageGrid(collage)
            } else {
                livePreview
            }
            if model.isSwitchingCamera {
                Rectangle().fill(.ultraThinMaterial).environment(\.colorScheme, .dark).transition(.opacity)
            }
            if let failure = model.cameraFailure {
                VStack(spacing: Spacing.md) {
                    Image(systemName: "camera.fill").font(.largeTitle)
                    Text(failure).multilineTextAlignment(.center)
                }
                .foregroundStyle(.white.opacity(0.8))
                .padding(Spacing.xxl)
                .accessibilityIdentifier("story.camera.failure")
            }
            if let countdown = model.countdown {
                Text(verbatim: "\(countdown)")
                    .font(.system(size: 120, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .shadow(radius: 8)
                    .contentTransition(.numericText(countsDown: true))
                    .accessibilityIdentifier("story.camera.countdown")
            }
            if let started = model.recordingStartedAt {
                VStack {
                    RecordingTimer(start: started, limit: StoryMediaImport.maxVideoDuration)
                        .padding(.top, 64)
                    Spacer()
                }
            }
            if let focusPoint {
                RoundedRectangle(cornerRadius: 4)
                    .stroke(Color.yellow, lineWidth: 1.5)
                    .frame(width: 72, height: 72)
                    .position(focusPoint)
                    .id(focusToken)
                    .transition(.scale(scale: 1.4).combined(with: .opacity))
                    .allowsHitTesting(false)
            }
        }
    }

    private var livePreview: some View {
        StoryCameraPreview(
            camera: model.camera,
            onTap: { point in showFocus(at: point) },
            onPinch: { scale, began in model.camera.zoom(by: scale, began: began) }
        )
    }

    private func showFocus(at point: CGPoint) {
        model.focus(at: point)
        Haptics.tap()
        focusToken += 1
        withAnimation(Motion.snappy) { focusPoint = point }
        let token = focusToken
        Task {
            try? await Task.sleep(nanoseconds: 900_000_000)
            if token == focusToken { withAnimation(.easeOut(duration: Motion.Duration.fade)) { focusPoint = nil } }
        }
    }

    private func collageGrid(_ collage: StoryCollageCapture<String>) -> some View {
        let metrics = StoryCanvasMetrics(size: canvas.size)
        return ZStack(alignment: .topLeading) {
            ForEach(Array(collage.layout.cells.enumerated()), id: \.offset) { index, cell in
                let rect = metrics.rect(cell)
                let file = collage.frames[index]
                Group {
                    if let file, let image = model.collageImages[file] {
                        Button {
                            model.retakeCollageCell(index)
                        } label: {
                            Image(uiImage: image).resizable().scaledToFill()
                                .frame(width: rect.width, height: rect.height)
                                .clipped()
                                .overlay(alignment: .topTrailing) {
                                    Image(systemName: "arrow.counterclockwise.circle.fill")
                                        .font(.title3)
                                        .foregroundStyle(.white, .black.opacity(0.4))
                                        .padding(Spacing.md)
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "stories.collage.retake", defaultValue: "Переснять кадр")))
                        .accessibilityValue(Text(verbatim: "filled"))
                    } else if collage.activeIndex == index {
                        livePreview
                            .frame(width: rect.width, height: rect.height)
                            .accessibilityValue(Text(verbatim: "active"))
                    } else {
                        Button {
                            model.activateCollageCell(index)
                        } label: {
                            Color.white.opacity(0.06)
                                .overlay(Image(systemName: "plus").font(.title2).foregroundStyle(.white.opacity(0.5)))
                                .frame(width: rect.width, height: rect.height)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "stories.collage.cell", defaultValue: "Пустая ячейка")))
                        .accessibilityValue(Text(verbatim: "empty"))
                    }
                }
                .frame(width: rect.width, height: rect.height)
                .overlay(Rectangle().stroke(Color.black, lineWidth: 2))
                .offset(x: rect.minX, y: rect.minY)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("story.collage.cell.\(index)")
            }
        }
        .frame(width: canvas.width, height: canvas.height, alignment: .topLeading)
    }

    // MARK: Верх

    private var topBar: some View {
        HStack(spacing: Spacing.md) {
            StoryRoundButton(
                symbol: "square.grid.2x2",
                label: String(localized: "stories.camera.collage", defaultValue: "Коллаж"),
                isActive: model.collage != nil || model.state == .cameraCollage
            ) {
                model.toggleCollagePicker()
            }
            .accessibilityIdentifier("story.camera.collage")

            Menu {
                Button {
                    model.startTextStory()
                } label: {
                    Label(String(localized: "stories.camera.textStory", defaultValue: "Текст на фоне"), systemImage: "textformat")
                }
                Button {
                    model.cycleSelfTimer()
                } label: {
                    Label(timerTitle, systemImage: "timer")
                }
            } label: {
                Image(systemName: model.selfTimer == nil ? "ellipsis" : "timer")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(.ultraThinMaterial).environment(\.colorScheme, .dark))
            }
            .accessibilityLabel(Text(String(localized: "stories.camera.more", defaultValue: "Режимы съёмки")))
            .accessibilityIdentifier("story.camera.more")

            if model.camera.hasFlash {
                StoryRoundButton(
                    symbol: model.flash.symbol,
                    label: String(localized: "stories.camera.flash", defaultValue: "Вспышка")
                ) {
                    model.toggleFlash()
                }
                .accessibilityIdentifier("story.camera.flash")
                .accessibilityValue(Text(verbatim: model.flash.rawValue))
            }

            Spacer()

            StoryRoundButton(symbol: "xmark", label: String(localized: "stories.close", defaultValue: "Закрыть")) {
                model.close()
            }
            .accessibilityIdentifier("story.camera.close")
        }
        .padding(.horizontal, Spacing.lg)
        .opacity(model.state == .recording ? 0 : 1)
        .animation(Motion.snappy, value: model.state)
    }

    private var timerTitle: String {
        switch model.selfTimer {
        case 3: return String(localized: "stories.camera.timer3", defaultValue: "Таймер: 3 с")
        case 10: return String(localized: "stories.camera.timer10", defaultValue: "Таймер: 10 с")
        default: return String(localized: "stories.camera.timerOff", defaultValue: "Таймер: выкл.")
        }
    }

    private var collagePicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.lg) {
                ForEach(StoryCollageLayout.allCases) { layout in
                    let selected = layout == model.collageLayout
                    Button {
                        model.selectCollage(layout)
                    } label: {
                        CollageIcon(layout: layout, selected: selected)
                    }
                    .buttonStyle(.pressable)
                    .accessibilityIdentifier("story.collage.layout.\(layout.rawValue)")
                    .accessibilityLabel(Text(layout.title))
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
        }
        .background(Capsule().fill(.ultraThinMaterial).environment(\.colorScheme, .dark).padding(.horizontal, Spacing.md))
    }

    // MARK: Низ

    private var bottomControls: some View {
        HStack {
            Button {
                Task { await model.openGallery() }
            } label: {
                Group {
                    if let thumbnail = model.latestThumbnail {
                        Image(uiImage: thumbnail).resizable().scaledToFill()
                    } else {
                        Image(systemName: "photo.on.rectangle").font(.title3).foregroundStyle(.white)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(.ultraThinMaterial)
                    }
                }
                .frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(.white, lineWidth: 2))
            }
            .buttonStyle(.pressable)
            .accessibilityLabel(Text(String(localized: "stories.camera.gallery", defaultValue: "Галерея")))
            .accessibilityIdentifier("story.camera.gallery")
            .opacity(model.state == .recording ? 0 : 1)

            Spacer()

            ShutterButton(appearance: model.shutter, recordingStart: model.recordingStartedAt, isBusy: model.isCapturing) {
                Task { await model.shutterTapped() }
            }

            Spacer()

            StoryRoundButton(
                symbol: "arrow.triangle.2.circlepath",
                label: String(localized: "stories.camera.flip", defaultValue: "Сменить камеру"),
                size: 44
            ) {
                Task { await model.switchCamera() }
            }
            .accessibilityIdentifier("story.camera.flip")
            .accessibilityValue(Text(verbatim: model.cameraPosition == .back ? "back" : "front"))
        }
        .padding(.horizontal, Spacing.xxl)
    }

    private var modeSwitcher: some View {
        let modes = StoryCaptureMode.allCases
        let index = modes.firstIndex(of: model.captureMode) ?? 0
        return HStack(spacing: Spacing.xxl) {
            ForEach(modes) { mode in
                Button {
                    model.setCaptureMode(mode)
                } label: {
                    Text(mode.title.uppercased())
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(mode == model.captureMode ? Color.white : Color.white.opacity(0.5))
                        .padding(.vertical, Spacing.sm)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("story.camera.mode.\(mode.rawValue)")
                .accessibilityAddTraits(mode == model.captureMode ? .isSelected : [])
            }
        }
        // Активная подпись — по центру под затвором; лента едет, как у Telegram.
        .offset(x: CGFloat(Double(modes.count - 1) / 2 - Double(index)) * 74)
        .animation(Motion.snappy, value: model.captureMode)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 20).onEnded { drag in
                guard abs(drag.translation.width) > abs(drag.translation.height) else { return }
                let next = index + (drag.translation.width < 0 ? 1 : -1)
                if modes.indices.contains(next) { model.setCaptureMode(modes[next]) }
            }
        )
        .accessibilityIdentifier("story.camera.modes")
    }
}

/// Кнопка затвора: белая — фото, красная — видео, квадрат с кольцом — запись.
private struct ShutterButton: View {
    let appearance: StoryShutterAppearance
    let recordingStart: Date?
    let isBusy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().stroke(.white, lineWidth: 4).frame(width: 78, height: 78)
                if let recordingStart {
                    TimelineView(.animation) { context in
                        let progress = min(context.date.timeIntervalSince(recordingStart) / StoryMediaImport.maxVideoDuration, 1)
                        Circle()
                            .trim(from: 0, to: progress)
                            .stroke(Color.red, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .frame(width: 78, height: 78)
                    }
                }
                RoundedRectangle(cornerRadius: appearance == .recording ? 8 : 31, style: .continuous)
                    .fill(appearance == .photo ? Color.white : Color.red)
                    .frame(width: appearance == .recording ? 30 : 62, height: appearance == .recording ? 30 : 62)
                    .scaleEffect(isBusy ? 0.9 : 1)
            }
            .animation(Motion.snappy, value: appearance)
            .animation(Motion.press, value: isBusy)
            .frame(width: 84, height: 84)
            .contentShape(Circle())
        }
        .buttonStyle(.pressable)
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier("story.camera.shutter")
        .accessibilityValue(Text(verbatim: appearance.accessibilityValue))
    }

    private var label: String {
        switch appearance {
        case .photo: return String(localized: "stories.camera.takePhoto", defaultValue: "Снять фото")
        case .videoIdle: return String(localized: "stories.camera.record", defaultValue: "Начать запись")
        case .recording: return String(localized: "stories.camera.stop", defaultValue: "Остановить запись")
        }
    }
}

/// Время записи и предел — над кадром.
struct RecordingTimer: View {
    let start: Date
    let limit: Double

    var body: some View {
        TimelineView(.periodic(from: start, by: 0.5)) { context in
            let elapsed = Int(context.date.timeIntervalSince(start))
            HStack(spacing: Spacing.sm) {
                Circle().fill(Color.red).frame(width: 8, height: 8)
                Text(verbatim: String(format: "%d:%02d", elapsed / 60, elapsed % 60))
                    .font(.system(.subheadline, design: .rounded).monospacedDigit().weight(.semibold))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
            .background(Capsule().fill(Color.black.opacity(0.45)))
        }
        .accessibilityIdentifier("story.camera.recordingTimer")
    }
}

/// Значок раскладки: ячейки будущих кадров.
private struct CollageIcon: View {
    let layout: StoryCollageLayout
    let selected: Bool

    var body: some View {
        let size = CGSize(width: 22, height: 36)
        let metrics = StoryCanvasMetrics(size: size)
        ZStack(alignment: .topLeading) {
            ForEach(Array(layout.cells.enumerated()), id: \.offset) { _, cell in
                let rect = metrics.rect(cell).insetBy(dx: 1, dy: 1)
                RoundedRectangle(cornerRadius: 2)
                    .stroke(selected ? Color.black : Color.white, lineWidth: 1.5)
                    .frame(width: rect.width, height: rect.height)
                    .offset(x: rect.minX, y: rect.minY)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .padding(Spacing.sm)
        .background(RoundedRectangle(cornerRadius: 8).fill(selected ? Color.white : Color.clear))
    }
}

extension StoryCollageLayout {
    var title: String {
        switch self {
        case .single: return String(localized: "stories.collage.single", defaultValue: "Один кадр")
        case .twoStacked: return String(localized: "stories.collage.twoStacked", defaultValue: "Два кадра друг над другом")
        case .twoSideBySide: return String(localized: "stories.collage.twoSideBySide", defaultValue: "Два кадра рядом")
        case .threeTopWide: return String(localized: "stories.collage.threeTopWide", defaultValue: "Три кадра")
        case .threeStacked: return String(localized: "stories.collage.threeStacked", defaultValue: "Три полосы")
        case .fourGrid: return String(localized: "stories.collage.fourGrid", defaultValue: "Сетка 2×2")
        case .sixGrid: return String(localized: "stories.collage.sixGrid", defaultValue: "Сетка 2×3")
        }
    }
}

import SwiftUI

/// Обработка снимка: ползунки, размытие и кривые. Фото остаётся видимым над панелью,
/// предпросмотр пересчитывается на GPU под пальцем.
struct StoryAdjustPanel: View {
    let model: StoryStudioModel
    let canvas: CGRect

    private var tab: StoryAdjustTab { model.state.adjustTab ?? .tools }
    private var panelHeight: CGFloat { min(canvas.height * 0.46, 330) }

    var body: some View {
        ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                switch tab {
                case .tools: toolsList
                case .blur: blurControls
                case .curves: StoryCurvesEditor(model: model)
                }
            }
            .frame(width: canvas.width, height: panelHeight, alignment: .top)
            .storyPanelBackground()
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18, style: .continuous))
            .offset(x: canvas.minX, y: canvas.maxY - panelHeight)

            bottomBar
                .frame(width: canvas.width, height: StoryStageLayout.bottomBar)
                .offset(x: canvas.minX, y: canvas.maxY)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("story.adjust")
    }

    // MARK: Ползунки

    private var toolsList: some View {
        ScrollView {
            VStack(spacing: Spacing.sm) {
                ForEach(StoryAdjustmentTool.allCases) { tool in
                    let value = model.document?.adjustments[tool] ?? 0
                    let active = model.activeAdjustment == tool
                    VStack(spacing: 0) {
                        HStack {
                            Text(tool.title)
                                .font(.subheadline.weight(active ? .semibold : .regular))
                                .foregroundStyle(active ? Palette.primary : .white)
                            Spacer()
                            Text(verbatim: value == 0 ? "0" : (value > 0 && tool.isBipolar ? "+\(Int(value))" : "\(Int(value))"))
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(value == 0 ? .white.opacity(0.5) : Palette.primary)
                        }
                        StorySlider(
                            value: value,
                            range: tool.range,
                            bipolar: tool.isBipolar,
                            onChange: { model.setAdjustment(tool, $0) },
                            onReset: { model.setAdjustment(tool, 0) }
                        )
                        .accessibilityLabel(Text(tool.title))
                        .accessibilityIdentifier("story.adjust.\(tool.rawValue)")
                    }
                    .padding(.horizontal, Spacing.xl)
                }
            }
            .padding(.vertical, Spacing.lg)
        }
    }

    // MARK: Размытие

    private var blurControls: some View {
        let blur = model.document?.blur ?? .off
        return VStack(spacing: Spacing.xl) {
            HStack(spacing: Spacing.xxl) {
                ForEach(StoryBlur.Mode.allCases, id: \.self) { mode in
                    let selected = blur.mode == mode
                    Button {
                        model.setBlurMode(mode)
                    } label: {
                        VStack(spacing: Spacing.sm) {
                            Image(systemName: mode.symbol)
                                .font(.system(size: 26, weight: .regular))
                                .frame(width: 56, height: 56)
                                .background(Circle().fill(selected ? Color.white.opacity(0.2) : .clear))
                            Text(mode.title).font(.footnote.weight(selected ? .semibold : .regular))
                        }
                        .foregroundStyle(selected ? Palette.primary : .white)
                    }
                    .buttonStyle(.pressable)
                    .accessibilityIdentifier("story.blur.\(mode.rawValue)")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(.top, Spacing.xl)

            if blur.mode != .off {
                VStack(spacing: Spacing.xs) {
                    HStack {
                        Text(String(localized: "stories.blur.intensity", defaultValue: "Сила"))
                        Spacer()
                        Text(verbatim: "\(Int((blur.intensity * 100).rounded()))").monospacedDigit()
                    }
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    StorySlider(
                        value: blur.intensity * 100,
                        range: 0...100,
                        bipolar: false,
                        onChange: { value in
                            var updated = blur
                            updated.setIntensity(value / 100)
                            model.setBlur(updated)
                        },
                        onReset: {
                            var updated = blur
                            updated.setIntensity(StoryBlur().intensity)
                            model.setBlur(updated)
                        }
                    )
                    .accessibilityIdentifier("story.blur.intensity")
                    Text(String(
                        localized: "stories.blur.hint",
                        defaultValue: "Двигайте зону резкости пальцем, растягивайте двумя"
                    ))
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.6))
                    .padding(.top, Spacing.sm)
                }
                .padding(.horizontal, Spacing.xl)
                .transition(.opacity)
            }
            Spacer()
        }
        .animation(Motion.snappy, value: blur.mode)
    }

    // MARK: Низ

    private var bottomBar: some View {
        HStack {
            Button(String(localized: "stories.cancel", defaultValue: "Отмена")) { model.cancelTool() }
                .accessibilityIdentifier("story.tool.cancel")
            Spacer()
            HStack(spacing: Spacing.xl) {
                tabButton(.tools, symbol: "slider.horizontal.3", title: String(localized: "stories.adjust.tab.tools", defaultValue: "Настройки"))
                tabButton(.blur, symbol: "drop.halffull", title: String(localized: "stories.adjust.tab.blur", defaultValue: "Размытие"))
                tabButton(.curves, symbol: "chart.line.uptrend.xyaxis", title: String(localized: "stories.adjust.tab.curves", defaultValue: "Кривые"))
            }
            Spacer()
            Button(String(localized: "stories.done", defaultValue: "Готово")) { model.confirmTool() }
                .font(.body.weight(.semibold))
                .foregroundStyle(Palette.primary)
                .accessibilityIdentifier("story.tool.done")
        }
        .foregroundStyle(.white)
        .padding(.horizontal, Spacing.xl)
    }

    private func tabButton(_ target: StoryAdjustTab, symbol: String, title: String) -> some View {
        Button {
            model.openAdjustments(target)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(tab == target ? Palette.primary : .white)
                .frame(width: 40, height: 40)
        }
        .accessibilityLabel(Text(title))
        .accessibilityIdentifier("story.adjust.tab.\(target.rawValue)")
        .accessibilityAddTraits(tab == target ? .isSelected : [])
    }
}

/// «Кривые»: квадрат с гистограммой, диагональю и пятью точками; каналы сверху.
struct StoryCurvesEditor: View {
    let model: StoryStudioModel
    @State private var dragging: Int?

    var body: some View {
        let channel = model.curvesChannel
        let curve = model.document?.curves[channel] ?? .identity
        VStack(spacing: Spacing.md) {
            HStack(spacing: Spacing.lg) {
                ForEach(StoryToneCurves.Channel.allCases, id: \.self) { item in
                    Button {
                        Haptics.tap()
                        model.curvesChannel = item
                    } label: {
                        HStack(spacing: Spacing.xs) {
                            Circle().fill(item.color).frame(width: 10, height: 10)
                            Text(item.title).font(.footnote.weight(item == channel ? .semibold : .regular))
                        }
                        .foregroundStyle(item == channel ? .white : .white.opacity(0.55))
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, Spacing.xs)
                        .background(Capsule().fill(item == channel ? Color.white.opacity(0.18) : .clear))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("story.curves.channel.\(item.rawValue)")
                    .accessibilityAddTraits(item == channel ? .isSelected : [])
                }
                Spacer()
                Button {
                    model.resetCurve()
                } label: {
                    Image(systemName: "arrow.counterclockwise").foregroundStyle(.white)
                }
                .disabled(curve.isIdentity)
                .opacity(curve.isIdentity ? 0.4 : 1)
                .accessibilityLabel(Text(String(localized: "stories.curves.reset", defaultValue: "Сбросить кривую")))
                .accessibilityIdentifier("story.curves.reset")
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.lg)

            GeometryReader { proxy in
                let side = min(proxy.size.width, proxy.size.height)
                graph(curve: curve, channel: channel, side: side)
                    .frame(width: side, height: side)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.lg)
        }
    }

    private func graph(curve: StoryToneCurve, channel: StoryToneCurves.Channel, side: CGFloat) -> some View {
        let histogram = model.histogram.values(for: channel)
        return ZStack {
            Canvas { context, size in
                let rect = CGRect(origin: .zero, size: size)
                // Гистограмма.
                if !histogram.isEmpty {
                    var bars = Path()
                    let barWidth = size.width / CGFloat(histogram.count)
                    for (index, value) in histogram.enumerated() {
                        let height = CGFloat(value) * size.height * 0.9
                        bars.addRect(CGRect(x: CGFloat(index) * barWidth, y: size.height - height, width: barWidth + 0.5, height: height))
                    }
                    context.fill(bars, with: .color(channel.color.opacity(0.25)))
                }
                // Сетка по четвертям и диагональ.
                var grid = Path()
                for step in 1..<4 {
                    let x = size.width * CGFloat(step) / 4
                    let y = size.height * CGFloat(step) / 4
                    grid.move(to: CGPoint(x: x, y: 0))
                    grid.addLine(to: CGPoint(x: x, y: size.height))
                    grid.move(to: CGPoint(x: 0, y: y))
                    grid.addLine(to: CGPoint(x: size.width, y: y))
                }
                context.stroke(grid, with: .color(.white.opacity(0.12)), lineWidth: 1)
                context.stroke(Path(rect), with: .color(.white.opacity(0.25)), lineWidth: 1)
                var diagonal = Path()
                diagonal.move(to: CGPoint(x: 0, y: size.height))
                diagonal.addLine(to: CGPoint(x: size.width, y: 0))
                context.stroke(diagonal, with: .color(.white.opacity(0.3)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                // Кривая.
                var line = Path()
                for step in 0...64 {
                    let x = Double(step) / 64
                    let point = CGPoint(x: CGFloat(x) * size.width, y: (1 - CGFloat(curve.value(at: x))) * size.height)
                    step == 0 ? line.move(to: point) : line.addLine(to: point)
                }
                context.stroke(line, with: .color(channel == .all ? .white : channel.color), lineWidth: 2)
            }
            ForEach(StoryToneCurve.xs.indices, id: \.self) { index in
                let point = CGPoint(x: CGFloat(StoryToneCurve.xs[index]) * side, y: (1 - CGFloat(curve.ys[index])) * side)
                Circle()
                    .fill(.white)
                    .frame(width: dragging == index ? 18 : 14, height: dragging == index ? 18 : 14)
                    .shadow(radius: 2)
                    .position(point)
                    .accessibilityElement()
                    .accessibilityLabel(Text(String(localized: "stories.curves.point", defaultValue: "Точка кривой")))
                    .accessibilityIdentifier("story.curves.point.\(index)")
                    .accessibilityValue(Text(verbatim: "\(Int((curve.ys[index] * 100).rounded()))"))
                    .accessibilityAdjustableAction { direction in
                        model.setCurvePoint(index, y: curve.ys[index] + (direction == .increment ? 0.05 : -0.05))
                    }
            }
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { drag in
                    let index = dragging ?? nearestPoint(to: drag.startLocation.x / max(side, 1))
                    if dragging == nil {
                        dragging = index
                        Haptics.tap()
                    }
                    model.setCurvePoint(index, y: Double(1 - drag.location.y / max(side, 1)))
                }
                .onEnded { _ in dragging = nil }
        )
        .accessibilityIdentifier("story.curves.graph")
    }

    private func nearestPoint(to x: CGFloat) -> Int {
        StoryToneCurve.xs.indices.min { abs(CGFloat(StoryToneCurve.xs[$0]) - x) < abs(CGFloat(StoryToneCurve.xs[$1]) - x) } ?? 2
    }
}

extension StoryToneCurves.Channel {
    var title: String {
        switch self {
        case .all: return String(localized: "stories.curves.all", defaultValue: "Все")
        case .red: return String(localized: "stories.curves.red", defaultValue: "Красный")
        case .green: return String(localized: "stories.curves.green", defaultValue: "Зелёный")
        case .blue: return String(localized: "stories.curves.blue", defaultValue: "Синий")
        }
    }

    var color: Color {
        switch self {
        case .all: return .white
        case .red: return .red
        case .green: return .green
        case .blue: return .blue
        }
    }
}

extension StoryAdjustmentTool {
    var title: String {
        switch self {
        case .enhance: return String(localized: "stories.adjust.enhance", defaultValue: "Улучшить")
        case .exposure: return String(localized: "stories.adjust.exposure", defaultValue: "Экспозиция")
        case .brightness: return String(localized: "stories.adjust.brightness", defaultValue: "Яркость")
        case .contrast: return String(localized: "stories.adjust.contrast", defaultValue: "Контраст")
        case .saturation: return String(localized: "stories.adjust.saturation", defaultValue: "Насыщенность")
        case .warmth: return String(localized: "stories.adjust.warmth", defaultValue: "Температура")
        case .tint: return String(localized: "stories.adjust.tint", defaultValue: "Оттенок")
        case .highlights: return String(localized: "stories.adjust.highlights", defaultValue: "Светлые участки")
        case .shadows: return String(localized: "stories.adjust.shadows", defaultValue: "Тени")
        case .vignette: return String(localized: "stories.adjust.vignette", defaultValue: "Виньетка")
        case .sharpen: return String(localized: "stories.adjust.sharpen", defaultValue: "Резкость")
        case .fade: return String(localized: "stories.adjust.fade", defaultValue: "Выцветание")
        }
    }
}

extension StoryBlur.Mode {
    var title: String {
        switch self {
        case .off: return String(localized: "stories.blur.off", defaultValue: "Нет")
        case .radial: return String(localized: "stories.blur.radial", defaultValue: "Радиальное")
        case .linear: return String(localized: "stories.blur.linear", defaultValue: "Линейное")
        }
    }

    var symbol: String {
        switch self {
        case .off: return "circle.slash"
        case .radial: return "smallcircle.filled.circle"
        case .linear: return "rectangle.split.1x2"
        }
    }
}

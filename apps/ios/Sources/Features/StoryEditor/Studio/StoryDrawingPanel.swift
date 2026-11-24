import SwiftUI

/// Режим «Рисунок»: отмена и повтор сверху, толщина слева, кисти и цвета снизу,
/// вкладки «Рисунок / Текст» и подтверждение.
struct StoryDrawingPanel: View {
    let model: StoryStudioModel
    let canvas: CGRect

    var body: some View {
        let tool = model.document?.drawingTool ?? StoryDrawingTool()
        let drawing = model.document?.drawing ?? StoryDrawing()
        ZStack(alignment: .topLeading) {
            HStack(spacing: Spacing.md) {
                StoryRoundButton(
                    symbol: "arrow.uturn.backward",
                    label: String(localized: "stories.drawing.undo", defaultValue: "Отменить")
                ) {
                    Haptics.tap()
                    model.editInTool { _ = $0.drawing.undo() }
                }
                .disabled(!drawing.canUndo)
                .opacity(drawing.canUndo ? 1 : 0.4)
                .accessibilityIdentifier("story.drawing.undo")
                StoryRoundButton(
                    symbol: "arrow.uturn.forward",
                    label: String(localized: "stories.drawing.redo", defaultValue: "Повторить")
                ) {
                    Haptics.tap()
                    model.editInTool { _ = $0.drawing.redo() }
                }
                .disabled(!drawing.canRedo)
                .opacity(drawing.canRedo ? 1 : 0.4)
                .accessibilityIdentifier("story.drawing.redo")
                Spacer()
                Button(String(localized: "stories.drawing.clear", defaultValue: "Очистить всё")) {
                    Haptics.impact(.medium)
                    model.editInTool { _ = $0.drawing.clearAll() }
                }
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, Spacing.lg)
                .frame(height: 40)
                .background(Capsule().fill(.ultraThinMaterial).environment(\.colorScheme, .dark))
                .disabled(drawing.isEmpty)
                .opacity(drawing.isEmpty ? 0.4 : 1)
                .accessibilityIdentifier("story.drawing.clear")
            }
            .padding(.horizontal, Spacing.lg)
            .frame(width: canvas.width)
            .offset(x: canvas.minX, y: canvas.minY + Spacing.md)
            .opacity(model.chromeHidden ? 0 : 1)

            BrushSizeSlider(tool: tool) { width in
                model.editInTool { $0.drawingTool.setWidth(width, for: tool.brush) }
            }
            .frame(width: 36, height: canvas.height * 0.4)
            .offset(x: canvas.minX + Spacing.sm, y: canvas.minY + canvas.height * 0.25)
            .opacity(model.chromeHidden ? 0 : 1)

            VStack(spacing: Spacing.md) {
                brushes(tool)
                colors(tool)
            }
            .frame(width: canvas.width)
            .padding(.vertical, Spacing.md)
            .background(
                LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
                    .allowsHitTesting(false)
            )
            .offset(x: canvas.minX, y: canvas.maxY - 128)
            .opacity(model.chromeHidden ? 0 : 1)

            tabs
                .frame(width: canvas.width, height: StoryStageLayout.bottomBar)
                .offset(x: canvas.minX, y: canvas.maxY)
        }
        .animation(.easeInOut(duration: Motion.Duration.layer), value: model.chromeHidden)
        .transition(.opacity)
    }

    private func brushes(_ tool: StoryDrawingTool) -> some View {
        HStack(spacing: Spacing.lg) {
            ForEach(StoryBrush.allCases, id: \.self) { brush in
                let selected = brush == tool.brush
                Button {
                    Haptics.tap()
                    model.editInTool { $0.drawingTool.brush = brush }
                } label: {
                    Image(systemName: brush.symbol)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(brush.usesColor ? tool.color.opaque.swiftUIColor : .white)
                        .shadow(color: brush == .neon ? tool.color.swiftUIColor : .clear, radius: 6)
                        .frame(width: 42, height: 46)
                        .background(RoundedRectangle(cornerRadius: 12).fill(selected ? Color.white.opacity(0.22) : .clear))
                        .offset(y: selected ? -4 : 0)
                }
                .buttonStyle(.pressable)
                .animation(Motion.snappy, value: selected)
                .accessibilityLabel(Text(brush.title))
                .accessibilityIdentifier("story.drawing.brush.\(brush.rawValue)")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }

    private func colors(_ tool: StoryDrawingTool) -> some View {
        HStack(spacing: Spacing.md) {
            Button {
                model.openColorPicker(.drawing)
            } label: {
                ZStack {
                    Circle().fill(AngularGradient(colors: [.red, .yellow, .green, .cyan, .blue, .purple, .red], center: .center))
                    Circle().fill(tool.color.swiftUIColor).padding(7).overlay(Circle().stroke(.white, lineWidth: 1.5).padding(7))
                }
                .frame(width: 30, height: 30)
            }
            .buttonStyle(.pressable)
            .accessibilityLabel(Text(String(localized: "stories.color.title", defaultValue: "Выбор цвета")))
            .accessibilityIdentifier("story.drawing.palette")
            .accessibilityValue(Text(verbatim: "\(tool.color.hex) \(Int((tool.color.alpha * 100).rounded()))%"))

            ForEach(StoryColor.presets, id: \.self) { color in
                let selected = color.matches(tool.color)
                Button {
                    Haptics.tap()
                    model.editInTool { $0.drawingTool.color = color.withAlpha(tool.color.alpha) }
                } label: {
                    Circle()
                        .fill(color.swiftUIColor)
                        .frame(width: 24, height: 24)
                        .overlay(Circle().stroke(.white, lineWidth: selected ? 3 : 1.5))
                        .scaleEffect(selected ? 1.15 : 1)
                }
                .buttonStyle(.pressable)
                .animation(Motion.snappy, value: selected)
                .accessibilityLabel(Text(verbatim: color.hex))
                .accessibilityIdentifier("story.drawing.color.\(color.hex)")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }

    private var tabs: some View {
        HStack {
            Button {
                model.cancelTool()
            } label: {
                Image(systemName: "xmark").font(.system(size: 18, weight: .semibold)).frame(width: 44, height: 44)
            }
            .accessibilityLabel(Text(String(localized: "stories.cancel", defaultValue: "Отмена")))
            .accessibilityIdentifier("story.tool.cancel")

            Spacer()
            HStack(spacing: Spacing.xl) {
                tab(String(localized: "stories.drawing.tab.draw", defaultValue: "Рисунок"), selected: true) {}
                    .accessibilityIdentifier("story.drawing.tab.draw")
                tab(String(localized: "stories.drawing.tab.text", defaultValue: "Текст"), selected: false) { model.beginText() }
                    .accessibilityIdentifier("story.drawing.tab.text")
            }
            Spacer()

            Button {
                model.confirmTool()
            } label: {
                Image(systemName: "checkmark")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(Palette.primary))
            }
            .buttonStyle(.pressable)
            .accessibilityLabel(Text(String(localized: "stories.done", defaultValue: "Готово")))
            .accessibilityIdentifier("story.tool.done")
        }
        .foregroundStyle(.white)
        .padding(.horizontal, Spacing.md)
    }

    private func tab(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: selected ? .bold : .medium))
                .foregroundStyle(selected ? .white : .white.opacity(0.55))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Толщина кисти — сужающаяся полоса у левого края, как у Telegram.
private struct BrushSizeSlider: View {
    let tool: StoryDrawingTool
    let onChange: (Double) -> Void

    var body: some View {
        GeometryReader { proxy in
            let range = tool.brush.widthRange
            let fraction = (tool.width(for: tool.brush) - range.lowerBound) / (range.upperBound - range.lowerBound)
            let height = proxy.size.height
            ZStack(alignment: .top) {
                Path { path in
                    path.move(to: CGPoint(x: proxy.size.width / 2 - 9, y: 0))
                    path.addLine(to: CGPoint(x: proxy.size.width / 2 + 9, y: 0))
                    path.addLine(to: CGPoint(x: proxy.size.width / 2 + 1.5, y: height))
                    path.addLine(to: CGPoint(x: proxy.size.width / 2 - 1.5, y: height))
                    path.closeSubpath()
                }
                .fill(Color.white.opacity(0.35))
                Circle()
                    .fill(.white)
                    .frame(width: 22, height: 22)
                    .shadow(radius: 2)
                    .offset(y: (1 - fraction) * height - 11)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                let t = 1 - (drag.location.y / max(height, 1)).clamped(to: 0...1)
                onChange(range.lowerBound + Double(t) * (range.upperBound - range.lowerBound))
            })
        }
        .accessibilityElement()
        .accessibilityLabel(Text(String(localized: "stories.drawing.size", defaultValue: "Толщина")))
        .accessibilityIdentifier("story.drawing.size")
        .accessibilityValue(Text(verbatim: "\(Int((tool.width(for: tool.brush) * 1000).rounded()))"))
        .accessibilityAdjustableAction { direction in
            let range = tool.brush.widthRange
            let step = (range.upperBound - range.lowerBound) / 10
            onChange(tool.width(for: tool.brush) + (direction == .increment ? step : -step))
        }
    }
}

extension StoryBrush {
    var symbol: String {
        switch self {
        case .pen: return "pencil.tip"
        case .marker: return "paintbrush.pointed.fill"
        case .neon: return "wand.and.rays"
        case .highlighter: return "highlighter"
        case .arrow: return "arrow.up.right"
        case .eraser: return "eraser.fill"
        }
    }

    var title: String {
        switch self {
        case .pen: return String(localized: "stories.brush.pen", defaultValue: "Ручка")
        case .marker: return String(localized: "stories.brush.marker", defaultValue: "Маркер")
        case .neon: return String(localized: "stories.brush.neon", defaultValue: "Неон")
        case .highlighter: return String(localized: "stories.brush.highlighter", defaultValue: "Выделитель")
        case .arrow: return String(localized: "stories.brush.arrow", defaultValue: "Стрелка")
        case .eraser: return String(localized: "stories.brush.eraser", defaultValue: "Ластик")
        }
    }
}

extension StoryColor {
    var swiftUIColor: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha) }
}

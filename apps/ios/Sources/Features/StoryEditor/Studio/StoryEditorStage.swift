import SwiftUI
import UIKit

/// Сцена редактора в UIKit: холст и правка надписи поверх него. SwiftUI-панели лежат
/// выше, а холст получает рамку от них же — одна раскладка на всё.
final class StoryStageView: UIView {
    let canvas = StoryCanvasView()
    let textEditor = StoryTextEditingView()
    var canvasFrame: CGRect = .zero {
        didSet { if canvasFrame != oldValue { setNeedsLayout() } }
    }

    private(set) var editingTextID: UUID?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        addSubview(canvas)
        addSubview(textEditor)
        textEditor.isHidden = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Холст под пальцем не меняет рамку посреди жеста: раскладка — только по смене размера.
        if canvas.bounds.size != canvasFrame.size || canvas.center != CGPoint(x: canvasFrame.midX, y: canvasFrame.midY) {
            canvas.bounds = CGRect(origin: .zero, size: canvasFrame.size)
            canvas.center = CGPoint(x: canvasFrame.midX, y: canvasFrame.midY)
        }
        textEditor.frame = bounds
        textEditor.canvasFrame = canvasFrame
    }

    /// Показать или скрыть правку надписи.
    func setEditingText(_ id: UUID?, payload: StoryTextPayload?, focused: Bool) {
        if let id, let payload {
            if editingTextID != id {
                editingTextID = id
                textEditor.isHidden = false
                textEditor.alpha = 0
                textEditor.begin(with: payload)
                UIView.animate(withDuration: Motion.Duration.layer) { self.textEditor.alpha = 1 }
            } else if payload.color != textEditor.payload.color {
                // Цвет пришёл из большого выбора цвета или откатился его отменой.
                textEditor.setColor(payload.color)
            }
            if focused {
                textEditor.refocus()
            } else if textEditor.textView.isFirstResponder {
                textEditor.textView.resignFirstResponder()
            }
        } else if editingTextID != nil {
            editingTextID = nil
            textEditor.end()
            UIView.animate(withDuration: Motion.Duration.layer, animations: {
                self.textEditor.alpha = 0
            }, completion: { _ in
                if self.editingTextID == nil { self.textEditor.isHidden = true }
            })
        }
    }
}

/// Холст редактора в SwiftUI.
struct StoryEditorStage: UIViewRepresentable {
    let model: StoryStudioModel
    let canvasFrame: CGRect

    func makeUIView(context: Context) -> StoryStageView {
        let stage = StoryStageView()
        let model = model
        stage.canvas.callbacks = StoryCanvasCallbacks(
            entityChanged: { id, center, scale, rotation in model.entityMoved(id, center: center, scale: scale, rotation: rotation) },
            mediaChanged: { transform in model.edit { $0.mediaTransform = transform } },
            entityRemoved: { id in model.edit { $0.remove(id) } },
            menuAction: { action, id in model.menuAction(action, for: id) },
            entityTapped: { id in model.entityTapped(id) },
            emptyTapped: {
                if model.state == .storyEditor { model.beginText() }
            },
            strokeFinished: { stroke in model.strokeFinished(stroke) },
            blurChanged: { blur in model.setBlur(blur) },
            interactionChanged: { active in model.setChromeHidden(active) }
        )
        stage.textEditor.onChange = { [weak stage] payload in
            guard let stage, let id = stage.editingTextID else { return }
            model.updateText(id, payload: payload, canvasWidth: stage.canvasFrame.width)
        }
        stage.textEditor.onInputChange = { input in
            model.setTextInput(input)
        }
        stage.textEditor.onOpenColorPicker = {
            model.openColorPicker(.text)
        }
        return stage
    }

    func updateUIView(_ stage: StoryStageView, context: Context) {
        stage.canvasFrame = canvasFrame
        guard let document = model.document else { return }
        let state = model.state
        let underlying = model.session.machine.underlying
        var editingID: UUID?
        var focused = false
        switch state {
        case let .textEditing(id, _, _):
            editingID = id
            focused = true
        case .colorPicker(.text):
            if case let .textEditing(id, _, _)? = underlying { editingID = id }
        default:
            break
        }
        let mode: StoryCanvasMode
        switch state {
        case .storyEditor: mode = .idle
        case .drawing: mode = .drawing
        case .blurAdjustment: mode = .blur
        default: mode = editingID.map { .textEditing($0) } ?? .locked
        }
        stage.canvas.render(document, workspace: model.workspace, mode: mode)
        stage.layoutIfNeeded()
        var payload: StoryTextPayload?
        if let editingID, case let .text(text)? = document.entity(editingID)?.kind { payload = text }
        stage.setEditingText(editingID, payload: payload, focused: focused)
    }

    static func dismantleUIView(_ stage: StoryStageView, coordinator: ()) {
        stage.canvas.stop()
        stage.textEditor.end()
    }
}

/// Предпросмотр камеры (вид источника кадров) в SwiftUI.
struct StoryCameraPreview: UIViewRepresentable {
    let camera: StoryCameraSource
    var onTap: (CGPoint) -> Void = { _ in }
    var onPinch: (CGFloat, Bool) -> Void = { _, _ in }

    func makeCoordinator() -> Coordinator { Coordinator(onTap: onTap, onPinch: onPinch) }

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.clipsToBounds = true
        container.backgroundColor = .black
        let preview = camera.previewView
        preview.frame = container.bounds
        preview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.addSubview(preview)
        container.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:))))
        container.addGestureRecognizer(UIPinchGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pinched(_:))))
        container.accessibilityIdentifier = "story.camera.preview.container"
        return container
    }

    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.onTap = onTap
        context.coordinator.onPinch = onPinch
        if camera.previewView.superview !== view {
            camera.previewView.frame = view.bounds
            view.addSubview(camera.previewView)
        }
    }

    final class Coordinator: NSObject {
        var onTap: (CGPoint) -> Void
        var onPinch: (CGFloat, Bool) -> Void

        init(onTap: @escaping (CGPoint) -> Void, onPinch: @escaping (CGFloat, Bool) -> Void) {
            self.onTap = onTap
            self.onPinch = onPinch
        }

        @objc func tapped(_ recognizer: UITapGestureRecognizer) {
            onTap(recognizer.location(in: recognizer.view))
        }

        @objc func pinched(_ recognizer: UIPinchGestureRecognizer) {
            switch recognizer.state {
            case .began: onPinch(recognizer.scale, true)
            case .changed: onPinch(recognizer.scale, false)
            default: break
            }
        }
    }
}

// MARK: - Общие элементы панелей

/// Круглая кнопка поверх фото: белый значок на тёмном размытии.
struct StoryRoundButton: View {
    let symbol: String
    let label: String
    var size: CGFloat = 40
    var tint: Color = .white
    var isActive = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(isActive ? Color.black : tint)
                .frame(width: size, height: size)
                .background {
                    if isActive {
                        Circle().fill(.white)
                    } else {
                        Circle().fill(.ultraThinMaterial).environment(\.colorScheme, .dark)
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(.pressable)
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

/// Значок без подложки — нижняя полоса инструментов редактора.
struct StoryToolButton: View {
    let symbol: String
    let label: String
    var isHighlighted = false
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(isHighlighted ? Palette.primary : .white)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.35)
        .accessibilityLabel(Text(label))
    }
}

/// Горизонтальный ползунок обработки: от центра (−100…100) или от левого края (0…100),
/// двойной тап — вернуть ноль. Значение меняется под пальцем без задержки.
struct StorySlider: View {
    let value: Double
    let range: ClosedRange<Double>
    var bipolar = true
    var accent: Color = Palette.primary
    let onChange: (Double) -> Void
    var onReset: (() -> Void)?

    @GestureState private var dragging = false

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let fraction = (value - range.lowerBound) / (range.upperBound - range.lowerBound)
            let origin = bipolar ? 0.5 : 0
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.22)).frame(height: 3)
                Capsule()
                    .fill(accent)
                    .frame(width: abs(fraction - origin) * width, height: 3)
                    .offset(x: min(fraction, origin) * width)
                if bipolar {
                    Rectangle().fill(Color.white.opacity(0.6)).frame(width: 1.5, height: 9).offset(x: width / 2 - 0.75)
                }
                Circle()
                    .fill(.white)
                    .frame(width: dragging ? 24 : 20, height: dragging ? 24 : 20)
                    .shadow(color: .black.opacity(0.3), radius: 2, y: 1)
                    .offset(x: fraction * width - (dragging ? 12 : 10))
                    .animation(Motion.press, value: dragging)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .updating($dragging) { _, state, _ in state = true }
                    .onChanged { drag in
                        let t = (drag.location.x / max(width, 1)).clamped(to: 0...1)
                        var newValue = range.lowerBound + t * (range.upperBound - range.lowerBound)
                        // Притяжение к нулю: ползунок легко вернуть ровно в середину.
                        if bipolar, abs(newValue) < (range.upperBound - range.lowerBound) * 0.025 { newValue = 0 }
                        if newValue.rounded() != value.rounded() { onChange(newValue.rounded()) }
                    }
            )
            .simultaneousGesture(TapGesture(count: 2).onEnded {
                Haptics.tap()
                onReset?()
            })
        }
        .frame(height: 30)
        .accessibilityElement()
        .accessibilityValue(Text(verbatim: "\(Int(value.rounded()))"))
        .accessibilityAdjustableAction { direction in
            let step = (range.upperBound - range.lowerBound) / 20
            onChange((value + (direction == .increment ? step : -step)).clamped(to: range))
        }
    }
}

extension View {
    /// Тёмная полупрозрачная подложка панелей редактора.
    func storyPanelBackground() -> some View {
        background(.ultraThinMaterial.opacity(0.95))
            .environment(\.colorScheme, .dark)
    }
}

extension CGFloat {
    func clamped(to range: ClosedRange<CGFloat>) -> CGFloat {
        Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
    }
}

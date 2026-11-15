import PhotosUI
import SwiftUI

/// Эмодзи, фигуры и фото поверх. Выбор кладёт объект в центр холста и закрывает панель;
/// тап мимо панели — отмена без изменений. Эмодзи здесь — отдельный объект холста,
/// а не символ в надписи (в надпись эмодзи вставляет панель у клавиатуры).
struct StoryStickerPanel: View {
    let model: StoryStudioModel
    let canvas: CGRect

    enum Tab: String, CaseIterable {
        case emoji
        case shapes
        case photo

        var title: String {
            switch self {
            case .emoji: return String(localized: "stories.stickers.emoji", defaultValue: "Эмодзи")
            case .shapes: return String(localized: "stories.stickers.shapes", defaultValue: "Фигуры")
            case .photo: return String(localized: "stories.stickers.photo", defaultValue: "Фото")
            }
        }
    }

    @State private var tab: Tab = .emoji
    @State private var filled = false
    @State private var photoPick: PhotosPickerItem?

    private var panelHeight: CGFloat { canvas.height * 0.62 }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.35)
                .frame(width: canvas.width, height: canvas.height)
                .offset(x: canvas.minX, y: canvas.minY)
                .onTapGesture { model.cancelTool() }
                .accessibilityIdentifier("story.stickers.dismiss")

            VStack(spacing: Spacing.md) {
                Capsule().fill(Color.white.opacity(0.35)).frame(width: 36, height: 5).padding(.top, Spacing.sm)
                Picker("", selection: $tab) {
                    ForEach(Tab.allCases, id: \.self) { item in
                        Text(item.title).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Spacing.lg)
                .accessibilityIdentifier("story.stickers.tabs")

                switch tab {
                case .emoji:
                    EmojiBrowser(columns: 7) { emoji in model.addEmoji(emoji) }
                        .accessibilityIdentifier("story.stickers.emojiGrid")
                case .shapes:
                    shapes
                case .photo:
                    PhotosPicker(selection: $photoPick, matching: .images) {
                        Label(String(localized: "stories.stickers.pickPhoto", defaultValue: "Выбрать фото"), systemImage: "photo.on.rectangle")
                            .font(.headline)
                            .foregroundStyle(.white)
                            .padding(.horizontal, Spacing.xxl)
                            .padding(.vertical, Spacing.lg)
                            .background(Capsule().fill(Palette.primary))
                    }
                    .padding(.top, Spacing.xxl)
                    .accessibilityIdentifier("story.stickers.pickPhoto")
                    Spacer()
                }
            }
            .frame(width: canvas.width, height: panelHeight, alignment: .top)
            .storyPanelBackground()
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 22, topTrailingRadius: 22, style: .continuous))
            .offset(x: canvas.minX, y: canvas.maxY + StoryStageLayout.bottomBar - panelHeight)
            .gesture(DragGesture().onEnded { drag in
                if drag.translation.height > 100 { model.cancelTool() }
            })
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("story.stickers")
        .task(id: photoPick) {
            guard let photoPick, let data = try? await photoPick.loadTransferable(type: Data.self), let image = UIImage(data: data) else { return }
            model.addEntity(photo: image)
        }
    }

    private var shapes: some View {
        let color = model.document?.drawingTool.color ?? .white
        return VStack(spacing: Spacing.lg) {
            HStack {
                Toggle(String(localized: "stories.stickers.filled", defaultValue: "Заливка"), isOn: $filled)
                    .toggleStyle(.button)
                    .tint(Palette.primary)
                    .accessibilityIdentifier("story.stickers.filled")
                Spacer()
                Button {
                    model.openColorPicker(.shape)
                } label: {
                    HStack(spacing: Spacing.sm) {
                        Circle().fill(color.swiftUIColor).frame(width: 22, height: 22).overlay(Circle().stroke(.white, lineWidth: 1.5))
                        Text(String(localized: "stories.color.title", defaultValue: "Выбор цвета"))
                    }
                    .foregroundStyle(.white)
                }
                .accessibilityIdentifier("story.stickers.color")
            }
            .padding(.horizontal, Spacing.xl)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: Spacing.lg) {
                ForEach(StoryShapePayload.Shape.allCases, id: \.self) { shape in
                    Button {
                        model.addShape(shape, filled: filled)
                    } label: {
                        ShapePreview(shape: shape, color: color, filled: filled)
                            .frame(width: 64, height: 64)
                            .padding(Spacing.md)
                            .background(RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.08)))
                    }
                    .buttonStyle(.pressable)
                    .accessibilityLabel(Text(shape.title))
                    .accessibilityIdentifier("story.stickers.shape.\(shape.rawValue)")
                }
            }
            .padding(.horizontal, Spacing.xl)
            Spacer()
        }
    }
}

/// Образец фигуры — тем же рендером, что и холст.
private struct ShapePreview: View {
    let shape: StoryShapePayload.Shape
    let color: StoryColor
    let filled: Bool

    var body: some View {
        Canvas { context, size in
            let payload = StoryShapePayload(shape: shape, color: color, filled: filled)
            let fit = payload.defaultSize
            let scale = min(size.width / CGFloat(fit.width), size.height / CGFloat(fit.height))
            let drawn = CGSize(width: CGFloat(fit.width) * scale, height: CGFloat(fit.height) * scale)
            context.withCGContext { cg in
                cg.translateBy(x: (size.width - drawn.width) / 2, y: (size.height - drawn.height) / 2)
                StoryShapeRenderer.draw(payload, in: cg, size: drawn, canvasWidth: 120)
            }
        }
    }
}

extension StoryShapePayload.Shape {
    var title: String {
        switch self {
        case .rectangle: return String(localized: "stories.shape.rectangle", defaultValue: "Прямоугольник")
        case .ellipse: return String(localized: "stories.shape.ellipse", defaultValue: "Круг")
        case .bubble: return String(localized: "stories.shape.bubble", defaultValue: "Облачко")
        case .star: return String(localized: "stories.shape.star", defaultValue: "Звезда")
        case .arrow: return String(localized: "stories.shape.arrow", defaultValue: "Стрелка")
        case .heart: return String(localized: "stories.shape.heart", defaultValue: "Сердце")
        }
    }
}

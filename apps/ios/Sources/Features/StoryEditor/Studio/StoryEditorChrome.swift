import PhotosUI
import SwiftUI

/// Панели редактора поверх холста — по состоянию экрана. Холст под ними не двигается:
/// панели только появляются и исчезают.
struct StoryEditorChrome: View {
    let model: StoryStudioModel
    let canvas: CGRect

    var body: some View {
        let state = model.state
        ZStack(alignment: .topLeading) {
            switch state {
            case .storyEditor, .discardConfirmation:
                StoryMainChrome(model: model, canvas: canvas)
                    .opacity(model.chromeHidden ? 0 : 1)
            case .textEditing:
                textTopBar
            case .drawing:
                StoryDrawingPanel(model: model, canvas: canvas)
            case .stickerSelection:
                StoryStickerPanel(model: model, canvas: canvas)
            case .imageAdjustment, .blurAdjustment, .curvesAdjustment:
                StoryAdjustPanel(model: model, canvas: canvas)
            case .colorPicker(let target):
                if target == .drawing { StoryDrawingPanel(model: model, canvas: canvas).allowsHitTesting(false) }
                if target == .shape { StoryStickerPanel(model: model, canvas: canvas).allowsHitTesting(false) }
                StoryColorPickerSheet(model: model, canvas: canvas)
            case .roundVideoRecording:
                StoryRoundVideoOverlay(model: model, canvas: canvas)
            default:
                EmptyView()
            }
        }
        .animation(Motion.snappy, value: state)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var textTopBar: some View {
        StoryConfirmBar(
            cancelTitle: String(localized: "stories.cancel", defaultValue: "Отмена"),
            confirmTitle: String(localized: "stories.done", defaultValue: "Готово"),
            onCancel: { model.cancelTool() },
            onConfirm: { model.confirmTool() }
        )
        .frame(width: canvas.width)
        .offset(x: canvas.minX, y: canvas.minY + Spacing.sm)
        .transition(.opacity)
    }
}

/// «Отмена» слева, «Готово» справа — верх инструмента.
struct StoryConfirmBar: View {
    let cancelTitle: String
    let confirmTitle: String
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        HStack {
            Button(cancelTitle, action: onCancel)
                .font(.body.weight(.medium))
                .padding(.horizontal, Spacing.lg)
                .frame(height: 40)
                .background(Capsule().fill(.ultraThinMaterial))
                .accessibilityIdentifier("story.tool.cancel")
            Spacer()
            Button(confirmTitle, action: onConfirm)
                .font(.body.weight(.semibold))
                .padding(.horizontal, Spacing.lg)
                .frame(height: 40)
                .background(Capsule().fill(Palette.primary))
                .accessibilityIdentifier("story.tool.done")
        }
        .foregroundStyle(.white)
        .padding(.horizontal, Spacing.lg)
        .environment(\.colorScheme, .dark)
    }
}

/// Редактор без открытого инструмента.
private struct StoryMainChrome: View {
    let model: StoryStudioModel
    let canvas: CGRect

    @State private var photoPick: PhotosPickerItem?
    @FocusState private var captionFocused: Bool
    /// Верх клавиатуры в координатах экрана. Экран редактора клавиатуру не обходит
    /// (снимок не должен сжиматься), поэтому подпись поднимаем над ней сами.
    @State private var keyboardTop: CGFloat?

    var body: some View {
        ZStack(alignment: .topLeading) {
            topBar
                .frame(width: canvas.width)
                .offset(x: canvas.minX, y: canvas.minY + Spacing.md)

            if let progress = model.queueProgress {
                Text(verbatim: "\(progress.current) / \(progress.total)")
                    .font(.footnote.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.white)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.xs)
                    .background(Capsule().fill(.black.opacity(0.45)))
                    .frame(width: canvas.width)
                    .offset(x: canvas.minX, y: canvas.minY + 64)
                    .accessibilityIdentifier("story.editor.queue")
            }

            // Подпись поднимается над клавиатурой — холст под ней стоит на месте.
            VStack {
                Spacer(minLength: 0)
                captionBar.frame(width: canvas.width)
            }
            .frame(width: canvas.width, height: captionBottom, alignment: .bottom)
            .offset(x: canvas.minX)
            .animation(.easeOut(duration: Motion.Duration.layer), value: captionBottom)

            toolRow
                .frame(width: canvas.width, height: StoryStageLayout.bottomBar)
                .offset(x: canvas.minX, y: canvas.maxY)
                .opacity(captionFocused ? 0 : 1)

            if model.isExporting {
                ProgressView()
                    .tint(.white)
                    .controlSize(.large)
                    .padding(Spacing.xxl)
                    .background(RoundedRectangle(cornerRadius: Radius.xl).fill(.black.opacity(0.6)))
                    .frame(width: canvas.width, height: canvas.height)
                    .offset(x: canvas.minX, y: canvas.minY)
                    .accessibilityIdentifier("story.editor.exporting")
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
            guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            let screen = UIScreen.main.bounds.height
            keyboardTop = frame.minY < screen - 1 ? frame.minY : nil
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardTop = nil
        }
        .task(id: photoPick) {
            guard let photoPick, let data = try? await photoPick.loadTransferable(type: Data.self), let image = UIImage(data: data) else { return }
            model.addEntity(photo: image)
            self.photoPick = nil
        }
    }

    /// Нижний край подписи: над клавиатурой, пока подпись в фокусе, иначе — у низа холста.
    private var captionBottom: CGFloat {
        if captionFocused, let keyboardTop { return keyboardTop - Spacing.sm }
        return canvas.maxY - Spacing.md
    }

    private var topBar: some View {
        HStack(spacing: Spacing.md) {
            StoryRoundButton(symbol: "xmark", label: String(localized: "stories.close", defaultValue: "Закрыть")) {
                Task { await model.requestClose() }
            }
            .accessibilityIdentifier("story.editor.close")
            Spacer()
            if case .gradient = model.document?.background {
                StoryRoundButton(symbol: "paintpalette", label: String(localized: "stories.editor.background", defaultValue: "Фон")) {
                    model.cycleGradient()
                }
                .accessibilityIdentifier("story.editor.gradient")
            }
            StoryRoundButton(symbol: "arrow.down.to.line", label: String(localized: "stories.editor.download", defaultValue: "Сохранить в «Фото»")) {
                Task { await model.saveToPhotos() }
            }
            .accessibilityIdentifier("story.editor.download")
        }
        .padding(.horizontal, Spacing.lg)
    }

    private var captionBar: some View {
        HStack(spacing: Spacing.sm) {
            PhotosPicker(selection: $photoPick, matching: .images) {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
            }
            .accessibilityLabel(Text(String(localized: "stories.editor.addPhoto", defaultValue: "Добавить фото поверх")))
            .accessibilityIdentifier("story.editor.addPhoto")

            TextField(
                String(localized: "stories.editor.caption", defaultValue: "Добавить подпись…"),
                text: Binding(
                    get: { model.document?.caption ?? "" },
                    set: { value in model.editInTool { $0.caption = String(value.prefix(StoryTextPayload.maxLength)) } }
                ),
                axis: .vertical
            )
            .lineLimit(1...4)
            .focused($captionFocused)
            .foregroundStyle(.white)
            .tint(.white)
            .accessibilityIdentifier("story.editor.caption")

            if captionFocused {
                Button {
                    captionFocused = false
                } label: {
                    Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(Palette.primary)
                }
                .accessibilityLabel(Text(String(localized: "stories.done", defaultValue: "Готово")))
            } else {
                Button {
                    Task { await model.openRoundVideo() }
                } label: {
                    Image(systemName: "video.circle")
                        .font(.system(size: 22, weight: .regular))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel(Text(String(localized: "stories.editor.roundVideo", defaultValue: "Круглое видео")))
                .accessibilityIdentifier("story.editor.roundVideo")
            }
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(.ultraThinMaterial))
        .environment(\.colorScheme, .dark)
        .padding(.horizontal, Spacing.md)
    }

    private var toolRow: some View {
        HStack(spacing: 0) {
            StoryToolButton(
                symbol: "arrow.uturn.backward",
                label: String(localized: "stories.editor.undo", defaultValue: "Отменить шаг"),
                isEnabled: model.session.canUndo
            ) { model.undo() }
                .accessibilityIdentifier("story.editor.undo")
            StoryToolButton(
                symbol: "slider.horizontal.3",
                label: String(localized: "stories.editor.adjust", defaultValue: "Обработка"),
                isHighlighted: model.document?.hasImageProcessing ?? false,
                isEnabled: !(model.document?.background.isGradient ?? true)
            ) { model.openAdjustments() }
                .accessibilityIdentifier("story.editor.adjust")
            StoryToolButton(symbol: "pencil.tip", label: String(localized: "stories.editor.draw", defaultValue: "Рисунок")) {
                model.openDrawing()
            }
            .accessibilityIdentifier("story.editor.draw")
            StoryToolButton(symbol: "textformat", label: String(localized: "stories.editor.text", defaultValue: "Текст")) {
                model.beginText()
            }
            .accessibilityIdentifier("story.editor.text")
            StoryToolButton(symbol: "face.smiling", label: String(localized: "stories.editor.stickers", defaultValue: "Стикеры")) {
                model.openStickers()
            }
            .accessibilityIdentifier("story.editor.stickers")
            Menu {
                Button {
                    Task { await model.openRoundVideo() }
                } label: {
                    Label(String(localized: "stories.editor.roundVideo", defaultValue: "Круглое видео"), systemImage: "video.circle")
                }
                Button {
                    Task { await model.saveDraftOnly() }
                } label: {
                    Label(String(localized: "stories.editor.saveDraft", defaultValue: "Сохранить черновик"), systemImage: "tray.and.arrow.down")
                }
                Button {
                    Task { await model.saveToPhotos() }
                } label: {
                    Label(String(localized: "stories.editor.download", defaultValue: "Сохранить в «Фото»"), systemImage: "arrow.down.to.line")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(Text(String(localized: "stories.editor.more", defaultValue: "Ещё")))
            .accessibilityIdentifier("story.editor.more")

            Spacer(minLength: Spacing.sm)

            Button {
                Task { await model.next() }
            } label: {
                HStack(spacing: Spacing.xs) {
                    Text(String(localized: "stories.editor.next", defaultValue: "Далее").uppercased())
                        .font(.system(size: 15, weight: .bold))
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, Spacing.lg)
                .frame(height: 38)
                .background(Capsule().fill(Palette.primary))
            }
            .buttonStyle(.pressable)
            .disabled(model.isExporting)
            .accessibilityIdentifier("story.editor.next")
        }
        .padding(.horizontal, Spacing.sm)
    }
}

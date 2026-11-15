import SwiftUI

/// Создание истории целиком: камера → (галерея) → редактор → публикация.
///
/// Холст 9:16 стоит в одной и той же рамке на всех шагах: снимок из камеры или
/// галереи открывается в редакторе ровно там, где был предпросмотр.
struct StoryStudioView: View {
    @State private var model: StoryStudioModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    init(stories: StoriesModel) {
        _model = State(initialValue: StoryStudioModel.make(stories: stories))
    }

    init(model: StoryStudioModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        GeometryReader { proxy in
            let insets = proxy.safeAreaInsets
            let full = CGSize(width: proxy.size.width + insets.leading + insets.trailing, height: proxy.size.height + insets.top + insets.bottom)
            let canvas = StoryStageLayout.canvasFrame(in: full, safeArea: UIEdgeInsets(top: insets.top, left: 0, bottom: insets.bottom, right: 0))
            let state = model.state
            let galleryMounted = model.session.machine.stack.contains(.gallery)
            ZStack(alignment: .topLeading) {
                Color.black

                if state.isCameraVisible {
                    StoryCameraScreen(model: model, canvas: canvas)
                        .transition(.opacity)
                }

                if galleryMounted {
                    StoryGalleryPanel(model: model, top: canvas.minY + 44)
                        .frame(width: full.width, height: full.height)
                        .opacity(state == .gallery ? 1 : 0)
                        .allowsHitTesting(state == .gallery)
                        .transition(.move(edge: .bottom))
                }

                if model.document != nil, state.isInEditor {
                    StoryEditorStage(model: model, canvasFrame: canvas)
                        .frame(width: full.width, height: full.height)
                        .transition(.opacity)
                    StoryEditorChrome(model: model, canvas: canvas)
                        .frame(width: full.width, height: full.height)
                }

                if state == .publishing {
                    StoryPublishView(model: model)
                        .frame(width: full.width, height: full.height)
                        .transition(.move(edge: .trailing))
                }
            }
            .frame(width: full.width, height: full.height)
            .ignoresSafeArea()
            .animation(Motion.snappy, value: state)
        }
        .ignoresSafeArea(.keyboard)
        .preferredColorScheme(.dark)
        .statusBarHidden(model.state.isCameraVisible)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("story.studio")
        .task {
            model.onClose = { dismiss() }
            await model.appear()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: model.enterBackground()
            case .active: Task { await model.enterForeground() }
            default: break
            }
        }
        .alert(
            String(localized: "stories.discard.title", defaultValue: "Сбросить изменения?"),
            isPresented: Binding(
                get: { model.state == .discardConfirmation },
                set: { shown in if !shown, model.state == .discardConfirmation { model.keepEditing() } }
            )
        ) {
            Button(String(localized: "stories.discard.delete", defaultValue: "Удалить"), role: .destructive) {
                Task { await model.discardChanges() }
            }
            .accessibilityIdentifier("story.discard.delete")
            Button(String(localized: "stories.discard.saveDraft", defaultValue: "Сохранить черновик")) {
                Task { await model.saveDraftAndClose() }
            }
            .accessibilityIdentifier("story.discard.save")
            Button(String(localized: "stories.cancel", defaultValue: "Отмена"), role: .cancel) {
                model.keepEditing()
            }
            .accessibilityIdentifier("story.discard.cancel")
        } message: {
            Text(String(
                localized: "stories.discard.message",
                defaultValue: "Все изменения будут утрачены, если Вы не сохраните черновик."
            ))
        }
        .alert(item: Binding(get: { model.alert }, set: { model.alert = $0 })) { alert in
            switch alert.kind {
            case .error(let message):
                return Alert(
                    title: Text(String(localized: "feed.actionFailed", defaultValue: "Не получилось")),
                    message: Text(message)
                )
            case .savedToPhotos:
                return Alert(title: Text(String(localized: "stories.editor.saved", defaultValue: "Сохранено в «Фото»")))
            case .dropCollage(let layout):
                return Alert(
                    title: Text(String(localized: "stories.collage.dropTitle", defaultValue: "Удалить снятые кадры?")),
                    message: Text(String(localized: "stories.collage.dropMessage", defaultValue: "Кадры, которые не поместятся в новую раскладку, пропадут.")),
                    primaryButton: .destructive(Text(String(localized: "stories.discard.delete", defaultValue: "Удалить"))) {
                        model.applyCollage(layout)
                    },
                    secondaryButton: .cancel(Text(String(localized: "stories.cancel", defaultValue: "Отмена")))
                )
            }
        }
    }
}

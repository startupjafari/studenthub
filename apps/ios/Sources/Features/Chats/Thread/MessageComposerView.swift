import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Поле ввода как в Telegram для iOS 26: слева скрепка в стеклянном круге, посередине —
/// поле-капсула, справа — микрофон, а когда есть текст — синяя «отправить».
///
/// Высота панели — 48 pt: осознанное исключение из высоты островов (DESIGN_SYSTEM
/// §4), потому что в открытом чате нижняя навигация скрыта и совпадать не с чем.
struct MessageComposerView: View {
    @Bindable var model: ChatThreadModel

    @FocusState private var isFocused: Bool
    @State private var recorder = VoiceRecorder()
    @State private var photos: [PhotosPickerItem] = []
    @State private var showsFileImporter = false
    @State private var showsCamera = false
    /// Выбранное к отправке — открыт лист вложений.
    @State private var sending: AttachmentDraft?
    /// Тот же черновик для `onDismiss`: к моменту закрытия `sending` уже обнулён.
    @State private var openedDraft: AttachmentDraft?
    /// Снимок камеры ждёт, пока она закроется: лист поверх уходящей камеры не откроется.
    @State private var captured: UIImage?
    @State private var creatingPoll = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            if let editing = model.editing {
                ReplyBar(
                    title: String(localized: "chats.editing", defaultValue: "Редактирование"),
                    text: editing.content,
                    symbol: "pencil"
                ) { model.cancelEdit() }
            } else if let replyTo = model.replyTo {
                ReplyBar(
                    title: replyTo.senderName.map {
                        String(localized: "chats.replyingToName", defaultValue: "Ответ \($0)")
                    } ?? String(localized: "chats.replyingTo", defaultValue: "Ответ"),
                    text: replyTo.content.isEmpty
                        ? String(localized: "chats.attachmentPreview", defaultValue: "Вложение")
                        : replyTo.content,
                    symbol: "arrowshape.turn.up.left"
                ) { model.cancelReply() }
            }

            if recorder.isRecording {
                RecordingBar(
                    levels: recorder.levels,
                    duration: recorder.duration,
                    onCancel: { recorder.cancel() },
                    onSend: {
                        guard let voice = recorder.stop() else { return }
                        Task { await model.attach(voice) }
                    }
                )
            }

            GlassGroup(spacing: Spacing.md) {
            HStack(alignment: .bottom, spacing: Spacing.md) {
                Menu {
                    // До десяти за раз — столько несёт одно сообщение-альбом, как в вебе.
                    PhotosPicker(
                        selection: $photos,
                        maxSelectionCount: AttachmentUploader.albumLimit,
                        matching: .any(of: [.images, .videos])
                    ) {
                        Label(
                            String(localized: "chats.attachMedia", defaultValue: "Фото или видео"),
                            systemImage: "photo"
                        )
                    }
                    if CameraPicker.isAvailable {
                        Button {
                            showsCamera = true
                        } label: {
                            Label(
                                String(localized: "chats.attachCamera", defaultValue: "Камера"),
                                systemImage: "camera"
                            )
                        }
                    }
                    Button {
                        showsFileImporter = true
                    } label: {
                        Label(
                            String(localized: "chats.attachFile", defaultValue: "Файл"),
                            systemImage: "doc"
                        )
                    }
                    // Опрос — в группах и официальных чатах, не в личных и не в
                    // «Избранном» (как в вебе: голосовать там некому).
                    if let kind = model.chat?.kind, kind != .private, kind != .saved {
                        Button {
                            creatingPoll = true
                        } label: {
                            Label(String(localized: "chats.poll.new", defaultValue: "Опрос"), systemImage: "chart.bar.xaxis")
                        }
                    }
                } label: {
                    Image(systemName: "paperclip")
                        .font(.title3)
                        .foregroundStyle(Palette.mutedForeground)
                        .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                        .composerGlass(in: Circle())
                }
                .accessibilityLabel(Text(String(localized: "chats.attach", defaultValue: "Вложение")))

                TextField(
                    text: $model.draft,
                    prompt: Text(verbatim: String(localized: "chats.placeholder", defaultValue: "Сообщение")),
                    axis: .vertical
                ) {
                    Text(verbatim: String(localized: "chats.placeholder", defaultValue: "Сообщение"))
                }
                .labelsHidden()
                .lineLimit(1...6)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                .focused($isFocused)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
                .frame(minHeight: ControlHeight.lg)
                // Радиус — половина высоты одной строки: в одну строку поле — капсула,
                // в несколько — скруглённый прямоугольник, как в Telegram.
                .composerGlass(in: RoundedRectangle(cornerRadius: ControlHeight.lg / 2, style: .continuous))
                .onChange(of: model.draft) {
                    model.draftChanged()
                }

                Group {
                    if canSend {
                        sendButton
                    } else {
                        micButton
                    }
                }
                .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: canSend)
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
            .frame(minHeight: ControlHeight.chatInput)
            }
        }
        .modifier(ComposerBarBackground())
        // «Отправить», вложение, микрофон — клавиатура остаётся, как в мессенджерах.
        .keepsKeyboardOnTap()
        .onChange(of: photos) {
            let picked = photos
            guard !picked.isEmpty else { return }
            photos = []
            let draft = openDraft()
            Task { await draft.add(photos: picked) }
        }
        .fullScreenCover(isPresented: $showsCamera, onDismiss: {
            guard let image = captured else { return }
            captured = nil
            let draft = openDraft()
            Task { await draft.add(image: image) }
        }) {
            CameraPicker { image in captured = image }
                .ignoresSafeArea()
        }
        .sheet(item: $sending, onDismiss: closeDraft) { draft in
            AttachmentSendSheet(draft: draft) {
                send(draft)
            }
        }
        .sheet(isPresented: $creatingPoll) {
            ChatPollCreatorView { question, options, multiple, anonymous in
                await model.createPoll(question: question, options: options, multiple: multiple, anonymous: anonymous)
            }
        }
        .fileImporter(
            isPresented: $showsFileImporter,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true
        ) { result in
            guard case .success(let urls) = result, !urls.isEmpty else { return }
            let draft = openDraft()
            Task { await draft.add(files: urls) }
        }
    }

    private var sendButton: some View {
        Button {
            Task { await model.send() }
        } label: {
            Image(systemName: model.editing == nil ? "arrow.up" : "checkmark")
                .font(Typography.body.weight(.bold))
                .foregroundStyle(Palette.primaryForeground)
                .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                .glassSurface(tint: Palette.primary, in: Circle())
        }
        .buttonStyle(.plain)
        .transition(.scale(scale: 0.6).combined(with: .opacity))
        .accessibilityLabel(Text(model.editing == nil
            ? String(localized: "chats.send", defaultValue: "Отправить")
            : String(localized: "common.save", defaultValue: "Сохранить")))
    }

    /// Пустое поле — вместо «отправить» микрофон: та же кнопка, что и во всех
    /// мессенджерах, и место под неё одно.
    private var micButton: some View {
        Button {
            Task {
                if recorder.isRecording {
                    guard let voice = recorder.stop() else { return }
                    await model.attach(voice)
                } else {
                    _ = await recorder.start()
                }
            }
        } label: {
            Image(systemName: recorder.isRecording ? "stop.fill" : "mic")
                .font(.title3)
                .foregroundStyle(recorder.isRecording ? Palette.primaryForeground : Palette.mutedForeground)
                .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                .glassSurface(tint: recorder.isRecording ? Palette.destructive : nil, in: Circle())
        }
        .buttonStyle(.plain)
        .transition(.scale(scale: 0.6).combined(with: .opacity))
        .accessibilityLabel(Text(recorder.isRecording
            ? String(localized: "chats.voice.stop", defaultValue: "Остановить запись")
            : String(localized: "chats.voice.record", defaultValue: "Записать голосовое")))
    }

    /// Лист вложений: уже открытый (выбранное добавляется к нему) или новый. Начатый в
    /// поле ввода текст становится подписью — как в Telegram.
    private func openDraft() -> AttachmentDraft {
        if let sending { return sending }
        let draft = AttachmentDraft(caption: model.editing == nil ? model.draft : "")
        sending = draft
        openedDraft = draft
        return draft
    }

    private func send(_ draft: AttachmentDraft) {
        let files = draft.outgoing
        let caption = draft.caption
        let asFiles = draft.showsAsFiles
        // Копии файлов теперь у загрузчика — закрытие листа их не трогает.
        draft.isSent = true
        sending = nil
        Task { await model.send(attachments: files, caption: caption, asFiles: asFiles) }
    }

    /// Лист закрыли без отправки — копии выбранного больше не нужны. Отправленный
    /// помечен `isSent`, его файлы уже у загрузчика.
    private func closeDraft() {
        guard let draft = openedDraft else { return }
        openedDraft = nil
        guard !draft.isSent else { return }
        draft.isClosed = true
        draft.discardAll()
    }

    private var canSend: Bool {
        !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Полоска «отвечаю на…» или «редактирую» над полем ввода.
private struct ReplyBar: View {
    let title: String
    let text: String
    var symbol = "arrowshape.turn.up.left"
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(Palette.primary)
                .accessibilityHidden(true)
            Capsule()
                .fill(Palette.primary)
                .frame(width: 3, height: ControlHeight.sm)
            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(Typography.meta.weight(.semibold))
                    .foregroundStyle(Palette.primary)
                    .lineLimit(1)
                Text(text)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
            }
            Spacer(minLength: Spacing.md)
            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(width: ControlHeight.sm, height: ControlHeight.sm)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "chats.cancelAction", defaultValue: "Отменить")))
        }
        .padding(.leading, Spacing.lg)
        .padding(.trailing, Spacing.sm)
        .padding(.vertical, Spacing.sm)
        .chatPanelSurface()
        .padding(.top, Spacing.sm)
    }
}


/// Подпись о том, что делает собеседник. Текст собирает интерфейс: сервер шлёт
/// только значение действия (PROJECT.md §9.1a).
struct ChatActionCaption: View {
    let action: String

    var body: some View {
        Text(Self.title(for: action))
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.xs)
            .accessibilityAddTraits(.updatesFrequently)
    }

    static func title(for action: String) -> String {
        switch action {
        case "RECORDING_VOICE":
            return String(localized: "chats.action.voice", defaultValue: "записывает голосовое…")
        case "UPLOADING_PHOTO":
            return String(localized: "chats.action.photo", defaultValue: "отправляет фото…")
        case "UPLOADING_VIDEO":
            return String(localized: "chats.action.video", defaultValue: "отправляет видео…")
        case "UPLOADING_FILE":
            return String(localized: "chats.action.file", defaultValue: "отправляет файл…")
        default:
            return String(localized: "chats.action.typing", defaultValue: "печатает…")
        }
    }
}

/// Полоса записи: настоящая волна по показаниям микрофона, время и две кнопки.
///
/// Волна здесь не украшение — по ней видно, что микрофон действительно слышит
/// голос, а не записывает тишину из-за занятого другим приложением входа.
struct RecordingBar: View {
    let levels: [Float]
    let duration: TimeInterval
    let onCancel: () -> Void
    let onSend: () -> Void

    var body: some View {
        HStack(spacing: Spacing.lg) {
            Button(action: onCancel) {
                Image(systemName: "trash")
                    .foregroundStyle(Palette.destructive)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "chats.cancelAction", defaultValue: "Отменить")))

            WaveformView(levels: levels)
                .frame(maxWidth: .infinity)
                .frame(height: ControlHeight.sm)

            Text(verbatim: time)
                .font(Typography.tabular(Typography.meta))
                .foregroundStyle(Palette.mutedForeground)

            Button(action: onSend) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(Palette.primary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "chats.send", defaultValue: "Отправить")))
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
        .chatPanelSurface()
        .padding(.top, Spacing.sm)
    }

    private var time: String {
        let whole = Int(duration)
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }
}

/// Столбики уровня сигнала.
struct WaveformView: View {
    let levels: [Float]

    var body: some View {
        GeometryReader { proxy in
            HStack(alignment: .center, spacing: 2) {
                ForEach(Array(levels.enumerated()), id: \.offset) { _, level in
                    Capsule()
                        .fill(Palette.primary)
                        // Минимум в пару точек: нулевая высота читается как обрыв
                        // записи, хотя это просто тишина между словами.
                        .frame(height: max(2, proxy.size.height * CGFloat(level)))
                }
            }
            .frame(maxHeight: .infinity, alignment: .center)
        }
        .accessibilityHidden(true)
    }
}


/// Подложка панели ввода. На iOS 26 её нет: поле и кнопки — стекло над перепиской, как
/// в «Сообщениях», и лента видна под ними. Раньше — непрозрачная полоса с линией сверху.
/// Панель действий режима выбора вместо поля ввода, как в Telegram: слева «Удалить»,
/// справа «Копировать» и «Переслать». Недоступное действие видно, но приглушено —
/// так понятно, что оно есть, просто не для этого выбора.
struct MessageSelectionBar: View {
    let canCopy: Bool
    let canForward: Bool
    let canDelete: Bool
    let onCopy: () -> Void
    let onForward: () -> Void
    let onDelete: () -> Void

    var body: some View {
        GlassGroup(spacing: Spacing.md) {
            HStack(spacing: Spacing.md) {
                action(
                    String(localized: "feed.delete", defaultValue: "Удалить"),
                    symbol: "trash",
                    tint: Palette.destructive,
                    enabled: canDelete,
                    perform: onDelete
                )
                Spacer(minLength: 0)
                action(
                    String(localized: "chats.selection.copy", defaultValue: "Копировать"),
                    symbol: "doc.on.doc",
                    tint: Palette.primary,
                    enabled: canCopy,
                    perform: onCopy
                )
                action(
                    String(localized: "chats.forward", defaultValue: "Переслать"),
                    symbol: "arrowshape.turn.up.right",
                    tint: Palette.primary,
                    enabled: canForward,
                    perform: onForward
                )
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
            .frame(minHeight: ControlHeight.chatInput)
        }
        .modifier(ComposerBarBackground())
    }

    private func action(
        _ title: String,
        symbol: String,
        tint: Color,
        enabled: Bool,
        perform: @escaping () -> Void
    ) -> some View {
        Button(action: perform) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(tint)
                .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                .composerGlass(in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(Text(title))
    }
}

private struct ComposerBarBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content
        } else {
            content
                .background(Palette.plainBackground)
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(Palette.border)
                        .frame(height: 1)
                }
        }
    }
}

private extension View {
    /// Элемент панели ввода: на iOS 26 — стекло, раньше — серая заливка.
    @ViewBuilder
    func composerGlass<S: Shape>(in shape: S) -> some View {
        if #available(iOS 26, *) {
            glassSurface(in: shape)
        } else {
            background(Palette.muted, in: shape)
        }
    }
}

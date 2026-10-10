import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Поле ввода.
///
/// Высота панели — 48 pt: осознанное исключение из высоты островов (DESIGN_SYSTEM
/// §4), потому что в открытом чате нижняя навигация скрыта и совпадать не с чем.
struct MessageComposerView: View {
    @Bindable var model: ChatThreadModel

    @FocusState private var isFocused: Bool
    @State private var recorder = VoiceRecorder()
    @State private var photo: PhotosPickerItem?
    @State private var showsFileImporter = false

    var body: some View {
        VStack(spacing: 0) {
            if let replyTo = model.replyTo {
                ReplyBar(text: replyTo.content) { model.cancelReply() }
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

            HStack(alignment: .bottom, spacing: Spacing.md) {
                Menu {
                    PhotosPicker(selection: $photo, matching: .images) {
                        Label(
                            String(localized: "chats.attachPhoto", defaultValue: "Фото"),
                            systemImage: "photo"
                        )
                    }
                    Button {
                        showsFileImporter = true
                    } label: {
                        Label(
                            String(localized: "chats.attachFile", defaultValue: "Файл"),
                            systemImage: "doc"
                        )
                    }
                } label: {
                    Image(systemName: "paperclip")
                        .font(Typography.body)
                        .foregroundStyle(Palette.mutedForeground)
                        .frame(width: ControlHeight.lg, height: ControlHeight.lg)
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
                .lineLimit(1...5)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                .focused($isFocused)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
                .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xl))
                .onChange(of: model.draft) {
                    model.draftChanged()
                }

                if canSend {
                    sendButton
                } else {
                    micButton
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
            .frame(minHeight: ControlHeight.chatInput)
        }
        .background(Palette.background)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Palette.border)
                .frame(height: 1)
        }
        .onChange(of: photo) {
            Task { await sendPickedPhoto() }
        }
        .fileImporter(isPresented: $showsFileImporter, allowedContentTypes: [.item]) { result in
            Task { await sendPickedFile(result) }
        }
    }

    private var sendButton: some View {
        Button {
            Task { await model.send() }
        } label: {
            Image(systemName: "arrow.up")
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.primaryForeground)
                        .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                .background(Palette.primary, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(String(localized: "chats.send", defaultValue: "Отправить")))
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
            Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill")
                .font(Typography.body)
                .foregroundStyle(Palette.primaryForeground)
                .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                .background(recorder.isRecording ? Palette.destructive : Palette.primary, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(recorder.isRecording
            ? String(localized: "chats.voice.stop", defaultValue: "Остановить запись")
            : String(localized: "chats.voice.record", defaultValue: "Записать голосовое")))
    }

    private func sendPickedPhoto() async {
        guard let photo else { return }
        self.photo = nil
        guard let data = try? await photo.loadTransferable(type: Data.self) else { return }
        await model.attach(
            OutgoingAttachment(data: data, mime: "image/jpeg", name: "photo.jpg", width: nil, height: nil)
        )
    }

    private func sendPickedFile(_ result: Result<URL, Error>) async {
        guard case .success(let url) = result else { return }
        // Файл из чужого каталога открывается только так: без этого чтение
        // запрещено песочницей.
        guard url.startAccessingSecurityScopedResource() else { return }
        defer { url.stopAccessingSecurityScopedResource() }
        guard let data = try? Data(contentsOf: url) else { return }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
            ?? "application/octet-stream"
        await model.attach(
            OutgoingAttachment(
                data: data,
                mime: mime,
                name: url.lastPathComponent,
                width: nil,
                height: nil
            )
        )
    }

    private var canSend: Bool {
        !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Полоска «отвечаю на…» над полем ввода.
private struct ReplyBar: View {
    let text: String
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: Spacing.md) {
            Rectangle()
                .fill(Palette.primary)
                .frame(width: 2, height: ControlHeight.sm)
            VStack(alignment: .leading, spacing: 0) {
                Text(String(localized: "chats.replyingTo", defaultValue: "Ответ"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.primary)
                Text(text)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
            }
            Spacer(minLength: Spacing.md)
            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "common.cancel", defaultValue: "Отменить")))
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .background(Palette.muted)
    }
}


/// Подпись о том, что делает собеседник. Текст собирает интерфейс: сервер шлёт
/// только значение действия (PROJECT.md §9.1a).
struct ChatActionCaption: View {
    let action: String

    var body: some View {
        Text(title)
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.xs)
            .accessibilityAddTraits(.updatesFrequently)
    }

    private var title: String {
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
            .accessibilityLabel(Text(String(localized: "common.cancel", defaultValue: "Отменить")))

            WaveformView(levels: levels)
                .frame(maxWidth: .infinity)
                .frame(height: ControlHeight.sm)

            Text(verbatim: time)
                .font(Typography.tabular(Typography.meta))
                .foregroundStyle(Palette.mutedForeground)

            Button(action: onSend) {
                Image(systemName: "arrow.up.circle.fill")
                    .foregroundStyle(Palette.primary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "chats.send", defaultValue: "Отправить")))
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .background(Palette.muted)
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

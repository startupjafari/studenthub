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
    /// Смещение пальца на микрофоне во время записи.
    @State private var micOffset: CGSize = .zero
    @State private var showsFileImporter = false
    /// Какие файлы выбирает `fileImporter`: любые или только аудио («Звук»).
    @State private var importTypes: [UTType] = [.item]
    @State private var showsAttachMenu = false
    /// Выбор в листе вложений ждёт, пока лист закроется.
    @State private var pendingPick: AttachmentPick?
    @State private var showsScanner = false
    /// Вместо клавиатуры открыта панель emoji, стикеров и GIF.
    @State private var showsPanel = false
    @State private var pickingContact = false
    /// «Выбрать из Галереи» во вкладке «Файл»: снимки уходят файлами.
    @State private var pickingPhotoFiles = false
    @State private var photoFiles: [PhotosPickerItem] = []
    @State private var contactToSend: ContactCardDraft?
    @State private var showsCamera = false
    /// Выбранное к отправке — открыт лист вложений.
    @State private var sending: AttachmentDraft?
    /// Тот же черновик для `onDismiss`: к моменту закрытия `sending` уже обнулён.
    @State private var openedDraft: AttachmentDraft?
    /// Снимок камеры ждёт, пока она закроется: лист поверх уходящей камеры не откроется.
    @State private var captured: UIImage?
    /// Каждая отправка — лёгкий отклик под пальцем, как в Telegram.
    @State private var sentTick = 0
    @Environment(\.motionReduced) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            // Полосы над полем выезжают снизу, из-под поля, и туда же уходят. Анимация
            // привязана к этому контейнеру: поле ввода под ним не перестраивается рывком
            // вслед за ними.
            VStack(spacing: 0) {
                if let editing = model.editing {
                    ReplyBar(
                        title: String(localized: "chats.editing", defaultValue: "Редактирование"),
                        text: editing.content,
                        symbol: "pencil"
                    ) { model.cancelEdit() }
                    .transition(barTransition)
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
                    // Ответ на другое сообщение — новая полоса, а не правка текста старой.
                    .id(replyTo.id)
                    .transition(barTransition)
                }

            }
            .animation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion), value: barKey)

            GlassGroup(spacing: Spacing.md) {
            HStack(alignment: .bottom, spacing: Spacing.md) {
                HStack(alignment: .bottom, spacing: Spacing.md) {
                    Button {
                        showsAttachMenu = true
                    } label: {
                        Image(systemName: "paperclip")
                            .font(.title3)
                            .foregroundStyle(Palette.mutedForeground)
                            .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                            .composerGlass(in: Circle(), isVisible: !recorder.machine.isActive)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("chat.attach")
                    .accessibilityLabel(Text(String(localized: "chats.attach", defaultValue: "Вложение")))

                    TextField(
                        text: $model.draft,
                        // Во время записи подсказки нет: стекло контейнера не гасит
                        // прозрачность поля, и «Сообщение» проступало сквозь полосу записи.
                        prompt: Text(verbatim: recorder.machine.isActive
                            ? ""
                            : String(localized: "chats.placeholder", defaultValue: "Сообщение")),
                        axis: .vertical
                    ) {
                        Text(verbatim: String(localized: "chats.placeholder", defaultValue: "Сообщение"))
                    }
                    .labelsHidden()
                    .lineLimit(1...6)
                    .font(Typography.body)
                    .foregroundStyle(recorder.machine.isActive ? Color.clear : Palette.foreground)
                    // Курсор тоже гаснет на время записи — клавиатура при этом остаётся.
                    .tint(recorder.machine.isActive ? Color.clear : Palette.primary)
                    .focused($isFocused)
                    .accessibilityIdentifier("chat.composer")
                    .padding(.leading, Spacing.lg)
                    // Справа — место под кнопку emoji внутри поля.
                    .padding(.trailing, ControlHeight.lg)
                    .padding(.vertical, Spacing.md)
                    .frame(minHeight: ControlHeight.lg)
                    .overlay(alignment: .bottomTrailing) {
                        if !recorder.machine.isActive { expressionButton }
                    }
                    // Радиус — половина высоты одной строки: в одну строку поле — капсула,
                    // в несколько — скруглённый прямоугольник, как в Telegram.
                    .composerGlass(
                        in: RoundedRectangle(cornerRadius: ControlHeight.lg / 2, style: .continuous),
                        isVisible: !recorder.machine.isActive
                    )
                    .onChange(of: model.draft) {
                        model.draftChanged()
                    }
                }
                // Во время записи место скрепки и поля занимает полоса записи. Поле
                // остаётся в иерархии (прозрачным): клавиатура и черновик не сбрасываются,
                // а микрофон под пальцем не перестраивается. Стекло поля и скрепки на это
                // время выключено: стекло в общем контейнере рисует сам контейнер, и
                // прозрачность его не гасила — скрепка и «Сообщение» проступали сквозь
                // полосу записи.
                .opacity(recorder.machine.isActive ? 0 : 1)
                .allowsHitTesting(!recorder.machine.isActive)
                .overlay {
                    if recorder.machine.isActive {
                        VoiceRecordingStrip(recorder: recorder, offset: micOffset)
                            .transition(.opacity)
                    }
                }

                // Микрофон и «отправить» занимают одно место и перетекают друг в друга:
                // одна кнопка сжимается и гаснет, другая вырастает поверх. В стопке, а
                // не в ряду — иначе на время перехода ряд раздвигался бы под обе.
                ZStack {
                    if canSend, !recorder.machine.isActive {
                        sendButton
                    } else {
                        VoiceMicButton(recorder: recorder, offset: $micOffset)
                            .transition(buttonTransition)
                    }
                }
                .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: canSend)
            }
            .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: recorder.phase)
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
            .frame(minHeight: ControlHeight.chatInput)
            }

            // Панель emoji, стикеров и GIF — на месте клавиатуры и той же высоты.
            if showsPanel {
                ExpressionPanel(
                    onEmoji: { model.draft += $0 },
                    onBackspace: {
                        guard !model.draft.isEmpty else { return }
                        model.draft.removeLast()
                    },
                    onSticker: { sticker in
                        sentTick += 1
                        Task { await model.sendSticker(id: sticker.id) }
                    },
                    onGif: { choice in
                        sentTick += 1
                        switch choice {
                        case .recent(let gif): Task { await model.sendGif(fileID: gif.fileId) }
                        case .external(let gif): Task { await model.sendExternalGif(id: gif.id) }
                        }
                    }
                )
                .frame(height: panelHeight)
                .transition(.move(edge: .bottom))
            }
        }
        .animation(Motion.respecting(Motion.snappy, reduceMotion: reduceMotion), value: showsPanel)
        // Пока открыта панель, экран чата не отступает от клавиатуры (`ComposerPanelShown`):
        // панель и клавиатура сменяют друг друга на одном месте, и поле ввода не прыгает.
        .preference(key: ComposerPanelShown.self, value: showsPanel)
        // Клавиатура поднялась поверх панели — панель уходит без анимации: высоты
        // совпадают, и под полем ничего не сдвигается.
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
            guard showsPanel, isFocused else { return }
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { showsPanel = false }
        }
        .modifier(ComposerBarBackground())
        // «Отправить», вложение, микрофон — клавиатура остаётся, как в мессенджерах.
        .keepsKeyboardOnTap()
        .sensoryFeedback(.impact(weight: .light), trigger: sentTick)
        .voiceRecordingAlerts(recorder)
        // Касание поля возвращает клавиатуру. Панель уступает ей место, когда клавиатура
        // уже поднялась (`keyboardDidShow` выше); не поднялась (внешняя клавиатура) —
        // уходит через мгновение сама.
        .onChange(of: isFocused) { _, focused in
            guard focused, showsPanel else { return }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(600))
                if isFocused, showsPanel, KeyboardFrame.shared.top == nil { showsPanel = false }
            }
        }
        // «Ответить» и «Редактировать» из меню сразу открывают клавиатуру.
        .onChange(of: model.replyTo?.id) { _, id in
            if id != nil { isFocused = true }
        }
        .onChange(of: model.editing?.id) { _, id in
            if id != nil { isFocused = true }
        }
        .onAppear {
            recorder.onSend = { [model] voice in await model.attach(voice) }
            recorder.onAnnounce = { [model] on in model.announceVoice(on) }
        }
        .onDisappear {
            // Ушли из чата посреди записи — недописанное не уходит само. Не `delete()`:
            // его машина в фазе «палец держит» не принимает, и у собеседников так и висело
            // «записывает голосовое…», а кнопка «вниз» в ленте пропадала.
            recorder.abandon()
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
        .sheet(isPresented: $showsAttachMenu, onDismiss: runPendingPick) {
            AttachmentMenuSheet(
                allowsPoll: allowsPoll,
                albumLimit: AttachmentUploader.albumLimit,
                onPick: { pendingPick = $0 },
                onSendLocation: { coordinate, title, address in
                    await model.sendLocation(
                        latitude: coordinate.latitude, longitude: coordinate.longitude, title: title, address: address
                    )
                },
                onSendLiveLocation: { location, period in
                    await model.sendLiveLocation(location, period: period)
                },
                onCreatePoll: { question, description, options, multiple, anonymous in
                    await model.createPoll(
                        question: question, description: description, options: options, multiple: multiple, anonymous: anonymous
                    )
                },
                onCreateChecklist: { title, items, othersCanAdd, othersCanMark in
                    await model.sendChecklist(title: title, items: items, othersCanAdd: othersCanAdd, othersCanMark: othersCanMark)
                }
            )
        }
        .photosPicker(
            isPresented: $pickingPhotoFiles,
            selection: $photoFiles,
            maxSelectionCount: AttachmentUploader.albumLimit,
            matching: .any(of: [.images, .videos])
        )
        .onChange(of: photoFiles) { _, items in
            guard !items.isEmpty else { return }
            photoFiles = []
            let draft = openDraft()
            // Снимки из вкладки «Файл» — файлами, без сжатия, как в Telegram.
            draft.asFiles = true
            Task { await draft.add(photos: items) }
        }
        .sheet(isPresented: $pickingContact) {
            ContactPicker(
                onPick: { contact in
                    pickingContact = false
                    contactToSend = ContactCardDraft(contact)
                },
                onCancel: { pickingContact = false }
            )
            .ignoresSafeArea()
        }
        .sheet(item: $contactToSend) { contact in
            ContactConfirmSheet(contact: contact) {
                await model.sendContact(contact)
            }
        }
        .fullScreenCover(isPresented: $showsScanner) {
            DocumentScanner(
                onScan: { url in
                    showsScanner = false
                    let draft = openDraft()
                    Task { await draft.add(files: [url]) }
                },
                onCancel: { showsScanner = false }
            )
            .ignoresSafeArea()
        }
        .fileImporter(
            isPresented: $showsFileImporter,
            allowedContentTypes: importTypes,
            allowsMultipleSelection: true
        ) { result in
            guard case .success(let urls) = result, !urls.isEmpty else { return }
            let draft = openDraft()
            Task { await draft.add(files: urls) }
        }
    }

    /// Смайлик внутри поля: открыть панель emoji; на открытой панели — клавиатура.
    private var expressionButton: some View {
        Button {
            if showsPanel {
                isFocused = true
            } else if KeyboardFrame.shared.top != nil {
                // С клавиатуры: панель сразу встаёт на её место (без въезда — она под
                // клавиатурой), и клавиатура уезжает, открывая её. Экран к этому моменту
                // уже не отступает от клавиатуры — поле стоит на месте.
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) { showsPanel = true }
                DispatchQueue.main.async { isFocused = false }
            } else {
                showsPanel = true
            }
        } label: {
            Image(systemName: showsPanel ? "keyboard" : "face.smiling")
                .font(.title3)
                .foregroundStyle(Palette.mutedForeground)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("chat.expressions")
        .accessibilityLabel(Text(showsPanel
            ? String(localized: "chats.panel.keyboard", defaultValue: "Клавиатура")
            : String(localized: "chats.panel.open", defaultValue: "Emoji, стикеры и GIF")))
    }

    /// Высота панели — как у последней клавиатуры за вычетом нижнего отступа экрана
    /// (панель стоит над ним, клавиатура — нет).
    private var panelHeight: CGFloat {
        let bottom = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow?.safeAreaInsets.bottom }
            .first ?? 0
        return max(260, (KeyboardFrame.shared.lastHeight ?? 336) - bottom)
    }

    private var sendButton: some View {
        Button {
            sentTick += 1
            Task { await model.send() }
        } label: {
            Image(systemName: model.editing == nil ? "arrow.up" : "checkmark")
                .font(Typography.body.weight(.bold))
                .foregroundStyle(Palette.primaryForeground)
                .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                .glassSurface(tint: Palette.primary, in: Circle())
        }
        .buttonStyle(.plain)
        .transition(buttonTransition)
        .accessibilityIdentifier("chat.send")
        .accessibilityLabel(Text(model.editing == nil
            ? String(localized: "chats.send", defaultValue: "Отправить")
            : String(localized: "common.save", defaultValue: "Сохранить")))
    }

    /// Опрос — в группах и официальных чатах, не в личных и не в «Избранном» (как в
    /// вебе: голосовать там некому).
    private var allowsPoll: Bool {
        guard let kind = model.chat?.kind else { return false }
        return kind != .private && kind != .saved
    }

    /// Выбор в листе вложений: системные окна открываются, когда лист уже закрылся.
    private func runPendingPick() {
        guard let pick = pendingPick else { return }
        pendingPick = nil
        switch pick {
        case .assets(let assets):
            let draft = openDraft()
            Task { await draft.add(assets: assets) }
        case .photos(let items):
            let draft = openDraft()
            Task { await draft.add(photos: items) }
        case .camera:
            showsCamera = true
        case .files:
            importTypes = [.item]
            showsFileImporter = true
        case .photosAsFiles:
            pickingPhotoFiles = true
        case .audio:
            importTypes = [.audio]
            showsFileImporter = true
        case .scan:
            showsScanner = true
        case .contact:
            pickingContact = true
        case .contactCard(let contact):
            contactToSend = contact
        }
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
        sentTick += 1
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

    /// Что сейчас над полем: правка, ответ (на какое сообщение), запись. Смена — повод
    /// анимировать полосы.
    private var barKey: String {
        "\(model.editing?.id ?? "")|\(model.replyTo?.id ?? "")"
    }

    /// Полоса над полем выезжает снизу; без движения — только проявляется.
    private var barTransition: AnyTransition {
        reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity)
    }

    /// Смена микрофона на «отправить»: сжатие с угасанием; без движения — угасание.
    private var buttonTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.5).combined(with: .opacity)
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
                // Недоступное — серым, а не бледным цветом действия: полупрозрачная
                // красная корзина на стекле читалась как активная, хотя чужие сообщения
                // сервер удалить не даст (только свои, WRONG_SCOPE).
                .foregroundStyle(enabled ? tint : Palette.mutedForeground)
                .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                .composerGlass(in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
        .animation(.easeOut(duration: Motion.Duration.feedback), value: enabled)
        .accessibilityLabel(Text(title))
    }
}

struct ComposerBarBackground: ViewModifier {
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

/// Открыта ли панель emoji, стикеров и GIF: экран чата на это время не отступает от
/// клавиатуры.
struct ComposerPanelShown: PreferenceKey {
    static let defaultValue = false

    static func reduce(value: inout Bool, nextValue: () -> Bool) {
        value = value || nextValue()
    }
}

extension View {
    /// Элемент панели ввода: на iOS 26 — стекло, раньше — серая заливка.
    ///
    /// `isVisible: false` убирает стекло, не меняя устройства вида (`Glass.identity`):
    /// поле под полосой записи не теряет фокус и черновик. `interactive: false` — стекло
    /// не раздувается под пальцем (микрофон: отклик удержания — круг записи).
    @ViewBuilder
    func composerGlass<S: Shape>(in shape: S, isVisible: Bool = true, interactive: Bool = true) -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                let glass = interactive ? Glass.regular.interactive() : Glass.regular
                glassEffect(isVisible ? glass : Glass.identity, in: shape)
                    .contentShape(shape)
            } else {
                background(isVisible ? Palette.muted : Color.clear, in: shape)
            }
        #else
            background(isVisible ? Palette.muted : Color.clear, in: shape)
        #endif
    }
}

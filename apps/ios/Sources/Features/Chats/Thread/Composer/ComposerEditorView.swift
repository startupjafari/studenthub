import SwiftUI
import UIKit

/// Как закрылся полноэкранный редактор: просто свёрнут, или следом нужно действие
/// панели ввода (лист вложений и вставка картинок открываются из неё — редактор поверх
/// не дал бы листу показаться).
enum ComposerEditorExit {
    case collapse
    case sent
    case attach
    case pasteImages([UIImage])
}

/// Полноэкранный редактор сообщения, как в Telegram (кнопка ⛶ в поле ввода): длинный
/// текст и правка — на весь экран. Сверху — свернуть и отмена/повтор, снизу — панель:
/// форматирование, списки, вложение, emoji, отправка. Текст — тот же черновик
/// `model.draft`: свернул — продолжил в поле; черновик в базе и на сервере тот же.
struct ComposerEditorView: View {
    @Bindable var model: ChatThreadModel
    let close: (ComposerEditorExit) -> Void
    /// Отправка или сохранение правки — та же, что у кнопки панели ввода.
    let send: () -> Void
    let sendSticker: (StickerSetDTO.Sticker) -> Void
    let sendGif: (GifChoice) -> Void
    let reduceMotion: Bool

    @State private var editor = ComposerTextController()
    @State private var isFocused = false
    /// Вместо клавиатуры — панель emoji, стикеров и GIF.
    @State private var showsPanel = false

    var body: some View {
        VStack(spacing: 0) {
            topBar
            if let editing = model.editing {
                ReplyBar(
                    title: String(localized: "chats.editing", defaultValue: "Редактирование"),
                    text: editing.content,
                    symbol: "pencil"
                ) {
                    model.cancelEdit()
                    close(.collapse)
                }
                .padding(.horizontal, Spacing.lg)
            }
            ComposerTextView(
                text: $model.draft,
                isFocused: $isFocused,
                controller: editor,
                maxLines: nil,
                accessibilityID: "chat.composer.editor",
                accessibilityLabel: placeholder,
                onPasteImages: { close(.pasteImages($0)) }
            )
            .overlay(alignment: .topLeading) {
                if model.draft.isEmpty {
                    Text(verbatim: placeholder)
                        .font(Typography.body)
                        .foregroundStyle(Color(uiColor: .placeholderText))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.top, Spacing.lg)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            toolbar
            if showsPanel {
                ExpressionPanel(
                    onEmoji: { emoji in
                        if !editor.insert(emoji) { model.draft += emoji }
                    },
                    onBackspace: {
                        if !editor.deleteBackward(), !model.draft.isEmpty { model.draft.removeLast() }
                    },
                    onSticker: { sticker in
                        sendSticker(sticker)
                        close(.sent)
                    },
                    onGif: { gif in
                        sendGif(gif)
                        close(.sent)
                    }
                )
                .frame(height: panelHeight)
                .transition(.move(edge: .bottom))
            }
        }
        .background { Palette.plainBackground.ignoresSafeArea() }
        // Панель стоит на месте клавиатуры: пока она открыта, уход клавиатуры не
        // двигает панель инструментов.
        .ignoresSafeArea(.keyboard, edges: showsPanel ? .bottom : [])
        .animation(Motion.respecting(Motion.snappy, reduceMotion: reduceMotion), value: showsPanel)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
            guard showsPanel, isFocused else { return }
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { showsPanel = false }
        }
        .onAppear { isFocused = true }
        .environment(\.motionReduced, reduceMotion)
    }

    // MARK: Верх

    private var topBar: some View {
        HStack(spacing: Spacing.md) {
            Button {
                close(.collapse)
            } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                    .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                    .composerGlass(in: Circle())
            }
            .buttonStyle(.pressableIcon)
            .accessibilityIdentifier("chat.editor.collapse")
            .accessibilityLabel(Text(String(localized: "chats.editor.collapse", defaultValue: "Свернуть")))

            Spacer(minLength: 0)

            HStack(spacing: 0) {
                historyButton(
                    symbol: "arrow.uturn.backward",
                    title: String(localized: "chats.editor.undo", defaultValue: "Отменить"),
                    enabled: editor.canUndo
                ) { editor.undo() }
                historyButton(
                    symbol: "arrow.uturn.forward",
                    title: String(localized: "chats.editor.redo", defaultValue: "Повторить"),
                    enabled: editor.canRedo
                ) { editor.redo() }
            }
            .composerGlass(in: Capsule())
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
        .keepsKeyboardOnTap()
    }

    private func historyButton(symbol: String, title: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.body.weight(.medium))
                .foregroundStyle(enabled ? Palette.foreground : Palette.mutedForeground)
                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
        .accessibilityLabel(Text(title))
    }

    // MARK: Панель инструментов

    private var toolbar: some View {
        GlassGroup(spacing: Spacing.md) {
            HStack(spacing: Spacing.md) {
                HStack(spacing: 0) {
                    Menu {
                        ForEach(ComposerFormat.allCases, id: \.self) { format in
                            Button {
                                editor.apply(format)
                            } label: {
                                Label(format.title, systemImage: format.symbol)
                            }
                        }
                    } label: {
                        toolIcon("textformat")
                    }
                    .accessibilityLabel(Text(String(localized: "chats.format.menu", defaultValue: "Форматирование")))

                    Menu {
                        Button {
                            editor.toggleList(.bulleted)
                        } label: {
                            Label(String(localized: "chats.editor.bulleted", defaultValue: "Маркированный список"), systemImage: "list.bullet")
                        }
                        Button {
                            editor.toggleList(.numbered)
                        } label: {
                            Label(String(localized: "chats.editor.numbered", defaultValue: "Нумерованный список"), systemImage: "list.number")
                        }
                    } label: {
                        toolIcon("list.bullet")
                    }
                    .accessibilityLabel(Text(String(localized: "chats.editor.list", defaultValue: "Список")))

                    // Правка не меняет вложений — как и в панели ввода, лист вложений
                    // в ней не открывается подписью.
                    if model.editing == nil {
                        Button {
                            close(.attach)
                        } label: {
                            toolIcon("paperclip")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "chats.attach", defaultValue: "Вложение")))
                    }

                    Button(action: togglePanel) {
                        toolIcon(showsPanel ? "keyboard" : "face.smiling")
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(showsPanel
                        ? String(localized: "chats.panel.keyboard", defaultValue: "Клавиатура")
                        : String(localized: "chats.panel.open", defaultValue: "Emoji, стикеры и GIF")))
                }
                .padding(.horizontal, Spacing.xs)
                .composerGlass(in: Capsule())

                Spacer(minLength: 0)

                Button {
                    send()
                    close(.sent)
                } label: {
                    Image(systemName: model.editing == nil ? "arrow.up" : "checkmark")
                        .font(Typography.body.weight(.bold))
                        .foregroundStyle(Palette.primaryForeground)
                        .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                        .glassSurface(tint: Palette.primary, in: Circle())
                }
                .buttonStyle(.pressableIcon)
                .disabled(!canSend)
                .opacity(canSend ? 1 : 0.5)
                .accessibilityIdentifier("chat.editor.send")
                .accessibilityLabel(Text(model.editing == nil
                    ? String(localized: "chats.send", defaultValue: "Отправить")
                    : String(localized: "common.save", defaultValue: "Сохранить")))
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
        }
        .keepsKeyboardOnTap()
    }

    private func toolIcon(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.title3)
            .foregroundStyle(Palette.mutedForeground)
            .frame(width: ControlHeight.xl, height: ControlHeight.xl)
            .contentShape(Rectangle())
    }

    /// Emoji вместо клавиатуры и обратно — как смайлик в поле панели ввода.
    private func togglePanel() {
        if showsPanel {
            isFocused = true
        } else if KeyboardFrame.shared.top != nil {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { showsPanel = true }
            DispatchQueue.main.async { isFocused = false }
        } else {
            showsPanel = true
        }
    }

    private var canSend: Bool {
        !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var placeholder: String {
        String(localized: "chats.placeholder", defaultValue: "Сообщение")
    }

    /// Как у панели ввода: высота последней клавиатуры за вычетом нижнего отступа.
    private var panelHeight: CGFloat {
        let bottom = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow?.safeAreaInsets.bottom }
            .first ?? 0
        return max(260, (KeyboardFrame.shared.lastHeight ?? 336) - bottom)
    }
}

/// Показ редактора поверх экрана чата — UIKit-ом, `overFullScreen`.
///
/// Не `fullScreenCover`: тот убирает экран чата из окна, и SwiftUI шлёт ему
/// `onDisappear` — чат «уходил» (закрывал комнату сокета, гасил выбор и голосовое), а
/// при сворачивании входил заново. Здесь экран чата остаётся под редактором.
@MainActor
final class ComposerEditorPresenter {
    private weak var controller: UIViewController?
    private var onExit: ((ComposerEditorExit) -> Void)?

    var isPresented: Bool { controller != nil }

    func present<Content: View>(_ content: Content, onExit: @escaping (ComposerEditorExit) -> Void) {
        guard controller == nil,
            let root = UIApplication.shared.connectedScenes
                .compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController })
                .first
        else { return }
        var top = root
        while let next = top.presentedViewController, !next.isBeingDismissed { top = next }

        let host = UIHostingController(rootView: content)
        host.modalPresentationStyle = .overFullScreen
        host.view.backgroundColor = .clear
        self.onExit = onExit
        controller = host
        top.present(host, animated: true)
    }

    /// Свернуть; действие панели ввода — когда редактор уже ушёл с экрана.
    func dismiss(_ exit: ComposerEditorExit) {
        guard let controller else { return }
        let onExit = onExit
        self.onExit = nil
        controller.dismiss(animated: true) {
            onExit?(exit)
        }
        self.controller = nil
    }
}

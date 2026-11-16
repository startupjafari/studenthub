import SwiftUI
import UIKit

/// Вкладка «Текст» листа вложений: отдельный многострочный редактор (не поле ввода
/// чата) с отменой и повтором. Готовый текст уходит файлом `.txt` через лист отправки —
/// особого «текстового» вида сообщения у сервера нет, а файл с ним получатель откроет
/// где угодно.
struct TextAttachmentEditor: View {
    let onSend: (URL) -> Void

    @State private var text = ""
    @State private var handle = UndoableTextView.Handle()
    @State private var failure: String?

    var body: some View {
        VStack(spacing: Spacing.md) {
            HStack(spacing: Spacing.md) {
                Spacer()
                Button {
                    handle.undo()
                } label: {
                    Image(systemName: "arrow.uturn.backward").font(.body.weight(.semibold))
                }
                .disabled(!handle.canUndo)
                .accessibilityLabel(Text(String(localized: "chats.attach.text.undo", defaultValue: "Отменить")))
                .accessibilityIdentifier("chat.attach.text.undo")
                Button {
                    handle.redo()
                } label: {
                    Image(systemName: "arrow.uturn.forward").font(.body.weight(.semibold))
                }
                .disabled(!handle.canRedo)
                .accessibilityLabel(Text(String(localized: "chats.attach.text.redo", defaultValue: "Повторить")))
                .accessibilityIdentifier("chat.attach.text.redo")
            }
            .foregroundStyle(Palette.primary)
            .padding(.horizontal, Spacing.xl)

            UndoableTextView(
                text: $text,
                handle: handle,
                placeholder: String(localized: "chats.attach.text.placeholder", defaultValue: "Ваш текст…")
            )
            .padding(Spacing.md)
            .background(Palette.secondary, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))
            .padding(.horizontal, Spacing.lg)

            if let failure {
                Text(failure).font(Typography.meta).foregroundStyle(Palette.destructive)
            }

            Button {
                send()
            } label: {
                Text(String(localized: "chats.attach.text.send", defaultValue: "Отправить файлом"))
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.md)
            .accessibilityIdentifier("chat.attach.text.send")
        }
        .padding(.top, Spacing.sm)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.attach.text")
    }

    private func send() {
        do {
            onSend(try Self.file(for: text))
        } catch {
            failure = error.userMessage
        }
    }

    /// Файл `.txt` в UTF-8 с именем из первых слов: «Конспект лекции.txt».
    static func file(for text: String, now: Date = Date()) throws -> URL {
        let firstLine = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        var name = String(firstLine.trimmingCharacters(in: .whitespaces).prefix(40))
            .components(separatedBy: CharacterSet(charactersIn: "/\\:?%*|\"<>"))
            .joined()
        if name.isEmpty {
            name = String(localized: "chats.attach.text.fileName", defaultValue: "Текст")
                + " " + now.formatted(.dateTime.day().month(.twoDigits).hour().minute())
                    .replacingOccurrences(of: ":", with: ".")
        }
        let folder = FileManager.default.temporaryDirectory.appending(path: "text-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: name + ".txt")
        try Data(text.utf8).write(to: url, options: .atomic)
        return url
    }
}

/// Многострочный UITextView со встроенной историей правок (`undoManager`): выделение,
/// копирование и вставка — системные, отмена и повтор — кнопками сверху.
struct UndoableTextView: UIViewRepresentable {
    /// Ручка для кнопок «Отменить» / «Повторить» и их доступности.
    @Observable
    final class Handle {
        fileprivate weak var view: UITextView?
        private(set) var canUndo = false
        private(set) var canRedo = false

        func undo() {
            view?.undoManager?.undo()
            synchronize()
        }

        func redo() {
            view?.undoManager?.redo()
            synchronize()
        }

        /// Текст после отмены — в привязку: делегат на программную правку не зовётся.
        private func synchronize() {
            if let view { view.delegate?.textViewDidChange?(view) }
            refresh()
        }

        func refresh() {
            canUndo = view?.undoManager?.canUndo ?? false
            canRedo = view?.undoManager?.canRedo ?? false
        }
    }

    @Binding var text: String
    let handle: Handle
    let placeholder: String

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> PlaceholderTextView {
        let view = PlaceholderTextView()
        view.delegate = context.coordinator
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.backgroundColor = .clear
        view.placeholder = placeholder
        view.text = text
        view.refreshPlaceholder()
        view.accessibilityIdentifier = "chat.attach.text.field"
        handle.view = view
        return view
    }

    func updateUIView(_ view: PlaceholderTextView, context: Context) {
        context.coordinator.parent = self
        if view.text != text {
            view.text = text
            view.refreshPlaceholder()
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: UndoableTextView

        init(_ parent: UndoableTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            (textView as? PlaceholderTextView)?.refreshPlaceholder()
            parent.text = textView.text
            parent.handle.refresh()
        }
    }
}

import SwiftUI

/// Новый опрос в чате — как в вебе: вопрос до 300 знаков, необязательное пояснение до
/// 500, от двух до десяти вариантов по 100 знаков, «несколько ответов» и «анонимно».
struct ChatPollCreatorView: View {
    /// `true` — опрос создан, лист можно закрыть.
    let create: (_ question: String, _ description: String?, _ options: [String], _ multiple: Bool, _ anonymous: Bool) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var question = ""
    @State private var details = ""
    @State private var options = ["", ""]
    @State private var multiple = false
    @State private var anonymous = false
    @State private var isSending = false
    @FocusState private var focused: Int?

    private static let maxOptions = 10

    private var filledOptions: [String] {
        options.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// Одинаковые варианты сервер примет, но голосовать между ними бессмысленно.
    private var hasDuplicates: Bool {
        let lowered = filledOptions.map { $0.lowercased() }
        return Set(lowered).count != lowered.count
    }

    private var canCreate: Bool {
        !question.trimmingCharacters(in: .whitespaces).isEmpty && filledOptions.count >= 2 && !hasDuplicates && !isSending
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(String(localized: "chats.poll.question", defaultValue: "Вопрос")) {
                    TextField(String(localized: "chats.poll.questionPlaceholder", defaultValue: "Задайте вопрос"), text: $question, axis: .vertical)
                        .onChange(of: question) { _, value in
                            if value.count > 300 { question = String(value.prefix(300)) }
                        }
                    TextField(
                        String(localized: "chats.poll.description", defaultValue: "Пояснение (необязательно)"),
                        text: $details,
                        axis: .vertical
                    )
                    .lineLimit(1...4)
                    .onChange(of: details) { _, value in
                        if value.count > 500 { details = String(value.prefix(500)) }
                    }
                }

                Section {
                    ForEach(options.indices, id: \.self) { index in
                        HStack(spacing: Spacing.md) {
                        if options.count > 2 {
                            Button {
                                options.remove(at: index)
                            } label: {
                                Image(systemName: "minus.circle.fill")
                                    .foregroundStyle(Palette.destructive)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(String(localized: "chats.poll.removeOption", defaultValue: "Убрать вариант")))
                        }
                        TextField(
                            String(localized: "chats.poll.option", defaultValue: "Вариант \(index + 1)"),
                            text: Binding(
                                get: { options.indices.contains(index) ? options[index] : "" },
                                set: { value in
                                    guard options.indices.contains(index) else { return }
                                    options[index] = String(value.prefix(100))
                                }
                            )
                        )
                        .focused($focused, equals: index)
                        .submitLabel(index == options.count - 1 ? .done : .next)
                        .onSubmit { focused = index + 1 < options.count ? index + 1 : nil }
                        }
                    }
                    .onDelete { offsets in
                        guard options.count - offsets.count >= 2 else { return }
                        options.remove(atOffsets: offsets)
                    }
                    if options.count < Self.maxOptions {
                        Button {
                            options.append("")
                            focused = options.count - 1
                        } label: {
                            Label(String(localized: "chats.poll.addOption", defaultValue: "Добавить вариант"), systemImage: "plus.circle.fill")
                        }
                    }
                } header: {
                    Text(String(localized: "chats.poll.options", defaultValue: "Варианты ответа"))
                } footer: {
                    if hasDuplicates {
                        Text(String(localized: "chats.poll.duplicates", defaultValue: "Варианты не должны повторяться"))
                            .foregroundStyle(Palette.destructive)
                    } else {
                        Text(String(localized: "chats.poll.optionsHint", defaultValue: "От двух до десяти вариантов. Лишний — смахните влево."))
                    }
                }

                Section {
                    Toggle(String(localized: "chats.poll.multiple", defaultValue: "Несколько ответов"), isOn: $multiple)
                    Toggle(String(localized: "chats.poll.anonymous", defaultValue: "Анонимный опрос"), isOn: $anonymous)
                }
            }
            .navigationTitle(Text(String(localized: "chats.poll.new", defaultValue: "Опрос")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSending {
                        ProgressView()
                    } else {
                        Button(String(localized: "chats.group.create", defaultValue: "Создать")) {
                            Task { await submit() }
                        }
                        .disabled(!canCreate)
                    }
                }
            }
        }
    }

    @MainActor
    private func submit() async {
        isSending = true
        defer { isSending = false }
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        let note = details.trimmingCharacters(in: .whitespacesAndNewlines)
        if await create(text, note.isEmpty ? nil : note, filledOptions, multiple, anonymous) {
            dismiss()
        }
    }
}

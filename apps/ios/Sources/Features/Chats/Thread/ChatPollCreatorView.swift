import Observation
import SwiftUI

/// Черновик опроса — как в вебе: вопрос до 300 знаков, необязательное пояснение до
/// 500, от двух до десяти вариантов по 100 знаков, «несколько ответов» и «анонимно».
/// Живёт в листе вложений, пока он открыт.
@Observable
final class PollDraft {
    static let maxOptions = 10

    var question = ""
    var details = ""
    var options = ["", ""]
    var multiple = false
    var anonymous = false
    private(set) var isSending = false

    var filledOptions: [String] {
        options.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// Одинаковые варианты сервер примет, но голосовать между ними бессмысленно.
    var hasDuplicates: Bool {
        let lowered = filledOptions.map { $0.lowercased() }
        return Set(lowered).count != lowered.count
    }

    var canCreate: Bool {
        !question.trimmingCharacters(in: .whitespaces).isEmpty && filledOptions.count >= 2 && !hasDuplicates && !isSending
    }

    /// `true` — опрос создан, лист можно закрыть.
    @MainActor
    func submit(
        _ create: (_ question: String, _ description: String?, _ options: [String], _ multiple: Bool, _ anonymous: Bool) async -> Bool
    ) async -> Bool {
        guard canCreate else { return false }
        isSending = true
        defer { isSending = false }
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        let note = details.trimmingCharacters(in: .whitespacesAndNewlines)
        return await create(text, note.isEmpty ? nil : note, filledOptions, multiple, anonymous)
    }
}

/// Форма нового опроса — вкладка «Опрос» листа вложений, как остальные разделы.
struct PollForm: View {
    @Bindable var draft: PollDraft
    @FocusState private var focused: Int?

    var body: some View {
        Form {
            Section(String(localized: "chats.poll.question", defaultValue: "Вопрос")) {
                TextField(String(localized: "chats.poll.questionPlaceholder", defaultValue: "Задайте вопрос"), text: $draft.question, axis: .vertical)
                    .onChange(of: draft.question) { _, value in
                        if value.count > 300 { draft.question = String(value.prefix(300)) }
                    }
                TextField(
                    String(localized: "chats.poll.description", defaultValue: "Пояснение (необязательно)"),
                    text: $draft.details,
                    axis: .vertical
                )
                .lineLimit(1...4)
                .onChange(of: draft.details) { _, value in
                    if value.count > 500 { draft.details = String(value.prefix(500)) }
                }
            }

            Section {
                ForEach(draft.options.indices, id: \.self) { index in
                    HStack(spacing: Spacing.md) {
                        if draft.options.count > 2 {
                            Button {
                                draft.options.remove(at: index)
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
                                get: { draft.options.indices.contains(index) ? draft.options[index] : "" },
                                set: { value in
                                    guard draft.options.indices.contains(index) else { return }
                                    draft.options[index] = String(value.prefix(100))
                                }
                            )
                        )
                        .focused($focused, equals: index)
                        .submitLabel(index == draft.options.count - 1 ? .done : .next)
                        .onSubmit { focused = index + 1 < draft.options.count ? index + 1 : nil }
                    }
                }
                .onDelete { offsets in
                    guard draft.options.count - offsets.count >= 2 else { return }
                    draft.options.remove(atOffsets: offsets)
                }
                if draft.options.count < PollDraft.maxOptions {
                    Button {
                        draft.options.append("")
                        focused = draft.options.count - 1
                    } label: {
                        Label(String(localized: "chats.poll.addOption", defaultValue: "Добавить вариант"), systemImage: "plus.circle.fill")
                    }
                }
            } header: {
                Text(String(localized: "chats.poll.options", defaultValue: "Варианты ответа"))
            } footer: {
                if draft.hasDuplicates {
                    Text(String(localized: "chats.poll.duplicates", defaultValue: "Варианты не должны повторяться"))
                        .foregroundStyle(Palette.destructive)
                } else {
                    Text(String(localized: "chats.poll.optionsHint", defaultValue: "От двух до десяти вариантов. Лишний — смахните влево."))
                }
            }

            Section {
                Toggle(String(localized: "chats.poll.multiple", defaultValue: "Несколько ответов"), isOn: $draft.multiple)
                Toggle(String(localized: "chats.poll.anonymous", defaultValue: "Анонимный опрос"), isOn: $draft.anonymous)
            }
        }
        .scrollContentBackground(.hidden)
    }
}

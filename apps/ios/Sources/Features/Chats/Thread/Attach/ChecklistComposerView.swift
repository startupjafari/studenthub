import Observation
import SwiftUI

/// Черновик общего списка дел: название, пункты, кто может добавлять и отмечать.
/// Живёт в листе вложений, пока он открыт, — переключился на «Галерею» и обратно, а
/// набранное на месте.
@Observable
final class ChecklistDraft {
    static let maxItems = 50

    var title = ""
    var items = ["", ""]
    var othersCanAdd = true
    var othersCanMark = true
    private(set) var isSending = false

    var filled: [String] {
        items.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    var canCreate: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty && !filled.isEmpty && !isSending
    }

    /// `true` — список ушёл, лист можно закрыть.
    @MainActor
    func submit(
        _ create: (_ title: String, _ items: [String], _ othersCanAdd: Bool, _ othersCanMark: Bool) async -> Bool
    ) async -> Bool {
        guard canCreate else { return false }
        isSending = true
        defer { isSending = false }
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return await create(name, filled, othersCanAdd, othersCanMark)
    }
}

/// Форма нового списка — вкладка «Список» листа вложений, как остальные разделы:
/// «Отправить» в шапке листа, переключение разделов капсулой внизу.
struct ChecklistForm: View {
    @Bindable var draft: ChecklistDraft
    @FocusState private var focused: Int?

    var body: some View {
        Form {
            Section(String(localized: "chats.checklist.titleSection", defaultValue: "Название")) {
                TextField(
                    String(localized: "chats.checklist.titlePlaceholder", defaultValue: "Например, «Что взять на практику»"),
                    text: $draft.title
                )
                .onChange(of: draft.title) { _, value in
                    if value.count > 200 { draft.title = String(value.prefix(200)) }
                }
            }

            Section {
                ForEach(draft.items.indices, id: \.self) { index in
                    HStack(spacing: Spacing.md) {
                        Image(systemName: "circle")
                            .foregroundStyle(Palette.mutedForeground)
                            .accessibilityHidden(true)
                        TextField(
                            String(localized: "chats.checklist.item", defaultValue: "Пункт \(index + 1)"),
                            text: Binding(
                                get: { draft.items.indices.contains(index) ? draft.items[index] : "" },
                                set: { value in
                                    guard draft.items.indices.contains(index) else { return }
                                    draft.items[index] = String(value.prefix(200))
                                }
                            )
                        )
                        .focused($focused, equals: index)
                        .submitLabel(.next)
                        .onSubmit { next(after: index) }
                        if draft.items.count > 1 {
                            Button {
                                draft.items.remove(at: index)
                            } label: {
                                Image(systemName: "minus.circle.fill")
                                    .foregroundStyle(Palette.destructive)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(String(localized: "chats.checklist.remove", defaultValue: "Убрать пункт")))
                        }
                    }
                }
                if draft.items.count < ChecklistDraft.maxItems {
                    Button {
                        draft.items.append("")
                        focused = draft.items.count - 1
                    } label: {
                        Label(String(localized: "chats.checklist.add", defaultValue: "Добавить пункт"), systemImage: "plus.circle.fill")
                    }
                }
            } header: {
                Text(String(localized: "chats.checklist.items", defaultValue: "Пункты"))
            }

            Section {
                Toggle(String(localized: "chats.checklist.othersCanAdd", defaultValue: "Другие могут добавлять пункты"), isOn: $draft.othersCanAdd)
                Toggle(String(localized: "chats.checklist.othersCanMark", defaultValue: "Другие могут отмечать выполненное"), isOn: $draft.othersCanMark)
            }
        }
        .scrollContentBackground(.hidden)
    }

    /// «Далее» на последнем пункте добавляет новый — список набирается без мыши.
    private func next(after index: Int) {
        if index + 1 < draft.items.count {
            focused = index + 1
        } else if draft.items.count < ChecklistDraft.maxItems,
            !draft.items[index].trimmingCharacters(in: .whitespaces).isEmpty
        {
            draft.items.append("")
            focused = draft.items.count - 1
        } else {
            focused = nil
        }
    }
}

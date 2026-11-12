import SwiftUI

/// Новый общий список дел: название, пункты, кто может добавлять и отмечать. Как опрос —
/// отдельным листом поверх переписки.
struct ChecklistComposerView: View {
    let create: (_ title: String, _ items: [String], _ othersCanAdd: Bool, _ othersCanMark: Bool) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var items = ["", ""]
    @State private var othersCanAdd = true
    @State private var othersCanMark = true
    @State private var isSending = false
    @FocusState private var focused: Int?

    static let maxItems = 50

    private var filled: [String] {
        items.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    private var canCreate: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty && !filled.isEmpty && !isSending
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(String(localized: "chats.checklist.titleSection", defaultValue: "Название")) {
                    TextField(
                        String(localized: "chats.checklist.titlePlaceholder", defaultValue: "Например, «Что взять на практику»"),
                        text: $title
                    )
                    .onChange(of: title) { _, value in
                        if value.count > 200 { title = String(value.prefix(200)) }
                    }
                }

                Section {
                    ForEach(items.indices, id: \.self) { index in
                        HStack(spacing: Spacing.md) {
                            Image(systemName: "circle")
                                .foregroundStyle(Palette.mutedForeground)
                                .accessibilityHidden(true)
                            TextField(
                                String(localized: "chats.checklist.item", defaultValue: "Пункт \(index + 1)"),
                                text: Binding(
                                    get: { items.indices.contains(index) ? items[index] : "" },
                                    set: { value in
                                        guard items.indices.contains(index) else { return }
                                        items[index] = String(value.prefix(200))
                                    }
                                )
                            )
                            .focused($focused, equals: index)
                            .submitLabel(.next)
                            .onSubmit { next(after: index) }
                            if items.count > 1 {
                                Button {
                                    items.remove(at: index)
                                } label: {
                                    Image(systemName: "minus.circle.fill")
                                        .foregroundStyle(Palette.destructive)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(Text(String(localized: "chats.checklist.remove", defaultValue: "Убрать пункт")))
                            }
                        }
                    }
                    if items.count < Self.maxItems {
                        Button {
                            items.append("")
                            focused = items.count - 1
                        } label: {
                            Label(String(localized: "chats.checklist.add", defaultValue: "Добавить пункт"), systemImage: "plus.circle.fill")
                        }
                    }
                } header: {
                    Text(String(localized: "chats.checklist.items", defaultValue: "Пункты"))
                }

                Section {
                    Toggle(String(localized: "chats.checklist.othersCanAdd", defaultValue: "Другие могут добавлять пункты"), isOn: $othersCanAdd)
                    Toggle(String(localized: "chats.checklist.othersCanMark", defaultValue: "Другие могут отмечать выполненное"), isOn: $othersCanMark)
                }
            }
            .navigationTitle(Text(String(localized: "chats.checklist.new", defaultValue: "Список")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSending {
                        ProgressView()
                    } else {
                        Button(String(localized: "chats.send", defaultValue: "Отправить")) {
                            Task { await submit() }
                        }
                        .disabled(!canCreate)
                    }
                }
            }
            .onAppear { focused = nil }
        }
    }

    /// «Далее» на последнем пункте добавляет новый — список набирается без мыши.
    private func next(after index: Int) {
        if index + 1 < items.count {
            focused = index + 1
        } else if items.count < Self.maxItems, !items[index].trimmingCharacters(in: .whitespaces).isEmpty {
            items.append("")
            focused = items.count - 1
        } else {
            focused = nil
        }
    }

    @MainActor
    private func submit() async {
        isSending = true
        defer { isSending = false }
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if await create(name, filled, othersCanAdd, othersCanMark) {
            dismiss()
        }
    }
}

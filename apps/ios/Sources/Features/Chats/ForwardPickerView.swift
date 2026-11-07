import SwiftUI

/// Куда переслать: несколько чатов разом, «Избранное» первым — так же, как в вебе.
/// Список читается из базы: пересылают в знакомые чаты, а сеть для выбора не нужна.
struct ForwardPickerView: View {
    let excludedChatID: String
    let send: ([String]) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var rows: [ChatListRow] = []
    @State private var selected: Set<String> = []
    @State private var query = ""
    @State private var isSending = false
    @State private var sentTick = 0

    var body: some View {
        NavigationStack {
            List(filtered) { row in
                Button {
                    if selected.contains(row.id) { selected.remove(row.id) } else { selected.insert(row.id) }
                } label: {
                    HStack(spacing: Spacing.lg) {
                        ChatAvatarView(title: row.title, kind: row.kind, avatarURL: row.avatarUrl, size: 40)
                        Text(row.displayTitle)
                            .foregroundStyle(Palette.foreground)
                            .lineLimit(1)
                        Spacer()
                        Image(systemName: selected.contains(row.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selected.contains(row.id) ? Palette.primary : Palette.mutedForeground)
                            .font(.title3)
                    }
                }
                .accessibilityAddTraits(selected.contains(row.id) ? .isSelected : [])
            }
            .searchable(text: $query, prompt: Text(String(localized: "chats.forward.search", defaultValue: "Поиск")))
            .navigationTitle(Text(String(localized: "chats.forward", defaultValue: "Переслать")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "common.cancel", defaultValue: "Отменить")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            isSending = true
                            let ok = await send(Array(selected))
                            isSending = false
                            if ok {
                                sentTick += 1
                                dismiss()
                            }
                        }
                    } label: {
                        if isSending { ProgressView() } else {
                            Text(String(localized: "chats.send", defaultValue: "Отправить"))
                        }
                    }
                    .disabled(selected.isEmpty || isSending)
                }
            }
            .sensoryFeedback(.success, trigger: sentTick)
            .task { await load() }
        }
    }

    private var filtered: [ChatListRow] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return rows }
        return rows.filter { $0.displayTitle.localizedCaseInsensitiveContains(trimmed) }
    }

    private func load() async {
        let all = (try? await AppServices.database.reader.read { db in
            try ChatListQuery.rows(for: .all).fetchAll(db)
        }) ?? []
        let candidates = all.filter { $0.id != excludedChatID }
        rows = candidates.filter { $0.kind == .saved } + candidates.filter { $0.kind != .saved }
    }
}

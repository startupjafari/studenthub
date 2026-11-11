import SwiftUI

/// «Прочитали» своего сообщения в группе, как в Telegram: аватар, имя и когда
/// прочитал, свежие сверху.
///
/// Список берётся у модели переписки: она держит снимок `GET /chats/:id/reads` и
/// накладывает на него события прочтения. При открытии снимок освежается — в меню
/// могло быть число из старого.
struct MessageReadersSheet: View {
    let model: ChatThreadModel
    let message: MessageRecord

    @Environment(\.dismiss) private var dismiss
    @State private var isLoading = true

    private var readers: [MessageReader] { model.readers(of: message) }

    var body: some View {
        NavigationStack {
            List {
                ForEach(readers) { reader in
                    PersonRow(
                        name: reader.name.isEmpty
                            ? String(localized: "home.someone", defaultValue: "Кто-то")
                            : reader.name,
                        avatarURL: reader.avatarURL,
                        trailing: Self.moment(reader.readAt)
                    )
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if readers.isEmpty {
                    if isLoading {
                        LoadingStateView()
                    } else if let failure = model.readsFailure {
                        ErrorStateView(message: failure, isOffline: model.readsOffline) {
                            await load()
                        }
                    } else {
                        EmptyStateView(
                            title: String(localized: "chats.readBy.none", defaultValue: "Пока никто не прочитал"),
                            symbol: "checkmark.message"
                        )
                    }
                }
            }
            .navigationTitle(Text(String(localized: "chats.readBy.title", defaultValue: "Прочитали")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    private func load() async {
        isLoading = true
        await model.loadReads()
        isLoading = false
    }

    /// Сегодня — только время, раньше — дата и время.
    private static func moment(_ date: Date) -> String {
        Calendar.current.isDateInToday(date)
            ? date.formatted(date: .omitted, time: .shortened)
            : date.formatted(date: .abbreviated, time: .shortened)
    }
}

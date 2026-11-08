import SwiftUI

/// «Отправить в чат»: выбор чата и необязательный комментарий (`POST /chats/:id/share-post`).
struct CommunitySharePostView: View {
    let postID: String

    @Environment(\.dismiss) private var dismiss
    @State private var chats: [CommunityChatDTO]?
    @State private var failure: String?
    @State private var search = ""
    @State private var comment = ""
    @State private var sending: String?
    @State private var sent = 0

    var body: some View {
        NavigationStack {
            List {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    TextField(String(localized: "community.share.comment", defaultValue: "Комментарий (необязательно)"), text: $comment, axis: .vertical)
                        .lineLimit(1...4)
                }
                if let chats {
                    let visible = filtered(chats)
                    if visible.isEmpty {
                        EmptyStateView(
                            title: String(localized: "community.share.noChats", defaultValue: "Подходящих чатов нет"),
                            symbol: "bubble.left.and.bubble.right"
                        )
                        .listRowBackground(Color.clear)
                    }
                    Section {
                        ForEach(visible) { chat in
                            Button {
                                Task { await send(to: chat) }
                            } label: {
                                HStack {
                                    PersonRow(
                                        name: chat.title ?? String(localized: "community.share.untitled", defaultValue: "Чат"),
                                        subtitle: chat.memberCount.flatMap { $0 > 2 ? String(localized: "community.share.members", defaultValue: "Участников: \($0.formatted())") : nil },
                                        avatarURL: chat.avatarUrl,
                                        size: 44
                                    )
                                    if sending == chat.id { ProgressView() }
                                }
                            }
                            .buttonStyle(.plain)
                            .disabled(sending != nil)
                        }
                    }
                } else {
                    LoadingStateView().listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .searchable(
                text: $search,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(String(localized: "community.share.search", defaultValue: "Найти чат"))
            )
            .navigationTitle(Text(String(localized: "community.share.title", defaultValue: "Отправить в чат")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .sensoryFeedback(.success, trigger: sent)
            .task { await load() }
        }
    }

    /// Архивные и заблокированные — вниз и прочь: в них не пишут.
    private func filtered(_ chats: [CommunityChatDTO]) -> [CommunityChatDTO] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        return chats
            .filter { $0.archived != true && $0.blocked != true }
            .filter { needle.isEmpty || ($0.title ?? "").lowercased().contains(needle) }
            .sorted { ($0.pinned == true ? 0 : 1) < ($1.pinned == true ? 0 : 1) }
    }

    @MainActor
    private func load() async {
        do {
            chats = try await CommunityAPI().chats()
            failure = nil
        } catch {
            failure = error.userMessage
            chats = []
        }
    }

    @MainActor
    private func send(to chat: CommunityChatDTO) async {
        sending = chat.id
        defer { sending = nil }
        let note = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await CommunityAPI().sharePost(postID: postID, chatID: chat.id, comment: note.isEmpty ? nil : String(note.prefix(4000)))
            sent += 1
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}

import SwiftUI

/// Экран переписки: лента сверху, поле ввода снизу.
struct ChatThreadView: View {
    let chatID: String
    let viewerID: String

    @State private var model: ChatThreadModel?

    var body: some View {
        VStack(spacing: 0) {
            if let model {
                if let failure = model.failure {
                    FormAlert(message: failure)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.top, Spacing.md)
                }

                MessageListView(
                    days: model.days,
                    anchor: model.openingAnchor,
                    onReachTop: { Task { await model.loadOlder() } },
                    onRetry: { message in Task { await model.retry(message) } },
                    onReply: { message in model.reply(to: message) }
                )

                MessageComposerView(model: model)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(model?.title ?? String(localized: "shell.chat", defaultValue: "Чат")))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard model == nil else { return }
            let created = ChatThreadModel(chatID: chatID, viewerID: viewerID)
            model = created
            created.start()
            await created.open()
        }
    }
}

import PhotosUI
import SwiftUI

/// Новая публикация.
///
/// Студенту сервер разрешает две аудитории: свою группу и одного человека лично
/// (`PERSONAL`). Текст — тот же ограниченный Markdown, что и в вебе; фото и видео —
/// до десяти, с превью и удалением до отправки.
struct PostComposerView: View {
    let feed: FeedModel

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var picks: [PhotosPickerItem] = []
    @State private var media: [PreparedMedia] = []
    @State private var recipient: SearchResultsDTO.Person?
    @State private var personal = false
    @State private var isPreparing = false
    @State private var isPublishing = false
    @State private var failure: String?
    @State private var published = 0
    @FocusState private var focused: Bool

    private let api: FeedFetching = FeedAPI()
    private static let maxMedia = 10
    private static let maxLength = 5000

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    audiencePicker

                    TextField(
                        String(localized: "composer.placeholder", defaultValue: "Что нового?"),
                        text: $text,
                        axis: .vertical
                    )
                    .font(Typography.body)
                    .lineLimit(5...)
                    .focused($focused)

                    if !media.isEmpty || isPreparing {
                        attachments
                    }

                    if let failure {
                        FormAlert(message: failure)
                    }
                }
                .padding(Spacing.xl)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Palette.background)
            .safeAreaInset(edge: .bottom, spacing: 0) { bottomBar }
            .navigationTitle(Text(String(localized: "composer.title", defaultValue: "Новая публикация")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "common.cancel", defaultValue: "Отменить")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await publish() }
                    } label: {
                        if isPublishing {
                            ProgressView()
                        } else {
                            Text(String(localized: "stories.publish", defaultValue: "Опубликовать"))
                        }
                    }
                    .disabled(!canPublish)
                }
            }
            .navigationDestination(isPresented: $personal) {
                RecipientPicker { person in
                    recipient = person
                    personal = false
                }
            }
            .onChange(of: picks) { _, items in
                Task { await load(items) }
            }
            .interactiveDismissDisabled(isPublishing || !trimmed.isEmpty || !media.isEmpty)
            .sensoryFeedback(.success, trigger: published)
            .onAppear { focused = true }
        }
    }

    private var audiencePicker: some View {
        Menu {
            Button {
                recipient = nil
            } label: {
                Label(String(localized: "audience.myGroup", defaultValue: "Моя группа"), systemImage: "person.3")
            }
            Button {
                personal = true
            } label: {
                Label(String(localized: "audience.toPerson", defaultValue: "Лично человеку…"), systemImage: "lock")
            }
        } label: {
            HStack(spacing: Spacing.sm) {
                Image(systemName: recipient == nil ? "person.3" : "lock")
                Text(recipient?.name ?? String(localized: "audience.myGroup", defaultValue: "Моя группа"))
                    .lineLimit(1)
                Image(systemName: "chevron.down").font(.caption.weight(.bold))
            }
            .font(Typography.meta.weight(.medium))
            .padding(.horizontal, Spacing.lg)
            .frame(height: ControlHeight.md)
            .background(Palette.primary.opacity(0.12), in: Capsule())
            .foregroundStyle(Palette.primary)
        }
        .accessibilityLabel(Text(String(localized: "composer.audience", defaultValue: "Кому видна публикация")))
    }

    private var attachments: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.md) {
                ForEach(media) { item in
                    ZStack(alignment: .topTrailing) {
                        Group {
                            if let preview = item.preview {
                                Image(uiImage: preview).resizable().scaledToFill()
                            } else {
                                Palette.muted
                            }
                        }
                        .frame(width: 96, height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                        .overlay {
                            if item.isVideo {
                                Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(.white)
                            }
                        }

                        Button {
                            media.removeAll { $0.id == item.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .black.opacity(0.6))
                                .font(.title3)
                        }
                        .buttonStyle(.plain)
                        .padding(Spacing.xs)
                        .accessibilityLabel(Text(String(localized: "composer.removeMedia", defaultValue: "Убрать вложение")))
                    }
                }
                if isPreparing {
                    ProgressView()
                        .frame(width: 96, height: 96)
                        .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                }
            }
        }
    }

    private var bottomBar: some View {
        HStack(spacing: Spacing.lg) {
            PhotosPicker(
                selection: $picks,
                maxSelectionCount: max(Self.maxMedia - media.count, 1),
                matching: .any(of: [.images, .videos])
            ) {
                Image(systemName: "photo.on.rectangle")
                    .font(.title3)
                    .frame(width: ControlHeight.xl, height: ControlHeight.xl)
            }
            .disabled(media.count >= Self.maxMedia || isPreparing)
            .accessibilityLabel(Text(String(localized: "composer.addMedia", defaultValue: "Добавить фото или видео")))

            Spacer()

            Text(verbatim: "\(trimmed.count)/\(Self.maxLength)")
                .font(Typography.tabular(Typography.meta))
                .foregroundStyle(trimmed.count > Self.maxLength ? Palette.destructive : Palette.mutedForeground)
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.sm)
        .background(.bar)
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var canPublish: Bool {
        !isPublishing && !isPreparing && !trimmed.isEmpty && trimmed.count <= Self.maxLength
    }

    private func load(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        isPreparing = true
        defer {
            isPreparing = false
            picks = []
        }
        for item in items.prefix(Self.maxMedia - media.count) {
            do {
                media.append(try await MediaPreparation.prepare(item))
            } catch {
                failure = (error as? LocalizedError)?.errorDescription
            }
        }
    }

    private func publish() async {
        isPublishing = true
        defer { isPublishing = false }
        do {
            var ids: [String] = []
            for item in media {
                ids.append(try await api.upload(item.data, mime: item.mime, filename: item.filename, bucket: .posts).id)
            }
            let post = try await api.createPost(content: trimmed, mediaIDs: ids, targetUserID: recipient?.id)
            // В свою ленту пост встаёт сразу; личный — тоже: автор видит свои посты.
            feed.insert(post)
            published += 1
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}

/// Выбор адресата личной публикации — поиском людей.
private struct RecipientPicker: View {
    let pick: (SearchResultsDTO.Person) -> Void

    @State private var query = ""
    @State private var people: [SearchResultsDTO.Person] = []
    private let api: FeedFetching = FeedAPI()

    var body: some View {
        List(people) { person in
            Button {
                pick(person)
            } label: {
                HStack(spacing: Spacing.lg) {
                    AvatarView(url: person.avatarUrl, name: person.name, size: 36)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(person.name).foregroundStyle(Palette.foreground)
                        if let username = person.username {
                            Text(verbatim: "@\(username)")
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                }
            }
        }
        .overlay {
            if people.isEmpty {
                ContentUnavailableView(
                    query.count < 2
                        ? String(localized: "search.hint", defaultValue: "Введите хотя бы две буквы")
                        : String(localized: "search.empty", defaultValue: "Никого не нашли"),
                    systemImage: "person.crop.circle.badge.questionmark"
                )
            }
        }
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text(String(localized: "search.people", defaultValue: "Имя или логин"))
        )
        .navigationTitle(Text(String(localized: "audience.toPerson", defaultValue: "Лично человеку…")))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: query) {
            let trimmed = query.trimmingCharacters(in: .whitespaces)
            guard trimmed.count >= 2 else {
                people = []
                return
            }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            people = (try? await api.search(trimmed).people) ?? []
        }
    }
}

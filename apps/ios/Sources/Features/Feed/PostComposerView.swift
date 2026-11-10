import PhotosUI
import SwiftUI

/// Новая публикация.
///
/// Аудитории — по роли, как в вебе (`AUDIENCES_BY_ROLE`): студент и староста пишут в
/// свою группу или лично человеку, преподаватель — в группу или по дисциплине, деканат и
/// администрация вуза — шире. Есть заголовок, черновик и отложенная публикация. Текст —
/// тот же ограниченный Markdown, что и в вебе; фото и видео — до десяти.
struct PostComposerView: View {
    let feed: FeedModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.viewerRole) private var role
    @State private var title = ""
    @State private var text = ""
    @State private var picks: [PhotosPickerItem] = []
    @State private var media: [PreparedMedia] = []
    @State private var audience = ""
    @State private var recipient: SearchResultsDTO.Person?
    @State private var personal = false
    @State private var groupID = ""
    @State private var facultyID = ""
    @State private var subject = ""
    @State private var groups: [CommunityGroupDTO] = []
    @State private var faculties: [CommunityFacultyDTO] = []
    @State private var scheduling = false
    @State private var scheduledAt = Date().addingTimeInterval(3600)
    @State private var isPreparing = false
    @State private var isPublishing = false
    @State private var failure: String?
    @State private var published = 0
    @State private var confirmingDiscard = false

    private var hasDraft: Bool { !trimmed.isEmpty || !media.isEmpty }
    @FocusState private var focused: Bool

    private let api: FeedFetching = FeedAPI()
    private static let maxMedia = 10
    private static let maxLength = 5000

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    audiencePicker
                    targetPicker

                    TextField(
                        String(localized: "community.composer.title", defaultValue: "Заголовок (необязательно)"),
                        text: $title,
                        axis: .vertical
                    )
                    .font(Typography.sectionTitle)
                    .lineLimit(1...3)

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

                    if scheduling {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            DatePicker(
                                String(localized: "community.composer.scheduleAt", defaultValue: "Опубликовать"),
                                selection: $scheduledAt,
                                in: Date().addingTimeInterval(60)...
                            )
                            Text(String(localized: "community.composer.scheduleHint", defaultValue: "Пост выйдет сам в указанное время. До этого его видите только вы."))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        .padding(Spacing.lg)
                        .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))
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
                    // Смахнуть написанное нельзя (`interactiveDismissDisabled` ниже), и
                    // крестик не должен молча делать то, от чего защищён жест.
                    SheetCloseButton {
                        if hasDraft { confirmingDiscard = true } else { dismiss() }
                    }
                    .disabled(isPublishing)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await publish(status: "PUBLISHED") }
                    } label: {
                        if isPublishing {
                            ProgressView()
                        } else if scheduling {
                            Text(String(localized: "community.composer.schedule", defaultValue: "Запланировать"))
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
                    audience = "PERSONAL"
                    personal = false
                }
            }
            .onChange(of: picks) { _, items in
                Task { await load(items) }
            }
            .interactiveDismissDisabled(isPublishing || hasDraft)
            .discardChangesDialog(isPresented: $confirmingDiscard) { dismiss() }
            .sensoryFeedback(.success, trigger: published)
            .onAppear {
                focused = true
                if audience.isEmpty { audience = audiences.first ?? "GROUP" }
            }
            .task {
                if CommunityPostAudience.picksGroup(role) { groups = (try? await CommunityAPI().groups()) ?? [] }
                if role == .universityAdmin { faculties = (try? await CommunityAPI().faculties()) ?? [] }
            }
        }
    }

    private var audiences: [String] {
        let list = CommunityPostAudience.allowed(for: role)
        return list.isEmpty ? ["GROUP", "PERSONAL"] : list
    }

    private var audienceTitle: String {
        if audience == "PERSONAL", let recipient { return recipient.name }
        if audience == "GROUP", !CommunityPostAudience.picksGroup(role) {
            return String(localized: "audience.myGroup", defaultValue: "Моя группа")
        }
        return CommunityText.audience(audience.isEmpty ? (audiences.first ?? "GROUP") : audience)
    }

    private var audiencePicker: some View {
        Menu {
            ForEach(audiences, id: \.self) { option in
                Button {
                    if option == "PERSONAL" {
                        personal = true
                    } else {
                        audience = option
                        recipient = nil
                    }
                } label: {
                    Label(
                        option == "PERSONAL"
                            ? String(localized: "audience.toPerson", defaultValue: "Лично человеку…")
                            : option == "GROUP" && !CommunityPostAudience.picksGroup(role)
                                ? String(localized: "audience.myGroup", defaultValue: "Моя группа")
                                : CommunityText.audience(option),
                        systemImage: CommunityText.audienceSymbol(option)
                    )
                }
            }
        } label: {
            HStack(spacing: Spacing.sm) {
                Image(systemName: CommunityText.audienceSymbol(audience))
                Text(audienceTitle).lineLimit(1)
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

    /// Уточнение аудитории: какая группа, какой факультет, какая дисциплина.
    @ViewBuilder
    private var targetPicker: some View {
        if audience == "GROUP", CommunityPostAudience.picksGroup(role) {
            Picker(String(localized: "community.event.group", defaultValue: "Группа"), selection: $groupID) {
                Text(String(localized: "community.composer.chooseGroup", defaultValue: "Выберите группу")).tag("")
                ForEach(groups) { Text($0.name).tag($0.id) }
            }
            .pickerStyle(.menu)
        } else if audience == "FACULTY", role == .universityAdmin {
            Picker(String(localized: "community.event.faculty", defaultValue: "Факультет"), selection: $facultyID) {
                Text(String(localized: "community.composer.chooseFaculty", defaultValue: "Выберите факультет")).tag("")
                ForEach(faculties) { Text($0.name).tag($0.id) }
            }
            .pickerStyle(.menu)
        } else if audience == "SUBJECT" {
            TextField(String(localized: "community.composer.subject", defaultValue: "Дисциплина"), text: $subject)
                .padding(Spacing.md)
                .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        }
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

            Button {
                scheduling.toggle()
            } label: {
                Image(systemName: scheduling ? "clock.fill" : "clock")
                    .font(.title3)
                    .frame(width: ControlHeight.xl, height: ControlHeight.xl)
            }
            .accessibilityLabel(Text(String(localized: "community.composer.schedule", defaultValue: "Запланировать")))

            Button {
                Task { await publish(status: "DRAFT") }
            } label: {
                Image(systemName: "square.and.arrow.down")
                    .font(.title3)
                    .frame(width: ControlHeight.xl, height: ControlHeight.xl)
            }
            .disabled(!canPublish)
            .accessibilityLabel(Text(String(localized: "community.composer.saveDraft", defaultValue: "Сохранить черновик")))

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
    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var targetReady: Bool {
        switch audience {
        case "PERSONAL": return recipient != nil
        case "GROUP": return !CommunityPostAudience.picksGroup(role) || !groupID.isEmpty
        case "FACULTY": return role != .universityAdmin || !facultyID.isEmpty
        case "SUBJECT": return !subject.trimmingCharacters(in: .whitespaces).isEmpty
        default: return true
        }
    }

    private var canPublish: Bool {
        !isPublishing && !isPreparing && !trimmed.isEmpty && trimmed.count <= Self.maxLength
            && trimmedTitle.count <= 200 && targetReady
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

    private func publish(status: String) async {
        isPublishing = true
        defer { isPublishing = false }
        do {
            var ids: [String] = []
            for item in media {
                ids.append(try await api.upload(item.data, mime: item.mime, filename: item.filename, bucket: .posts).id)
            }
            let chosen = audience.isEmpty ? (audiences.first ?? "GROUP") : audience
            let input = CommunityPostInput(
                audience: chosen,
                title: trimmedTitle.isEmpty ? nil : trimmedTitle,
                content: trimmed,
                facultyId: chosen == "FACULTY" && !facultyID.isEmpty ? facultyID : nil,
                groupId: chosen == "GROUP" && !groupID.isEmpty ? groupID : nil,
                targetUserId: chosen == "PERSONAL" ? recipient?.id : nil,
                subject: chosen == "SUBJECT" ? subject.trimmingCharacters(in: .whitespaces) : nil,
                mediaIds: ids.isEmpty ? nil : ids,
                status: status,
                scheduledAt: status == "PUBLISHED" && scheduling ? scheduledAt : nil
            )
            let post = try await CommunityAPI().createPost(input)
            // В ленту встаёт только вышедший пост: черновик и отложенный живут в
            // «Черновиках и отложенных» профиля.
            if post.status == nil || post.status == "PUBLISHED" { feed.insert(post) }
            published += 1
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}

/// Аудитории публикации по роли — зеркало `ALLOWED_AUDIENCES` сервера.
enum CommunityPostAudience {
    static func allowed(for role: Role) -> [String] {
        switch role {
        case .platformAdmin: return ["ALL", "PERSONAL"]
        case .universityAdmin: return ["UNIVERSITY", "FACULTY", "GROUP", "TEACHERS", "PERSONAL"]
        case .dean: return ["FACULTY", "GROUP", "PERSONAL"]
        case .teacher: return ["GROUP", "SUBJECT", "PERSONAL"]
        case .starosta, .student: return ["GROUP", "PERSONAL"]
        case .employer: return ["COMPANY"]
        default: return []
        }
    }

    /// Кто выбирает группу сам: у студента и старосты группа своя.
    static func picksGroup(_ role: Role) -> Bool {
        role == .universityAdmin || role == .dean || role == .teacher
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

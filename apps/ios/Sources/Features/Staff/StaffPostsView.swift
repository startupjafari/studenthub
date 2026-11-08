import PhotosUI
import SwiftUI

// Публикации от имени вуза и деканата (веб — `FeedView` у админа вуза и декана): разделы
// ленты и «Модерация», создание поста с аудиторией, правка, удаление, закрепление.
// Карточки и действия над постом — общие с лентой (`PostCardView`, `PostActionsHost`).

enum StaffPostText {
    static func audience(_ raw: String) -> String {
        switch raw {
        case "ALL": return String(localized: "staff.post.audience.all", defaultValue: "Всем")
        case "UNIVERSITY": return String(localized: "staff.post.audience.university", defaultValue: "Университет")
        case "FACULTY": return String(localized: "staff.post.audience.faculty", defaultValue: "Факультет")
        case "GROUP": return String(localized: "staff.post.audience.group", defaultValue: "Группа")
        case "SUBJECT": return String(localized: "staff.post.audience.subject", defaultValue: "Весь вуз · предмет")
        case "TEACHERS": return String(localized: "staff.post.audience.teachers", defaultValue: "Преподаватели")
        case "PERSONAL": return String(localized: "staff.post.audience.personal", defaultValue: "Лично")
        default: return raw
        }
    }

    static func filter(_ raw: String) -> String {
        switch raw {
        case "GROUP": return String(localized: "staff.post.filter.group", defaultValue: "Моя группа")
        case "UNIVERSITY": return String(localized: "staff.post.filter.university", defaultValue: "Университет")
        case "TEACHERS": return String(localized: "staff.post.filter.teachers", defaultValue: "Преподаватели")
        case "IMPORTANT": return String(localized: "staff.post.filter.important", defaultValue: "Важное")
        case "SAVED": return String(localized: "staff.post.filter.saved", defaultValue: "Сохранённое")
        case "MODERATION": return String(localized: "staff.post.filter.moderation", defaultValue: "Модерация")
        default: return String(localized: "staff.post.filter.all", defaultValue: "Все")
        }
    }

    /// Кому роль вправе адресовать пост (веб — `AUDIENCES_BY_ROLE`). Сервер проверяет то же.
    static func audiences(for role: Role) -> [String] {
        switch role {
        case .platformAdmin: return ["ALL", "PERSONAL"]
        case .universityAdmin: return ["UNIVERSITY", "FACULTY", "GROUP", "TEACHERS", "PERSONAL"]
        case .dean: return ["FACULTY", "GROUP", "PERSONAL"]
        case .teacher: return ["GROUP", "SUBJECT", "PERSONAL"]
        case .starosta, .student: return ["GROUP", "PERSONAL"]
        default: return []
        }
    }
}

// MARK: - Лента

struct StaffPostsView: View {
    @Environment(\.viewerRole) private var role
    @Environment(\.viewerID) private var viewerID
    @State private var picked: String?
    @State private var model = FeedModel()
    @State private var composing = false

    /// Модераторы посты не пишут — только читают и модерируют.
    private var canPost: Bool { role != .platformModerator && role != .universityModerator }

    private var canModerate: Bool {
        [.platformAdmin, .platformModerator, .universityAdmin, .universityModerator, .dean].contains(role)
    }

    /// Модератору без права публиковать модерация — основная работа: раздел первым и
    /// открыт сразу. Админу и декану лента остаётся своей, «Модерация» — последней.
    private var filters: [String] {
        let base = ["ALL", "GROUP", "UNIVERSITY", "TEACHERS", "IMPORTANT", "SAVED"]
        guard canModerate else { return base }
        return canPost ? base + ["MODERATION"] : ["MODERATION"] + base
    }

    private var filter: String { picked ?? (canModerate && !canPost ? "MODERATION" : "ALL") }

    var body: some View {
        PostActionsHost(model: model) { actions in
            ScrollView {
                LazyVStack(spacing: Spacing.lg) {
                    FilterChips(
                        options: filters.map { (Optional($0), StaffPostText.filter($0)) },
                        selection: Binding(get: { Optional(filter) }, set: { picked = $0 ?? "ALL" })
                    )
                    .padding(.horizontal, Spacing.xl)
                    feed(actions)
                }
                .padding(.vertical, Spacing.md)
            }
            .background(Palette.background)
            .refreshable { await model.refresh() }
        }
        .navigationTitle(Text(StaffScreen.posts.title))
        .adminFloatingAction(canPost, String(localized: "staff.post.new", defaultValue: "Новая публикация"), symbol: "square.and.pencil") {
            composing = true
        }
        .sheet(isPresented: $composing) {
            StaffPostComposerSheet(role: role) { post in
                if let post { model.insert(post) }
            }
        }
        .task(id: filter) {
            model = FeedModel(api: FeedAPI(scope: Self.scope(filter)))
            await model.refresh()
        }
    }

    private static func scope(_ filter: String) -> FeedScope {
        switch filter {
        case "ALL": return .all
        case "SAVED": return .saved
        default: return .filter(filter)
        }
    }

    @ViewBuilder
    private func feed(_ actions: PostCardActions) -> some View {
        if !model.hasLoaded {
            ForEach(0..<2, id: \.self) { _ in PostCardSkeleton() }
                .padding(.horizontal, Spacing.xl)
        } else if let failure = model.failure, model.posts.isEmpty {
            ErrorStateView(message: failure, isOffline: model.isOffline) { await model.refresh() }
        } else if model.posts.isEmpty {
            EmptyStateView(
                title: String(localized: "staff.post.empty", defaultValue: "Лента пуста"),
                symbol: "newspaper",
                hint: String(localized: "staff.post.empty.hint", defaultValue: "Здесь появятся посты")
            )
        } else {
            ForEach(model.posts) { post in
                PostCardView(post: post, model: model, viewerID: viewerID, actions: actions)
                    .padding(.horizontal, Spacing.xl)
                    .onAppear {
                        if post.id == model.posts.last?.id {
                            Task { await model.loadMore() }
                        }
                    }
            }
            if model.isLoadingMore { ProgressView().padding(Spacing.lg) }
        }
    }
}

// MARK: - Новая публикация

private struct StaffPostComposerSheet: View {
    let role: Role
    let created: (PostDTO?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var audience = ""
    @State private var asUniversity = false
    @State private var title = ""
    @State private var content = ""
    @State private var subject = ""
    @State private var faculty: StaffFaculty?
    @State private var group: StaffGroup?
    @State private var person: StaffUserPick?
    @State private var faculties: [StaffFaculty] = []
    @State private var schedule = false
    @State private var scheduledAt = Date().addingTimeInterval(60 * 60)
    @State private var picks: [PhotosPickerItem] = []
    @State private var media: [PreparedMedia] = []
    @State private var isPreparing = false
    @State private var isSaving = false
    @State private var failure: String?
    @State private var notice: String?
    @State private var pickingGroup = false
    @State private var pickingPerson = false

    private let api = StaffAPI()
    private static let maxMedia = 10

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                audienceSection
                Section {
                    TextField(String(localized: "staff.post.titleField", defaultValue: "Заголовок (необязательно)"), text: $title)
                    TextField(String(localized: "staff.post.content", defaultValue: "Текст"), text: $content, axis: .vertical)
                        .lineLimit(5...14)
                } footer: {
                    Text(verbatim: "\(content.count.formatted())/5000")
                }

                Section {
                    if !media.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Spacing.sm) {
                                ForEach(media) { item in
                                    ZStack(alignment: .topTrailing) {
                                        Group {
                                            if let preview = item.preview {
                                                Image(uiImage: preview).resizable().scaledToFill()
                                            } else {
                                                Image(systemName: item.isVideo ? "video" : "photo")
                                                    .foregroundStyle(Palette.mutedForeground)
                                            }
                                        }
                                        .frame(width: 72, height: 72)
                                        .background(Palette.muted)
                                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                                        Button {
                                            media.removeAll { $0.id == item.id }
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundStyle(.white, .black.opacity(0.6))
                                        }
                                        .buttonStyle(.plain)
                                        .padding(2)
                                    }
                                }
                            }
                        }
                    }
                    PhotosPicker(
                        selection: $picks,
                        maxSelectionCount: max(Self.maxMedia - media.count, 1),
                        matching: .any(of: [.images, .videos])
                    ) {
                        if isPreparing {
                            ProgressView()
                        } else {
                            Label(String(localized: "staff.post.addMedia", defaultValue: "Добавить фото или видео"), systemImage: "photo.on.rectangle")
                        }
                    }
                    .disabled(media.count >= Self.maxMedia || isPreparing)
                }

                Section {
                    Toggle(String(localized: "staff.post.schedule", defaultValue: "Отложить публикацию"), isOn: $schedule)
                    if schedule {
                        DatePicker(String(localized: "staff.post.scheduleAt", defaultValue: "Отложить до"), selection: $scheduledAt, in: Date()...)
                    }
                    Button {
                        Task { await submit(status: "DRAFT") }
                    } label: {
                        Label(String(localized: "staff.post.saveDraft", defaultValue: "Сохранить черновик"), systemImage: "tray.and.arrow.down")
                    }
                    .disabled(!canSubmit)
                } footer: {
                    Text(String(localized: "staff.post.draft.hint", defaultValue: "Черновики и отложенные посты видны только вам — в профиле, на вкладке «Посты»."))
                }
            }
            .navigationTitle(Text(String(localized: "staff.post.new", defaultValue: "Новая публикация")))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .interactiveDismissDisabled(isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(schedule
                            ? String(localized: "staff.post.scheduleAction", defaultValue: "Запланировать")
                            : String(localized: "staff.post.publish", defaultValue: "Опубликовать")) {
                            Task { await submit(status: "PUBLISHED") }
                        }
                        .disabled(!canSubmit)
                    }
                }
            }
            .onChange(of: picks) { _, items in
                Task { await load(items) }
            }
            .sheet(isPresented: $pickingGroup) {
                StaffGroupPickerSheet { group = $0 }
            }
            .sheet(isPresented: $pickingPerson) {
                StaffPersonPickerSheet(adminSearch: role == .universityAdmin || role == .platformAdmin) { person = $0 }
            }
            .alert(
                String(localized: "staff.post.done", defaultValue: "Готово"),
                isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil; dismiss() } })
            ) {
                Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
            } message: {
                Text(notice ?? "")
            }
            .task {
                if audience.isEmpty { audience = StaffPostText.audiences(for: role).first ?? "" }
                if role == .universityAdmin, faculties.isEmpty {
                    faculties = (try? await api.faculties()) ?? []
                }
            }
        }
    }

    @ViewBuilder
    private var audienceSection: some View {
        Section {
            // Пост от имени университета — всегда весь вуз; так пишет страница вуза.
            if role == .universityAdmin {
                Toggle(String(localized: "staff.post.asUniversity", defaultValue: "От имени университета"), isOn: $asUniversity)
            }
            if !asUniversity {
                Picker(String(localized: "staff.post.audience", defaultValue: "Аудитория"), selection: $audience) {
                    ForEach(StaffPostText.audiences(for: role), id: \.self) { Text(StaffPostText.audience($0)).tag($0) }
                }
                if audience == "FACULTY", role == .universityAdmin {
                    Picker(String(localized: "staff.post.faculty", defaultValue: "Факультет"), selection: $faculty) {
                        Text(String(localized: "staff.post.faculty.pick", defaultValue: "Выберите факультет")).tag(StaffFaculty?.none)
                        ForEach(faculties) { Text($0.name).tag(StaffFaculty?.some($0)) }
                    }
                }
                if audience == "GROUP", [.universityAdmin, .dean, .teacher].contains(role) {
                    Button {
                        pickingGroup = true
                    } label: {
                        StaffValueRow(
                            title: String(localized: "staff.post.group", defaultValue: "Группа"),
                            value: group?.name ?? String(localized: "staff.post.group.pick", defaultValue: "Выберите группу")
                        )
                    }
                }
                if audience == "SUBJECT" {
                    TextField(String(localized: "staff.post.subject", defaultValue: "Предмет"), text: $subject)
                }
                if audience == "PERSONAL" {
                    Button {
                        pickingPerson = true
                    } label: {
                        StaffValueRow(
                            title: String(localized: "staff.post.person", defaultValue: "Кому"),
                            value: person?.name ?? String(localized: "staff.post.person.pick", defaultValue: "Выберите человека")
                        )
                    }
                }
            }
        }
    }

    private var trimmedContent: String { content.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var canSubmit: Bool {
        guard !isPreparing, !trimmedContent.isEmpty, content.count <= 5000, title.count <= 200 else { return false }
        if asUniversity { return true }
        switch audience {
        case "FACULTY": return role != .universityAdmin || faculty != nil
        case "GROUP": return ![.universityAdmin, .dean, .teacher].contains(role) || group != nil
        case "SUBJECT": return !subject.trimmingCharacters(in: .whitespaces).isEmpty
        case "PERSONAL": return person != nil
        case "": return false
        default: return true
        }
    }

    @MainActor
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
                failure = (error as? LocalizedError)?.errorDescription ?? error.userMessage
            }
        }
    }

    @MainActor
    private func submit(status: String) async {
        if status == "PUBLISHED", schedule, scheduledAt <= Date() {
            failure = String(localized: "staff.post.schedulePast", defaultValue: "Это время уже прошло — выберите время в будущем")
            return
        }
        isSaving = true
        defer { isSaving = false }
        do {
            var ids: [String] = []
            let uploader = FeedAPI()
            for item in media {
                ids.append(try await uploader.upload(item.data, mime: item.mime, filename: item.filename, bucket: .posts).id)
            }
            let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            let input = StaffAPI.PostInput(
                audience: asUniversity ? "UNIVERSITY" : audience,
                title: cleanTitle.isEmpty ? nil : cleanTitle,
                content: trimmedContent,
                facultyId: !asUniversity && audience == "FACULTY" ? faculty?.id : nil,
                groupId: !asUniversity && audience == "GROUP" ? group?.id : nil,
                targetUserId: !asUniversity && audience == "PERSONAL" ? person?.id : nil,
                subject: !asUniversity && audience == "SUBJECT" ? subject.trimmingCharacters(in: .whitespaces) : nil,
                mediaIds: ids.isEmpty ? nil : ids,
                status: status,
                scheduledAt: status == "PUBLISHED" && schedule ? scheduledAt : nil,
                asUniversity: asUniversity ? true : nil
            )
            let post = try await api.createPost(input)
            if status == "DRAFT" {
                created(nil)
                notice = String(localized: "staff.post.draftSaved", defaultValue: "Черновик сохранён")
            } else if schedule {
                created(nil)
                notice = String(localized: "staff.post.scheduled", defaultValue: "Публикация запланирована")
            } else {
                created(post)
                dismiss()
            }
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Выбор группы и человека

/// Группа вуза поиском по названию. Декану сервер отдаёт группы его факультета.
struct StaffGroupPickerSheet: View {
    var facultyID: String?
    let pick: (StaffGroup) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var groups: [StaffGroup]?
    @State private var failure: String?

    private let api = StaffAPI()

    var body: some View {
        NavigationStack {
            List {
                if let failure {
                    FormAlert(message: failure).listRowBackground(Color.clear)
                }
                if let groups {
                    if groups.isEmpty {
                        Text(String(localized: "staff.picker.nothing", defaultValue: "Никого не нашли"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                            .listRowBackground(Color.clear)
                    }
                    ForEach(groups) { group in
                        Button {
                            pick(group)
                            dismiss()
                        } label: {
                            Text(group.name).foregroundStyle(Palette.foreground)
                        }
                    }
                } else if failure == nil {
                    LoadingStateView().listRowBackground(Color.clear)
                }
            }
            .listStyle(.insetGrouped)
            .debouncedSearch($search, prompt: String(localized: "staff.picker.group.search", defaultValue: "Название группы")) { value in
                await find(value)
            }
            .navigationTitle(Text(String(localized: "staff.post.group.pick", defaultValue: "Выберите группу")))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .task { if groups == nil { await find("") } }
        }
    }

    @MainActor
    private func find(_ value: String) async {
        do {
            groups = try await api.groups(search: value, facultyID: facultyID)
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }
}

/// Адресат личного поста: админ ищет по всем пользователям вуза, остальные — по
/// справочнику людей вокруг.
struct StaffPersonPickerSheet: View {
    let adminSearch: Bool
    let pick: (StaffUserPick) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var people: [StaffUserPick] = []
    @State private var failure: String?

    private let api = StaffAPI()

    var body: some View {
        NavigationStack {
            List {
                if let failure {
                    FormAlert(message: failure).listRowBackground(Color.clear)
                }
                if search.trimmingCharacters(in: .whitespaces).count < 2, adminSearch {
                    Text(String(localized: "staff.picker.typeMore", defaultValue: "Введите хотя бы две буквы ФИО"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .listRowBackground(Color.clear)
                }
                ForEach(people) { person in
                    Button {
                        pick(person)
                        dismiss()
                    } label: {
                        PersonRow(
                            name: person.name,
                            subtitle: [StaffRoleText.title(person.role), person.groupName ?? person.facultyName].compactMap { $0 }.joined(separator: " · "),
                            avatarURL: person.avatarThumbUrl
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .listStyle(.insetGrouped)
            .debouncedSearch($search, prompt: String(localized: "staff.picker.person.search", defaultValue: "ФИО")) { value in
                await find(value)
            }
            .navigationTitle(Text(String(localized: "staff.post.person.pick", defaultValue: "Выберите человека")))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .task { if !adminSearch, people.isEmpty { await find("") } }
        }
    }

    @MainActor
    private func find(_ value: String) async {
        if adminSearch, value.count < 2 {
            people = []
            return
        }
        do {
            people = adminSearch ? try await api.users(search: value, role: nil) : try await api.directory(search: value)
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }
}

import SwiftUI

// Управление событиями (веб — `EventsView`, `EventDetailView`, `CreateEventModal`,
// `EditEventModal`): предстоящие и прошедшие, создание с аудиторией, правка, удаление,
// участие, онлайн-встреча, участники и обсуждение.

enum StaffEventText {
    /// Кому роль вправе адресовать событие (веб — `UI_AUDIENCES`).
    static func audiences(for role: Role) -> [String] {
        switch role {
        case .platformAdmin: return ["ALL"]
        case .universityAdmin: return ["UNIVERSITY", "FACULTY", "GROUP", "TEACHERS"]
        case .dean: return ["FACULTY", "GROUP"]
        case .teacher: return ["GROUP", "SUBJECT"]
        case .starosta, .student: return ["GROUP"]
        default: return []
        }
    }

    static func audience(_ raw: String) -> String {
        if raw == "SUBJECT" { return String(localized: "staff.event.audience.subject", defaultValue: "Весь вуз (от преподавателя)") }
        return StaffPostText.audience(raw)
    }

    static func provider(_ raw: String?) -> String {
        switch raw {
        case "ZOOM": return "Zoom"
        case "GOOGLE_MEET": return "Google Meet"
        case "TEAMS": return "Microsoft Teams"
        case nil: return String(localized: "staff.event.online", defaultValue: "Онлайн")
        default: return String(localized: "staff.event.meetingOther", defaultValue: "Онлайн-встреча")
        }
    }

    static func when(_ event: StaffEvent) -> String {
        let start = event.startsAt.formatted(.dateTime.weekday(.abbreviated).day().month(.wide).hour().minute())
        guard let end = event.endsAt else { return start }
        if Calendar.current.isDate(end, inSameDayAs: event.startsAt) {
            return "\(start) – \(end.formatted(.dateTime.hour().minute()))"
        }
        return "\(start) – \(end.formatted(.dateTime.day().month(.wide).hour().minute()))"
    }
}

// MARK: - Список

struct StaffEventsView: View {
    @Environment(\.viewerRole) private var role
    @State private var filter: String? = "upcoming"
    @State private var loader: PagedLoader<StaffEvent>
    @State private var creating = false
    @State private var deleting: StaffEvent?
    @State private var actionFailure: String?
    @State private var appeared = false

    private let api = StaffAPI()

    init() {
        let api = StaffAPI()
        _loader = State(initialValue: PagedLoader(limit: 50) { request in
            try await api.events(filter: "upcoming", request)
        })
    }

    /// Модераторы события не создают — только читают ленту.
    private var canCreate: Bool {
        role != .platformModerator && role != .universityModerator && !StaffEventText.audiences(for: role).isEmpty
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "staff.event.empty", defaultValue: "Событий нет"),
                symbol: "calendar.badge.clock",
                hint: filter == "past"
                    ? String(localized: "staff.event.empty.past", defaultValue: "Прошедших событий нет")
                    : String(localized: "staff.event.empty.upcoming", defaultValue: "Пока нет предстоящих событий"),
                actionTitle: canCreate && filter != "past" ? String(localized: "staff.event.create", defaultValue: "Создать событие") : nil,
                action: canCreate && filter != "past" ? { creating = true } : nil
            ),
            header: {
                FilterChipsRow(
                    options: [
                        (Optional("upcoming"), String(localized: "staff.event.upcoming", defaultValue: "Предстоящие")),
                        (Optional("past"), String(localized: "staff.event.past", defaultValue: "Прошедшие")),
                    ],
                    selection: $filter
                )
            },
            row: { event in
                NavigationLink(value: AppRoute.staff(.event(id: event.id))) {
                    StaffEventRow(event: event, past: filter == "past")
                }
                .swipeActions {
                    if event.canManage == true {
                        Button(role: .destructive) {
                            deleting = event
                        } label: {
                            Label(String(localized: "staff.event.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                    }
                }
            }
        )
        .navigationTitle(Text(StaffScreen.events.title))
        .toolbar {
            if canCreate {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(Text(String(localized: "staff.event.create", defaultValue: "Создать событие")))
                }
            }
        }
        .onChange(of: filter) { _, value in
            let filter = value ?? "upcoming"
            Task { await loader.replace { request in try await api.events(filter: filter, request) } }
        }
        .sheet(isPresented: $creating) {
            StaffEventFormSheet(event: nil, role: role) { await loader.reload() }
        }
        .confirmDestructive(
            $deleting,
            title: { _ in String(localized: "staff.event.delete.confirm", defaultValue: "Удалить событие?") },
            actionTitle: String(localized: "staff.event.delete", defaultValue: "Удалить")
        ) { event in
            do {
                try await api.deleteEvent(id: event.id)
                loader.remove(id: event.id)
            } catch {
                actionFailure = error.userMessage
            }
        }
        .actionFailureAlert($actionFailure)
        .onAppear {
            if appeared { Task { await loader.reload() } }
            appeared = true
        }
    }
}

private struct StaffEventRow: View {
    let event: StaffEvent
    let past: Bool

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            // Отрывной календарь: дата — первое, что ищут глазами в списке событий.
            VStack(spacing: 0) {
                Text(event.startsAt.formatted(.dateTime.weekday(.abbreviated)))
                    .font(.caption2.weight(.medium))
                Text(event.startsAt.formatted(.dateTime.day()))
                    .font(.title3.weight(.bold).monospacedDigit())
                Text(event.startsAt.formatted(.dateTime.month(.abbreviated)))
                    .font(.caption2.weight(.medium))
            }
            .foregroundStyle(Palette.primary)
            .frame(width: 52)
            .padding(.vertical, Spacing.xs)
            .background(Palette.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: Radius.lg))

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(event.title).font(Typography.cardTitle).foregroundStyle(Palette.foreground).lineLimit(3)
                if let organizer = event.organizer {
                    Text(organizer.displayName).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                }
                HStack(spacing: Spacing.sm) {
                    if let audience = event.audience {
                        StatusBadge(text: StaffEventText.audience(audience), tint: Palette.mutedForeground)
                    }
                    if event.isRegistered {
                        StatusBadge(text: String(localized: "staff.event.registered", defaultValue: "Вы участвуете"), tint: Palette.success)
                    }
                }
                HStack(spacing: Spacing.lg) {
                    Label(event.startsAt.formatted(.dateTime.hour().minute()), systemImage: "clock")
                    if event.isOnline {
                        Label(StaffEventText.provider(event.meetingProvider), systemImage: "video")
                            .foregroundStyle(Palette.info)
                    } else if let location = event.location, !location.isEmpty {
                        Label(location, systemImage: "mappin").lineLimit(1)
                    }
                    Label(event.participants.formatted(), systemImage: "person.2")
                }
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            }
        }
        .opacity(past ? 0.7 : 1)
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Карточка

struct StaffEventDetailView: View {
    let eventID: String

    @Environment(\.viewerRole) private var role
    @Environment(\.viewerID) private var viewerID
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var event: StaffEvent?
    @State private var failure: String?
    @State private var actionFailure: String?
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var isWorking = false
    @State private var meeting: StaffEventMeeting?
    @State private var participants: PagedLoader<StaffEventParticipant>
    @State private var comments: PagedLoader<StaffEventComment>
    @State private var commentText = ""
    @State private var replyTo: StaffEventComment?
    @State private var deletingComment: StaffEventComment?

    private let api = StaffAPI()

    init(eventID: String) {
        self.eventID = eventID
        let api = StaffAPI()
        _participants = State(initialValue: PagedLoader(limit: 50) { request in
            try await api.eventParticipants(id: eventID, request)
        })
        _comments = State(initialValue: PagedLoader(limit: 20) { request in
            try await api.eventComments(id: eventID, request)
        })
    }

    var body: some View {
        Group {
            if let event {
                content(event)
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(event?.title ?? StaffScreen.event(id: eventID).title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let event, canManage(event) {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            editing = true
                        } label: {
                            Label(String(localized: "staff.event.edit", defaultValue: "Изменить"), systemImage: "pencil")
                        }
                        Button(role: .destructive) {
                            confirmDelete = true
                        } label: {
                            Label(String(localized: "staff.event.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .sheet(isPresented: $editing) {
            if let event { StaffEventFormSheet(event: event, role: role) { await load() } }
        }
        .sheet(item: Binding(get: { meeting.map { StaffMeetingSheetItem(meeting: $0) } }, set: { if $0 == nil { meeting = nil } })) { item in
            StaffMeetingSheet(meeting: item.meeting) { url in openURL(url) }
        }
        .confirmationDialog(
            String(localized: "staff.event.delete.confirm", defaultValue: "Удалить событие?"),
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button(String(localized: "staff.event.delete", defaultValue: "Удалить"), role: .destructive) {
                Task { await remove() }
            }
        }
        .confirmDestructive(
            $deletingComment,
            title: { comment in
                comment.author.id == viewerID
                    ? String(localized: "staff.event.comment.delete.confirm", defaultValue: "Удалить комментарий?")
                    : String(localized: "staff.event.comment.deleteOther", defaultValue: "Удалить чужой комментарий?")
            },
            actionTitle: String(localized: "staff.event.comment.delete", defaultValue: "Удалить комментарий")
        ) { comment in
            do {
                try await api.deleteEventComment(id: eventID, commentID: comment.id)
                comments.remove(id: comment.id)
            } catch {
                actionFailure = error.userMessage
            }
        }
        .actionFailureAlert($actionFailure)
        .overlay {
            if isWorking {
                ProgressView()
                    .padding(Spacing.xl)
                    .glassSurface(interactive: false, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            }
        }
        .task { await load() }
    }

    /// Право решает сервер (`canManage`); роль — только запасной вариант для старого ответа.
    private func canManage(_ event: StaffEvent) -> Bool {
        event.canManage ?? (event.organizerId == viewerID || [.platformAdmin, .universityAdmin, .dean].contains(role))
    }

    private var canModerate: Bool {
        [.platformAdmin, .universityAdmin, .dean, .platformModerator, .universityModerator].contains(role)
    }

    @ViewBuilder
    private func content(_ event: StaffEvent) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    HStack(spacing: Spacing.sm) {
                        if let audience = event.audience {
                            StatusBadge(text: StaffEventText.audience(audience), tint: Palette.mutedForeground)
                        }
                        if event.isRegistered {
                            StatusBadge(text: String(localized: "staff.event.registered", defaultValue: "Вы участвуете"), tint: Palette.success)
                        }
                    }
                    Label(StaffEventText.when(event), systemImage: "calendar")
                    if event.isOnline {
                        Label(StaffEventText.provider(event.meetingProvider), systemImage: "video").foregroundStyle(Palette.info)
                    } else if let location = event.location, !location.isEmpty {
                        Label(location, systemImage: "mappin.and.ellipse")
                    }
                    Label(
                        event.participants == 0
                            ? String(localized: "staff.event.noParticipants", defaultValue: "Пока никто не записался")
                            : String(localized: "staff.event.participantsCount", defaultValue: "Участников: \(event.participants.formatted())"),
                        systemImage: "person.2"
                    )
                    if let organizer = event.organizer, let id = organizer.id ?? event.organizerId {
                        NavigationLink(value: AppRoute.profile(id: id)) {
                            Text(String(localized: "staff.event.organizer", defaultValue: "Организатор: \(organizer.displayName)"))
                        }
                    }
                }
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                if let description = event.description, !description.isEmpty {
                    Text(description).font(Typography.body).foregroundStyle(Palette.foreground)
                }
                if event.isPast {
                    Text(String(localized: "staff.event.finished", defaultValue: "Событие завершилось"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }

            if !event.isPast {
                Section {
                    // Организатору регистрация не нужна: встречу ведёт он.
                    if (event.isRegistered || event.organizerId == viewerID), event.meetingProvider != nil {
                        Button {
                            Task { await openMeeting() }
                        } label: {
                            Label(String(localized: "staff.event.join", defaultValue: "Присоединиться"), systemImage: "video")
                        }
                    }
                    Button {
                        Task { await toggleRegistration(event) }
                    } label: {
                        Label(
                            event.isRegistered
                                ? String(localized: "staff.event.cancelRegistration", defaultValue: "Отменить участие")
                                : String(localized: "staff.event.register", defaultValue: "Участвовать"),
                            systemImage: event.isRegistered ? "xmark.circle" : "checkmark.circle"
                        )
                    }
                }
            }

            // Участники — только организатору и админам scope: это список людей.
            if canManage(event) {
                Section(String(localized: "staff.event.participants", defaultValue: "Участники")) {
                    participantsList
                }
            }

            Section(String(localized: "staff.event.comments", defaultValue: "Обсуждение")) {
                commentComposer
                commentsList
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    @ViewBuilder
    private var participantsList: some View {
        if participants.isLoaded {
            if participants.items.isEmpty {
                Text(String(localized: "staff.event.noParticipants", defaultValue: "Пока никто не записался"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            ForEach(participants.items) { participant in
                NavigationLink(value: AppRoute.profile(id: participant.userId)) {
                    PersonRow(
                        name: DisplayFormat.name(first: participant.user.firstName, last: participant.user.lastName),
                        subtitle: [
                            StaffRoleText.title(participant.user.role),
                            participant.user.group?.name ?? participant.user.faculty?.name,
                        ].compactMap { $0 }.joined(separator: " · "),
                        avatarURL: participant.user.avatarThumbUrl,
                        size: 32
                    )
                }
                .task { await participants.loadMore(after: participant) }
            }
            if participants.hasMore { ProgressView().frame(maxWidth: .infinity) }
        } else if participants.failure != nil {
            // 403 у админа чужого scope — не ошибка экрана: блок просто пуст.
            Text(String(localized: "staff.event.participants.unavailable", defaultValue: "Список участников недоступен"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
        } else {
            ProgressView().frame(maxWidth: .infinity)
                .task { await participants.loadIfNeeded() }
        }
    }

    private var commentComposer: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            if let replyTo {
                HStack {
                    Label(
                        String(localized: "staff.event.replyTo", defaultValue: "Ответ: \(replyTo.author.displayName)"),
                        systemImage: "arrowshape.turn.up.left"
                    )
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    Spacer()
                    Button {
                        self.replyTo = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground)
                    }
                    .buttonStyle(.borderless)
                }
            }
            HStack(alignment: .bottom, spacing: Spacing.sm) {
                TextField(
                    String(localized: "staff.event.comment.placeholder", defaultValue: "Вопрос организатору или комментарий"),
                    text: $commentText,
                    axis: .vertical
                )
                .lineLimit(1...5)
                Button {
                    Task { await sendComment() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.title2)
                }
                .buttonStyle(.borderless)
                .disabled(commentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || commentText.count > 2000)
                .accessibilityLabel(Text(String(localized: "staff.event.comment.send", defaultValue: "Отправить")))
            }
        }
    }

    @ViewBuilder
    private var commentsList: some View {
        if comments.isLoaded {
            ForEach(comments.items) { comment in
                commentRow(comment)
                    .task { await comments.loadMore(after: comment) }
            }
            if comments.hasMore { ProgressView().frame(maxWidth: .infinity) }
        } else if let failure = comments.failure {
            Text(failure).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
        } else {
            ProgressView().frame(maxWidth: .infinity)
                .task { await comments.loadIfNeeded() }
        }
    }

    private func commentRow(_ comment: StaffEventComment) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(comment.author.displayName).font(Typography.meta.weight(.semibold)).foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                Text(DisplayFormat.relative(comment.createdAt)).font(.caption).foregroundStyle(Palette.mutedForeground)
            }
            if let reply = comment.replyTo {
                Text(reply.deleted == true
                    ? String(localized: "staff.event.reply.deleted", defaultValue: "Комментарий удалён")
                    : "\(reply.author?.displayName ?? ""): \(reply.content ?? "")")
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
                    .padding(.leading, Spacing.sm)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(Palette.primary).frame(width: 2)
                    }
            }
            if !comment.content.isEmpty {
                Text(comment.content).font(Typography.body).foregroundStyle(Palette.foreground)
            }
            if let media = comment.media, !media.isEmpty {
                Label(
                    String(localized: "staff.event.comment.attachments", defaultValue: "Вложений: \(media.count.formatted())"),
                    systemImage: "paperclip"
                )
                .font(.caption)
                .foregroundStyle(Palette.mutedForeground)
            }
            let reactions = Dictionary(grouping: comment.reactions ?? [], by: \.emoji)
            if !reactions.isEmpty {
                Text(reactions.keys.sorted().map { "\($0) \(reactions[$0]?.count ?? 0)" }.joined(separator: "  "))
                    .font(.caption)
            }
        }
        .padding(.vertical, 2)
        .contextMenu {
            Button {
                replyTo = comment
            } label: {
                Label(String(localized: "staff.event.reply", defaultValue: "Ответить"), systemImage: "arrowshape.turn.up.left")
            }
            if comment.canDelete ?? (comment.author.id == viewerID || canModerate) {
                Button(role: .destructive) {
                    deletingComment = comment
                } label: {
                    Label(String(localized: "staff.event.comment.delete", defaultValue: "Удалить комментарий"), systemImage: "trash")
                }
            }
        }
        .swipeActions {
            if comment.canDelete ?? (comment.author.id == viewerID || canModerate) {
                Button(role: .destructive) {
                    deletingComment = comment
                } label: {
                    Label(String(localized: "staff.event.comment.delete", defaultValue: "Удалить комментарий"), systemImage: "trash")
                }
            }
            Button {
                replyTo = comment
            } label: {
                Label(String(localized: "staff.event.reply", defaultValue: "Ответить"), systemImage: "arrowshape.turn.up.left")
            }
            .tint(Palette.primary)
        }
    }

    // MARK: Действия

    @MainActor
    private func load() async {
        do {
            event = try await api.event(id: eventID)
            failure = nil
            if participants.isLoaded { await participants.reload() }
            if comments.isLoaded { await comments.reload() }
        } catch {
            if event == nil { failure = error.userMessage } else { actionFailure = error.userMessage }
        }
    }

    @MainActor
    private func toggleRegistration(_ event: StaffEvent) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await api.registerEvent(id: eventID, on: !event.isRegistered)
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }

    /// Ссылку сервер отдаёт по нажатию: окно подключения считается на момент запроса.
    @MainActor
    private func openMeeting() async {
        isWorking = true
        defer { isWorking = false }
        do {
            meeting = try await api.eventMeeting(id: eventID)
        } catch let error as APIError where error.code == .forbidden {
            actionFailure = String(localized: "staff.event.meeting.unavailable", defaultValue: "Ссылка недоступна: нужна регистрация на событие")
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func sendComment() async {
        let text = commentText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        do {
            try await api.addEventComment(id: eventID, content: text, replyTo: replyTo?.id)
            commentText = ""
            replyTo = nil
            await comments.reload()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func remove() async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await api.deleteEvent(id: eventID)
            dismiss()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

private struct StaffMeetingSheetItem: Identifiable {
    let meeting: StaffEventMeeting
    var id: String { meeting.url }
}

/// Подключение к встрече: сервис, код доступа, открыть ссылку — когда окно уже открыто.
private struct StaffMeetingSheet: View {
    let meeting: StaffEventMeeting
    let open: (URL) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(String(localized: "staff.event.meeting.provider", defaultValue: "Встреча проходит в \(StaffEventText.provider(meeting.provider))."))
                    if let passcode = meeting.passcode, !passcode.isEmpty {
                        DetailRow(title: String(localized: "staff.event.meeting.passcode", defaultValue: "Код доступа"), value: passcode)
                    }
                    if !meeting.joinable, let from = meeting.joinableFrom {
                        Text(String(
                            localized: "staff.event.meeting.notYet",
                            defaultValue: "Подключиться можно с \(DisplayFormat.dateTime(from)) — ссылка откроется заранее."
                        ))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                    }
                }
                Section {
                    Button {
                        if let url = URL(string: meeting.url) {
                            open(url)
                            dismiss()
                        }
                    } label: {
                        Label(String(localized: "staff.event.meeting.open", defaultValue: "Открыть встречу"), systemImage: "arrow.up.right.square")
                    }
                    .disabled(!meeting.joinable)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Text(String(localized: "staff.event.meeting.title", defaultValue: "Подключение к встрече")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "common.ok", defaultValue: "Понятно")) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Форма события

/// Создание и правка. При правке уходят только изменённые поля — участников сервер
/// уведомляет о переносе начала, и пустой запрос не должен их тревожить.
private struct StaffEventFormSheet: View {
    let event: StaffEvent?
    let role: Role
    let saved: () async -> Void

    @State private var audience = ""
    @State private var title = ""
    @State private var description = ""
    @State private var startsAt = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    @State private var hasEnd = false
    @State private var endsAt = (Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()).addingTimeInterval(2 * 60 * 60)
    @State private var isOnline = false
    @State private var location = ""
    @State private var meetingURL = ""
    @State private var passcode = ""
    @State private var faculty: StaffFaculty?
    @State private var group: StaffGroup?
    @State private var faculties: [StaffFaculty] = []
    @State private var pickingGroup = false
    /// Текущая встреча: ссылку отдают только участникам и организатору. `nil` — неизвестна,
    /// и пустое поле ссылку не трогает.
    @State private var currentMeeting: StaffEventMeeting?
    @State private var prepared = false

    private let api = StaffAPI()

    var body: some View {
        StaffFormSheet(
            title: event == nil
                ? String(localized: "staff.event.new", defaultValue: "Новое событие")
                : String(localized: "staff.event.editTitle", defaultValue: "Изменить событие"),
            saveTitle: event == nil
                ? String(localized: "staff.event.create.action", defaultValue: "Создать")
                : String(localized: "common.save", defaultValue: "Сохранить"),
            canSave: problem == nil,
            save: { try await save() },
            saved: saved
        ) {
            if event == nil {
                Section {
                    Picker(String(localized: "staff.event.audience", defaultValue: "Аудитория"), selection: $audience) {
                        ForEach(StaffEventText.audiences(for: role), id: \.self) { Text(StaffEventText.audience($0)).tag($0) }
                    }
                    if audience == "FACULTY", role == .universityAdmin {
                        Picker(String(localized: "staff.event.faculty", defaultValue: "Факультет"), selection: $faculty) {
                            Text(String(localized: "staff.event.faculty.pick", defaultValue: "Выберите факультет")).tag(StaffFaculty?.none)
                            ForEach(faculties) { Text($0.name).tag(StaffFaculty?.some($0)) }
                        }
                    }
                    if audience == "GROUP", [.universityAdmin, .dean, .teacher].contains(role) {
                        Button {
                            pickingGroup = true
                        } label: {
                            StaffValueRow(
                                title: String(localized: "staff.event.group", defaultValue: "Группа"),
                                value: group?.name ?? String(localized: "staff.event.group.pick", defaultValue: "Выберите группу")
                            )
                        }
                    }
                }
            }

            Section {
                TextField(String(localized: "staff.event.titleField", defaultValue: "Название"), text: $title)
                TextField(String(localized: "staff.event.description", defaultValue: "Описание"), text: $description, axis: .vertical)
                    .lineLimit(3...10)
            }

            Section {
                DatePicker(String(localized: "staff.event.startsAt", defaultValue: "Начало"), selection: $startsAt)
                Toggle(String(localized: "staff.event.hasEnd", defaultValue: "Указать окончание"), isOn: $hasEnd)
                if hasEnd {
                    DatePicker(String(localized: "staff.event.endsAt", defaultValue: "Окончание"), selection: $endsAt, in: startsAt...)
                }
            }

            Section {
                Toggle(String(localized: "staff.event.isOnline", defaultValue: "Онлайн-событие"), isOn: $isOnline)
                if isOnline {
                    TextField(String(localized: "staff.event.meetingLink", defaultValue: "Ссылка на Zoom, Meet или трансляцию"), text: $meetingURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField(String(localized: "staff.event.passcode", defaultValue: "Код доступа, если нужен"), text: $passcode)
                        .autocorrectionDisabled()
                } else {
                    TextField(String(localized: "staff.event.location", defaultValue: "Аудитория / адрес / ссылка"), text: $location)
                }
            } footer: {
                if event != nil, event?.meetingProvider != nil, currentMeeting == nil, isOnline {
                    Text(String(localized: "staff.event.meetingKeep", defaultValue: "Оставьте поле пустым, чтобы сохранить текущую ссылку"))
                }
            }
        }
        .sheet(isPresented: $pickingGroup) {
            StaffGroupPickerSheet { group = $0 }
        }
        .task { await prepare() }
    }

    private var problem: String? {
        if title.trimmingCharacters(in: .whitespaces).isEmpty || title.count > 200 { return "" }
        if description.trimmingCharacters(in: .whitespaces).isEmpty || description.count > 5000 { return "" }
        if hasEnd, endsAt <= startsAt { return "" }
        let link = meetingURL.trimmingCharacters(in: .whitespaces)
        if isOnline, !link.isEmpty, link.range(of: "^https?://\\S+$", options: [.regularExpression, .caseInsensitive]) == nil {
            return ""
        }
        if event == nil {
            if audience.isEmpty { return "" }
            if audience == "FACULTY", role == .universityAdmin, faculty == nil { return "" }
            if audience == "GROUP", [.universityAdmin, .dean, .teacher].contains(role), group == nil { return "" }
        }
        return nil
    }

    @MainActor
    private func prepare() async {
        guard !prepared else { return }
        prepared = true
        if role == .universityAdmin { faculties = (try? await api.faculties()) ?? [] }
        guard let event else {
            audience = StaffEventText.audiences(for: role).first ?? ""
            return
        }
        title = event.title
        description = event.description ?? ""
        startsAt = event.startsAt
        if let end = event.endsAt {
            hasEnd = true
            endsAt = end
        }
        isOnline = event.isOnline
        location = event.location ?? ""
        if event.meetingProvider != nil, let meeting = try? await api.eventMeeting(id: event.id) {
            currentMeeting = meeting
            meetingURL = meeting.url
            passcode = meeting.passcode ?? ""
        }
    }

    private func save() async throws {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let link = meetingURL.trimmingCharacters(in: .whitespaces)
        let code = passcode.trimmingCharacters(in: .whitespaces)
        let place = location.trimmingCharacters(in: .whitespaces)
        guard let event else {
            var fields: [String: JSONValue] = [
                "audience": .string(audience),
                "title": .string(trimmedTitle),
                "description": .string(trimmedDescription),
                "startsAt": .date(startsAt),
                "isOnline": .bool(isOnline),
            ]
            if hasEnd { fields["endsAt"] = .date(endsAt) }
            if isOnline {
                if !link.isEmpty { fields["meetingUrl"] = .string(link) }
                if !code.isEmpty { fields["meetingPasscode"] = .string(code) }
            } else if !place.isEmpty {
                fields["location"] = .string(place)
            }
            if audience == "FACULTY", let faculty { fields["facultyId"] = .string(faculty.id) }
            if audience == "GROUP", let group { fields["groupId"] = .string(group.id) }
            try await api.createEvent(fields)
            return
        }
        var patch: [String: JSONValue] = [:]
        if trimmedTitle != event.title { patch["title"] = .string(trimmedTitle) }
        if trimmedDescription != (event.description ?? "") { patch["description"] = .string(trimmedDescription) }
        if abs(startsAt.timeIntervalSince(event.startsAt)) >= 1 { patch["startsAt"] = .date(startsAt) }
        let newEnd: Date? = hasEnd ? endsAt : nil
        if newEnd != event.endsAt { patch["endsAt"] = .date(newEnd) }
        if isOnline != event.isOnline { patch["isOnline"] = .bool(isOnline) }
        if !isOnline, place != (event.location ?? "") { patch["location"] = .text(place) }
        if isOnline {
            if !link.isEmpty, link != currentMeeting?.url { patch["meetingUrl"] = .string(link) }
            // Ссылку убрали, а прежняя известна — снимаем встречу.
            if link.isEmpty, currentMeeting != nil { patch["meetingUrl"] = .null }
            if code != (currentMeeting?.passcode ?? ""), !(currentMeeting == nil && code.isEmpty) {
                patch["meetingPasscode"] = .text(code)
            }
        } else if event.meetingProvider != nil {
            patch["meetingUrl"] = .null
        }
        guard !patch.isEmpty else { return }
        try await api.updateEvent(id: event.id, patch)
    }
}

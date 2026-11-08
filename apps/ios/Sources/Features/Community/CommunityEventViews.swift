import SwiftUI
import UIKit

// События со стороны участника: карточка (`/events/[id]`) с записью, онлайн-встречей и
// обсуждением; создание и правка своего события. Управление событиями сотрудниками —
// отдельный раздел (`StaffScreen.events`).

// MARK: - Список

/// Строка события в списке.
struct CommunityEventRow: View {
    let event: CommunityEventDTO

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(event.title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(3)
                Spacer(minLength: Spacing.md)
                if event.isRegistered == true {
                    StatusBadge(text: String(localized: "community.event.registered", defaultValue: "Вы записаны"), tint: Palette.success)
                } else if event.isOver {
                    StatusBadge(text: String(localized: "community.event.over", defaultValue: "Прошло"), tint: Palette.mutedForeground)
                }
            }
            Label(CommunityEventText.period(event), systemImage: "calendar")
            if event.isOnline == true || event.meetingProvider != nil {
                Label(CommunityText.meetingProvider(event.meetingProvider), systemImage: "video")
            }
            if let location = event.location, !location.isEmpty {
                Label(location, systemImage: "mappin")
            }
        }
        .font(Typography.meta)
        .foregroundStyle(Palette.mutedForeground)
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

enum CommunityEventText {
    static func period(_ event: CommunityEventDTO) -> String {
        guard let end = event.endsAt else { return DisplayFormat.dateTime(event.startsAt) }
        if Calendar.current.isDate(end, inSameDayAs: event.startsAt) {
            return "\(DisplayFormat.dateTime(event.startsAt)) – \(end.formatted(date: .omitted, time: .shortened))"
        }
        return "\(DisplayFormat.dateTime(event.startsAt)) – \(DisplayFormat.dateTime(end))"
    }

    /// Кому роль вправе адресовать событие — как в вебе (`create-event-modal`).
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

    /// Кто выбирает группу сам: у студента и старосты группа своя.
    static func picksGroup(_ role: Role) -> Bool {
        role == .universityAdmin || role == .dean || role == .teacher
    }
}

// MARK: - Карточка

struct CommunityEventView: View {
    let eventID: String

    @Environment(\.viewerID) private var viewerID
    @Environment(\.dismiss) private var dismiss
    @State private var event: CommunityEventDTO?
    @State private var failure: String?
    @State private var isBusy = false
    @State private var actionFailure: String?
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var meeting: CommunityEventMeetingDTO?
    @State private var participants: [CommunityEventParticipantDTO]?
    @State private var comments = PagedLoader<CommunityEventCommentDTO>(limit: 30) { _ in Page(items: [], meta: nil) }
    @State private var draft = ""
    @State private var replyTo: CommunityEventCommentDTO?
    @State private var isSending = false
    @State private var deletingComment: CommunityEventCommentDTO?

    private let api = CommunityAPI()

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
        .navigationTitle(Text(CommunityScreen.event(id: eventID).title))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $editing) {
            if let event {
                CommunityEventEditor(event: event) { updated in self.event = updated }
            }
        }
        .alert(
            String(localized: "community.event.passcode", defaultValue: "Код доступа к встрече"),
            isPresented: Binding(get: { meeting?.passcode != nil }, set: { if !$0 { meeting = nil } }),
            presenting: meeting
        ) { meeting in
            Button(String(localized: "community.event.copyAndJoin", defaultValue: "Скопировать и открыть")) {
                UIPasteboard.general.string = meeting.passcode
                if let url = URL(string: meeting.url) { UIApplication.shared.open(url) }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: { meeting in
            Text(verbatim: meeting.passcode ?? "")
        }
        .confirmationDialog(
            String(localized: "community.event.delete.title", defaultValue: "Удалить событие?"),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(String(localized: "feed.delete", defaultValue: "Удалить"), role: .destructive) {
                Task { await deleteEvent() }
            }
        } message: {
            Text(String(localized: "community.event.delete.message", defaultValue: "Участники больше не увидят событие."))
        }
        .confirmDestructive(
            $deletingComment,
            title: { _ in String(localized: "community.comment.delete.title", defaultValue: "Удалить комментарий?") },
            actionTitle: String(localized: "feed.delete", defaultValue: "Удалить")
        ) { comment in
            do {
                try await api.deleteEventComment(eventID: eventID, commentID: comment.id)
                comments.remove(id: comment.id)
            } catch {
                actionFailure = error.userMessage
            }
        }
        .actionFailureAlert($actionFailure)
    }

    private func content(_ event: CommunityEventDTO) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    HStack(spacing: Spacing.sm) {
                        if let audience = event.audience {
                            StatusBadge(text: CommunityText.audience(audience), tint: Palette.primary)
                        }
                        if event.isRegistered == true {
                            StatusBadge(text: String(localized: "community.event.registered", defaultValue: "Вы записаны"), tint: Palette.success)
                        }
                    }
                    Text(event.title)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Palette.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                    if let description = event.description, !description.isEmpty {
                        PostTextView(content: description, lineLimit: 12)
                    }
                }
                .padding(.vertical, Spacing.xs)
                DetailRow(title: String(localized: "community.event.when", defaultValue: "Когда"), value: CommunityEventText.period(event), symbol: "calendar")
                if event.isOnline == true || event.meetingProvider != nil {
                    DetailRow(title: String(localized: "community.event.format", defaultValue: "Формат"), value: CommunityText.meetingProvider(event.meetingProvider), symbol: "video")
                }
                if let location = event.location, !location.isEmpty {
                    DetailRow(title: String(localized: "community.event.where", defaultValue: "Где"), value: location, symbol: "mappin")
                }
                DetailRow(
                    title: String(localized: "community.event.participants", defaultValue: "Участников"),
                    value: (event.counts?.participants ?? 0).formatted(),
                    symbol: "person.2"
                )
                if let organizer = event.organizer {
                    NavigationLink(value: AppRoute.profile(id: organizer.id)) {
                        DetailRow(title: String(localized: "community.event.organizer", defaultValue: "Организатор"), value: organizer.name, symbol: "person.crop.circle")
                    }
                }
                if event.isOver {
                    Label(String(localized: "community.event.finished", defaultValue: "Событие завершилось"), systemImage: "flag.checkered")
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }

            if !event.isOver {
                Section {
                    if canJoinMeeting(event) {
                        Button {
                            Task { await joinMeeting() }
                        } label: {
                            Label(String(localized: "community.event.joinMeeting", defaultValue: "Подключиться к встрече"), systemImage: "video.fill")
                        }
                        .disabled(isBusy)
                    }
                    Button {
                        Task { await toggleRegistration(event) }
                    } label: {
                        if event.isRegistered == true {
                            Label(String(localized: "community.event.unregister", defaultValue: "Отменить запись"), systemImage: "xmark.circle")
                                .foregroundStyle(Palette.destructive)
                        } else {
                            Label(String(localized: "community.event.register", defaultValue: "Записаться"), systemImage: "checkmark.circle")
                        }
                    }
                    .disabled(isBusy)
                }
            }

            if event.canManage == true, let participants, !participants.isEmpty {
                Section {
                    ForEach(participants) { participant in
                        NavigationLink(value: AppRoute.profile(id: participant.user.id)) {
                            PersonRow(name: participant.user.name, subtitle: participant.createdAt.map { DisplayFormat.dateTime($0) }, avatarURL: participant.user.avatar, size: 32)
                        }
                    }
                } header: {
                    Text(String(localized: "community.event.participantsList", defaultValue: "Кто записался"))
                }
            }

            discussion
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
        .toolbar {
            if event.canManage == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            editing = true
                        } label: {
                            Label(String(localized: "feed.edit", defaultValue: "Редактировать"), systemImage: "pencil")
                        }
                        Button(role: .destructive) {
                            confirmingDelete = true
                        } label: {
                            Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel(Text(String(localized: "community.event.actions", defaultValue: "Действия с событием")))
                }
            }
        }
    }

    private var discussion: some View {
        Section {
            if let replyTo {
                HStack {
                    Label(
                        String(localized: "community.comment.replyTo", defaultValue: "Ответ: \((replyTo.author?.name).orDash)"),
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
                    .accessibilityLabel(Text(String(localized: "common.cancel", defaultValue: "Отмена")))
                }
            }
            HStack(alignment: .bottom, spacing: Spacing.md) {
                TextField(String(localized: "community.comment.placeholder", defaultValue: "Комментарий"), text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                Button {
                    Task { await send() }
                } label: {
                    if isSending { ProgressView() } else { Image(systemName: "paperplane.fill") }
                }
                .buttonStyle(.borderless)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
                .accessibilityLabel(Text(String(localized: "community.comment.send", defaultValue: "Отправить")))
            }
            if comments.isLoaded, comments.items.isEmpty {
                Text(String(localized: "feed.noComments", defaultValue: "Комментариев пока нет"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            ForEach(comments.items) { comment in
                CommunityCommentRow(
                    name: comment.author?.name ?? "—",
                    avatar: comment.author?.avatar,
                    text: commentText(comment),
                    date: comment.createdAt,
                    profileID: comment.author?.id,
                    caption: comment.replyTo.map { reply in
                        reply.deleted == true
                            ? String(localized: "community.comment.replyDeleted", defaultValue: "В ответ на удалённый комментарий")
                            : "↪︎ \(reply.author?.name ?? "—"): \(reply.content ?? "")"
                    }
                )
                .overlay(alignment: .bottomTrailing) {
                    let summary = reactionSummary(comment)
                    if !summary.isEmpty {
                        Text(verbatim: summary).font(.caption).foregroundStyle(Palette.mutedForeground)
                    }
                }
                .task { await comments.loadMore(after: comment) }
                .contextMenu {
                    Button {
                        replyTo = comment
                    } label: {
                        Label(String(localized: "community.comment.reply", defaultValue: "Ответить"), systemImage: "arrowshape.turn.up.left")
                    }
                    ForEach(["👍", "❤️", "😂", "🔥"], id: \.self) { emoji in
                        Button {
                            Task { await react(comment, emoji: emoji) }
                        } label: {
                            Text(verbatim: emoji)
                        }
                    }
                    if comment.canDelete == true {
                        Button(role: .destructive) {
                            deletingComment = comment
                        } label: {
                            Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                    }
                }
            }
        } header: {
            Text(String(localized: "community.event.discussion", defaultValue: "Обсуждение"))
        }
    }

    private func commentText(_ comment: CommunityEventCommentDTO) -> String {
        let text = comment.content ?? ""
        let files = comment.media?.count ?? 0
        guard files > 0 else { return text }
        let note = String(localized: "community.comment.attachments", defaultValue: "Вложений: \(files.formatted())")
        return text.isEmpty ? note : "\(text)\n\(note)"
    }

    private func reactionSummary(_ comment: CommunityEventCommentDTO) -> String {
        let counts = Dictionary((comment.reactions ?? []).map { ($0.emoji, 1) }, uniquingKeysWith: +)
        return counts.sorted { $0.value > $1.value }.map { "\($0.key)\($0.value)" }.joined(separator: " ")
    }

    private func canJoinMeeting(_ event: CommunityEventDTO) -> Bool {
        guard event.meetingProvider != nil else { return false }
        return event.isRegistered == true || event.organizerId == viewerID || event.canManage == true
    }

    @MainActor
    private func load() async {
        do {
            let loaded = try await api.event(id: eventID)
            event = loaded
            failure = nil
            await comments.replace { [api, eventID] request in
                try await api.eventComments(id: eventID, cursor: request.cursor)
            }
            if loaded.canManage == true {
                participants = try? await api.eventParticipants(id: eventID)
            }
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func toggleRegistration(_ current: CommunityEventDTO) async {
        isBusy = true
        defer { isBusy = false }
        let on = current.isRegistered != true
        do {
            try await api.setRegistered(eventID: current.id, on)
            event?.isRegistered = on
            let count = current.counts?.participants ?? 0
            event?.counts = CommunityEventDTO.Counts(participants: max(0, count + (on ? 1 : -1)))
        } catch {
            actionFailure = error.userMessage
        }
    }

    /// Ссылка на встречу выдаётся только в окне подключения (за 15 минут до начала).
    @MainActor
    private func joinMeeting() async {
        isBusy = true
        defer { isBusy = false }
        do {
            let answer = try await api.eventMeeting(id: eventID)
            if answer.joinable == false {
                let from = DisplayFormat.dateTime(answer.joinableFrom)
                actionFailure = String(localized: "community.event.notYet", defaultValue: "Подключиться можно с \(from)")
                return
            }
            if answer.passcode != nil {
                meeting = answer
            } else if let url = URL(string: answer.url) {
                await UIApplication.shared.open(url)
            }
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        isSending = true
        defer { isSending = false }
        do {
            _ = try await api.commentEvent(id: eventID, text: String(text.prefix(2000)), replyTo: replyTo?.id)
            draft = ""
            replyTo = nil
            await comments.reload()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func react(_ comment: CommunityEventCommentDTO, emoji: String) async {
        do {
            try await api.reactEventComment(eventID: eventID, commentID: comment.id, emoji: emoji)
            await comments.reload()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func deleteEvent() async {
        do {
            try await api.deleteEvent(id: eventID)
            dismiss()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

// MARK: - Создание и правка

struct CommunityEventEditor: View {
    /// `nil` — новое событие.
    let event: CommunityEventDTO?
    let saved: (CommunityEventDTO) -> Void

    @Environment(\.viewerRole) private var role
    @State private var audience = "GROUP"
    @State private var title = ""
    @State private var details = ""
    @State private var location = ""
    @State private var isOnline = false
    @State private var meetingURL = ""
    @State private var passcode = ""
    @State private var startsAt = Date().addingTimeInterval(24 * 3600)
    @State private var hasEnd = false
    @State private var endsAt = Date().addingTimeInterval(26 * 3600)
    @State private var groupID = ""
    @State private var facultyID = ""
    @State private var groups: [CommunityGroupDTO] = []
    @State private var faculties: [CommunityFacultyDTO] = []
    @State private var didFill = false

    private let api = CommunityAPI()

    var body: some View {
        FormSheet(
            title: event == nil
                ? String(localized: "community.event.new", defaultValue: "Новое событие")
                : String(localized: "feed.edit", defaultValue: "Редактировать"),
            canSave: canSave,
            save: save
        ) {
            if event == nil {
                Section {
                    Picker(String(localized: "community.event.audience", defaultValue: "Для кого"), selection: $audience) {
                        ForEach(audiences, id: \.self) { Text(CommunityText.audience($0)).tag($0) }
                    }
                    if audience == "GROUP", CommunityEventText.picksGroup(role) {
                        Picker(String(localized: "community.event.group", defaultValue: "Группа"), selection: $groupID) {
                            Text(verbatim: "—").tag("")
                            ForEach(groups) { Text($0.name).tag($0.id) }
                        }
                    }
                    if audience == "FACULTY", role == .universityAdmin {
                        Picker(String(localized: "community.event.faculty", defaultValue: "Факультет"), selection: $facultyID) {
                            Text(verbatim: "—").tag("")
                            ForEach(faculties) { Text($0.name).tag($0.id) }
                        }
                    }
                }
            }
            Section {
                TextField(String(localized: "community.event.title", defaultValue: "Название"), text: $title)
                TextField(String(localized: "community.event.description", defaultValue: "Описание"), text: $details, axis: .vertical)
                    .lineLimit(3...10)
            }
            Section {
                DatePicker(String(localized: "community.event.starts", defaultValue: "Начало"), selection: $startsAt)
                Toggle(String(localized: "community.event.hasEnd", defaultValue: "Указать окончание"), isOn: $hasEnd)
                if hasEnd {
                    DatePicker(String(localized: "community.event.ends", defaultValue: "Окончание"), selection: $endsAt, in: startsAt...)
                }
                TextField(String(localized: "community.event.location", defaultValue: "Место"), text: $location)
            }
            Section {
                Toggle(String(localized: "community.event.online", defaultValue: "Онлайн"), isOn: $isOnline)
                if isOnline {
                    TextField(String(localized: "community.event.meetingURL", defaultValue: "Ссылка на встречу"), text: $meetingURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField(String(localized: "community.event.meetingPasscode", defaultValue: "Код доступа"), text: $passcode)
                        .textInputAutocapitalization(.never)
                }
            } footer: {
                if !urlIsValid {
                    FieldError(message: String(localized: "profile.website.invalid", defaultValue: "Адрес сайта должен начинаться с http:// или https://"))
                }
            }
        }
        .onAppear(perform: fill)
        .task {
            if CommunityEventText.picksGroup(role) { groups = (try? await api.groups()) ?? [] }
            if role == .universityAdmin { faculties = (try? await api.faculties()) ?? [] }
        }
    }

    private var audiences: [String] {
        let list = CommunityEventText.audiences(for: role)
        return list.isEmpty ? ["GROUP"] : list
    }

    private var trimmedURL: String { meetingURL.trimmingCharacters(in: .whitespaces) }
    private var urlIsValid: Bool {
        trimmedURL.isEmpty || ((trimmedURL.hasPrefix("https://") || trimmedURL.hasPrefix("http://")) && trimmedURL.count <= 500)
    }

    private var canSave: Bool {
        let titleOK = !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && title.count <= 200
        let detailsOK = !details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && details.count <= 5000
        let groupOK = event != nil || audience != "GROUP" || !CommunityEventText.picksGroup(role) || !groupID.isEmpty
        let facultyOK = event != nil || audience != "FACULTY" || role != .universityAdmin || !facultyID.isEmpty
        return titleOK && detailsOK && urlIsValid && groupOK && facultyOK && (!hasEnd || endsAt > startsAt)
    }

    private func fill() {
        guard !didFill else { return }
        didFill = true
        audience = audiences.first ?? "GROUP"
        guard let event else { return }
        title = event.title
        details = event.description ?? ""
        location = event.location ?? ""
        isOnline = event.isOnline ?? false
        startsAt = event.startsAt
        if let end = event.endsAt {
            hasEnd = true
            endsAt = end
        }
    }

    private func optional(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    @MainActor
    private func save() async throws {
        if let event {
            // Ссылку на встречу карточка не отдаёт: пустое поле при правке значит «не менять».
            var fields: [String: JSONValue] = [
                "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
                "description": .string(details.trimmingCharacters(in: .whitespacesAndNewlines)),
                "location": optional(location).map(JSONValue.string) ?? .null,
                "isOnline": .bool(isOnline),
                "startsAt": .string(JSONCoding.isoString(startsAt)),
                "endsAt": hasEnd ? .string(JSONCoding.isoString(endsAt)) : .null,
            ]
            if !isOnline {
                fields["meetingUrl"] = .null
            } else if let url = optional(meetingURL) {
                fields["meetingUrl"] = .string(url)
                fields["meetingPasscode"] = optional(passcode).map(JSONValue.string) ?? .null
            }
            saved(try await api.updateEvent(id: event.id, fields: fields))
        } else {
            let input = CommunityEventInput(
                audience: audience,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                description: details.trimmingCharacters(in: .whitespacesAndNewlines),
                location: optional(location),
                isOnline: isOnline,
                meetingUrl: isOnline ? optional(meetingURL) : nil,
                meetingPasscode: isOnline ? optional(passcode) : nil,
                startsAt: startsAt,
                endsAt: hasEnd ? endsAt : nil,
                groupId: audience == "GROUP" && !groupID.isEmpty ? groupID : nil,
                facultyId: audience == "FACULTY" && !facultyID.isEmpty ? facultyID : nil
            )
            saved(try await api.createEvent(input))
        }
    }
}

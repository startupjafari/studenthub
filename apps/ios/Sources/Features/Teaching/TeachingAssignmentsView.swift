import SwiftUI

/// Задания преподавателя: свои дисциплины, создание, публикация, закрытие, правка,
/// удаление. Нажатие на задание ведёт к сданным работам и проверке.
struct TeachingAssignmentsView: View {
    @State private var status: String?
    @State private var loader = PagedLoader<TeachingAssignmentDTO>(limit: 20) { request in
        try await TeachingAPI().assignments(request, status: nil)
    }
    @State private var queue: TeachingReviewQueueDTO?
    /// Очередь «Ждут проверки» не пришла: без полосы блок просто исчезал бы, и
    /// преподаватель решил бы, что проверять нечего.
    @State private var queueFailure: String?
    @State private var queueOffline = false
    @State private var creating = false
    @State private var editing: TeachingAssignmentDTO?
    @State private var deleting: TeachingAssignmentDTO?
    @State private var actionFailure: String?

    private let api = TeachingAPI()

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "teaching.assignments.empty", defaultValue: "Вы ещё не создали задания"),
                symbol: "doc.text",
                hint: String(localized: "teaching.assignments.empty.hint", defaultValue: "Создайте задание для своей дисциплины."),
                actionTitle: String(localized: "teaching.assignments.new", defaultValue: "Создать задание"),
                action: { creating = true }
            )
        ) {
            // Сбой самого списка уже занимает экран — вторая ошибка над ним лишняя.
            if let queueFailure, loader.failure == nil {
                StaleDataBanner(message: queueFailure, isOffline: queueOffline) { await loadQueue() }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if let queue, queue.total > 0 {
                Section {
                    ForEach(queue.items) { item in
                        NavigationLink(value: AppRoute.teacher(.assignmentSubmissions(assignmentID: item.id))) {
                            TelegramStyleRow(
                                title: item.title,
                                subtitle: item.subject,
                                meta: item.dueAt.map { DisplayFormat.date($0) },
                                metaTint: StudyDue.tint(item.dueAt)
                            ) {
                                RowSymbol(symbol: "tray.full.fill", tint: TileTint.orange)
                            } accessory: {
                                TeachingCounter(count: item.pending, tint: TileTint.orange)
                            }
                        }
                    }
                } header: {
                    Text(String(localized: "teaching.assignments.queue", defaultValue: "Ждут проверки: \(queue.total.formatted())"))
                }
            }
            FilterChipsRow(options: Self.filters, selection: $status)
        } row: { assignment in
            NavigationLink(value: AppRoute.teacher(.assignmentSubmissions(assignmentID: assignment.id))) {
                TeachingAssignmentRow(assignment: assignment)
            }
            .contextMenu { menu(for: assignment) }
            .swipeActions {
                Button(role: .destructive) {
                    deleting = assignment
                } label: {
                    Label(String(localized: "teaching.delete", defaultValue: "Удалить"), systemImage: "trash")
                }
                Button {
                    editing = assignment
                } label: {
                    Label(String(localized: "teaching.edit", defaultValue: "Изменить"), systemImage: "pencil")
                }
                .tint(Palette.info)
            }
        }
        .navigationTitle(Text(String(localized: "teaching.assignments.title", defaultValue: "Задания")))
        .floatingAction(String(localized: "teaching.assignments.new", defaultValue: "Создать задание")) {
            creating = true
        }
        .sheet(isPresented: $creating) {
            TeachingAssignmentForm(assignment: nil) { await reload() }
        }
        .sheet(item: $editing) { assignment in
            TeachingAssignmentForm(assignment: assignment) { await reload() }
        }
        .confirmDestructive(
            $deleting,
            title: { assignment in
                assignment.status == "DRAFT"
                    ? String(localized: "teaching.assignments.delete.confirm", defaultValue: "Удалить задание «\(assignment.title)»?")
                    : String(localized: "teaching.assignments.delete.confirmPublished", defaultValue: "«\(assignment.title)»: черновики студентов удалятся вместе с заданием. Если работы уже сданы, удалить не получится — задание можно закрыть.")
            },
            actionTitle: String(localized: "teaching.delete", defaultValue: "Удалить")
        ) { assignment in
            await run(conflict: String(localized: "teaching.assignments.delete.hasWork", defaultValue: "По заданию есть сданные работы — удалить нельзя. Закройте задание, чтобы прекратить приём.")) {
                try await api.deleteAssignment(id: assignment.id)
            }
        }
        .actionFailureAlert($actionFailure)
        .onChange(of: status) { Task { await applyFilter() } }
        .task { await loadQueue() }
    }

    private static let filters: [(value: String?, title: String)] = [
        (nil, String(localized: "teaching.filter.all", defaultValue: "Все")),
        ("PUBLISHED", TeachingText.assignmentStatus("PUBLISHED").text),
        ("DRAFT", TeachingText.assignmentStatus("DRAFT").text),
        ("CLOSED", TeachingText.assignmentStatus("CLOSED").text),
    ]

    @ViewBuilder
    private func menu(for assignment: TeachingAssignmentDTO) -> some View {
        Button {
            editing = assignment
        } label: {
            Label(String(localized: "teaching.edit", defaultValue: "Изменить"), systemImage: "pencil")
        }
        switch assignment.status {
        case "DRAFT":
            Button {
                Task { await run { try await api.publishAssignment(id: assignment.id) } }
            } label: {
                Label(String(localized: "teaching.assignments.publish", defaultValue: "Опубликовать"), systemImage: "paperplane")
            }
        case "PUBLISHED":
            Button {
                Task { await run { try await api.closeAssignment(id: assignment.id) } }
            } label: {
                Label(String(localized: "teaching.assignments.close", defaultValue: "Закрыть приём"), systemImage: "xmark.circle")
            }
        case "CLOSED":
            Button {
                Task { await run { try await api.publishAssignment(id: assignment.id) } }
            } label: {
                Label(String(localized: "teaching.assignments.reopen", defaultValue: "Открыть снова"), systemImage: "arrow.uturn.backward")
            }
        default:
            EmptyView()
        }
        Button(role: .destructive) {
            deleting = assignment
        } label: {
            Label(String(localized: "teaching.delete", defaultValue: "Удалить"), systemImage: "trash")
        }
    }

    @MainActor
    private func applyFilter() async {
        let status = status
        await loader.replace { request in try await TeachingAPI().assignments(request, status: status) }
    }

    @MainActor
    private func reload() async {
        await loader.reload()
        await loadQueue()
    }

    @MainActor
    private func loadQueue() async {
        do {
            queue = try await api.reviewQueue(limit: 5)
            queueFailure = nil
        } catch is CancellationError {
            return
        } catch {
            // Прошлая очередь остаётся на экране — полоса говорит, что она несвежая.
            queueFailure = error.userMessage
            queueOffline = error.isOffline
        }
    }

    /// Конфликт смены статуса значит, что задание уже перевели в другом окне, — список
    /// перечитывается в любом случае, чтобы меню показало действия настоящего статуса.
    @MainActor
    private func run(conflict: String? = nil, _ action: () async throws -> Void) async {
        do {
            try await action()
        } catch {
            actionFailure = teachingFailure(
                error,
                conflict: conflict ?? String(localized: "teaching.assignments.statusChanged", defaultValue: "Статус задания уже изменился — список обновлён")
            )
        }
        await reload()
    }
}

/// Задание строкой как чат: значок типа, название, срок справа, ниже — дисциплина,
/// группа и тип; статус плашкой.
private struct TeachingAssignmentRow: View {
    let assignment: TeachingAssignmentDTO

    var body: some View {
        let status = TeachingText.assignmentStatus(assignment.status)
        let overdue: Bool = assignment.status == "PUBLISHED" && StudyDue.isPast(assignment.dueAt)
        let course: String = [assignment.course?.subject.name, assignment.course?.group?.name]
            .compactMap { $0 }
            .joined(separator: " · ")
        let lines: [String] = [course, TeachingText.assignmentType(assignment.type)].filter { !$0.isEmpty }
        TelegramStyleRow(
            title: assignment.title,
            subtitle: lines.joined(separator: "\n"),
            meta: assignment.dueAt.map { DisplayFormat.date($0) }
                ?? String(localized: "teaching.assignments.noDue", defaultValue: "Без срока"),
            metaTint: overdue ? Palette.destructive : Palette.mutedForeground
        ) {
            RowSymbol(
                symbol: teachingAssignmentSymbol(assignment.type),
                tint: assignment.status == "DRAFT" ? Color.gray : ScheduleSubjectTint.color(for: assignment.course?.subject.name ?? assignment.title)
            )
        } accessory: {
            StatusBadge(text: status.text, tint: status.tint)
        }
    }
}

/// Создание и правка задания. У опубликованного правки видны студентам сразу.
struct TeachingAssignmentForm: View {
    let assignment: TeachingAssignmentDTO?
    let saved: () async -> Void

    @State private var courses: [CourseDTO] = []
    @State private var coursesFailure: String?
    @State private var coursesOffline = false
    @State private var courseID = ""
    @State private var title = ""
    @State private var description = ""
    @State private var type = "HOMEWORK"
    @State private var submissionType = "TEXT"
    @State private var maxScore = ""
    @State private var hasDue = false
    @State private var dueAt = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
    @State private var allowLate = false

    init(assignment: TeachingAssignmentDTO?, saved: @escaping () async -> Void) {
        self.assignment = assignment
        self.saved = saved
        if let assignment {
            _title = State(initialValue: assignment.title)
            _description = State(initialValue: assignment.description ?? "")
            _type = State(initialValue: assignment.type)
            _submissionType = State(initialValue: assignment.submissionType)
            _maxScore = State(initialValue: assignment.maxScore.map(String.init) ?? "")
            _hasDue = State(initialValue: assignment.dueAt != nil)
            _dueAt = State(initialValue: assignment.dueAt ?? Date())
            _allowLate = State(initialValue: assignment.allowLate ?? false)
        }
    }

    var body: some View {
        FormSheet(
            title: assignment == nil
                ? String(localized: "teaching.assignments.new", defaultValue: "Создать задание")
                : String(localized: "teaching.assignments.edit", defaultValue: "Изменить задание"),
            saveTitle: assignment == nil
                ? String(localized: "teaching.create", defaultValue: "Создать")
                : String(localized: "common.save", defaultValue: "Сохранить"),
            canSave: isValid,
            save: save,
            saved: saved
        ) {
            if assignment == nil {
                if let coursesFailure {
                    // Дисциплины не пришли — пустой выбор без объяснения выглядел бы как «у вас их нет».
                    Section {
                        StaleDataBanner(message: coursesFailure, isOffline: coursesOffline) { await loadCourses() }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    }
                }
                Section {
                    TeachingCoursePicker(courses: courses, selection: $courseID)
                }
            }
            Section {
                TextField(String(localized: "teaching.assignments.field.title", defaultValue: "Название"), text: $title)
                TextField(String(localized: "teaching.assignments.field.description", defaultValue: "Описание"), text: $description, axis: .vertical)
                    .lineLimit(3...10)
            }
            Section {
                Picker(String(localized: "teaching.assignments.field.type", defaultValue: "Тип"), selection: $type) {
                    ForEach(TeachingText.assignmentTypes, id: \.self) { Text(TeachingText.assignmentType($0)).tag($0) }
                }
                Picker(String(localized: "teaching.assignments.field.submissionType", defaultValue: "Способ сдачи"), selection: $submissionType) {
                    ForEach(TeachingText.submissionTypes, id: \.self) { Text(TeachingText.submissionType($0)).tag($0) }
                }
                TextField(String(localized: "teaching.assignments.field.maxScore", defaultValue: "Максимальный балл"), text: $maxScore)
                    .keyboardType(.numberPad)
            }
            Section {
                Toggle(String(localized: "teaching.assignments.field.hasDue", defaultValue: "Срок сдачи"), isOn: $hasDue)
                if hasDue {
                    DatePicker(String(localized: "teaching.assignments.field.dueAt", defaultValue: "Сдать до"), selection: $dueAt)
                }
                Toggle(String(localized: "teaching.assignments.field.allowLate", defaultValue: "Разрешить позднюю сдачу"), isOn: $allowLate)
            } footer: {
                if let assignment, assignment.status != "DRAFT" {
                    Text(String(localized: "teaching.assignments.editPublishedHint", defaultValue: "Студенты уже видят задание — изменения появятся у них сразу"))
                }
            }
        }
        .task {
            guard assignment == nil, courses.isEmpty else { return }
            await loadCourses()
        }
    }

    @MainActor
    private func loadCourses() async {
        do {
            courses = try await CoursesAPI().courses(mine: true)
            coursesFailure = nil
            if courses.count == 1 { courseID = courses[0].id }
        } catch is CancellationError {
            return
        } catch {
            coursesFailure = error.userMessage
            coursesOffline = error.isOffline
        }
    }

    private var parsedMax: Int? { Int(maxScore.trimmingCharacters(in: .whitespaces)) }

    private var isValid: Bool {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 200 else { return false }
        if assignment == nil, courseID.isEmpty { return false }
        if !maxScore.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let max = parsedMax, (1...1000).contains(max) else { return false }
        }
        return true
    }

    private func save() async throws {
        let api = TeachingAPI()
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
        if let assignment {
            // Только изменённые поля: открыть и сохранить без правок не должно «менять»
            // срок опубликованного задания и оставлять след в аудите.
            var fields: [String: JSONValue] = [:]
            if name != assignment.title { fields["title"] = .string(name) }
            if text != (assignment.description ?? "").trimmingCharacters(in: .whitespacesAndNewlines) { fields["description"] = .text(text) }
            if type != assignment.type { fields["type"] = .string(type) }
            if submissionType != assignment.submissionType { fields["submissionType"] = .string(submissionType) }
            if parsedMax != assignment.maxScore { fields["maxScore"] = .int(parsedMax) }
            let newDue: Date? = hasDue ? dueAt : nil
            if !Self.sameMinute(newDue, assignment.dueAt) { fields["dueAt"] = .date(newDue) }
            if allowLate != (assignment.allowLate ?? false) { fields["allowLate"] = .bool(allowLate) }
            guard !fields.isEmpty else { return }
            try await api.updateAssignment(id: assignment.id, JSONBody(fields))
        } else {
            var fields: [String: JSONValue] = [
                "courseId": .string(courseID),
                "title": .string(name),
                "type": .string(type),
                "submissionType": .string(submissionType),
                "allowLate": .bool(allowLate),
            ]
            if !text.isEmpty { fields["description"] = .string(text) }
            if let max = parsedMax { fields["maxScore"] = .int(max) }
            if hasDue { fields["dueAt"] = .date(dueAt) }
            try await api.createAssignment(JSONBody(fields))
        }
    }

    private static func sameMinute(_ lhs: Date?, _ rhs: Date?) -> Bool {
        switch (lhs, rhs) {
        case (nil, nil): return true
        case let (l?, r?): return Int(l.timeIntervalSince1970 / 60) == Int(r.timeIntervalSince1970 / 60)
        default: return false
        }
    }
}

// MARK: - Сданные работы

/// Сданные работы задания: статус, попытка, балл. Нажатие — проверка работы.
struct TeachingSubmissionsView: View {
    let assignmentID: String

    @State private var assignment: TeachingAssignmentDTO?
    @State private var submissions: [TeachingSubmissionDTO]?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var filter: String?
    @State private var editing = false

    private let api = TeachingAPI()

    var body: some View {
        List {
            if let assignment {
                Section {
                    let status = TeachingText.assignmentStatus(assignment.status)
                    HeroHeader(
                        visual: Self.visual(assignment),
                        title: assignment.title,
                        subtitle: StudyText.join([assignment.course?.subject.name, assignment.course?.group?.name]),
                        actions: editActions
                    ) {
                        HStack(spacing: Spacing.sm) {
                            StatusBadge(text: status.text, tint: status.tint)
                            StatusBadge(text: TeachingText.assignmentType(assignment.type), tint: Palette.mutedForeground)
                        }
                    }
                }
                Section {
                    DetailRow(
                        title: String(localized: "student.assignment.due", defaultValue: "Срок сдачи"),
                        value: assignment.dueAt.map { DisplayFormat.dateTime($0) } ?? String(localized: "teaching.assignments.noDue", defaultValue: "Без срока"),
                        symbol: "calendar.badge.clock"
                    )
                    if let max = assignment.maxScore {
                        DetailRow(title: String(localized: "student.assignment.maxScore", defaultValue: "Макс. балл"), value: max.formatted(), symbol: "star")
                    }
                    DetailRow(
                        title: String(localized: "teaching.assignments.field.submissionType", defaultValue: "Способ сдачи"),
                        value: TeachingText.submissionType(assignment.submissionType),
                        symbol: "tray.and.arrow.up"
                    )
                    if let description = assignment.description, !description.isEmpty {
                        Text(description)
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                            .textSelection(.enabled)
                    }
                }
            }
            if let submissions {
                if !submissions.isEmpty {
                    FilterChipsRow(options: filterOptions(submissions), selection: $filter)
                }
                let visible = submissions.filter { filter == nil || $0.status == filter }
                if visible.isEmpty {
                    EmptyStateView(
                        title: String(localized: "teaching.submissions.empty", defaultValue: "Сдач пока нет"),
                        symbol: "tray",
                        hint: String(localized: "teaching.submissions.empty.hint", defaultValue: "Работы студентов появятся здесь после отправки.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(visible) { submission in
                            NavigationLink {
                                TeachingSubmissionReviewView(
                                    submission: submission,
                                    maxScore: assignment?.maxScore,
                                    returnable: assignment?.status == "PUBLISHED"
                                ) { await load() }
                            } label: {
                                submissionRow(submission)
                            }
                        }
                    }
                }
            } else if assignment != nil, let failure {
                // Задание открылось, а сдачи нет — сбой строкой под его шапкой.
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .screenState(assignment == nil && submissions == nil) {
            if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(TeacherScreen.assignmentSubmissions(assignmentID: assignmentID).title))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editing) {
            if let assignment {
                TeachingAssignmentForm(assignment: assignment) { await load() }
            }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private static func visual(_ assignment: TeachingAssignmentDTO) -> HeroVisual {
        let tint: Color = ScheduleSubjectTint.color(for: assignment.course?.subject.name ?? assignment.title)
        return HeroVisual.symbol(teachingAssignmentSymbol(assignment.type), tint: tint)
    }

    private var editActions: [HeroAction] {
        let edit = HeroAction(title: String(localized: "teaching.edit", defaultValue: "Изменить"), symbol: "pencil") { editing = true }
        return [edit]
    }

    private func filterOptions(_ submissions: [TeachingSubmissionDTO]) -> [(value: String?, title: String)] {
        var options: [(value: String?, title: String)] = [(nil, String(localized: "teaching.filter.all", defaultValue: "Все"))]
        for status in ["SUBMITTED", "GRADED", "RETURNED", "DRAFT"] {
            let count = submissions.filter { $0.status == status }.count
            if count > 0 { options.append((status, "\(TeachingText.submissionStatus(status).text) · \(count.formatted())")) }
        }
        return options
    }

    /// Работа строкой как чат: аватар студента, имя, время сдачи справа, ниже —
    /// попытка и балл, статус плашкой.
    private func submissionRow(_ submission: TeachingSubmissionDTO) -> some View {
        let status = TeachingText.submissionStatus(submission.status)
        var lines: [String] = []
        if let attempt = submission.attemptNumber {
            lines.append(String(localized: "teaching.submissions.attempt", defaultValue: "Попытка \(attempt.formatted())"))
        }
        if let score = submission.score {
            lines.append(String(localized: "teaching.submissions.score", defaultValue: "Балл: \(score.formatted())"))
        }
        return TelegramStyleRow(
            title: submission.student.name,
            subtitle: lines.joined(separator: " · "),
            meta: submission.submittedAt.map { DisplayFormat.relative($0) }
        ) {
            AvatarView(url: submission.student.avatarUrl, name: submission.student.name, size: 44)
        } accessory: {
            StatusBadge(text: status.text, tint: status.tint)
        }
    }

    @MainActor
    private func load() async {
        do {
            async let detail = api.assignment(id: assignmentID)
            async let list = api.submissions(assignmentID: assignmentID)
            assignment = try await detail
            submissions = try await list
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

/// Проверка одной работы: текст, ссылка, файлы; балл и комментарий; возврат на
/// доработку. Оценённую можно переоценить, но не вернуть — это решают до оценки.
private struct TeachingSubmissionReviewView: View {
    let submission: TeachingSubmissionDTO
    let maxScore: Int?
    let returnable: Bool
    let changed: () async -> Void

    @State private var score: String
    @State private var feedback: String
    @State private var regrading = false
    @State private var isSaving = false
    @State private var failure: String?
    @State private var opener = RemoteFileOpener()
    @Environment(\.dismiss) private var dismiss

    init(submission: TeachingSubmissionDTO, maxScore: Int?, returnable: Bool, changed: @escaping () async -> Void) {
        self.submission = submission
        self.maxScore = maxScore
        self.returnable = returnable
        self.changed = changed
        _score = State(initialValue: submission.score.map(String.init) ?? "")
        // Комментарий подставляется только у оценённой: у сданной там был бы отзыв
        // «на доработку» к прошлой попытке, и он молча стал бы отзывом к оценке.
        _feedback = State(initialValue: submission.status == "GRADED" ? (submission.feedback ?? "") : "")
    }

    private var gradable: Bool { submission.status == "SUBMITTED" }

    private var profileActions: [HeroAction] {
        let id = submission.student.id
        let profile = HeroAction(title: String(localized: "teaching.submissions.profile", defaultValue: "Профиль"), symbol: "person.fill") {
            teachingPush(.profile(id: id))
        }
        return [profile]
    }
    private var formOpen: Bool { gradable || regrading }
    private var ceiling: Int { maxScore ?? 1000 }

    var body: some View {
        Form {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            Section {
                let status = TeachingText.submissionStatus(submission.status)
                HeroHeader(
                    visual: HeroVisual.avatar(url: submission.student.avatarUrl, name: submission.student.name),
                    title: submission.student.name,
                    actions: profileActions
                ) {
                    StatusBadge(text: status.text, tint: status.tint)
                }
            }
            Section {
                if let attempt = submission.attemptNumber {
                    DetailRow(title: String(localized: "teaching.submissions.attemptTitle", defaultValue: "Попытка"), value: attempt.formatted())
                }
                if let submittedAt = submission.submittedAt {
                    DetailRow(title: String(localized: "teaching.submissions.submittedTitle", defaultValue: "Сдано"), value: DisplayFormat.dateTime(submittedAt))
                }
                if let gradedBy = submission.gradedBy {
                    DetailRow(title: String(localized: "teaching.submissions.gradedBy", defaultValue: "Проверил"), value: gradedBy.name)
                }
            }

            Section(String(localized: "teaching.submissions.answer", defaultValue: "Ответ")) {
                if let text = submission.text, !text.isEmpty {
                    Text(text).textSelection(.enabled)
                } else {
                    Text(String(localized: "teaching.submissions.noText", defaultValue: "Без текста"))
                        .foregroundStyle(Palette.mutedForeground)
                }
                if let link = submission.linkUrl, let url = URL(string: link) {
                    Link(destination: url) {
                        Label(link, systemImage: "link").lineLimit(2)
                    }
                }
            }

            if let files = submission.files, !files.isEmpty {
                Section(String(localized: "teaching.submissions.files", defaultValue: "Файлы")) {
                    ForEach(Array(files.enumerated()), id: \.element.id) { index, file in
                        let name = file.name ?? String(localized: "teaching.submissions.fileN", defaultValue: "Файл \((index + 1).formatted())")
                        Button {
                            Task {
                                await opener.open(name: name) {
                                    try await TeachingAPI().submissionFileURL(submissionID: submission.id, fileID: file.id)
                                }
                            }
                        } label: {
                            IconRow(title: name, symbol: "doc.fill", tint: TileTint.indigo, value: DisplayFormat.fileSize(file.size))
                        }
                    }
                }
            }

            if formOpen {
                Section {
                    TextField(String(localized: "teaching.submissions.scoreField", defaultValue: "Балл от 0 до \(ceiling.formatted())"), text: $score)
                        .keyboardType(.numberPad)
                    TextField(String(localized: "teaching.submissions.feedback", defaultValue: "Комментарий"), text: $feedback, axis: .vertical)
                        .lineLimit(3...8)
                } header: {
                    Text(String(localized: "teaching.submissions.grading", defaultValue: "Оценивание"))
                } footer: {
                    if gradable && returnable {
                        Text(String(localized: "teaching.submissions.returnHint", defaultValue: "Чтобы вернуть работу на исправление, напишите комментарий — что поправить."))
                    }
                }

                Section {
                    Button {
                        Task { await grade() }
                    } label: {
                        Label(regrading
                            ? String(localized: "teaching.submissions.saveGrade", defaultValue: "Сохранить оценку")
                            : String(localized: "teaching.submissions.publishGrade", defaultValue: "Поставить балл"),
                            systemImage: "checkmark.circle.fill")
                            .fontWeight(.semibold)
                    }
                    .disabled(isSaving)
                    if gradable && returnable {
                        Button {
                            Task { await returnForFix() }
                        } label: {
                            Label(String(localized: "teaching.submissions.return", defaultValue: "Вернуть на исправление"), systemImage: "arrow.uturn.backward.circle")
                                .foregroundStyle(Palette.warning)
                        }
                        .disabled(isSaving)
                    }
                }
            } else {
                Section {
                    if let score = submission.score {
                        DetailRow(title: String(localized: "teaching.submissions.scoreTitle", defaultValue: "Балл"), value: maxScore.map { "\(score) / \($0)" } ?? "\(score)")
                    }
                    if let note = submission.feedback, !note.isEmpty {
                        Text(note).foregroundStyle(Palette.foreground)
                    }
                    if submission.status == "GRADED" {
                        Button(String(localized: "teaching.submissions.regrade", defaultValue: "Изменить оценку")) { regrading = true }
                    }
                } header: {
                    Text(String(localized: "teaching.submissions.grading", defaultValue: "Оценивание"))
                }
            }
        }
        .navigationTitle(Text(submission.student.name))
        .navigationBarTitleDisplayMode(.inline)
        .remoteFilePreview(opener)
        .overlay { if isSaving { ProgressView() } }
    }

    @MainActor
    private func grade() async {
        guard let value = Int(score.trimmingCharacters(in: .whitespaces)) else {
            failure = String(localized: "teaching.submissions.scoreRequired", defaultValue: "Укажите балл")
            return
        }
        guard (0...ceiling).contains(value) else {
            failure = String(localized: "teaching.submissions.scoreRange", defaultValue: "Балл от 0 до \(ceiling.formatted())")
            return
        }
        await perform {
            // Пустой комментарий уходит пустой строкой: сервер очищает поле.
            try await TeachingAPI().grade(
                submissionID: submission.id,
                score: value,
                feedback: feedback.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
    }

    @MainActor
    private func returnForFix() async {
        let text = feedback.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            failure = String(localized: "teaching.submissions.feedbackRequired", defaultValue: "Добавьте комментарий")
            return
        }
        await perform { try await TeachingAPI().returnSubmission(id: submission.id, feedback: text) }
    }

    @MainActor
    private func perform(_ action: () async throws -> Void) async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await action()
            await changed()
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}

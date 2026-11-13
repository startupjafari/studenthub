import SwiftUI

/// Задания (веб `/assignments`). Студенту — вкладки по статусу сдачи («Активные»,
/// «На проверке», «Проверено», «Просрочено») со счётчиками; преподавателю сдавать
/// нечего, у него плоский список (проверка работ — в его разделе).
struct AssignmentsView: View {
    /// Преподавателю сдавать нечего: состояние «Не сдано» в строке было бы неправдой.
    var isStudent = true

    @State private var loader = PagedLoader<AssignmentDTO>(limit: 100) { request in
        try await StudentStudyAPI().assignments(page: request.page, limit: request.limit)
    }
    @State private var tab: AssignmentsTab = .active

    var body: some View {
        List {
            if loader.isLoaded {
                if let failure = loader.failure {
                    StaleDataBanner(message: failure, isOffline: loader.isOffline) { await loader.reload() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if !loader.items.isEmpty {
                    if isStudent {
                        FilterChipsRow(options: tabOptions, selection: tabSelection)
                    }
                    Section {
                        ForEach(visible) { assignment in
                            NavigationLink(value: AppRoute.assignment(id: assignment.id)) {
                                AssignmentRow(assignment: assignment, isStudent: isStudent)
                            }
                        }
                        // Вкладки делят загруженное по статусу сдачи, которого сервер не
                        // фильтрует, — поэтому следующая страница по кнопке, как в вебе.
                        if loader.hasMore, let last = loader.items.last {
                            Button {
                                Task { await loader.loadMore(after: last) }
                            } label: {
                                HStack {
                                    Text(String(localized: "student.assignments.showMore", defaultValue: "Показать ещё"))
                                    if loader.isLoading { Spacer(); ProgressView() }
                                }
                            }
                            .disabled(loader.isLoading)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(!loader.isLoaded || visible.isEmpty) {
            if loader.isLoaded, loader.items.isEmpty {
                EmptyStateView(
                    title: String(localized: "study.noAssignments", defaultValue: "Заданий пока нет"),
                    symbol: "list.clipboard",
                    hint: isStudent ? String(localized: "student.assignments.emptyHint", defaultValue: "Все актуальные задания появятся здесь.") : nil
                )
            } else if loader.isLoaded {
                EmptyStateView(
                    title: String(localized: "student.assignments.tabEmpty", defaultValue: "Здесь пока пусто"),
                    symbol: "tray"
                )
            } else if let failure = loader.failure {
                ErrorStateView(message: failure, isOffline: loader.isOffline) { await loader.reload() }
            } else {
                LoadingStateView()
            }
        }
        .pullToRefresh { await loader.reload() }
        .task { await loader.loadIfNeeded() }
        .navigationTitle(Text(String(localized: "study.assignments", defaultValue: "Задания")))
    }

    /// Задания выбранной вкладки (у преподавателя вкладок нет — все).
    private var visible: [AssignmentDTO] {
        isStudent ? loader.items.filter { tab.includes(StudentAssignmentStatus.of($0)) } : loader.items
    }

    private var tabOptions: [(value: AssignmentsTab?, title: String)] {
        AssignmentsTab.allCases.map { tab -> (value: AssignmentsTab?, title: String) in
            let number: String = count(tab).formatted()
            return (value: tab, title: tab.title + " " + number)
        }
    }

    private var tabSelection: Binding<AssignmentsTab?> {
        Binding(get: { tab }, set: { tab = $0 ?? .active })
    }

    private func count(_ tab: AssignmentsTab) -> Int {
        loader.items.filter { tab.includes(StudentAssignmentStatus.of($0)) }.count
    }
}

/// Вкладки списка студента: «Активные» — всё, по чему ещё предстоит работать;
/// закрытое без сданной работы — в «Просроченных»: сдать его уже нельзя.
private enum AssignmentsTab: CaseIterable, Hashable {
    case active, submitted, graded, overdue

    var title: String {
        switch self {
        case .active: return String(localized: "student.assignments.tab.active", defaultValue: "Активные")
        case .submitted: return StudentAssignmentStatus.submitted.title
        case .graded: return StudentAssignmentStatus.graded.title
        case .overdue: return StudentAssignmentStatus.overdue.title
        }
    }

    func includes(_ status: StudentAssignmentStatus) -> Bool {
        switch self {
        case .active: return status == .notStarted || status == .draft || status == .returned
        case .submitted: return status == .submitted
        case .graded: return status == .graded
        case .overdue: return status == .overdue || status == .closed
        }
    }
}

/// Задание строкой как чат: значок цвета дисциплины, название, срок справа, ниже —
/// дисциплина и плашка статуса (или балл, если проверено).
private struct AssignmentRow: View {
    let assignment: AssignmentDTO
    let isStudent: Bool

    var body: some View {
        let status = StudentAssignmentStatus.of(assignment)
        let overdue: Bool = isStudent ? status == .overdue : StudyDue.isPast(assignment.dueAt)
        TelegramStyleRow(
            title: assignment.title,
            subtitle: StudyText.join([assignment.subject, StudyText.dateTime(assignment.dueAt)], separator: "\n"),
            meta: assignment.dueAt.map { DisplayFormat.relative($0) },
            // Просроченное выделяем цветом: это единственное, что человек ищет в списке глазами.
            metaTint: overdue ? Palette.destructive : Palette.mutedForeground
        ) {
            RowSymbol(
                symbol: AssignmentDetailView.typeSymbol(assignment.type),
                tint: ScheduleSubjectTint.color(for: assignment.subject ?? assignment.title)
            )
        } accessory: {
            if isStudent {
                if let score = assignment.mySubmission?.score, assignment.mySubmission?.status == "GRADED" {
                    Text(verbatim: assignment.maxScore.map { "\(score) / \($0)" } ?? String(score))
                        .font(Typography.tabular(.subheadline.weight(.semibold)))
                        .foregroundStyle(Palette.success)
                } else {
                    StatusBadge(text: status.title, tint: status.tint)
                }
            }
        }
    }
}

/// Карточка задания (веб `student-assignment-detail.tsx`): автор, срок, максимум,
/// описание, итог проверки или замечания, форма сдачи по способу сдачи задания
/// (текст, ссылка, файлы), попытка и время отправки, черновик и отправка.
struct AssignmentDetailView: View {
    let assignmentID: String
    /// Сдача — только студенту: преподавателю `PUT …/submission` отвечает 403.
    var isStudent = true

    @Environment(\.openURL) private var openURL
    @State private var remote = RemoteValue<AssignmentDTO>()
    @State private var files: StudentSubmissionFilesModel?
    @State private var text = ""
    @State private var link = ""
    @State private var syncedText: String?
    @State private var syncedLink: String?
    @State private var busy: Action?
    @State private var failure: String?
    @State private var notice: String?

    private enum Action { case draft, submit }

    private let api = StudyAPI()

    private var assignment: AssignmentDTO? { remote.value }

    var body: some View {
        Form {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
            }
            // Обновление не удалось, а задание на экране — полосой, набранное не трогаем.
            if assignment != nil, let loadFailure = remote.failure {
                StaleDataBanner(message: loadFailure, isOffline: remote.isOffline) { await reload() }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }

            if let assignment {
                summary(assignment)
                if isStudent {
                    result(assignment)
                    work(assignment)
                }
            }
        }
        .screenState(assignment == nil) {
            if let failure = remote.failure {
                ErrorStateView(message: failure, isOffline: remote.isOffline) { await reload() }
            } else if remote.checkedCache {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(String(localized: "study.assignment", defaultValue: "Задание")))
        .navigationBarTitleDisplayMode(.inline)
        .pullToRefresh { await reload() }
        .modifier(FilesPresentation(files: files))
        .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .onChange(of: remote.checkedCache) { syncFields() }
        // Возврат приложения из фона после долгой паузы — повод перечитать (`AppLifecycle`).
        .task(id: AppLifecycle.shared.foregroundEpoch) {
            if files == nil {
                let filesModel = StudentSubmissionFilesModel(assignmentID: assignmentID)
                filesModel.onChanged = { await self.reload() }
                files = filesModel
            }
            await reload()
        }
    }

    // MARK: Разделы

    @ViewBuilder
    private func summary(_ assignment: AssignmentDTO) -> some View {
        Section {
            HeroHeader(
                visual: HeroVisual.symbol(Self.typeSymbol(assignment.type), tint: ScheduleSubjectTint.color(for: assignment.subject ?? assignment.title)),
                title: assignment.title,
                subtitle: assignment.subject
            ) {
                HStack(spacing: Spacing.sm) {
                    if isStudent {
                        let status = StudentAssignmentStatus.of(assignment)
                        StatusBadge(text: status.title, tint: status.tint)
                    }
                    if let type = assignment.type {
                        StatusBadge(text: Self.typeTitle(type), tint: Palette.mutedForeground)
                    }
                }
            }
        }
        Section {
            if let author = assignment.createdBy, !author.name.isEmpty {
                NavigationLink(value: AppRoute.profile(id: author.id)) {
                    DetailRow(title: String(localized: "student.assignment.author", defaultValue: "Преподаватель"), value: author.name, symbol: "person")
                }
            }
            if let due = assignment.dueAt {
                DetailRow(title: String(localized: "student.assignment.due", defaultValue: "Срок сдачи"), value: DisplayFormat.dateTime(due), symbol: "calendar.badge.clock")
            }
            if let max = assignment.maxScore {
                DetailRow(title: String(localized: "student.assignment.maxScore", defaultValue: "Макс. балл"), value: String(max), symbol: "star")
            }
        }
        if let description = assignment.description, !description.isEmpty {
            Section {
                Text(description)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .textSelection(.enabled)
            } header: {
                Text(String(localized: "student.assignment.description", defaultValue: "Описание"))
            }
        }
    }

    @ViewBuilder
    private func result(_ assignment: AssignmentDTO) -> some View {
        if let submission = assignment.mySubmission, submission.status == "GRADED" {
            Section {
                Label {
                    Text(verbatim: assignment.maxScore.map { "\(submission.score ?? 0) / \($0)" } ?? String(submission.score ?? 0))
                        .font(Typography.tabular(Typography.metric))
                } icon: {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.success)
                }
                if let feedback = submission.feedback, !feedback.isEmpty {
                    Text(feedback)
                        .font(Typography.body)
                        .textSelection(.enabled)
                }
            } header: {
                Text(String(localized: "student.assignment.result", defaultValue: "Результат проверки"))
            }
        } else if let submission = assignment.mySubmission, submission.status == "RETURNED", let feedback = submission.feedback, !feedback.isEmpty {
            Section {
                Text(feedback)
                    .font(Typography.body)
                    .textSelection(.enabled)
            } header: {
                Text(String(localized: "student.assignment.needsFix", defaultValue: "Требуются исправления"))
                    .foregroundStyle(Palette.warning)
            }
        }
    }

    @ViewBuilder
    private func work(_ assignment: AssignmentDTO) -> some View {
        let editable = StudentAssignmentStatus.canEdit(assignment)
        let type = assignment.submissionType ?? "MIXED"
        let submission = assignment.mySubmission
        let attached = submission?.files ?? []
        Section {
            if type == "TEXT" || type == "MIXED" {
                TextField(text: $text, axis: .vertical) {
                    Text(verbatim: String(localized: "study.answer", defaultValue: "Ответ"))
                }
                .lineLimit(3...12)
                .disabled(!editable)
            }
            if type == "LINK" || type == "MIXED" {
                if editable {
                    TextField(text: $link) {
                        Text(verbatim: String(localized: "student.assignment.link", defaultValue: "Ссылка на работу"))
                    }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                } else if let url = submission?.linkUrl, let target = URL(string: url) {
                    Button {
                        openURL(target)
                    } label: {
                        Label(url, systemImage: "link")
                            .lineLimit(2)
                    }
                }
            }
            if let submission {
                Text(verbatim: [
                    submission.attemptNumber.map { String(localized: "student.assignment.attempt", defaultValue: "Попытка \(String($0))") },
                    submission.submittedAt.map { String(localized: "student.assignment.submittedAt", defaultValue: "отправлено \(DisplayFormat.dateTime($0))") },
                ].compactMap { $0 }.joined(separator: " · "))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            }
            let status = StudentAssignmentStatus.of(assignment)
            if status == .overdue || status == .closed {
                Text(status == .closed
                    ? String(localized: "student.assignment.closedHint", defaultValue: "Задание закрыто — приём работ завершён")
                    : String(localized: "student.assignment.deadlineHint", defaultValue: "Срок сдачи истёк — отправить работу уже нельзя"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            if editable {
                Button {
                    Task { await saveDraft() }
                } label: {
                    HStack {
                        Text(String(localized: "student.assignment.saveDraft", defaultValue: "Сохранить черновик"))
                        if busy == .draft { Spacer(); ProgressView() }
                    }
                }
                .disabled(busy != nil)
                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        Label(String(localized: "study.submit", defaultValue: "Сдать работу"), systemImage: "paperplane")
                        if busy == .submit { Spacer(); ProgressView() }
                    }
                }
                .disabled(busy != nil)
            }
        } header: {
            Text(String(localized: "study.yourWork", defaultValue: "Ваша работа"))
        }

        // Файлы — у «Файла» и «Смешанного»; уже приложенные видны при любом типе, чтобы
        // смена типа преподавателем не прятала сданное.
        if let files, type == "FILE" || type == "MIXED" || !attached.isEmpty {
            StudentSubmissionFilesSection(model: files, submissionID: submission?.id, files: attached, isEditable: editable)
        }
    }

    // MARK: Действия

    @MainActor
    private func reload() async {
        let id = assignmentID
        await remote.load { try await StudyAPI().assignment(id: id) }
        syncFields()
    }

    /// Поля синхронизируются по значениям с сервера: после загрузки файла задание
    /// приходит заново, и набранный, но не сохранённый ответ не должен стираться.
    /// Зовётся и когда задание встало из сохранённого — до ответа сети, чтобы ответ
    /// с тем же текстом не затёр начатое за это время.
    @MainActor
    private func syncFields() {
        let serverText = assignment?.mySubmission?.text ?? ""
        let serverLink = assignment?.mySubmission?.linkUrl ?? ""
        if serverText != syncedText {
            text = serverText
            syncedText = serverText
        }
        if serverLink != syncedLink {
            link = serverLink
            syncedLink = serverLink
        }
    }

    @MainActor
    private func saveDraft() async {
        guard busy == nil else { return }
        busy = .draft
        defer { busy = nil }
        do {
            try await api.saveSubmissionDraft(assignmentID: assignmentID, text: text.isEmpty ? nil : text, linkURL: link.isEmpty ? nil : link)
            await reload()
            failure = nil
            notice = String(localized: "student.assignment.draftSaved", defaultValue: "Черновик сохранён")
        } catch {
            failure = error.userMessage
        }
    }

    /// Сначала сохраняем черновик, потом отправляем: на сервере это два шага, и
    /// отправка без сохранения отправила бы пустую работу.
    @MainActor
    private func submit() async {
        guard busy == nil else { return }
        busy = .submit
        defer { busy = nil }
        do {
            try await api.saveSubmissionDraft(
                assignmentID: assignmentID,
                text: text.isEmpty ? nil : text,
                linkURL: link.isEmpty ? nil : link
            )
            try await api.submit(assignmentID: assignmentID)
            await reload()
            failure = nil
            notice = String(localized: "student.assignment.submitted", defaultValue: "Работа отправлена")
        } catch {
            failure = error.userMessage
        }
    }

    /// Значок по типу задания — в строке списка и в шапке карточки.
    static func typeSymbol(_ type: String?) -> String {
        switch type {
        case "LAB": return "flask.fill"
        case "COURSEWORK": return "doc.text.fill"
        case "PROJECT": return "hammer.fill"
        default: return "list.clipboard.fill"
        }
    }

    static func typeTitle(_ type: String) -> String {
        switch type {
        case "HOMEWORK": return String(localized: "student.assignment.type.homework", defaultValue: "Домашнее задание")
        case "LAB": return String(localized: "student.assignment.type.lab", defaultValue: "Лабораторная")
        case "COURSEWORK": return String(localized: "student.assignment.type.coursework", defaultValue: "Курсовая")
        case "PROJECT": return String(localized: "student.assignment.type.project", defaultValue: "Проект")
        case "OTHER": return String(localized: "student.assignment.type.other", defaultValue: "Другое")
        default: return type
        }
    }
}

/// Окна файлов работы — только когда модель уже создана.
private struct FilesPresentation: ViewModifier {
    let files: StudentSubmissionFilesModel?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let files {
            content.studentSubmissionFilesPresentation(files)
        } else {
            content
        }
    }
}

/// Материалы (веб — раздел дисциплины): фильтр по дисциплине, описание, ссылка,
/// файлы с открытием системным просмотрщиком.
struct MaterialsView: View {
    @Environment(\.openURL) private var openURL
    @State private var subject: String?
    @State private var subjects: [StudentMaterialSubjectDTO] = []
    @State private var opener = RemoteFileOpener()
    @State private var loader = PagedLoader<MaterialDTO>(limit: 30) { request in
        try await StudentStudyAPI().materials(subject: nil, request: request)
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "study.noMaterials", defaultValue: "Материалов пока нет"),
                symbol: "folder"
            ),
            header: {
                if subjects.count > 1 {
                    FilterChipsRow(options: subjectOptions, selection: $subject)
                }
            },
            row: { material in
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    TelegramStyleRow(
                        title: material.title,
                        subtitle: StudyText.join([material.subject, material.teacher?.name]),
                        meta: material.createdAt.map { DisplayFormat.date($0) }
                    ) {
                        RowSymbol(symbol: "folder.fill", tint: ScheduleSubjectTint.color(for: material.subject ?? material.title))
                    }
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        if let description = material.description, !description.isEmpty {
                            Text(description)
                                .font(.subheadline)
                                .foregroundStyle(Palette.foreground)
                                .lineLimit(6)
                        }
                        if let raw = material.url, let url = URL(string: raw) {
                            Button {
                                openURL(url)
                            } label: {
                                Label(String(localized: "student.materials.openLink", defaultValue: "Открыть ссылку"), systemImage: "link")
                                    .font(.subheadline.weight(.medium))
                            }
                            .buttonStyle(.borderless)
                        }
                        ForEach(material.files ?? []) { file in
                            Button {
                                open(material: material, file: file)
                            } label: {
                                Label {
                                    Text(verbatim: [file.name ?? String(localized: "student.files.file", defaultValue: "Файл"), DisplayFormat.fileSize(file.size)]
                                        .filter { !$0.isEmpty }.joined(separator: " · "))
                                } icon: {
                                    Image(systemName: StudentSubmissionFilesSection.symbol(for: file.mime))
                                }
                                .font(.subheadline)
                                .lineLimit(2)
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                    // Под текстом строки, а не под значком — как вложения в чате.
                    .padding(.leading, 44 + Spacing.lg)
                }
                .padding(.vertical, Spacing.xs)
            }
        )
        .navigationTitle(Text(String(localized: "study.materials", defaultValue: "Материалы")))
        .remoteFilePreview(opener)
        .task {
            if subjects.isEmpty, let list = try? await StudentStudyAPI().materialSubjects() {
                subjects = list
            }
        }
        .onChange(of: subject) { _, value in
            Task {
                await loader.replace { request in
                    try await StudentStudyAPI().materials(subject: value, request: request)
                }
            }
        }
    }

    private var subjectOptions: [(value: String?, title: String)] {
        var options: [(value: String?, title: String)] = [(nil, String(localized: "student.filter.all", defaultValue: "Все"))]
        for entry in subjects {
            guard let name = entry.subject, !name.isEmpty else { continue }
            options.append((name, "\(name) · \(entry.count)"))
        }
        return options
    }

    private func open(material: MaterialDTO, file: MaterialDTO.File) {
        Task {
            await opener.open(name: file.name ?? file.id) {
                try await StudentStudyAPI().materialFileURL(materialID: material.id, fileID: file.id)
            }
        }
    }
}

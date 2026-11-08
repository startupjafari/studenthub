import SwiftUI

/// Экзамены преподавателя: предстоящие и прошедшие, период, назначение, правка,
/// удаление. Ведомость — на экране экзамена.
struct TeachingExamsView: View {
    @Environment(\.viewerID) private var viewerID

    /// `nil` — предстоящие, `past` — прошедшие.
    @State private var tab: String?
    @State private var usesPeriod = false
    @State private var periodFrom = Calendar.current.date(byAdding: .month, value: -1, to: Date()) ?? Date()
    @State private var periodTo = Calendar.current.date(byAdding: .month, value: 1, to: Date()) ?? Date()
    @State private var exams: [TeachingExamDTO]?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var creating = false
    @State private var editing: TeachingExamDTO?
    @State private var deleting: TeachingExamDTO?
    @State private var actionFailure: String?

    private let api = TeachingAPI()
    /// Предел выдачи сервера (`EXAM_LIST_LIMIT`).
    private static let listLimit = 200

    var body: some View {
        List {
            FilterChipsRow(
                options: [
                    (nil, String(localized: "teaching.exams.upcoming", defaultValue: "Предстоящие")),
                    ("past", String(localized: "teaching.exams.past", defaultValue: "Прошедшие")),
                ],
                selection: $tab
            )
            Section {
                Toggle(String(localized: "teaching.exams.period", defaultValue: "Период"), isOn: $usesPeriod)
                if usesPeriod {
                    DatePicker(String(localized: "teaching.exams.from", defaultValue: "С"), selection: $periodFrom, displayedComponents: .date)
                    DatePicker(String(localized: "teaching.exams.to", defaultValue: "По"), selection: $periodTo, in: periodFrom..., displayedComponents: .date)
                }
            }

            if let exams {
                if exams.isEmpty {
                    EmptyStateView(
                        title: tab == nil
                            ? String(localized: "teaching.exams.empty", defaultValue: "Экзамены не назначены")
                            : String(localized: "teaching.exams.pastEmpty", defaultValue: "Прошедших экзаменов нет"),
                        symbol: "rosette",
                        hint: tab == nil ? String(localized: "teaching.exams.empty.hint", defaultValue: "Назначьте экзамен по дисциплине.") : nil,
                        actionTitle: tab == nil ? String(localized: "teaching.exams.new", defaultValue: "Назначить экзамен") : nil,
                        action: tab == nil ? { creating = true } : nil
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(exams) { exam in
                            NavigationLink(value: AppRoute.teacher(.exam(id: exam.id))) {
                                TeachingExamRow(exam: exam)
                            }
                            .contextMenu { menu(for: exam) }
                            .swipeActions {
                                if canManage(exam) {
                                    Button(role: .destructive) {
                                        deleting = exam
                                    } label: {
                                        Label(String(localized: "teaching.delete", defaultValue: "Удалить"), systemImage: "trash")
                                    }
                                    Button {
                                        editing = exam
                                    } label: {
                                        Label(String(localized: "teaching.edit", defaultValue: "Изменить"), systemImage: "pencil")
                                    }
                                    .tint(Palette.info)
                                }
                            }
                        }
                    } footer: {
                        if exams.count >= Self.listLimit {
                            Text(String(localized: "teaching.exams.capped", defaultValue: "Показаны только ближайшие \(Self.listLimit.formatted()). Чтобы найти остальные, выберите период."))
                        }
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(TeacherScreen.exams.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    creating = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel(Text(String(localized: "teaching.exams.new", defaultValue: "Назначить экзамен")))
            }
        }
        .sheet(isPresented: $creating) {
            TeachingExamForm(exam: nil) { await load() }
        }
        .sheet(item: $editing) { exam in
            TeachingExamForm(exam: exam) { await load() }
        }
        .confirmDestructive(
            $deleting,
            title: { exam in
                exam.date > Date()
                    ? String(localized: "teaching.exams.delete.confirm", defaultValue: "Удалить экзамен «\(exam.course.subject.name)», группа \(exam.group.name)? Студенты группы получат уведомление об отмене.")
                    : String(localized: "teaching.exams.delete.confirmPast", defaultValue: "Удалить экзамен «\(exam.course.subject.name)», группа \(exam.group.name)? Удаление необратимо.")
            },
            actionTitle: String(localized: "teaching.delete", defaultValue: "Удалить")
        ) { exam in
            do {
                try await api.deleteExam(id: exam.id)
            } catch {
                actionFailure = teachingFailure(error, conflict: String(localized: "teaching.exams.delete.hasResults", defaultValue: "По экзамену уже выставлены результаты — удалить его нельзя"))
            }
            await load()
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task(id: query) { await load() }
    }

    /// Экзаменатор, не читающий дисциплину, ведёт только ведомость: править и удалять
    /// экзамен может преподаватель дисциплины (так же решает сервер).
    private func canManage(_ exam: TeachingExamDTO) -> Bool {
        exam.course.teacherId == viewerID
    }

    @ViewBuilder
    private func menu(for exam: TeachingExamDTO) -> some View {
        if canManage(exam) {
            Button {
                editing = exam
            } label: {
                Label(String(localized: "teaching.edit", defaultValue: "Изменить"), systemImage: "pencil")
            }
            Button(role: .destructive) {
                deleting = exam
            } label: {
                Label(String(localized: "teaching.delete", defaultValue: "Удалить"), systemImage: "trash")
            }
        }
    }

    /// Ключ запроса: вкладка и период. Граница вкладок — начало сегодняшнего дня:
    /// утренний экзамен остаётся в «предстоящих», где по нему заполняют ведомость.
    private var query: String {
        "\(tab ?? "upcoming")|\(usesPeriod)|\(TeachingAPI.day(periodFrom))|\(TeachingAPI.day(periodTo))"
    }

    @MainActor
    private func load() async {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let from = usesPeriod ? calendar.startOfDay(for: periodFrom) : nil
        let to = usesPeriod ? calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: periodTo)) : nil
        do {
            if tab == nil {
                let lower = max(from ?? today, today)
                exams = try await api.exams(mine: false, from: lower, to: to)
            } else {
                let upper = min(to ?? today, today)
                // Прошедшие — свежие сверху: сервер отдаёт по возрастанию даты.
                exams = Array(try await api.exams(mine: false, from: from, to: upper).reversed())
            }
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

private struct TeachingExamRow: View {
    let exam: TeachingExamDTO

    var body: some View {
        var details = [TeachingText.examFormat(exam.format)]
        if let room = exam.room?.name { details.append(room) }
        return ListCardRow(
            title: exam.course.subject.name,
            subtitle: exam.group.name,
            lines: [
                exam.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute()),
                details.joined(separator: " · "),
                exam.examiner.map { String(localized: "teaching.exams.examinerLine", defaultValue: "Экзаменатор: \($0.name)") } ?? "",
            ]
        )
    }
}

/// Экран экзамена: сведения и ведомость — допуск, итог, балл по каждому студенту.
struct TeachingExamDetailView: View {
    let examID: String

    @Environment(\.viewerID) private var viewerID
    @Environment(\.dismiss) private var dismiss

    @State private var exam: TeachingExamDTO?
    @State private var roster: [TeachingExamRosterDTO.Entry] = []
    @State private var drafts: [String: TeachingExamDraft] = [:]
    @State private var failure: String?
    @State private var isOffline = false
    @State private var saveFailure: String?
    @State private var isSaving = false
    @State private var editing = false
    @State private var deleting: TeachingExamDTO?
    @State private var actionFailure: String?
    @State private var query = ""

    private let api = TeachingAPI()

    var body: some View {
        List {
            if let exam {
                if let saveFailure {
                    FormAlert(message: saveFailure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    DetailRow(title: String(localized: "teaching.exams.group", defaultValue: "Группа"), value: exam.group.name)
                    DetailRow(
                        title: String(localized: "teaching.exams.date", defaultValue: "Дата и время"),
                        value: exam.date.formatted(.dateTime.weekday(.wide).day().month(.wide).hour().minute())
                    )
                    DetailRow(title: String(localized: "teaching.exams.format", defaultValue: "Формат"), value: TeachingText.examFormat(exam.format))
                    DetailRow(title: String(localized: "teaching.room", defaultValue: "Аудитория"), value: exam.room?.name ?? "—")
                    DetailRow(title: String(localized: "teaching.exams.examiner", defaultValue: "Экзаменатор"), value: exam.examiner?.name ?? "—")
                    if let max = exam.maxScore {
                        DetailRow(title: String(localized: "teaching.exams.maxScore", defaultValue: "Макс. балл"), value: max.formatted())
                    }
                    if let note = exam.note, !note.isEmpty {
                        Text(note).font(Typography.body).foregroundStyle(Palette.foreground)
                    }
                }

                Section {
                    if roster.isEmpty {
                        Text(String(localized: "teaching.exams.noStudents", defaultValue: "В группе нет студентов"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(visibleRoster) { entry in
                        rosterRow(entry, ceiling: Double(exam.maxScore ?? 1000))
                    }
                } header: {
                    Text(String(localized: "teaching.exams.roster", defaultValue: "Ведомость"))
                } footer: {
                    Text(String(localized: "teaching.exams.roster.footer", defaultValue: "Недопущенному нельзя поставить «Сдан» или «Не сдан». Сохраняются только изменённые строки."))
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(exam?.course.subject.name ?? TeacherScreen.exam(id: examID).title))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: Text(String(localized: "teaching.searchStudent", defaultValue: "Найти студента")))
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if isSaving {
                    ProgressView()
                } else {
                    Button(String(localized: "common.save", defaultValue: "Сохранить")) { Task { await save() } }
                        .disabled(drafts.isEmpty)
                }
            }
            if let exam, exam.course.teacherId == viewerID {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            editing = true
                        } label: {
                            Label(String(localized: "teaching.edit", defaultValue: "Изменить"), systemImage: "pencil")
                        }
                        Button(role: .destructive) {
                            deleting = exam
                        } label: {
                            Label(String(localized: "teaching.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel(Text(String(localized: "teaching.actions", defaultValue: "Действия")))
                }
            }
        }
        .sheet(isPresented: $editing) {
            if let exam {
                TeachingExamForm(exam: exam) { await load() }
            }
        }
        .confirmDestructive(
            $deleting,
            title: { _ in String(localized: "teaching.exams.delete.title", defaultValue: "Удалить экзамен?") },
            actionTitle: String(localized: "teaching.delete", defaultValue: "Удалить")
        ) { exam in
            do {
                try await api.deleteExam(id: exam.id)
                dismiss()
            } catch {
                actionFailure = teachingFailure(error, conflict: String(localized: "teaching.exams.delete.hasResults", defaultValue: "По экзамену уже выставлены результаты — удалить его нельзя"))
            }
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task { await load() }
    }

    private var visibleRoster: [TeachingExamRosterDTO.Entry] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return needle.isEmpty ? roster : roster.filter { $0.name.lowercased().contains(needle) }
    }

    private func draft(_ entry: TeachingExamRosterDTO.Entry) -> TeachingExamDraft {
        drafts[entry.id] ?? TeachingExamDraft(entry)
    }

    private func update(_ entry: TeachingExamRosterDTO.Entry, _ change: (inout TeachingExamDraft) -> Void) {
        var value = draft(entry)
        change(&value)
        drafts[entry.id] = value == TeachingExamDraft(entry) ? nil : value
    }

    private func rosterRow(_ entry: TeachingExamRosterDTO.Entry, ceiling: Double) -> some View {
        let value = draft(entry)
        let errors = value.errors(ceiling: ceiling)
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                Text(entry.name).font(Typography.body).foregroundStyle(Palette.foreground)
                Spacer()
                if let attempt = entry.attempt, attempt > 1 {
                    Text(String(localized: "teaching.exams.attempt", defaultValue: "Попытка \(attempt.formatted())"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            Toggle(
                String(localized: "teaching.exams.admitted", defaultValue: "Допуск"),
                isOn: Binding(get: { value.admitted }, set: { on in update(entry) { $0.admitted = on } })
            )
            HStack {
                Picker(
                    String(localized: "teaching.exams.status", defaultValue: "Статус"),
                    selection: Binding(get: { value.status }, set: { status in update(entry) { $0.status = status } })
                ) {
                    ForEach(TeachingText.examStatuses, id: \.self) { Text(TeachingText.examStatus($0).text).tag($0) }
                }
                .pickerStyle(.menu)
                .tint(errors.status ? Palette.destructive : TeachingText.examStatus(value.status).tint)
                Spacer()
                TextField(
                    String(localized: "teaching.exams.score", defaultValue: "Балл"),
                    text: Binding(get: { value.score }, set: { score in update(entry) { $0.score = score } })
                )
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 72)
                .foregroundStyle(errors.score ? Palette.destructive : Palette.foreground)
            }
            if errors.status {
                FieldError(message: String(localized: "teaching.exams.notAdmittedStatus", defaultValue: "Недопущенному нельзя поставить «Сдан» или «Не сдан»"))
            }
            if errors.score {
                FieldError(message: String(localized: "teaching.exams.scoreRange", defaultValue: "Балл от 0 до \(JSONValue.format(ceiling))"))
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    @MainActor
    private func load() async {
        do {
            async let detail = api.exam(id: examID)
            async let results = api.examResults(id: examID)
            exam = try await detail
            roster = try await results.students.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func save() async {
        let ceiling = Double(exam?.maxScore ?? 1000)
        if drafts.values.contains(where: { $0.errors(ceiling: ceiling).any }) {
            saveFailure = String(localized: "teaching.exams.rosterInvalid", defaultValue: "Ведомость заполнена с ошибками — исправьте выделенные поля")
            return
        }
        isSaving = true
        defer { isSaving = false }
        do {
            try await api.saveExamResults(
                examID: examID,
                entries: drafts.map { id, draft in
                    TeachingExamResultEntry(
                        studentId: id,
                        admitted: draft.admitted,
                        status: draft.status,
                        score: TeachingText.parseScore(draft.score),
                        note: draft.note
                    )
                }
            )
            drafts = [:]
            saveFailure = nil
            await load()
        } catch {
            saveFailure = error.userMessage
        }
    }
}

/// Черновик строки ведомости.
struct TeachingExamDraft: Equatable {
    var admitted: Bool
    var status: String
    var score: String
    var note: String?

    init(_ entry: TeachingExamRosterDTO.Entry) {
        admitted = entry.admitted
        status = entry.status
        score = entry.score.map(JSONValue.format) ?? ""
        note = entry.note
    }

    func errors(ceiling: Double) -> (score: Bool, status: Bool, any: Bool) {
        var scoreBad = false
        let trimmed = score.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
            if let value = TeachingText.parseScore(trimmed) {
                scoreBad = value < 0 || value > ceiling
            } else {
                scoreBad = true
            }
        }
        let statusBad = !admitted && (status == "PASSED" || status == "FAILED")
        return (scoreBad, statusBad, scoreBad || statusBad)
    }
}

/// Назначение и правка экзамена. Экзаменатора преподаватель не выбирает — им
/// становится он сам или тот, кого назначит деканат.
struct TeachingExamForm: View {
    let exam: TeachingExamDTO?
    let saved: () async -> Void

    @State private var courses: [CourseDTO] = []
    @State private var courseID = ""
    @State private var date: Date
    @State private var format: String
    @State private var room: TeachingNamedRef?
    @State private var maxScore: String
    @State private var note: String

    init(exam: TeachingExamDTO?, saved: @escaping () async -> Void) {
        self.exam = exam
        self.saved = saved
        let defaultDate = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()) ?? Date()
        _date = State(initialValue: exam?.date ?? defaultDate)
        _format = State(initialValue: exam?.format ?? "WRITTEN")
        _room = State(initialValue: exam?.room)
        _maxScore = State(initialValue: exam?.maxScore.map(String.init) ?? "")
        _note = State(initialValue: exam?.note ?? "")
    }

    var body: some View {
        FormSheet(
            title: exam == nil
                ? String(localized: "teaching.exams.new", defaultValue: "Назначить экзамен")
                : String(localized: "teaching.exams.edit", defaultValue: "Изменить экзамен"),
            saveTitle: exam == nil
                ? String(localized: "teaching.exams.create", defaultValue: "Назначить")
                : String(localized: "common.save", defaultValue: "Сохранить"),
            canSave: isValid,
            save: save,
            saved: saved
        ) {
            if exam == nil {
                Section {
                    TeachingCoursePicker(courses: courses, selection: $courseID)
                }
            }
            Section {
                DatePicker(String(localized: "teaching.exams.date", defaultValue: "Дата и время"), selection: $date)
                Picker(String(localized: "teaching.exams.format", defaultValue: "Формат"), selection: $format) {
                    ForEach(TeachingText.examFormats, id: \.self) { Text(TeachingText.examFormat($0)).tag($0) }
                }
                TeachingRoomField(room: $room)
                TextField(String(localized: "teaching.exams.maxScoreField", defaultValue: "Макс. балл (необязательно)"), text: $maxScore)
                    .keyboardType(.numberPad)
                TextField(String(localized: "teaching.exams.note", defaultValue: "Примечание"), text: $note, axis: .vertical)
                    .lineLimit(2...5)
            }
        }
        .task {
            guard exam == nil, courses.isEmpty else { return }
            courses = (try? await CoursesAPI().courses(mine: true)) ?? []
            if courses.count == 1 { courseID = courses[0].id }
        }
    }

    private var parsedMax: Int? { Int(maxScore.trimmingCharacters(in: .whitespaces)) }

    private var isValid: Bool {
        if exam == nil, courseID.isEmpty { return false }
        if note.count > 2000 { return false }
        if !maxScore.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let max = parsedMax, (1...1000).contains(max) else { return false }
        }
        return true
    }

    private func save() async throws {
        let api = TeachingAPI()
        let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if let exam {
                var fields: [String: JSONValue] = [:]
                if Int(date.timeIntervalSince1970 / 60) != Int(exam.date.timeIntervalSince1970 / 60) { fields["date"] = .date(date) }
                if format != exam.format { fields["format"] = .string(format) }
                if room?.id != exam.room?.id { fields["roomId"] = room.map { .string($0.id) } ?? .null }
                if parsedMax != exam.maxScore { fields["maxScore"] = .int(parsedMax) }
                if text != (exam.note ?? "") { fields["note"] = .text(text) }
                guard !fields.isEmpty else { return }
                try await api.updateExam(id: exam.id, JSONBody(fields))
            } else {
                var fields: [String: JSONValue] = [
                    "courseId": .string(courseID),
                    "date": .date(date),
                    "format": .string(format),
                ]
                if let room { fields["roomId"] = .string(room.id) }
                if let max = parsedMax { fields["maxScore"] = .int(max) }
                if !text.isEmpty { fields["note"] = .string(text) }
                try await api.createExam(JSONBody(fields))
            }
        } catch let error as APIError where error.code == .conflict {
            // Общий текст конфликта не говорит, с чем пересеклось.
            throw APIError.server(
                code: .conflict,
                message: String(localized: "teaching.exams.conflict", defaultValue: "В это время у группы, аудитории или экзаменатора уже есть другой экзамен"),
                details: [],
                statusCode: 409
            )
        }
    }
}

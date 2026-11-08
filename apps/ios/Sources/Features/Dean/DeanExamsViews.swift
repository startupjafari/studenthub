import SwiftUI

/// Экзамены факультета: предстоящие и прошедшие, период, назначение, правка, удаление,
/// ведомость. Граница вкладок — начало сегодняшнего дня: утренний экзамен остаётся в
/// «предстоящих», где по нему и заполняют ведомость.
struct DeanExamsView: View {
    private enum Tab: Hashable { case upcoming, past }

    @State private var tab: Tab? = .upcoming
    @State private var exams: [DeanExam]?
    @State private var failure: String?
    @State private var periodOn = false
    @State private var periodFrom = Calendar.current.startOfDay(for: Date())
    @State private var periodTo = Calendar.current.date(byAdding: .month, value: 1, to: Calendar.current.startOfDay(for: Date())) ?? Date()
    @State private var creating = false
    @State private var editing: DeanExam?
    @State private var deleting: DeanExam?
    @State private var actionFailure: String?

    private let api = DeanAPI()
    private let today = Calendar.current.startOfDay(for: Date())
    /// Потолок выдачи сервера (`EXAM_LIST_LIMIT`).
    private static let cap = 200

    var body: some View {
        List {
            FilterChipsRow(
                options: [
                    (Tab.upcoming, String(localized: "dean.exams.upcoming", defaultValue: "Предстоящие")),
                    (Tab.past, String(localized: "dean.exams.past", defaultValue: "Прошедшие")),
                ],
                selection: $tab
            )

            Section {
                Toggle(String(localized: "dean.exams.period", defaultValue: "Период"), isOn: $periodOn)
                if periodOn {
                    DatePicker(String(localized: "dean.exams.from", defaultValue: "С"), selection: $periodFrom, displayedComponents: .date)
                    DatePicker(String(localized: "dean.exams.to", defaultValue: "По"), selection: $periodTo, in: periodFrom..., displayedComponents: .date)
                }
            }

            if let exams {
                if exams.isEmpty {
                    EmptyStateView(
                        title: tab == .past
                            ? String(localized: "dean.exams.pastEmpty", defaultValue: "Прошедших экзаменов нет")
                            : String(localized: "dean.exams.empty", defaultValue: "Экзаменов не назначено"),
                        symbol: "graduationcap",
                        hint: tab == .past ? nil : String(localized: "dean.exams.emptyHint", defaultValue: "Назначьте экзамен — группа получит уведомление"),
                        actionTitle: tab == .past ? nil : String(localized: "dean.exams.new", defaultValue: "Назначить экзамен"),
                        action: tab == .past ? nil : { creating = true }
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(exams) { exam in
                            NavigationLink(value: AppRoute.dean(.examRoster(id: exam.id))) {
                                ListCardRow(
                                    title: exam.course.subject.name,
                                    subtitle: DisplayFormat.dateTime(exam.date),
                                    status: (DeanText.examFormat(exam.format), Palette.mutedForeground),
                                    lines: [
                                        [exam.group.name, exam.room?.name].compactMap { $0 }.joined(separator: " · "),
                                        exam.examiner.map { String(localized: "dean.exams.examinerLine", defaultValue: "Экзаменатор: \($0.name)") } ?? "",
                                    ]
                                )
                            }
                            .swipeActions {
                                Button(role: .destructive) {
                                    deleting = exam
                                } label: {
                                    Label(String(localized: "dean.delete", defaultValue: "Удалить"), systemImage: "trash")
                                }
                                Button {
                                    editing = exam
                                } label: {
                                    Label(String(localized: "dean.edit", defaultValue: "Изменить"), systemImage: "pencil")
                                }
                            }
                            .contextMenu {
                                Button {
                                    editing = exam
                                } label: {
                                    Label(String(localized: "dean.edit", defaultValue: "Изменить"), systemImage: "pencil")
                                }
                                Button(role: .destructive) {
                                    deleting = exam
                                } label: {
                                    Label(String(localized: "dean.delete", defaultValue: "Удалить"), systemImage: "trash")
                                }
                            }
                        }
                    } footer: {
                        if exams.count >= Self.cap {
                            Text(String(localized: "dean.exams.capped", defaultValue: "Показаны первые \(Self.cap.formatted()) — сузьте период."))
                        }
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(DeanScreen.exams.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    creating = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel(Text(String(localized: "dean.exams.new", defaultValue: "Назначить экзамен")))
            }
        }
        .refreshable { await load() }
        .task(id: QueryKey(tab: tab, periodOn: periodOn, from: periodFrom, to: periodTo)) { await load() }
        .sheet(isPresented: $creating) {
            DeanExamForm(exam: nil) { await load() }
        }
        .sheet(item: $editing) { exam in
            DeanExamForm(exam: exam) { await load() }
        }
        .confirmDestructive(
            $deleting,
            title: { exam in
                exam.date > Date()
                    ? String(localized: "dean.exams.deleteConfirm", defaultValue: "Удалить экзамен «\(exam.course.subject.name)» у группы \(exam.group.name)? Группа получит уведомление об отмене.")
                    : String(localized: "dean.exams.deletePastConfirm", defaultValue: "Удалить прошедший экзамен «\(exam.course.subject.name)» у группы \(exam.group.name)?")
            },
            actionTitle: String(localized: "dean.delete", defaultValue: "Удалить")
        ) { exam in
            await delete(exam)
        }
        .actionFailureAlert($actionFailure)
    }

    private struct QueryKey: Equatable {
        let tab: Tab?
        let periodOn: Bool
        let from: Date
        let to: Date
    }

    @MainActor
    private func load() async {
        let calendar = Calendar.current
        let from = periodOn ? calendar.startOfDay(for: periodFrom) : nil
        let to = periodOn ? calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: periodTo)) : nil
        let range: (Date?, Date?)
        if tab == .past {
            range = (from, min(to ?? today, today))
        } else {
            range = (max(from ?? today, today), to)
        }
        do {
            let list = try await api.exams(from: range.0, to: range.1)
            // Предстоящие — ближайший сверху, прошедшие — свежий сверху.
            exams = tab == .past ? list.sorted { $0.date > $1.date } : list.sorted { $0.date < $1.date }
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func delete(_ exam: DeanExam) async {
        do {
            try await api.deleteExam(id: exam.id)
            exams?.removeAll { $0.id == exam.id }
        } catch {
            if let api = error as? APIError, api.code == .conflict {
                actionFailure = String(localized: "dean.exams.deleteHasResults", defaultValue: "По экзамену уже выставлены результаты — удалить его нельзя.")
            } else {
                actionFailure = error.userMessage
            }
        }
    }
}

/// Назначение и правка экзамена: дисциплина, дата и время, формат, аудитория,
/// экзаменатор, максимум. Правка шлёт только изменённые поля — лишнее поле означало бы
/// ложный «перенос» с уведомлением группе.
private struct DeanExamForm: View {
    let exam: DeanExam?
    let saved: () async -> Void

    @State private var course: DeanPickOption?
    @State private var date: Date
    @State private var format: String
    @State private var room: DeanPickOption?
    @State private var examiner: DeanPickOption?
    @State private var maxScore: String

    private let api = DeanAPI()

    init(exam: DeanExam?, saved: @escaping () async -> Void) {
        self.exam = exam
        self.saved = saved
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date().rounded(minutes: 30)) ?? Date()
        _date = State(initialValue: exam?.date ?? tomorrow)
        _format = State(initialValue: exam?.format ?? "WRITTEN")
        _room = State(initialValue: exam?.room.map { DeanPickOption(id: $0.id, title: $0.name) })
        _examiner = State(initialValue: exam?.examiner.map { DeanPickOption(id: $0.id, title: $0.name) })
        _maxScore = State(initialValue: exam.map { $0.maxScore.map { String($0) } ?? "" } ?? "100")
    }

    private var maxScoreValue: Int?? {
        let trimmed = maxScore.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return exam == nil ? nil : .some(nil) }
        guard let value = Int(trimmed), (1...1000).contains(value) else { return nil }
        return .some(value)
    }

    var body: some View {
        FormSheet(
            title: exam == nil
                ? String(localized: "dean.exams.new", defaultValue: "Назначить экзамен")
                : String(localized: "dean.exams.edit", defaultValue: "Экзамен"),
            canSave: maxScoreValue != nil && (exam != nil || course != nil),
            save: { try await save() },
            saved: saved
        ) {
            Section {
                if let exam {
                    DetailRow(title: String(localized: "dean.courses.col.subject", defaultValue: "Дисциплина"), value: exam.course.subject.name)
                    DetailRow(title: String(localized: "dean.group.name", defaultValue: "Группа"), value: exam.group.name)
                } else {
                    DeanPickerField(
                        title: String(localized: "dean.courses.col.subject", defaultValue: "Дисциплина"),
                        selection: $course,
                        allowsNone: false,
                        load: { search in
                            let all = try await api.allCourses()
                            let needle = search.lowercased()
                            return all
                                .filter { needle.isEmpty || $0.subject.name.lowercased().contains(needle) || $0.group.name.lowercased().contains(needle) }
                                .map { DeanPickOption(id: $0.id, title: $0.subject.name, subtitle: [$0.group.name, $0.teacher?.name].compactMap { $0 }.joined(separator: " · ")) }
                        }
                    )
                }
                DatePicker(String(localized: "dean.exams.dateTime", defaultValue: "Дата и время"), selection: $date)
                Picker(String(localized: "dean.exams.format", defaultValue: "Формат"), selection: $format) {
                    ForEach(DeanText.examFormats, id: \.self) { Text(DeanText.examFormat($0)).tag($0) }
                }
            }

            Section {
                DeanPickerField(
                    title: String(localized: "dean.exams.room", defaultValue: "Аудитория"),
                    selection: $room,
                    load: DeanPickers.rooms(api)
                )
                DeanPickerField(
                    title: String(localized: "dean.exams.examiner", defaultValue: "Экзаменатор"),
                    selection: $examiner,
                    noneTitle: String(localized: "dean.exams.examinerNone", defaultValue: "Ведущий дисциплины"),
                    load: DeanPickers.teachingStaff(api)
                )
                TextField(String(localized: "dean.exams.maxScore", defaultValue: "Максимальный балл"), text: $maxScore)
                    .keyboardType(.numberPad)
            } footer: {
                Text(String(localized: "dean.exams.formHint", defaultValue: "Максимум — от 1 до 1000. Если экзаменатор не выбран, им будет ведущий дисциплины."))
            }
        }
    }

    private func save() async throws {
        let score = maxScoreValue ?? nil
        do {
            if let exam {
                var fields: [String: JSONValue] = [:]
                if abs(date.timeIntervalSince(exam.date)) >= 60 { fields["date"] = .date(date) }
                if format != exam.format { fields["format"] = .string(format) }
                if score != exam.maxScore { fields["maxScore"] = .int(score) }
                if room?.id != exam.room?.id { fields["roomId"] = .text(room?.id) }
                if examiner?.id != exam.examiner?.id { fields["examinerId"] = .text(examiner?.id) }
                guard !fields.isEmpty else { return }
                try await api.updateExam(id: exam.id, fields: fields)
            } else if let course {
                var fields: [String: JSONValue] = ["courseId": .string(course.id), "date": .date(date), "format": .string(format)]
                if let score { fields["maxScore"] = .int(score) }
                if let room { fields["roomId"] = .string(room.id) }
                if let examiner { fields["examinerId"] = .string(examiner.id) }
                try await api.createExam(fields: fields)
            }
        } catch {
            // CONFLICT с полем maxScore — максимум ниже уже выставленного балла; без поля —
            // у группы, аудитории или экзаменатора в это время другой экзамен.
            if let api = error as? APIError, case .server(let code, _, let details, _) = api, code == .conflict {
                if details.contains(where: { $0.field == "maxScore" }) {
                    throw DeanErrorText.failure(String(localized: "dean.exams.maxBelowGraded", defaultValue: "Максимум ниже уже выставленного балла."))
                }
                throw DeanErrorText.failure(DeanErrorText.message(error))
            }
            throw error
        }
    }
}

// MARK: - Ведомость

/// Ведомость экзамена: допуск, статус и балл по каждому студенту. На сохранение уходят
/// только тронутые строки — иначе результаты второго проверяющего, выставленные после
/// открытия ведомости, затёрлись бы.
struct DeanExamRosterView: View {
    let examID: String

    @State private var exam: DeanExam?
    @State private var roster: [DeanExamRoster.Entry]?
    @State private var rows: [String: Row] = [:]
    @State private var dirty: Set<String> = []
    @State private var failure: String?
    @State private var actionFailure: String?
    @State private var isSaving = false
    @State private var savedNotice = false

    private let api = DeanAPI()

    struct Row: Equatable {
        var admitted: Bool
        var status: String
        var score: String
    }

    private var ceiling: Double { Double(exam?.maxScore ?? 1000) }

    var body: some View {
        List {
            if let exam {
                Section {
                    DetailRow(title: String(localized: "dean.courses.col.subject", defaultValue: "Дисциплина"), value: exam.course.subject.name)
                    DetailRow(title: String(localized: "dean.group.name", defaultValue: "Группа"), value: exam.group.name)
                    DetailRow(title: String(localized: "dean.exams.dateTime", defaultValue: "Дата и время"), value: DisplayFormat.dateTime(exam.date))
                    DetailRow(title: String(localized: "dean.exams.format", defaultValue: "Формат"), value: DeanText.examFormat(exam.format))
                    if let max = exam.maxScore {
                        DetailRow(title: String(localized: "dean.exams.maxScore", defaultValue: "Максимальный балл"), value: max.formatted())
                    }
                }
            }

            if let roster {
                if roster.isEmpty {
                    EmptyStateView(
                        title: String(localized: "dean.roster.empty", defaultValue: "В группе нет студентов"),
                        symbol: "person.2"
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(roster) { entry in
                            rosterRow(entry)
                        }
                    } footer: {
                        Text(String(localized: "dean.roster.hint", defaultValue: "«Сдал» и «Не сдал» — только у допущенных. Балл — от 0 до максимума."))
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(Text(DeanScreen.examRoster(id: examID).title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isSaving {
                    ProgressView()
                } else {
                    Button(String(localized: "common.save", defaultValue: "Сохранить")) { Task { await save() } }
                        .disabled(dirty.isEmpty)
                }
            }
        }
        .refreshable { await load() }
        .task { if roster == nil { await load() } }
        .actionFailureAlert($actionFailure)
        .alert(String(localized: "dean.roster.saved", defaultValue: "Ведомость сохранена"), isPresented: $savedNotice) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
    }

    @ViewBuilder
    private func rosterRow(_ entry: DeanExamRoster.Entry) -> some View {
        let row = rows[entry.studentId] ?? Row(admitted: entry.admitted, status: entry.status, score: "")
        let errors = Self.errors(row, ceiling: ceiling)
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack {
                Text(entry.name).font(Typography.cardTitle)
                if let attempt = entry.attempt, attempt > 1 {
                    StatusBadge(text: String(localized: "dean.roster.attempt", defaultValue: "Попытка \(attempt.formatted())"), tint: Palette.info)
                }
                Spacer()
                if dirty.contains(entry.studentId) {
                    Image(systemName: "pencil.circle.fill").foregroundStyle(Palette.warning)
                        .accessibilityLabel(Text(String(localized: "dean.roster.changed", defaultValue: "Изменено")))
                }
            }
            Toggle(String(localized: "dean.roster.admitted", defaultValue: "Допущен"), isOn: binding(entry) { $0.admitted } set: { $0.admitted = $1 })
            HStack {
                Picker(String(localized: "dean.roster.status", defaultValue: "Статус"), selection: binding(entry) { $0.status } set: { $0.status = $1 }) {
                    ForEach(DeanText.examStatuses, id: \.self) { Text(DeanText.examStatus($0).0).tag($0) }
                }
                .tint(errors.status ? Palette.destructive : Palette.primary)
                Spacer()
                TextField(String(localized: "dean.roster.score", defaultValue: "Балл"), text: binding(entry) { $0.score } set: { $0.score = $1 })
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 80)
                    .padding(.horizontal, Spacing.sm)
                    .padding(.vertical, Spacing.xs)
                    .background(errors.score ? Palette.destructive.opacity(0.12) : Palette.muted, in: RoundedRectangle(cornerRadius: Radius.md))
            }
            if errors.status {
                Text(String(localized: "dean.roster.notAdmitted", defaultValue: "Недопущенному нельзя поставить «Сдал» или «Не сдал»"))
                    .font(.caption).foregroundStyle(Palette.destructive)
            }
            if errors.score {
                Text(String(localized: "dean.roster.scoreRange", defaultValue: "Балл — от 0 до \(JSONValue.format(ceiling))"))
                    .font(.caption).foregroundStyle(Palette.destructive)
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    private func binding<T>(_ entry: DeanExamRoster.Entry, get: @escaping (Row) -> T, set: @escaping (inout Row, T) -> Void) -> Binding<T> {
        Binding(
            get: { get(rows[entry.studentId] ?? Row(admitted: entry.admitted, status: entry.status, score: "")) },
            set: { value in
                var row = rows[entry.studentId] ?? Row(admitted: entry.admitted, status: entry.status, score: "")
                set(&row, value)
                rows[entry.studentId] = row
                dirty.insert(entry.studentId)
            }
        )
    }

    private static func errors(_ row: Row, ceiling: Double) -> (score: Bool, status: Bool) {
        let raw = row.score.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        let number = Double(raw)
        let score = !raw.isEmpty && (number == nil || number! < 0 || number! > ceiling)
        let status = !row.admitted && (row.status == "PASSED" || row.status == "FAILED")
        return (score, status)
    }

    @MainActor
    private func load() async {
        do {
            async let examTask = api.exam(id: examID)
            async let rosterTask = api.examRoster(id: examID)
            let (loadedExam, loadedRoster) = try await (examTask, rosterTask)
            exam = loadedExam
            // Перечитанная ведомость переписывает только нетронутые строки.
            for entry in loadedRoster.students where !dirty.contains(entry.studentId) {
                rows[entry.studentId] = Row(
                    admitted: entry.admitted,
                    status: entry.status,
                    score: entry.score.map { JSONValue.format($0) } ?? ""
                )
            }
            roster = loadedRoster.students
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func save() async {
        let ids = Array(dirty)
        guard !ids.isEmpty else { return }
        if ids.contains(where: { id in rows[id].map { let e = Self.errors($0, ceiling: ceiling); return e.score || e.status } ?? false }) {
            actionFailure = String(localized: "dean.roster.invalid", defaultValue: "В ведомости есть ошибки — они подсвечены.")
            return
        }
        let entries = ids.compactMap { id -> DeanExamResultEntry? in
            guard let row = rows[id] else { return nil }
            let raw = row.score.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
            return DeanExamResultEntry(studentId: id, admitted: row.admitted, status: row.status, score: raw.isEmpty ? nil : Double(raw))
        }
        isSaving = true
        defer { isSaving = false }
        do {
            try await api.saveExamResults(examID: examID, entries: entries)
            // Снимаем отметку только с отправленных строк.
            dirty.subtract(ids)
            savedNotice = true
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

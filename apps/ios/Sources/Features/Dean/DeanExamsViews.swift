import SwiftUI

/// Экзамены факультета: предстоящие и прошедшие, период, назначение, правка, удаление,
/// ведомость. Граница вкладок — начало сегодняшнего дня: утренний экзамен остаётся в
/// «предстоящих», где по нему и заполняют ведомость.
struct DeanExamsView: View {
    private enum Tab: Hashable { case upcoming, past }

    @State private var tab: Tab? = .upcoming
    @State private var remote = RemoteValue<[DeanExam]>()
    /// Запрос, ответ на который сейчас на экране: при смене вкладки или периода старый
    /// список не показывается под новыми фильтрами.
    @State private var shownKey: QueryKey?
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

    private var exams: [DeanExam]? { remote.value }
    private var failure: String? { remote.failure }
    private var isOffline: Bool { remote.isOffline }

    var body: some View {
        List {
            FilterChipsRow(
                options: [
                    (Tab.upcoming, String(localized: "dean.exams.upcoming", defaultValue: "Предстоящие")),
                    (Tab.past, String(localized: "dean.exams.past", defaultValue: "Прошедшие")),
                ],
                selection: $tab
            )

            if periodOn {
                Section {
                    DatePicker(String(localized: "dean.exams.from", defaultValue: "С"), selection: $periodFrom, displayedComponents: .date)
                    DatePicker(String(localized: "dean.exams.to", defaultValue: "По"), selection: $periodTo, in: periodFrom..., displayedComponents: .date)
                } header: {
                    Text(String(localized: "dean.exams.period", defaultValue: "Период"))
                }
            }

            if let exams {
                if let failure {
                    StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if !exams.isEmpty {
                    Section {
                        ForEach(exams) { exam in
                            examRow(exam)
                        }
                    } footer: {
                        if exams.count >= Self.cap {
                            Text(String(localized: "dean.exams.capped", defaultValue: "Показаны первые \(Self.cap.formatted()) — сузьте период."))
                        }
                    }
                }
            }
        }
        .compactListStyle()
        .screenState(exams?.isEmpty != false) {
            if exams != nil {
                emptyState
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(DeanScreen.exams.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    withAnimation { periodOn.toggle() }
                } label: {
                    Image(systemName: periodOn ? "calendar.badge.minus" : "calendar.badge.plus")
                }
                .accessibilityLabel(Text(String(localized: "dean.exams.period", defaultValue: "Период")))
                .accessibilityValue(Text(periodOn
                    ? String(localized: "dean.exams.periodOn", defaultValue: "Включён")
                    : String(localized: "dean.exams.periodOff", defaultValue: "Выключен")))
            }
        }
        .floatingAction(String(localized: "dean.exams.new", defaultValue: "Назначить экзамен")) { creating = true }
        .pullToRefresh { await load() }
        .task(id: QueryKey(tab: tab, periodOn: periodOn, from: periodFrom, to: periodTo)) {
            let key = QueryKey(tab: tab, periodOn: periodOn, from: periodFrom, to: periodTo)
            // Другая вкладка или период — прежний список уже не ответ: загрузка с нуля.
            // Возврат на экран с тем же запросом обновляет список на месте.
            if shownKey != key {
                remote.reset()
                shownKey = key
            }
            await load()
        }
        // Вернулись из фона после долгой паузы — список перечитывается фоном
        // (`AppLifecycle`), показанное остаётся на месте.
        .onChange(of: AppLifecycle.shared.foregroundEpoch) {
            Task { await load() }
        }
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

    @ViewBuilder
    private var emptyState: some View {
        if tab == .past {
            EmptyStateView(
                title: String(localized: "dean.exams.pastEmpty", defaultValue: "Прошедших экзаменов нет"),
                symbol: "graduationcap"
            )
        } else {
            EmptyStateView(
                title: String(localized: "dean.exams.empty", defaultValue: "Экзаменов не назначено"),
                symbol: "graduationcap",
                hint: String(localized: "dean.exams.emptyHint", defaultValue: "Назначьте экзамен — группа получит уведомление"),
                actionTitle: String(localized: "dean.exams.new", defaultValue: "Назначить экзамен"),
                action: { creating = true }
            )
        }
    }

    private func examRow(_ exam: DeanExam) -> some View {
        NavigationLink(value: AppRoute.dean(.examRoster(id: exam.id))) {
            DeanExamRow(exam: exam, isPast: tab == .past)
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
            NavigationLink(value: AppRoute.dean(.group(id: exam.group.id))) {
                Label(String(localized: "dean.student.openGroup", defaultValue: "Карточка группы"), systemImage: "person.3")
            }
            Button(role: .destructive) {
                deleting = exam
            } label: {
                Label(String(localized: "dean.delete", defaultValue: "Удалить"), systemImage: "trash")
            }
        }
    }

    private struct QueryKey: Equatable {
        let tab: Tab?
        let periodOn: Bool
        let from: Date
        let to: Date
    }

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
        let past = tab == .past
        let api = api
        await remote.load {
            let list = try await api.exams(from: range.0, to: range.1)
            // Предстоящие — ближайший сверху, прошедшие — свежий сверху.
            return past ? list.sorted { $0.date > $1.date } : list.sorted { $0.date < $1.date }
        }
    }

    @MainActor
    private func delete(_ exam: DeanExam) async {
        do {
            try await api.deleteExam(id: exam.id)
            remote.value?.removeAll { $0.id == exam.id }
        } catch {
            if let api = error as? APIError, api.code == .conflict {
                actionFailure = String(localized: "dean.exams.deleteHasResults", defaultValue: "По экзамену уже выставлены результаты — удалить его нельзя.")
            } else {
                actionFailure = error.userMessage
            }
        }
    }
}

/// Экзамен строкой: плитка даты слева, дисциплина, время справа, группа и аудитория
/// ниже, формат — плашкой.
private struct DeanExamRow: View {
    let exam: DeanExam
    let isPast: Bool

    var body: some View {
        TelegramStyleRow(title: exam.course.subject.name, subtitle: subtitle, meta: time) {
            DeanDateTile(date: exam.date, tint: isPast ? Palette.mutedForeground : Palette.primary)
        } accessory: {
            StatusBadge(text: DeanText.examFormat(exam.format), tint: Palette.mutedForeground)
        }
    }

    private var time: String {
        exam.date.formatted(.dateTime.hour().minute())
    }

    private var subtitle: String {
        var first = exam.group.name
        if let room = exam.room?.name { first += " · " + room }
        guard let examiner = exam.examiner?.name else { return first }
        return first + "\n" + String(localized: "dean.exams.examinerLine", defaultValue: "Экзаменатор: \(examiner)")
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
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var isSaving = false
    @State private var savedNotice = false
    @State private var editingExam = false

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
                header(exam)
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
                    } header: {
                        Text(String(localized: "dean.roster.students", defaultValue: "Студенты"))
                    } footer: {
                        Text(String(localized: "dean.roster.hint", defaultValue: "«Сдал» и «Не сдал» — только у допущенных. Балл — от 0 до максимума."))
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .screenState(roster == nil) {
            if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(Text(DeanScreen.examRoster(id: examID).title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isSaving {
                    ProgressView()
                } else {
                    DeanConfirmButton { Task { await save() } }
                        .disabled(dirty.isEmpty)
                }
            }
        }
        .pullToRefresh { await load() }
        .task { if roster == nil { await load() } }
        .sheet(isPresented: $editingExam) {
            if let exam {
                DeanExamForm(exam: exam) { await load() }
            }
        }
        .actionFailureAlert($actionFailure)
        .alert(String(localized: "dean.roster.saved", defaultValue: "Ведомость сохранена"), isPresented: $savedNotice) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
    }

    // MARK: Шапка

    private func header(_ exam: DeanExam) -> some View {
        HeroHeader(
            visual: .symbol("list.clipboard.fill", tint: TileTint.purple),
            title: exam.course.subject.name,
            subtitle: headerSubtitle(exam),
            actions: [
                HeroAction(title: String(localized: "dean.edit", defaultValue: "Изменить"), symbol: "pencil") {
                    editingExam = true
                },
                HeroAction(title: String(localized: "dean.roster.group", defaultValue: "Группа"), symbol: "person.3") {
                    DeanNav.push(.dean(.group(id: exam.group.id)))
                },
            ],
            badges: { headerBadges(exam) }
        )
    }

    private func headerSubtitle(_ exam: DeanExam) -> String {
        var parts = [exam.group.name, DisplayFormat.dateTime(exam.date)]
        if let room = exam.room?.name { parts.append(room) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func headerBadges(_ exam: DeanExam) -> some View {
        let tally = self.tally
        // Два ряда, а не один: с крупным шрифтом четыре плашки в строку не влезают.
        VStack(spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                StatusBadge(text: DeanText.examFormat(exam.format), tint: Palette.mutedForeground)
                if let max = exam.maxScore {
                    StatusBadge(text: maxLine(max), tint: Palette.info)
                }
            }
            if tally.passed > 0 || tally.failed > 0 {
                HStack(spacing: Spacing.sm) {
                    if tally.passed > 0 {
                        StatusBadge(text: countLine("PASSED", tally.passed), tint: Palette.success)
                    }
                    if tally.failed > 0 {
                        StatusBadge(text: countLine("FAILED", tally.failed), tint: Palette.destructive)
                    }
                }
            }
        }
    }

    private func maxLine(_ max: Int) -> String {
        let value = max.formatted()
        return String(localized: "dean.roster.maxShort", defaultValue: "Макс. \(value)")
    }

    private func countLine(_ status: String, _ count: Int) -> String {
        DeanText.examStatus(status).0 + ": " + count.formatted()
    }

    /// Сводка по ведомости — с учётом ещё не сохранённых правок.
    private var tally: (passed: Int, failed: Int) {
        var passed = 0
        var failed = 0
        for entry in roster ?? [] {
            let status = rows[entry.studentId]?.status ?? entry.status
            if status == "PASSED" { passed += 1 }
            if status == "FAILED" { failed += 1 }
        }
        return (passed, failed)
    }

    // MARK: Строка

    @ViewBuilder
    private func rosterRow(_ entry: DeanExamRoster.Entry) -> some View {
        let row = rows[entry.studentId] ?? Row(admitted: entry.admitted, status: entry.status, score: "")
        let errors = Self.errors(row, ceiling: ceiling)
        let status = DeanText.examStatus(row.status)
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(spacing: Spacing.lg) {
                AvatarView(url: nil, name: entry.name, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.name)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(2)
                    HStack(spacing: Spacing.sm) {
                        StatusBadge(text: status.0, tint: status.1)
                        if let attempt = entry.attempt, attempt > 1 {
                            StatusBadge(text: attemptLine(attempt), tint: Palette.info)
                        }
                    }
                }
                Spacer(minLength: Spacing.sm)
                if dirty.contains(entry.studentId) {
                    Image(systemName: "pencil.circle.fill")
                        .foregroundStyle(Palette.warning)
                        .accessibilityLabel(Text(String(localized: "dean.roster.changed", defaultValue: "Изменено")))
                }
            }
            Toggle(String(localized: "dean.roster.admitted", defaultValue: "Допущен"), isOn: binding(entry) { $0.admitted } set: { $0.admitted = $1 })
            HStack {
                Picker(String(localized: "dean.roster.status", defaultValue: "Статус"), selection: binding(entry) { $0.status } set: { $0.status = $1 }) {
                    ForEach(DeanText.examStatuses, id: \.self) { Text(DeanText.examStatus($0).0).tag($0) }
                }
                .pickerStyle(.menu)
                .tint(errors.status ? Palette.destructive : Palette.primary)
                Spacer()
                TextField(String(localized: "dean.roster.score", defaultValue: "Балл"), text: binding(entry) { $0.score } set: { $0.score = $1 })
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .font(.body.monospacedDigit())
                    .frame(width: 80)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .background(errors.score ? Palette.destructive.opacity(0.12) : Palette.muted, in: Capsule())
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

    private func attemptLine(_ attempt: Int) -> String {
        let value = attempt.formatted()
        return String(localized: "dean.roster.attempt", defaultValue: "Попытка \(value)")
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
            isOffline = error.isOffline
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

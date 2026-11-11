import SwiftUI

/// Журнал оценок: свои дисциплины. Журнал каждой — отдельным экраном: на телефоне
/// матрица «студенты × контрольные точки» не читается, поэтому журнал разложен по
/// колонкам, а итог — отдельной секцией.
struct TeachingGradebookListView: View {
    var body: some View {
        RemoteContent(load: { try await CoursesAPI().courses(mine: true) }) { courses in
            List {
                if courses.isEmpty {
                    EmptyStateView(
                        title: String(localized: "teaching.gradebook.noCourses", defaultValue: "У вас нет дисциплин"),
                        symbol: "tablecells",
                        hint: String(localized: "teaching.gradebook.noCourses.hint", defaultValue: "Дисциплины назначает деканат.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(grouped(courses), id: \.title) { section in
                        Section(section.title) {
                            ForEach(section.courses) { course in
                                NavigationLink(value: AppRoute.teacher(.gradebookCourse(id: course.id))) {
                                    TelegramStyleRow(
                                        title: course.subject.name,
                                        subtitle: StudyText.join([course.group?.name, course.subject.code]),
                                        meta: course.credits.map(CoursesText.credits)
                                    ) {
                                        RowSymbol(symbol: "tablecells.fill", tint: ScheduleSubjectTint.color(for: course.subject.name))
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
        .background(Palette.background)
        .navigationTitle(Text(TeacherScreen.gradebook.title))
    }

    /// По семестрам: свежий сверху — журнал текущего семестра открывают чаще всего.
    private func grouped(_ courses: [CourseDTO]) -> [(title: String, courses: [CourseDTO])] {
        let other = String(localized: "teaching.gradebook.noTerm", defaultValue: "Без семестра")
        let byTerm = Dictionary(grouping: courses) { $0.term?.name ?? other }
        return byTerm
            .map { key, value in
                (
                    title: key,
                    courses: value.sorted { $0.subject.name.localizedCompare($1.subject.name) == .orderedAscending },
                    active: value.contains { $0.term?.isActive == true },
                    number: value.compactMap { $0.term?.number }.max() ?? 0
                )
            }
            .sorted { lhs, rhs in
                if lhs.active != rhs.active { return lhs.active }
                return lhs.number > rhs.number
            }
            .map { (title: $0.title, courses: $0.courses) }
    }
}

/// Журнал одной дисциплины: контрольные точки (добавить, править, порядок,
/// публикация, удаление) и итог по студентам.
struct TeachingGradebookCourseView: View {
    let courseID: String

    @State private var book: TeachingGradebookDTO?
    @State private var courseTitle: String?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var addingColumn = false
    @State private var editingColumn: TeachingGradebookDTO.Column?
    @State private var deletingColumn: TeachingGradebookDTO.Column?
    @State private var sortByTotal = false

    private let api = TeachingAPI()

    var body: some View {
        List {
            if let book {
                columnsSection(book)
                totalsSection(book)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(courseTitle ?? TeacherScreen.gradebookCourse(id: courseID).title))
        .navigationBarTitleDisplayMode(.inline)
        .floatingAction(String(localized: "teaching.gradebook.addColumn", defaultValue: "Добавить контрольную точку")) {
            if book != nil { addingColumn = true }
        }
        .sheet(isPresented: $addingColumn) {
            TeachingColumnForm(courseID: courseID, column: nil) { await load() }
        }
        .sheet(item: $editingColumn) { column in
            TeachingColumnForm(courseID: courseID, column: column) { await load() }
        }
        .confirmDestructive(
            $deletingColumn,
            title: { _ in String(localized: "teaching.gradebook.deleteColumn.confirm", defaultValue: "Удалить колонку и все оценки?") },
            actionTitle: String(localized: "teaching.gradebook.deleteColumn", defaultValue: "Удалить колонку")
        ) { column in
            await run(conflict: String(localized: "teaching.gradebook.deleteColumn.published", defaultValue: "В колонке опубликованные оценки. Сначала снимите её с публикации")) {
                try await api.deleteColumn(id: column.id)
            }
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task { await load() }
    }

    // MARK: Секции

    @ViewBuilder
    private func columnsSection(_ book: TeachingGradebookDTO) -> some View {
        let columns = book.columns.sorted { $0.position < $1.position }
        Section {
            if columns.isEmpty {
                EmptyStateView(
                    title: String(localized: "teaching.gradebook.noColumns", defaultValue: "Контрольных точек нет"),
                    symbol: "plus.rectangle.on.rectangle",
                    hint: String(localized: "teaching.gradebook.noColumns.hint", defaultValue: "Добавьте ЛР, РК или экзамен."),
                    actionTitle: String(localized: "teaching.gradebook.addColumn", defaultValue: "Добавить контрольную точку"),
                    action: { addingColumn = true }
                )
                .listRowBackground(Color.clear)
            }
            ForEach(Array(columns.enumerated()), id: \.element.id) { index, column in
                NavigationLink {
                    TeachingColumnGradesView(book: book, column: column) { await load() }
                } label: {
                    columnRow(column, book: book)
                }
                .contextMenu { columnMenu(column, index: index, columns: columns) }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        deletingColumn = column
                    } label: {
                        Label(String(localized: "teaching.gradebook.deleteColumn", defaultValue: "Удалить колонку"), systemImage: "trash")
                    }
                    Button {
                        editingColumn = column
                    } label: {
                        Label(String(localized: "teaching.edit", defaultValue: "Изменить"), systemImage: "pencil")
                    }
                    .tint(Palette.info)
                }
                .swipeActions(edge: .leading) {
                    Button {
                        Task { await togglePublished(column) }
                    } label: {
                        Label(
                            column.published
                                ? String(localized: "teaching.gradebook.unpublish", defaultValue: "Снять с публикации")
                                : String(localized: "teaching.gradebook.publish", defaultValue: "Опубликовать"),
                            systemImage: column.published ? "eye.slash" : "eye"
                        )
                    }
                    .tint(column.published ? Palette.warning : Palette.success)
                }
            }
        } header: {
            Text(String(localized: "teaching.gradebook.columns", defaultValue: "Контрольные точки"))
        } footer: {
            if !columns.isEmpty {
                Text(String(localized: "teaching.gradebook.columns.footer", defaultValue: "Черновик колонки студенты не видят. Оценки ставятся внутри колонки; действия — долгим нажатием или смахиванием."))
            }
        }
    }

    /// Контрольная точка строкой как чат: значок вида, название, «оценено N из M»
    /// справа, ниже — вид и максимум; черновик — серым значком и плашкой.
    private func columnRow(_ column: TeachingGradebookDTO.Column, book: TeachingGradebookDTO) -> some View {
        let graded = book.grades.filter { $0.columnId == column.id && $0.score != nil }.count
        var lines = [TeachingText.columnKind(column.kind)]
        if let max = column.maxScore {
            lines.append(String(localized: "teaching.gradebook.max", defaultValue: "Макс. балл: \(max.formatted())"))
        }
        let complete = graded == book.students.count && graded > 0
        let progress: String = graded.formatted() + " / " + book.students.count.formatted()
        return TelegramStyleRow(
            title: column.title,
            subtitle: lines.joined(separator: " · "),
            meta: progress,
            metaTint: complete ? Palette.success : Palette.mutedForeground
        ) {
            RowSymbol(symbol: Self.kindSymbol(column.kind), tint: column.published ? TileTint.indigo : Color.gray, size: 40)
        } accessory: {
            if !column.published {
                StatusBadge(text: String(localized: "teaching.gradebook.draft", defaultValue: "Черновик"), tint: Palette.mutedForeground)
            }
        }
    }

    private static func kindSymbol(_ kind: String) -> String {
        switch kind {
        case "LAB": return "flask.fill"
        case "CONTROL": return "checkmark.seal.fill"
        case "EXAM": return "rosette"
        default: return "doc.text.fill"
        }
    }

    @ViewBuilder
    private func columnMenu(_ column: TeachingGradebookDTO.Column, index: Int, columns: [TeachingGradebookDTO.Column]) -> some View {
        Button {
            editingColumn = column
        } label: {
            Label(String(localized: "teaching.edit", defaultValue: "Изменить"), systemImage: "pencil")
        }
        if index > 0 {
            Button {
                Task { await move(columns, from: index, to: index - 1) }
            } label: {
                Label(String(localized: "teaching.gradebook.moveUp", defaultValue: "Сдвинуть раньше"), systemImage: "arrow.up")
            }
        }
        if index < columns.count - 1 {
            Button {
                Task { await move(columns, from: index, to: index + 1) }
            } label: {
                Label(String(localized: "teaching.gradebook.moveDown", defaultValue: "Сдвинуть позже"), systemImage: "arrow.down")
            }
        }
        Button {
            Task { await togglePublished(column) }
        } label: {
            if column.published {
                Label(String(localized: "teaching.gradebook.unpublish", defaultValue: "Снять с публикации"), systemImage: "eye.slash")
            } else {
                Label(String(localized: "teaching.gradebook.publish", defaultValue: "Опубликовать"), systemImage: "eye")
            }
        }
        Button(role: .destructive) {
            deletingColumn = column
        } label: {
            Label(String(localized: "teaching.gradebook.deleteColumn", defaultValue: "Удалить колонку"), systemImage: "trash")
        }
    }

    @ViewBuilder
    private func totalsSection(_ book: TeachingGradebookDTO) -> some View {
        if !book.students.isEmpty {
            let rows = book.students.map { student in (student: student, total: total(for: student.id, in: book)) }
            let sorted = sortByTotal
                ? rows.sorted { ($0.total ?? -1) < ($1.total ?? -1) }
                : rows.sorted { $0.student.name.localizedCompare($1.student.name) == .orderedAscending }
            Section {
                ForEach(sorted, id: \.student.id) { row in
                    NavigationLink {
                        TeachingStudentGradesView(book: book, student: row.student)
                    } label: {
                        HStack(spacing: Spacing.md) {
                            PersonRow(name: row.student.name, avatarURL: row.student.avatarUrl, size: 40)
                            Text(verbatim: row.total.map { "\($0)%" } ?? "—")
                                .font(Typography.tabular(.body.weight(.semibold)))
                                .foregroundStyle(row.total.map(StudentGradeMath.tint) ?? Palette.mutedForeground)
                        }
                    }
                }
            } header: {
                HStack {
                    Text(String(localized: "teaching.gradebook.total", defaultValue: "Итог"))
                    Spacer()
                    Button {
                        sortByTotal.toggle()
                    } label: {
                        Label(
                            sortByTotal
                                ? String(localized: "teaching.gradebook.sortByName", defaultValue: "По алфавиту")
                                : String(localized: "teaching.gradebook.sortByTotal", defaultValue: "По итогу"),
                            systemImage: "arrow.up.arrow.down"
                        )
                        .font(.footnote.weight(.semibold))
                    }
                    .textCase(nil)
                }
            } footer: {
                Text(String(localized: "teaching.gradebook.total.footer", defaultValue: "Итог — средняя доля от максимума по колонкам, где он задан."))
            }
        }
    }

    // MARK: Действия

    /// Итог как в вебе: среднее «балл / максимум» по колонкам с максимумом.
    private func total(for studentID: String, in book: TeachingGradebookDTO) -> Int? {
        let ratios: [Double] = book.columns.compactMap { column in
            guard let max = column.maxScore, max > 0,
                  let score = book.grades.first(where: { $0.columnId == column.id && $0.studentId == studentID })?.score
            else { return nil }
            return score / Double(max)
        }
        guard !ratios.isEmpty else { return nil }
        return Int((ratios.reduce(0, +) / Double(ratios.count) * 100).rounded())
    }

    @MainActor
    private func load() async {
        do {
            async let gradebook = api.gradebook(courseID: courseID)
            async let courses = try? CoursesAPI().courses(mine: true)
            book = try await gradebook
            let list = await courses
            if let course = list?.first(where: { $0.id == courseID }) {
                courseTitle = TeachingCoursePicker.label(course)
            }
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    /// Порядок — `position`. После удалений номера бывают с дырами, поэтому
    /// переписываем позиции подряд и отправляем только изменившиеся.
    @MainActor
    private func move(_ columns: [TeachingGradebookDTO.Column], from: Int, to: Int) async {
        var order = columns
        order.swapAt(from, to)
        await run {
            for (index, column) in order.enumerated() where column.position != index {
                try await api.updateColumn(id: column.id, JSONBody(["position": .int(index)]))
            }
        }
    }

    @MainActor
    private func togglePublished(_ column: TeachingGradebookDTO.Column) async {
        await run {
            try await api.setColumnPublished(id: column.id, published: !column.published)
        }
    }

    @MainActor
    private func run(conflict: String? = nil, _ action: () async throws -> Void) async {
        do {
            try await action()
        } catch {
            actionFailure = teachingFailure(error, conflict: conflict)
        }
        await load()
    }
}

/// Оценки одной колонки: поле балла у каждого студента. Сохраняются только
/// изменённые ячейки — пустая ячейка не затирает оценку, поставленную в другом окне.
private struct TeachingColumnGradesView: View {
    let book: TeachingGradebookDTO
    let column: TeachingGradebookDTO.Column
    let saved: () async -> Void

    @State private var edits: [String: String] = [:]
    @State private var query = ""
    @State private var isSaving = false
    @State private var failure: String?
    @State private var didSave = false
    @Environment(\.dismiss) private var dismiss

    private var ceiling: Double { Double(column.maxScore ?? 1000) }

    var body: some View {
        List {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            Section {
                ForEach(students) { student in
                    let value = binding(for: student.id)
                    let invalid = isInvalid(value.wrappedValue)
                    HStack(spacing: Spacing.lg) {
                        AvatarView(url: student.avatarUrl, name: student.name, size: 36)
                        Text(student.name)
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                            .lineLimit(2)
                        Spacer(minLength: Spacing.md)
                        TextField(String(localized: "teaching.gradebook.score", defaultValue: "Балл"), text: value)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.center)
                            .font(Typography.tabular(.body.weight(.semibold)))
                            .frame(width: 64)
                            .padding(.vertical, Spacing.sm)
                            .background(
                                invalid ? Palette.destructive.opacity(0.12) : Palette.muted,
                                in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                            )
                            .foregroundStyle(invalid ? Palette.destructive : Palette.foreground)
                            .accessibilityLabel(Text(student.name))
                        if let max = column.maxScore {
                            Text(verbatim: "/ \(max)")
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                }
            } footer: {
                Text(String(localized: "teaching.gradebook.range", defaultValue: "Балл от 0 до \(JSONValue.format(ceiling)). Пустое поле — без оценки."))
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(column.title))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: Text(String(localized: "teaching.searchStudent", defaultValue: "Найти студента")))
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if isSaving {
                    ProgressView()
                } else {
                    Button(String(localized: "common.save", defaultValue: "Сохранить")) { Task { await save() } }
                        .disabled(edits.isEmpty)
                }
            }
        }
    }

    private var students: [TeachingPersonRef] {
        let sorted = book.students.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return needle.isEmpty ? sorted : sorted.filter { $0.name.lowercased().contains(needle) }
    }

    private func original(_ studentID: String) -> String {
        guard let score = book.grades.first(where: { $0.columnId == column.id && $0.studentId == studentID })?.score else { return "" }
        return JSONValue.format(score)
    }

    private func binding(for studentID: String) -> Binding<String> {
        Binding(
            get: { edits[studentID] ?? original(studentID) },
            set: { value in
                if value == original(studentID) { edits[studentID] = nil } else { edits[studentID] = value }
            }
        )
    }

    private func isInvalid(_ raw: String) -> Bool {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return false }
        guard let value = TeachingText.parseScore(trimmed) else { return true }
        return value < 0 || value > ceiling
    }

    @MainActor
    private func save() async {
        if edits.values.contains(where: isInvalid) {
            failure = String(localized: "teaching.gradebook.outOfRange", defaultValue: "Есть баллы вне допустимого диапазона — исправьте выделенные поля")
            return
        }
        isSaving = true
        defer { isSaving = false }
        do {
            try await TeachingAPI().saveGrades(
                columnID: column.id,
                entries: edits.map { TeachingGradeEntry(studentId: $0.key, score: TeachingText.parseScore($0.value)) }
            )
            await saved()
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}

/// Оценки одного студента по всем колонкам — «карточка» строки журнала.
private struct TeachingStudentGradesView: View {
    let book: TeachingGradebookDTO
    let student: TeachingPersonRef

    private var profileActions: [HeroAction] {
        let id = student.id
        let profile = HeroAction(title: String(localized: "teaching.submissions.profile", defaultValue: "Профиль"), symbol: "person.fill") {
            teachingPush(.profile(id: id))
        }
        return [profile]
    }

    var body: some View {
        List {
            Section {
                HeroHeader(
                    visual: HeroVisual.avatar(url: student.avatarUrl, name: student.name),
                    title: student.name,
                    actions: profileActions
                )
            }
            Section {
                ForEach(book.columns.sorted { $0.position < $1.position }) { column in
                    let score = book.grades.first { $0.columnId == column.id && $0.studentId == student.id }?.score
                    HStack(spacing: Spacing.lg) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(column.title)
                                .font(.body.weight(.medium))
                                .foregroundStyle(Palette.foreground)
                            Text(TeachingText.columnKind(column.kind))
                                .font(.footnote)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        Spacer(minLength: Spacing.md)
                        Text(verbatim: column.maxScore.map { "\(TeachingText.score(score)) / \($0)" } ?? TeachingText.score(score))
                            .font(Typography.tabular(.body.weight(.semibold)))
                            .foregroundStyle(score == nil ? Palette.mutedForeground : Palette.foreground)
                    }
                    .accessibilityElement(children: .combine)
                }
            } header: {
                Text(String(localized: "teaching.gradebook.columns", defaultValue: "Контрольные точки"))
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(student.name))
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Новая или правка контрольной точки.
private struct TeachingColumnForm: View {
    let courseID: String
    let column: TeachingGradebookDTO.Column?
    let saved: () async -> Void

    @State private var title = ""
    @State private var kind = "OTHER"
    @State private var maxScore = ""

    init(courseID: String, column: TeachingGradebookDTO.Column?, saved: @escaping () async -> Void) {
        self.courseID = courseID
        self.column = column
        self.saved = saved
        _title = State(initialValue: column?.title ?? "")
        _kind = State(initialValue: column?.kind ?? "OTHER")
        _maxScore = State(initialValue: column?.maxScore.map(String.init) ?? "")
    }

    var body: some View {
        FormSheet(
            title: column == nil
                ? String(localized: "teaching.gradebook.newColumn", defaultValue: "Новая контрольная точка")
                : String(localized: "teaching.gradebook.editColumn", defaultValue: "Контрольная точка"),
            canSave: isValid,
            save: save,
            saved: saved
        ) {
            Section {
                TextField(String(localized: "teaching.gradebook.columnTitle", defaultValue: "Название, например ЛР1"), text: $title)
                Picker(String(localized: "teaching.gradebook.kind", defaultValue: "Тип"), selection: $kind) {
                    ForEach(TeachingText.columnKinds, id: \.self) { Text(TeachingText.columnKind($0)).tag($0) }
                }
                TextField(String(localized: "teaching.gradebook.maxScore", defaultValue: "Макс. балл (необязательно)"), text: $maxScore)
                    .keyboardType(.numberPad)
            } footer: {
                Text(String(localized: "teaching.gradebook.maxScore.footer", defaultValue: "От 1 до 1000. Без максимума колонка не входит в итог."))
            }
        }
    }

    private var parsedMax: Int? { Int(maxScore.trimmingCharacters(in: .whitespaces)) }

    private var isValid: Bool {
        let name = title.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, name.count <= 100 else { return false }
        if maxScore.trimmingCharacters(in: .whitespaces).isEmpty { return true }
        guard let max = parsedMax else { return false }
        return (1...1000).contains(max)
    }

    private func save() async throws {
        let name = title.trimmingCharacters(in: .whitespaces)
        let api = TeachingAPI()
        if let column {
            try await api.updateColumn(
                id: column.id,
                JSONBody(["title": .string(name), "kind": .string(kind), "maxScore": .int(parsedMax)])
            )
        } else {
            var fields: [String: JSONValue] = ["courseId": .string(courseID), "title": .string(name), "kind": .string(kind)]
            if let max = parsedMax { fields["maxScore"] = .int(max) }
            try await api.createColumn(JSONBody(fields))
        }
    }
}

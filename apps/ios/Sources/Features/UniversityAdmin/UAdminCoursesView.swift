import SwiftUI

// Дисциплины вуза (`views/course-admin`): назначения дисциплин группам, справочник
// дисциплин и семестры. Три вкладки, у каждой — список по страницам, создание, правка
// и удаление.

struct UAdminCoursesView: View {
    @State private var tab: CoursesTab = .courses
    @State private var courses = PagedLoader<UAdminCourseDTO>(limit: 30) { request in
        try await UAdminAPI().courses(request, sort: "subject", order: "asc")
    }
    @State private var subjects = PagedLoader<UAdminSubjectDTO>(limit: 30) { request in
        try await UAdminAPI().subjects(request, search: nil)
    }
    @State private var terms = PagedLoader<UAdminTermDTO>(limit: 30) { request in
        try await UAdminAPI().terms(request)
    }
    @State private var courseSort: CourseSort = .subject
    @State private var subjectQuery = ""
    @State private var editingCourse: CourseTarget?
    @State private var editingSubject: SubjectTarget?
    @State private var editingTerm: TermTarget?
    @State private var deleting: DeleteTarget?
    @State private var actionFailure: String?

    var body: some View {
        Group {
            switch tab {
            case .courses: coursesList
            case .subjects: subjectsList
            case .terms: termsList
            }
        }
        .navigationTitle(Text(UniAdminScreen.courses.title))
        .toolbar {
            if tab == .courses {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker(String(localized: "uadmin.sort", defaultValue: "Сортировка"), selection: $courseSort) {
                            ForEach(CourseSort.allCases) { Text($0.title).tag($0) }
                        }
                    } label: {
                        Image(systemName: "arrow.up.arrow.down")
                    }
                    .accessibilityLabel(Text(String(localized: "uadmin.sort", defaultValue: "Сортировка")))
                }
            }
        }
        .floatingAction(tab.addTitle) {
            switch tab {
            case .courses: editingCourse = CourseTarget(course: nil)
            case .subjects: editingSubject = SubjectTarget(subject: nil)
            case .terms: editingTerm = TermTarget(term: nil)
            }
        }
        .sheet(item: $editingCourse) { target in
            CourseForm(course: target.course) { await courses.reload() }
        }
        .sheet(item: $editingSubject) { target in
            SubjectForm(subject: target.subject) { await subjects.reload() }
                .presentationDetents([.medium, .large])
        }
        .sheet(item: $editingTerm) { target in
            TermForm(term: target.term) { await terms.reload() }
        }
        .confirmDestructive(
            $deleting,
            title: { String(localized: "uadmin.courses.deleteConfirm", defaultValue: "Удалить «\($0.name)»?") },
            actionTitle: String(localized: "uadmin.delete", defaultValue: "Удалить")
        ) { target in
            await remove(target)
        }
        .actionFailureAlert($actionFailure)
        .onChange(of: courseSort) { _, sort in
            Task {
                await courses.replace { request in
                    try await UAdminAPI().courses(request, sort: sort.rawValue, order: sort == .credits ? "desc" : "asc")
                }
            }
        }
    }

    /// Разделы — капсулами, как папки чатов.
    private var tabPicker: some View {
        FilterChipsRow(
            options: CoursesTab.allCases.map { (value: Optional($0), title: $0.title) },
            selection: Binding(get: { Optional(tab) }, set: { tab = $0 ?? .courses })
        )
    }

    private var coursesList: some View {
        PagedList(
            loader: courses,
            empty: EmptyStateView(
                title: String(localized: "uadmin.courses.empty", defaultValue: "Дисциплины не назначены"),
                symbol: "book",
                hint: String(localized: "uadmin.courses.emptyHint", defaultValue: "Назначьте дисциплину группе."),
                actionTitle: String(localized: "uadmin.courses.assign", defaultValue: "Назначить дисциплину"),
                action: { editingCourse = CourseTarget(course: nil) }
            )
        ) {
            tabPicker
        } row: { course in
            Button {
                editingCourse = CourseTarget(course: course)
            } label: {
                TelegramStyleRow(
                    title: course.subject.name,
                    subtitle: Self.courseDetails(course),
                    meta: Self.credits(course.credits)
                ) {
                    RowSymbol(symbol: "book.fill", tint: TileTint.indigo)
                }
            }
            .buttonStyle(.plain)
            .swipeActions {
                Button(role: .destructive) {
                    deleting = DeleteTarget(kind: .course, id: course.id, name: course.subject.name)
                } label: {
                    Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
                }
            }
            .contextMenu {
                rowMenu(edit: { editingCourse = CourseTarget(course: course) }) {
                    deleting = DeleteTarget(kind: .course, id: course.id, name: course.subject.name)
                }
            }
        }
    }

    private var subjectsList: some View {
        PagedList(
            loader: subjects,
            empty: EmptyStateView(
                title: String(localized: "uadmin.subjects.empty", defaultValue: "Справочник пуст"),
                symbol: "books.vertical",
                hint: String(localized: "uadmin.subjects.emptyHint", defaultValue: "Добавьте дисциплины вуза.")
            )
        ) {
            tabPicker
        } row: { subject in
            Button {
                editingSubject = SubjectTarget(subject: subject)
            } label: {
                TelegramStyleRow(title: subject.name, meta: subject.code) {
                    RowSymbol(symbol: "books.vertical.fill", tint: TileTint.blue)
                }
            }
            .buttonStyle(.plain)
            .swipeActions {
                Button(role: .destructive) {
                    deleting = DeleteTarget(kind: .subject, id: subject.id, name: subject.name)
                } label: {
                    Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
                }
            }
            .contextMenu {
                rowMenu(edit: { editingSubject = SubjectTarget(subject: subject) }) {
                    deleting = DeleteTarget(kind: .subject, id: subject.id, name: subject.name)
                }
            }
        }
        .uadminDebouncedSearch($subjectQuery, prompt: String(localized: "uadmin.searchByName", defaultValue: "Поиск по названию")) { needle in
            await subjects.replace { request in
                try await UAdminAPI().subjects(request, search: needle.isEmpty ? nil : String(needle.prefix(200)))
            }
        }
    }

    private var termsList: some View {
        PagedList(
            loader: terms,
            empty: EmptyStateView(
                title: String(localized: "uadmin.terms.empty", defaultValue: "Семестров нет"),
                symbol: "calendar",
                hint: String(localized: "uadmin.terms.emptyHint", defaultValue: "Добавьте учебный семестр.")
            )
        ) {
            tabPicker
        } row: { term in
            Button {
                editingTerm = TermTarget(term: term)
            } label: {
                TelegramStyleRow(
                    title: term.name,
                    subtitle: "\(UAdminDay.display(term.startsOn)) – \(UAdminDay.display(term.endsOn))",
                    meta: Self.termNumber(term.number)
                ) {
                    RowSymbol(symbol: "calendar", tint: term.isActive ? TileTint.green : TileTint.gray)
                } accessory: {
                    if term.isActive {
                        StatusBadge(text: String(localized: "uadmin.terms.active", defaultValue: "Текущий"), tint: Palette.success)
                    }
                }
            }
            .buttonStyle(.plain)
            .swipeActions {
                Button(role: .destructive) {
                    deleting = DeleteTarget(kind: .term, id: term.id, name: term.name)
                } label: {
                    Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
                }
            }
            .contextMenu {
                rowMenu(edit: { editingTerm = TermTarget(term: term) }) {
                    deleting = DeleteTarget(kind: .term, id: term.id, name: term.name)
                }
            }
        }
    }

    // Подписи меты — отдельными функциями: `map` с локализованной строкой внутри
    // обобщённой строки списка заметно нагружает проверку типов.
    private static func credits(_ credits: Int?) -> String? {
        guard let credits else { return nil }
        let value = String(credits)
        return String(localized: "uadmin.courses.creditsValue", defaultValue: "\(value) кр.")
    }

    private static func termNumber(_ number: Int?) -> String? {
        guard let number else { return nil }
        let value = String(number)
        return String(localized: "uadmin.terms.number", defaultValue: "Семестр №\(value)")
    }

    /// Группа, ниже — преподаватель и семестр.
    private static func courseDetails(_ course: UAdminCourseDTO) -> String {
        var second: [String] = []
        if let teacher = course.teacher?.name, !teacher.isEmpty { second.append(teacher) }
        if let term = course.term?.name, !term.isEmpty { second.append(term) }
        guard !second.isEmpty else { return course.group.name }
        return course.group.name + "\n" + second.joined(separator: " · ")
    }

    @ViewBuilder
    private func rowMenu(edit: @escaping () -> Void, delete: @escaping () -> Void) -> some View {
        Button(action: edit) {
            Label(String(localized: "uadmin.edit", defaultValue: "Изменить"), systemImage: "pencil")
        }
        Button(role: .destructive, action: delete) {
            Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
        }
    }

    @MainActor
    private func remove(_ target: DeleteTarget) async {
        let api = UAdminAPI()
        do {
            switch target.kind {
            case .course:
                try await api.deleteCourse(id: target.id)
                courses.remove(id: target.id)
            case .subject:
                try await api.deleteSubject(id: target.id)
                subjects.remove(id: target.id)
            case .term:
                try await api.deleteTerm(id: target.id)
                terms.remove(id: target.id)
            }
        } catch where target.kind == .course && UAdminFailure.isConflict(error) {
            actionFailure = String(localized: "uadmin.courses.hasRecords", defaultValue: "По дисциплине есть оценки, сданные работы или результаты экзаменов — удалить её нельзя")
        } catch {
            actionFailure = error.userMessage
        }
    }
}

private enum CoursesTab: String, CaseIterable, Identifiable {
    case courses, subjects, terms

    var id: String { rawValue }

    var title: String {
        switch self {
        case .courses: return String(localized: "uadmin.courses.tab.courses", defaultValue: "Курсы")
        case .subjects: return String(localized: "uadmin.courses.tab.subjects", defaultValue: "Справочник")
        case .terms: return String(localized: "uadmin.courses.tab.terms", defaultValue: "Семестры")
        }
    }

    var addTitle: String {
        switch self {
        case .courses: return String(localized: "uadmin.courses.assign", defaultValue: "Назначить дисциплину")
        case .subjects: return String(localized: "uadmin.subjects.add", defaultValue: "Добавить дисциплину")
        case .terms: return String(localized: "uadmin.terms.add", defaultValue: "Добавить семестр")
        }
    }
}

private enum CourseSort: String, CaseIterable, Identifiable {
    case subject, group, term, teacher, credits

    var id: String { rawValue }

    var title: String {
        switch self {
        case .subject: return String(localized: "uadmin.courses.sort.subject", defaultValue: "Дисциплина")
        case .group: return String(localized: "uadmin.courses.sort.group", defaultValue: "Группа")
        case .term: return String(localized: "uadmin.courses.sort.term", defaultValue: "Семестр")
        case .teacher: return String(localized: "uadmin.courses.sort.teacher", defaultValue: "Преподаватель")
        case .credits: return String(localized: "uadmin.courses.sort.credits", defaultValue: "Кредиты")
        }
    }
}

private struct CourseTarget: Identifiable {
    let id = UUID()
    let course: UAdminCourseDTO?
}

private struct SubjectTarget: Identifiable {
    let id = UUID()
    let subject: UAdminSubjectDTO?
}

private struct TermTarget: Identifiable {
    let id = UUID()
    let term: UAdminTermDTO?
}

private struct DeleteTarget {
    enum Kind { case course, subject, term }
    let kind: Kind
    let id: String
    let name: String
}

// MARK: - Формы

/// Назначение дисциплины группе. Дисциплину и группу после создания не меняют — их
/// заменяет новое назначение; правятся преподаватель, семестр и кредиты.
private struct CourseForm: View {
    let course: UAdminCourseDTO?
    let saved: () async -> Void

    @State private var subject: UAdminRefDTO?
    @State private var group: UAdminRefDTO?
    @State private var teacher: UAdminRefDTO?
    @State private var termID: String?
    @State private var credits = ""
    @State private var terms: [UAdminTermDTO] = []
    @State private var picking: CoursePick?
    @State private var prepared = false

    var body: some View {
        FormSheet(
            title: course == nil
                ? String(localized: "uadmin.courses.assign", defaultValue: "Назначить дисциплину")
                : String(localized: "uadmin.courses.edit", defaultValue: "Изменить дисциплину"),
            canSave: valid,
            save: save,
            saved: saved
        ) {
            Section {
                if let course {
                    LabeledContent(String(localized: "uadmin.courses.subject", defaultValue: "Дисциплина"), value: course.subject.name)
                    LabeledContent(String(localized: "uadmin.courses.group", defaultValue: "Группа"), value: course.group.name)
                } else {
                    UAdminPickerRow(title: String(localized: "uadmin.courses.subject", defaultValue: "Дисциплина"), value: subject?.name) { picking = .subject }
                    UAdminPickerRow(title: String(localized: "uadmin.courses.group", defaultValue: "Группа"), value: group?.name) { picking = .group }
                }
                UAdminPickerRow(
                    title: String(localized: "uadmin.courses.teacher", defaultValue: "Преподаватель"),
                    value: teacher?.name,
                    placeholder: String(localized: "uadmin.picker.none", defaultValue: "Не выбрано")
                ) { picking = .teacher }
                Picker(String(localized: "uadmin.courses.term", defaultValue: "Семестр"), selection: $termID) {
                    Text(String(localized: "uadmin.courses.noTerm", defaultValue: "Без семестра")).tag(String?.none)
                    ForEach(terms) { Text($0.name).tag(Optional($0.id)) }
                }
                TextField(String(localized: "uadmin.courses.credits", defaultValue: "Кредиты"), text: $credits)
                    .keyboardType(.numberPad)
            } footer: {
                if !creditsValid {
                    Text(String(localized: "uadmin.courses.creditsRange", defaultValue: "Кредиты — целое число от 0 до 60"))
                        .foregroundStyle(Palette.destructive)
                }
            }
        }
        .sheet(item: $picking) { pick in
            switch pick {
            case .subject:
                UAdminSearchPicker(
                    title: String(localized: "uadmin.courses.subject", defaultValue: "Дисциплина"),
                    prompt: String(localized: "uadmin.searchByName", defaultValue: "Поиск по названию"),
                    load: { needle in
                        try await UAdminAPI().subjects(PageRequest(cursor: nil, page: 1, limit: 30), search: needle.isEmpty ? nil : needle).items
                    },
                    label: \.name,
                    detail: \.code
                ) { picked in
                    subject = picked.map { UAdminRefDTO(id: $0.id, name: $0.name) }
                }
            case .group:
                UAdminSearchPicker(
                    title: String(localized: "uadmin.courses.group", defaultValue: "Группа"),
                    prompt: String(localized: "uadmin.searchByName", defaultValue: "Поиск по названию"),
                    load: UAdminPickers.groups,
                    label: \.name
                ) { picked in
                    group = picked.map { UAdminRefDTO(id: $0.id, name: $0.name) }
                }
            case .teacher:
                UAdminSearchPicker(
                    title: String(localized: "uadmin.courses.teacher", defaultValue: "Преподаватель"),
                    prompt: String(localized: "uadmin.searchPeople", defaultValue: "Фамилия или имя"),
                    allowsNone: true,
                    load: UAdminPickers.teachers,
                    label: \.name,
                    detail: { $0.role.map(UAdminText.role) }
                ) { picked in
                    teacher = picked.map { UAdminRefDTO(id: $0.id, name: $0.name) }
                }
            }
        }
        .onAppear {
            guard !prepared else { return }
            prepared = true
            teacher = course?.teacher.map { UAdminRefDTO(id: $0.id, name: $0.name) }
            termID = course?.term?.id
            credits = course?.credits.map { String($0) } ?? ""
        }
        .task {
            terms = (try? await UAdminAPI().terms(PageRequest(cursor: nil, page: 1, limit: 100)).items) ?? []
        }
    }

    private var creditsValue: Int? { Int(credits.trimmingCharacters(in: .whitespaces)) }

    private var creditsValid: Bool {
        let raw = credits.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return true }
        guard let value = creditsValue else { return false }
        return (0...60).contains(value)
    }

    private var valid: Bool {
        creditsValid && (course != nil || (subject != nil && group != nil))
    }

    private func save() async throws {
        if let course {
            try await UAdminAPI().saveCourse(
                id: course.id,
                body: ["teacherId": .text(teacher?.id), "termId": .text(termID), "credits": .int(creditsValue)]
            )
        } else {
            guard let subject, let group else { return }
            try await UAdminAPI().saveCourse(
                id: nil,
                body: [
                    "subjectId": .string(subject.id), "groupId": .string(group.id), "teacherId": .text(teacher?.id),
                    "termId": .text(termID), "credits": .int(creditsValue),
                ]
            )
        }
    }
}

private enum CoursePick: String, Identifiable {
    case subject, group, teacher
    var id: String { rawValue }
}

private struct SubjectForm: View {
    let subject: UAdminSubjectDTO?
    let saved: () async -> Void

    @State private var name = ""
    @State private var code = ""
    @State private var prepared = false

    var body: some View {
        FormSheet(
            title: subject == nil
                ? String(localized: "uadmin.subjects.add", defaultValue: "Добавить дисциплину")
                : String(localized: "uadmin.subjects.edit", defaultValue: "Изменить дисциплину справочника"),
            canSave: !trimmedName.isEmpty && trimmedName.count <= 200 && code.count <= 50,
            save: { try await UAdminAPI().saveSubject(id: subject?.id, name: trimmedName, code: code.trimmingCharacters(in: .whitespaces)) },
            saved: saved
        ) {
            Section {
                TextField(String(localized: "uadmin.subjects.name", defaultValue: "Название"), text: $name)
                TextField(String(localized: "uadmin.subjects.code", defaultValue: "Код (необязательно)"), text: $code)
                    .textInputAutocapitalization(.characters)
            }
        }
        .onAppear {
            guard !prepared else { return }
            prepared = true
            name = subject?.name ?? ""
            code = subject?.code ?? ""
        }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
}

/// Семестр: название, номер, даты и признак текущего. Текущим может быть только один —
/// остальные семестры вуза перестанут им быть.
struct UAdminTermForm: View {
    let term: UAdminTermDTO?
    let saved: () async -> Void

    @State private var name = ""
    @State private var number = ""
    @State private var startsOn = Date()
    @State private var endsOn = Calendar.current.date(byAdding: .month, value: 4, to: Date()) ?? Date()
    @State private var isActive = false
    @State private var prepared = false

    var body: some View {
        FormSheet(
            title: term == nil
                ? String(localized: "uadmin.terms.add", defaultValue: "Добавить семестр")
                : String(localized: "uadmin.terms.edit", defaultValue: "Изменить семестр"),
            canSave: valid,
            save: {
                let body: [String: JSONValue] = [
                    "name": .string(trimmedName),
                    "number": .int(numberValue),
                    "startsOn": .string(UAdminDay.string(startsOn)),
                    "endsOn": .string(UAdminDay.string(endsOn)),
                    "isActive": .bool(isActive),
                ]
                try await UAdminAPI().saveTerm(id: term?.id, body: body)
            },
            saved: saved
        ) {
            Section {
                TextField(String(localized: "uadmin.terms.namePlaceholder", defaultValue: "Название, например Осень 2026"), text: $name)
                TextField(String(localized: "uadmin.terms.numberField", defaultValue: "Номер семестра (необязательно)"), text: $number)
                    .keyboardType(.numberPad)
                DatePicker(String(localized: "uadmin.terms.starts", defaultValue: "Начало"), selection: $startsOn, displayedComponents: .date)
                DatePicker(String(localized: "uadmin.terms.ends", defaultValue: "Конец"), selection: $endsOn, in: startsOn..., displayedComponents: .date)
                Toggle(String(localized: "uadmin.terms.isActive", defaultValue: "Текущий семестр"), isOn: $isActive)
            } footer: {
                if !numberValid {
                    Text(String(localized: "uadmin.terms.numberInvalid", defaultValue: "Номер — целое число от 1 до 20"))
                        .foregroundStyle(Palette.destructive)
                } else if isActive {
                    Text(String(localized: "uadmin.terms.activeHint", defaultValue: "Остальные семестры вуза перестанут быть текущими"))
                }
            }
        }
        .onAppear {
            guard !prepared else { return }
            prepared = true
            guard let term else { return }
            name = term.name
            number = term.number.map { String($0) } ?? ""
            startsOn = UAdminDay.local(term.startsOn) ?? startsOn
            endsOn = UAdminDay.local(term.endsOn) ?? endsOn
            isActive = term.isActive
        }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var numberValue: Int? { Int(number.trimmingCharacters(in: .whitespaces)) }

    private var numberValid: Bool {
        let raw = number.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return true }
        guard let value = numberValue else { return false }
        return (1...20).contains(value)
    }

    private var valid: Bool {
        !trimmedName.isEmpty && trimmedName.count <= 120 && numberValid
            && UAdminDay.string(endsOn) >= UAdminDay.string(startsOn)
    }
}

private typealias TermForm = UAdminTermForm

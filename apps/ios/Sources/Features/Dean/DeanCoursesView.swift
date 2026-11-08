import SwiftUI

/// Дисциплины факультета: назначение дисциплины группе, правка (преподаватель, семестр,
/// кредиты), удаление. Справочник дисциплин и семестры ведёт админ вуза — декан их
/// только смотрит (на вкладках ниже), кнопок правки у него нет, как и в вебе.
struct DeanCoursesView: View {
    private enum Tab: String, Hashable { case courses, subjects, terms }

    @State private var tab: Tab? = .courses
    @State private var sort: String?
    @State private var ascending = true
    @State private var courses: PagedLoader<DeanCourse>
    @State private var subjects: PagedLoader<DeanSubject>
    @State private var terms: PagedLoader<DeanTerm>
    @State private var creating = false
    @State private var editing: DeanCourse?
    @State private var deleting: DeanCourse?
    @State private var actionFailure: String?

    private let api = DeanAPI()

    init() {
        let api = DeanAPI()
        _courses = State(initialValue: PagedLoader(limit: 50) { try await api.courses($0, sort: nil, ascending: true) })
        _subjects = State(initialValue: PagedLoader(limit: 50) { try await api.subjects($0, search: nil) })
        _terms = State(initialValue: PagedLoader(limit: 50) { try await api.terms($0) })
    }

    var body: some View {
        Group {
            switch tab ?? .courses {
            case .courses: coursesList
            case .subjects: subjectsList
            case .terms: termsList
            }
        }
        .navigationTitle(Text(DeanScreen.courses.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if tab == .courses {
                    Menu {
                        Button {
                            creating = true
                        } label: {
                            Label(String(localized: "dean.courses.assign", defaultValue: "Назначить дисциплину"), systemImage: "plus")
                        }
                        Picker(String(localized: "dean.sort.by", defaultValue: "Сортировать"), selection: $sort) {
                            Text(String(localized: "dean.sort.default", defaultValue: "Как на сервере")).tag(String?.none)
                            Text(String(localized: "dean.courses.col.subject", defaultValue: "Дисциплина")).tag(String?.some("subject"))
                            Text(String(localized: "dean.group.name", defaultValue: "Группа")).tag(String?.some("group"))
                            Text(String(localized: "dean.courses.col.term", defaultValue: "Семестр")).tag(String?.some("term"))
                            Text(String(localized: "dean.courses.col.teacher", defaultValue: "Преподаватель")).tag(String?.some("teacher"))
                            Text(String(localized: "dean.courses.col.credits", defaultValue: "Кредиты")).tag(String?.some("credits"))
                        }
                        Toggle(String(localized: "dean.sort.ascending", defaultValue: "По возрастанию"), isOn: $ascending)
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .onChange(of: sort) { _, _ in Task { await resort() } }
        .onChange(of: ascending) { _, _ in Task { await resort() } }
        .sheet(isPresented: $creating) {
            DeanCourseForm(course: nil) { await courses.reload() }
        }
        .sheet(item: $editing) { course in
            DeanCourseForm(course: course) { await courses.reload() }
        }
        .confirmDestructive(
            $deleting,
            title: { String(localized: "dean.courses.deleteConfirm", defaultValue: "Удалить дисциплину «\($0.subject.name)» у группы \($0.group.name)?") },
            actionTitle: String(localized: "dean.delete", defaultValue: "Удалить")
        ) { course in
            await delete(course)
        }
        .actionFailureAlert($actionFailure)
    }

    private var tabs: some View {
        FilterChipsRow(
            options: [
                (Tab.courses, String(localized: "dean.courses.tab.courses", defaultValue: "Курсы")),
                (Tab.subjects, String(localized: "dean.courses.tab.subjects", defaultValue: "Справочник")),
                (Tab.terms, String(localized: "dean.courses.tab.terms", defaultValue: "Семестры")),
            ],
            selection: $tab
        )
    }

    private var coursesList: some View {
        PagedList(
            loader: courses,
            empty: EmptyStateView(
                title: String(localized: "dean.courses.empty", defaultValue: "Дисциплин пока нет"),
                symbol: "book",
                hint: String(localized: "dean.courses.emptyHint", defaultValue: "Назначьте дисциплину группе — она появится у преподавателя в журнале"),
                actionTitle: String(localized: "dean.courses.assign", defaultValue: "Назначить дисциплину"),
                action: { creating = true }
            ),
            header: { tabs },
            row: { course in
                Button {
                    editing = course
                } label: {
                    ListCardRow(
                        title: course.subject.name,
                        subtitle: course.group.name,
                        lines: [
                            course.teacher?.name ?? String(localized: "dean.courses.noTeacher", defaultValue: "Преподаватель не назначен"),
                            [course.term?.name, course.credits.map { String(localized: "dean.courses.credits", defaultValue: "Кредитов: \($0.formatted())") }]
                                .compactMap { $0 }
                                .joined(separator: " · "),
                        ]
                    )
                }
                .buttonStyle(.plain)
                .swipeActions {
                    Button(role: .destructive) {
                        deleting = course
                    } label: {
                        Label(String(localized: "dean.delete", defaultValue: "Удалить"), systemImage: "trash")
                    }
                    Button {
                        editing = course
                    } label: {
                        Label(String(localized: "dean.edit", defaultValue: "Изменить"), systemImage: "pencil")
                    }
                }
                .contextMenu {
                    Button {
                        editing = course
                    } label: {
                        Label(String(localized: "dean.edit", defaultValue: "Изменить"), systemImage: "pencil")
                    }
                    Button(role: .destructive) {
                        deleting = course
                    } label: {
                        Label(String(localized: "dean.delete", defaultValue: "Удалить"), systemImage: "trash")
                    }
                }
            }
        )
    }

    private var subjectsList: some View {
        PagedList(
            loader: subjects,
            empty: EmptyStateView(
                title: String(localized: "dean.subjects.empty", defaultValue: "Справочник дисциплин пуст"),
                symbol: "books.vertical",
                hint: String(localized: "dean.subjects.emptyHint", defaultValue: "Справочник ведёт администратор вуза")
            ),
            header: { tabs },
            row: { subject in
                HStack {
                    Text(subject.name).font(Typography.body)
                    Spacer(minLength: Spacing.md)
                    if let code = subject.code, !code.isEmpty {
                        StatusBadge(text: code, tint: Palette.mutedForeground)
                    }
                }
            }
        )
    }

    private var termsList: some View {
        PagedList(
            loader: terms,
            empty: EmptyStateView(
                title: String(localized: "dean.terms.empty", defaultValue: "Семестров нет"),
                symbol: "calendar",
                hint: String(localized: "dean.subjects.emptyHint", defaultValue: "Справочник ведёт администратор вуза")
            ),
            header: { tabs },
            row: { term in
                ListCardRow(
                    title: term.name,
                    status: term.isActive ? (String(localized: "dean.term.active", defaultValue: "Текущий семестр"), Palette.success) : nil,
                    lines: ["\(DisplayFormat.date(DeanTime.parse(term.startsOn))) — \(DisplayFormat.date(DeanTime.parse(term.endsOn)))"]
                )
            }
        )
    }

    @MainActor
    private func resort() async {
        let sort = sort
        let ascending = ascending
        await courses.replace { try await api.courses($0, sort: sort, ascending: ascending) }
    }

    @MainActor
    private func delete(_ course: DeanCourse) async {
        do {
            try await api.deleteCourse(id: course.id)
            courses.remove(id: course.id)
        } catch {
            // CONFLICT — по дисциплине уже есть оценки, работы или результаты экзаменов.
            if let api = error as? APIError, api.code == .conflict {
                actionFailure = String(localized: "dean.courses.deleteHasRecords", defaultValue: "По дисциплине уже есть оценки, работы или результаты экзаменов — удалить её нельзя.")
            } else {
                actionFailure = error.userMessage
            }
        }
    }
}

/// Назначение дисциплины группе или правка назначенной. Правка шлёт только изменённое:
/// сервер заново проверяет каждого переданного преподавателя.
private struct DeanCourseForm: View {
    let course: DeanCourse?
    let saved: () async -> Void

    @State private var subject: DeanPickOption?
    @State private var group: DeanPickOption?
    @State private var teacher: DeanPickOption?
    @State private var term: DeanPickOption?
    @State private var credits = ""

    private let api = DeanAPI()

    init(course: DeanCourse?, saved: @escaping () async -> Void) {
        self.course = course
        self.saved = saved
        _teacher = State(initialValue: course?.teacher.map { DeanPickOption(id: $0.id, title: $0.name) })
        _term = State(initialValue: course?.term.map { DeanPickOption(id: $0.id, title: $0.name) })
        _credits = State(initialValue: course?.credits.map { String($0) } ?? "")
    }

    private var creditsValue: Int?? {
        let trimmed = credits.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return .some(nil) }
        guard let value = Int(trimmed), (0...60).contains(value) else { return nil }
        return .some(value)
    }

    var body: some View {
        FormSheet(
            title: course == nil
                ? String(localized: "dean.courses.new", defaultValue: "Новая дисциплина")
                : String(localized: "dean.courses.editTitle", defaultValue: "Дисциплина группы"),
            canSave: creditsValue != nil && (course != nil || (subject != nil && group != nil)),
            save: { try await save() },
            saved: saved
        ) {
            Section {
                if let course {
                    DetailRow(title: String(localized: "dean.courses.col.subject", defaultValue: "Дисциплина"), value: course.subject.name)
                    DetailRow(title: String(localized: "dean.group.name", defaultValue: "Группа"), value: course.group.name)
                } else {
                    DeanPickerField(
                        title: String(localized: "dean.courses.col.subject", defaultValue: "Дисциплина"),
                        selection: $subject,
                        allowsNone: false,
                        load: DeanPickers.subjects(api)
                    )
                    DeanPickerField(
                        title: String(localized: "dean.group.name", defaultValue: "Группа"),
                        selection: $group,
                        allowsNone: false,
                        load: DeanPickers.groups(api)
                    )
                }
            }

            Section {
                DeanPickerField(
                    title: String(localized: "dean.courses.col.teacher", defaultValue: "Преподаватель"),
                    selection: $teacher,
                    load: DeanPickers.teachingStaff(api)
                )
                DeanPickerField(
                    title: String(localized: "dean.courses.col.term", defaultValue: "Семестр"),
                    selection: $term,
                    searchable: false,
                    load: DeanPickers.terms(api)
                )
                TextField(String(localized: "dean.courses.col.credits", defaultValue: "Кредиты"), text: $credits)
                    .keyboardType(.numberPad)
            } footer: {
                Text(String(localized: "dean.courses.teacherHint", defaultValue: "Без преподавателя дисциплина не появится у ведущего в журнале, заданиях и экзаменах. Кредиты — от 0 до 60."))
            }
        }
    }

    private func save() async throws {
        let creditsValue = creditsValue ?? nil
        if let course {
            var fields: [String: JSONValue] = [:]
            if teacher?.id != course.teacher?.id { fields["teacherId"] = .text(teacher?.id) }
            if term?.id != course.term?.id { fields["termId"] = .text(term?.id) }
            if creditsValue != course.credits { fields["credits"] = .int(creditsValue) }
            guard !fields.isEmpty else { return }
            try await api.updateCourse(id: course.id, fields: fields)
        } else if let subject, let group {
            try await api.createCourse(subjectID: subject.id, groupID: group.id, teacherID: teacher?.id, termID: term?.id, credits: creditsValue)
        }
    }
}

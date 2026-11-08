import SwiftUI

// Студенты, преподаватели и старосты факультета, карточка студента и форма учебных
// данных. Блокировки здесь нет: она у администрации вуза, декан ведёт учебные данные.

/// Список людей факультета одной роли: поиск, сортировка на сервере, фильтр группы
/// (у студентов), выгрузка в Excel/CSV.
struct DeanPeopleView: View {
    let role: Role

    @State private var query: DeanAPI.UserQuery
    @State private var search = ""
    @State private var loader: PagedLoader<DeanUser>
    @State private var filtersShown = false
    @State private var exportChoice = false
    @State private var academicFor: DeanUser?
    @State private var exporter = DeanFileExporter()
    @State private var groupFilter: DeanPickOption?

    private let api = DeanAPI()

    init(role: Role) {
        self.role = role
        let initial = DeanAPI.UserQuery(role: role)
        _query = State(initialValue: initial)
        let api = DeanAPI()
        _loader = State(initialValue: PagedLoader(limit: 50) { request in
            try await api.users(request, query: initial)
        })
    }

    private var isStudentList: Bool { role == .student || role == .starosta }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "dean.people.empty", defaultValue: "Никого не нашлось"),
                symbol: "person.2"
            ),
            header: {
                if let groupFilter {
                    Section {
                        HStack {
                            Label(groupFilter.title, systemImage: "person.3")
                            Spacer()
                            Button(String(localized: "dean.filter.reset", defaultValue: "Сбросить")) {
                                self.groupFilter = nil
                                Task { await apply() }
                            }
                        }
                    }
                    .listRowBackground(Palette.card)
                }
            },
            row: { user in
                NavigationLink(value: route(user)) {
                    HStack {
                        PersonRow(name: user.name, subtitle: user.email, avatarURL: user.avatarThumbUrl ?? user.avatarUrl)
                        if user.isBlocked == true {
                            StatusBadge(text: String(localized: "dean.people.blocked", defaultValue: "Заблокирован"), tint: Palette.destructive)
                        }
                    }
                }
                .swipeActions {
                    if isStudentList {
                        Button {
                            academicFor = user
                        } label: {
                            Label(String(localized: "dean.academic.title", defaultValue: "Учебные данные"), systemImage: "graduationcap")
                        }
                        .tint(Palette.primary)
                    }
                }
                .contextMenu {
                    if isStudentList {
                        Button {
                            academicFor = user
                        } label: {
                            Label(String(localized: "dean.academic.title", defaultValue: "Учебные данные"), systemImage: "graduationcap")
                        }
                    }
                }
            }
        )
        .navigationTitle(Text(title))
        .debouncedSearch($search, prompt: String(localized: "dean.people.search", defaultValue: "Имя или почта")) { needle in
            query.search = needle
            await apply()
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    filtersShown = true
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel(Text(String(localized: "dean.filter.title", defaultValue: "Фильтры и порядок")))
                Button {
                    exportChoice = true
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .disabled((loader.total ?? 0) == 0)
                .accessibilityLabel(Text(String(localized: "dean.people.export", defaultValue: "Выгрузить список")))
            }
        }
        .confirmationDialog(
            String(localized: "dean.people.export", defaultValue: "Выгрузить список"),
            isPresented: $exportChoice,
            titleVisibility: .visible
        ) {
            Button(verbatim: "Excel (XLSX)") { export(.xlsx) }
            Button(verbatim: "CSV") { export(.csv) }
        } message: {
            Text(String(localized: "dean.people.exportHint", defaultValue: "В файл попадёт вся выборка с текущими фильтрами. Больше 5000 строк — только CSV."))
        }
        .sheet(isPresented: $filtersShown) {
            DeanPeopleFilterSheet(
                showsGroup: isStudentList,
                group: groupFilter,
                sort: query.sort,
                ascending: query.ascending
            ) { group, sort, ascending in
                groupFilter = group
                query.sort = sort
                query.ascending = ascending
                await apply()
            }
        }
        .sheet(item: $academicFor) { user in
            DeanAcademicForm(userID: user.id) { await loader.reload() }
        }
        .deanExportSheet(exporter)
    }

    private var title: String {
        switch role {
        case .teacher: return DeanScreen.teachers.title
        case .starosta: return DeanScreen.starostas.title
        default: return DeanScreen.students.title
        }
    }

    private func route(_ user: DeanUser) -> AppRoute {
        isStudentList ? .dean(.student(id: user.id)) : .profile(id: user.id)
    }

    @MainActor
    private func apply() async {
        query.groupID = groupFilter?.id
        let current = query
        await loader.replace { request in try await api.users(request, query: current) }
    }

    private func export(_ format: DeanExportFormat) {
        let current = query
        let stem: String
        switch role {
        case .teacher: stem = "teachers"
        case .starosta: stem = "starostas"
        default: stem = "students"
        }
        Task {
            await exporter.run(name: DeanFileExporter.fileName(stem, format: format)) {
                try await api.exportUsers(query: current, format: format)
            }
        }
    }
}

private struct DeanPeopleFilterSheet: View {
    let showsGroup: Bool
    @State var group: DeanPickOption?
    @State var sort: String?
    @State var ascending: Bool
    let apply: (DeanPickOption?, String?, Bool) async -> Void

    private let api = DeanAPI()

    var body: some View {
        FormSheet(
            title: String(localized: "dean.filter.title", defaultValue: "Фильтры и порядок"),
            saveTitle: String(localized: "dean.filter.apply", defaultValue: "Применить"),
            save: { await apply(group, sort, ascending) }
        ) {
            if showsGroup {
                Section {
                    DeanPickerField(
                        title: String(localized: "dean.group.name", defaultValue: "Группа"),
                        selection: $group,
                        noneTitle: String(localized: "dean.filter.allGroups", defaultValue: "Все группы"),
                        load: DeanPickers.groups(api)
                    )
                }
                .listRowBackground(Palette.card)
            }
            Section {
                Picker(String(localized: "dean.sort.by", defaultValue: "Сортировать"), selection: $sort) {
                    Text(String(localized: "dean.sort.default", defaultValue: "Как на сервере")).tag(String?.none)
                    Text(String(localized: "dean.sort.name", defaultValue: "По имени")).tag(String?.some("name"))
                    Text(String(localized: "dean.sort.email", defaultValue: "По почте")).tag(String?.some("email"))
                    Text(String(localized: "dean.sort.blocked", defaultValue: "По статусу")).tag(String?.some("blocked"))
                    Text(String(localized: "dean.sort.created", defaultValue: "По дате регистрации")).tag(String?.some("createdAt"))
                }
                if sort != nil {
                    Toggle(String(localized: "dean.sort.ascending", defaultValue: "По возрастанию"), isOn: $ascending)
                }
            }
            .listRowBackground(Palette.card)
        }
    }
}

// MARK: - Карточка студента

/// Студент глазами деканата: учебные данные, посещаемость, причины риска, библиотека.
struct DeanStudentView: View {
    let userID: String

    @State private var reload = 0
    @State private var editing = false

    private let api = DeanAPI()

    private struct Snapshot {
        var profile: DeanUserProfile
        var group: DeanGroup?
        var attendance: DeanGroupAttendance.Student?
        var risk: DeanAtRisk.Student?
        var debts: DeanLibraryDebts?
    }

    var body: some View {
        RemoteContent(reloadToken: reload, load: { try await load() }) { data in
            content(data)
        }
        .navigationTitle(Text(DeanScreen.student(id: userID).title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(String(localized: "dean.academic.edit", defaultValue: "Изменить")) { editing = true }
            }
        }
        .sheet(isPresented: $editing) {
            DeanAcademicForm(userID: userID) { reload += 1 }
        }
    }

    @MainActor
    private func load() async throws -> Snapshot {
        let profile = try await api.user(id: userID)
        async let group: DeanGroup? = profile.groupId.asyncMap { try? await api.group(id: $0) }
        async let attendance: DeanGroupAttendance? = profile.groupId.asyncMap { try? await api.groupAttendance(groupID: $0) }
        async let risk = try? api.atRisk()
        async let debts = try? api.libraryDebts(userID: userID)
        return Snapshot(
            profile: profile,
            group: await group,
            attendance: (await attendance)?.students.first { $0.studentId == userID },
            risk: (await risk)?.students.first { $0.studentId == userID },
            debts: await debts
        )
    }

    @ViewBuilder
    private func content(_ data: Snapshot) -> some View {
        let profile = data.profile
        List {
            Section {
                NavigationLink(value: AppRoute.profile(id: profile.id)) {
                    PersonRow(
                        name: profile.name,
                        subtitle: [profile.roleValue.title, data.group?.name ?? ""].filter { !$0.isEmpty }.joined(separator: " · "),
                        avatarURL: profile.avatarUrl,
                        size: 56
                    )
                }
                if let email = profile.email, !email.isEmpty {
                    DetailRow(title: String(localized: "dean.student.email", defaultValue: "Почта"), value: email, symbol: "envelope")
                }
                if let phone = profile.phone, !phone.isEmpty {
                    DetailRow(title: String(localized: "dean.student.phone", defaultValue: "Телефон"), value: phone, symbol: "phone")
                }
                if let group = data.group {
                    NavigationLink(value: AppRoute.dean(.group(id: group.id))) {
                        DetailRow(title: String(localized: "dean.group.name", defaultValue: "Группа"), value: group.name, symbol: "person.3")
                    }
                }
            }
            .listRowBackground(Palette.card)

            Section {
                if let status = profile.academicStatus, !status.isEmpty {
                    HStack {
                        Text(String(localized: "dean.academic.status", defaultValue: "Статус"))
                        Spacer()
                        StatusBadge(text: status, tint: DeanAcademic.leaving.contains(status) ? Palette.destructive : Palette.success)
                    }
                }
                ForEach(DeanAcademic.detailRows(profile), id: \.0) { row in
                    DetailRow(title: row.0, value: row.1)
                }
                Button {
                    editing = true
                } label: {
                    Label(String(localized: "dean.academic.title", defaultValue: "Учебные данные"), systemImage: "square.and.pencil")
                }
            } header: {
                Text(String(localized: "dean.student.academic", defaultValue: "Учёба"))
            }
            .listRowBackground(Palette.card)

            Section {
                if let attendance = data.attendance {
                    DeanRateRow(
                        title: String(localized: "dean.kpi.attendance", defaultValue: "Посещаемость"),
                        subtitle: String(localized: "dean.attendance.tracked", defaultValue: "Отмечено занятий: \(attendance.tracked.formatted())"),
                        rate: attendance.attendanceRate
                    )
                } else {
                    Text(String(localized: "dean.student.noAttendance", defaultValue: "Отметок посещаемости пока нет"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                if let risk = data.risk, !risk.reasons.isEmpty {
                    ForEach(risk.reasons, id: \.kind) { reason in
                        Label(DeanRiskText.line(reason), systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Palette.destructive)
                    }
                } else {
                    Label(String(localized: "dean.student.noRisk", defaultValue: "Причин для беспокойства нет"), systemImage: "checkmark.seal")
                        .foregroundStyle(Palette.success)
                }
            } header: {
                Text(String(localized: "dean.student.progress", defaultValue: "Успеваемость и посещаемость"))
            }
            .listRowBackground(Palette.card)

            if let debts = data.debts {
                Section {
                    if debts.clear || debts.loans.isEmpty {
                        Label(String(localized: "dean.student.libraryClear", defaultValue: "Задолженностей нет"), systemImage: "checkmark.circle")
                            .foregroundStyle(Palette.success)
                    } else {
                        ForEach(debts.loans) { loan in
                            DeanLoanRow(loan: loan)
                        }
                    }
                } header: {
                    Text(String(localized: "dean.student.library", defaultValue: "Библиотека"))
                }
                .listRowBackground(Palette.card)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .refreshable { reload += 1 }
    }
}

private struct DeanLoanRow: View {
    let loan: DeanLibraryDebts.Loan

    var body: some View {
        let lost = loan.status == "LOST"
        ListCardRow(
            title: loan.book?.title ?? "—",
            subtitle: loan.copy?.inventoryNumber.map { String(localized: "dean.loan.inventory", defaultValue: "Инв. № \($0)") },
            status: lost
                ? (String(localized: "dean.loan.lost", defaultValue: "Утеряна"), Palette.destructive)
                : (loan.overdue == true
                    ? (String(localized: "dean.loan.overdue", defaultValue: "Просрочена"), Palette.destructive)
                    : (String(localized: "dean.loan.open", defaultValue: "На руках"), Palette.warning))
        )
    }
}

private extension Optional {
    func asyncMap<T>(_ transform: (Wrapped) async -> T?) async -> T? {
        guard let value = self else { return nil }
        return await transform(value)
    }
}

// MARK: - Учебные данные

enum DeanAcademic {
    static let statuses = ["Обучающийся", "Академический отпуск", "Выпускник", "Отчислен", "Переведён"]
    /// Статусы ухода из вуза: при переводе в них — предупреждение о книгах библиотеки.
    static let leaving: Set<String> = ["Выпускник", "Отчислен", "Переведён"]
    static let educationLevels = ["Среднее", "Среднее специальное", "Бакалавриат", "Специалитет", "Магистратура", "Аспирантура", "Докторантура"]
    static let studyForms = ["Очная", "Заочная", "Очно-заочная", "Дистанционная"]
    static let fundingTypes = ["Бюджетное", "Платное", "Грант", "Целевое"]
    static let dormitory = ["Да", "Нет"]

    static func detailRows(_ profile: DeanUserProfile) -> [(String, String)] {
        let rows: [(String, String?)] = [
            (String(localized: "dean.academic.course", defaultValue: "Курс"), profile.course.map { String($0) }),
            (String(localized: "dean.academic.specialty", defaultValue: "Специальность"), profile.specialty),
            (String(localized: "dean.academic.level", defaultValue: "Уровень образования"), profile.educationLevel),
            (String(localized: "dean.academic.form", defaultValue: "Форма обучения"), profile.studyForm),
            (String(localized: "dean.academic.funding", defaultValue: "Основа обучения"), profile.fundingType),
            (String(localized: "dean.academic.enrollment", defaultValue: "Год поступления"), profile.enrollmentYear.map { String($0) }),
            (String(localized: "dean.academic.graduation", defaultValue: "Год выпуска"), profile.graduationYear.map { String($0) }),
            (String(localized: "dean.academic.gpa", defaultValue: "GPA"), profile.gpa.map { $0.formatted(.number.precision(.fractionLength(0...2))) }),
            (String(localized: "dean.academic.card", defaultValue: "Номер студенческого"), profile.studentCardNumber),
            (String(localized: "dean.academic.dormitory", defaultValue: "Общежитие"), profile.dormitory),
        ]
        return rows.compactMap { row in
            guard let value = row.1, !value.isEmpty else { return nil }
            return (row.0, value)
        }
    }
}

/// Учебные данные студента — правит декан. Уходят только изменённые поля: пустое поле
/// здесь значит «не знаю», и отправка всех полей разом затёрла бы, скажем, номер
/// студенческого, которого декану в профиль не пришло.
struct DeanAcademicForm: View {
    let userID: String
    var saved: () async -> Void = {}

    @State private var initial: [String: String]?
    @State private var form: [String: String] = [:]
    @State private var failure: String?
    @State private var specialties: [String] = []
    @State private var debts: DeanLibraryDebts?

    private let api = DeanAPI()
    private static let numeric: Set<String> = ["course", "enrollmentYear", "graduationYear", "gpa"]

    var body: some View {
        Group {
            if initial != nil {
                FormSheet(
                    title: String(localized: "dean.academic.title", defaultValue: "Учебные данные"),
                    canSave: !changed.isEmpty && isValid,
                    save: { try await save() },
                    saved: saved
                ) {
                    fields
                }
            } else if let failure {
                NavigationStack {
                    ErrorStateView(message: failure) { await load() }
                }
            } else {
                LoadingStateView()
            }
        }
        .task { await load() }
        .task(id: form["academicStatus"]) { await checkDebts() }
    }

    @ViewBuilder
    private var fields: some View {
        Section {
            TextField(String(localized: "dean.academic.course", defaultValue: "Курс"), text: binding("course"))
                .keyboardType(.numberPad)
            DeanDictPicker(
                title: String(localized: "dean.academic.specialty", defaultValue: "Специальность"),
                options: specialties,
                value: binding("specialty")
            )
            DeanDictPicker(title: String(localized: "dean.academic.level", defaultValue: "Уровень образования"), options: DeanAcademic.educationLevels, value: binding("educationLevel"))
            DeanDictPicker(title: String(localized: "dean.academic.form", defaultValue: "Форма обучения"), options: DeanAcademic.studyForms, value: binding("studyForm"))
            DeanDictPicker(title: String(localized: "dean.academic.funding", defaultValue: "Основа обучения"), options: DeanAcademic.fundingTypes, value: binding("fundingType"))
        }
        .listRowBackground(Palette.card)

        Section {
            DeanDictPicker(title: String(localized: "dean.academic.status", defaultValue: "Статус"), options: DeanAcademic.statuses, value: binding("academicStatus"), allowsEmpty: false)
            if leaving, let debts, !debts.clear, !debts.loans.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Label(
                        String(localized: "dean.academic.debts", defaultValue: "За студентом числятся книги: \(debts.loans.count.formatted())"),
                        systemImage: "books.vertical"
                    )
                    .foregroundStyle(Palette.destructive)
                    ForEach(debts.loans) { loan in
                        Text(verbatim: "· \(loan.book?.title ?? "—")")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
            }
        } footer: {
            Text(String(localized: "dean.academic.statusHint", defaultValue: "От статуса зависят выдача книг и проход по студенческому."))
        }
        .listRowBackground(Palette.card)

        Section {
            DeanDictPicker(title: String(localized: "dean.academic.enrollment", defaultValue: "Год поступления"), options: Self.years, value: binding("enrollmentYear"))
            DeanDictPicker(title: String(localized: "dean.academic.graduation", defaultValue: "Год выпуска"), options: Self.years, value: binding("graduationYear"))
            TextField(String(localized: "dean.academic.gpa", defaultValue: "GPA"), text: binding("gpa"))
                .keyboardType(.decimalPad)
            TextField(String(localized: "dean.academic.card", defaultValue: "Номер студенческого"), text: binding("studentCardNumber"))
            DeanDictPicker(title: String(localized: "dean.academic.dormitory", defaultValue: "Общежитие"), options: DeanAcademic.dormitory, value: binding("dormitory"))
        } footer: {
            Text(String(localized: "dean.academic.cardHint", defaultValue: "Номер студенческого чужому человеку в профиль не приходит: пустое поле не значит, что номера нет."))
        }
        .listRowBackground(Palette.card)
    }

    private static let years: [String] = {
        let now = Calendar.current.component(.year, from: Date())
        return stride(from: now + 6, through: 1970, by: -1).map { String($0) }
    }()

    private var leaving: Bool {
        guard let initial else { return false }
        let status = form["academicStatus"] ?? ""
        return status != initial["academicStatus"] && DeanAcademic.leaving.contains(status)
    }

    private var changed: [String] {
        guard let initial else { return [] }
        return form.keys.filter { (form[$0] ?? "") != (initial[$0] ?? "") }.sorted()
    }

    private var isValid: Bool {
        for key in Self.numeric {
            let value = (form[key] ?? "").trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
            if !value.isEmpty, Double(value) == nil { return false }
        }
        return true
    }

    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { form[key] ?? "" }, set: { form[key] = $0 })
    }

    @MainActor
    private func load() async {
        do {
            let profile = try await api.user(id: userID)
            let values: [String: String] = [
                "course": profile.course.map { String($0) } ?? "",
                "specialty": profile.specialty ?? "",
                "educationLevel": profile.educationLevel ?? "",
                "studyForm": profile.studyForm ?? "",
                "fundingType": profile.fundingType ?? "",
                "academicStatus": profile.academicStatus ?? "",
                "enrollmentYear": profile.enrollmentYear.map { String($0) } ?? "",
                "graduationYear": profile.graduationYear.map { String($0) } ?? "",
                "gpa": profile.gpa.map { JSONValue.format($0) } ?? "",
                "studentCardNumber": profile.studentCardNumber ?? "",
                "dormitory": profile.dormitory ?? "",
            ]
            form = values
            initial = values
            failure = nil
            specialties = (try? await api.specialties().map(\.name)) ?? []
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func checkDebts() async {
        guard leaving, debts == nil else { return }
        debts = try? await api.libraryDebts(userID: userID)
    }

    private func save() async throws {
        var fields: [String: JSONValue] = [:]
        for key in changed {
            let value = (form[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if Self.numeric.contains(key) {
                let number = Double(value.replacingOccurrences(of: ",", with: "."))
                fields[key] = number.map { .number($0) } ?? .null
            } else {
                fields[key] = .string(value)
            }
        }
        try await api.updateAcademic(userID: userID, fields: fields)
    }
}

/// Выбор значения справочника. Значение не из списка (запись до справочника) остаётся
/// видно отдельной строкой, пока не выбрали другое.
private struct DeanDictPicker: View {
    let title: String
    let options: [String]
    @Binding var value: String
    var allowsEmpty = true

    var body: some View {
        Picker(title, selection: $value) {
            if allowsEmpty || value.isEmpty {
                Text(String(localized: "dean.picker.none", defaultValue: "Не выбрано")).tag("")
            }
            if !value.isEmpty, !options.contains(value) {
                Text(verbatim: value).tag(value)
            }
            ForEach(options, id: \.self) { option in
                Text(verbatim: option).tag(option)
            }
        }
    }
}

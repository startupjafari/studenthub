import SwiftUI

/// Дисциплины: студенту — курсы его группы, преподавателю — свои (`mine`). Поиск по
/// названию, разбивка по семестрам, текущий — первым.
struct CoursesView: View {
    let role: Role

    @State private var courses: [CourseDTO]?
    @State private var failure: String?
    @State private var query = ""

    private var isTeacher: Bool { role == .teacher }

    var body: some View {
        List {
            if let courses {
                let terms = Self.grouped(filtered(courses))
                if terms.isEmpty {
                    EmptyStateView(
                        title: query.isEmpty
                            ? String(localized: "courses.empty", defaultValue: "Дисциплин пока нет")
                            : String(localized: "services.notFound", defaultValue: "Ничего не нашлось"),
                        symbol: "book.closed"
                    )
                    .listRowBackground(Color.clear)
                }
                ForEach(terms, id: \.title) { term in
                    Section {
                        ForEach(term.courses) { course in
                            NavigationLink {
                                CourseDetailView(course: course, role: role)
                            } label: {
                                CourseRow(course: course, showsGroup: isTeacher)
                            }
                        }
                    } header: {
                        Text(term.title)
                    }
                    .listRowBackground(Palette.card)
                }
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(MoreSection.subjects.title))
        .searchable(text: $query, prompt: Text(String(localized: "courses.search", defaultValue: "Найти дисциплину")))
        .refreshable { await load() }
        .task { await load() }
    }

    private func filtered(_ courses: [CourseDTO]) -> [CourseDTO] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return courses }
        return courses.filter {
            $0.subject.name.lowercased().contains(needle)
                || ($0.subject.code?.lowercased().contains(needle) ?? false)
                || ($0.teacher?.name.lowercased().contains(needle) ?? false)
                || ($0.group?.name.lowercased().contains(needle) ?? false)
        }
    }

    /// Семестры: активный первым, затем по номеру по убыванию — свежее выше.
    static func grouped(_ courses: [CourseDTO]) -> [(title: String, courses: [CourseDTO])] {
        let byTerm = Dictionary(grouping: courses) { $0.term?.id ?? "" }
        return byTerm.values
            .sorted { lhs, rhs in
                let a = lhs.first?.term, b = rhs.first?.term
                if (a?.isActive ?? false) != (b?.isActive ?? false) { return a?.isActive ?? false }
                return (a?.number ?? 0) > (b?.number ?? 0)
            }
            .map { list in
                let term = list.first?.term
                let title = term?.name ?? String(localized: "courses.noTerm", defaultValue: "Без семестра")
                let sorted = list.sorted { $0.subject.name.localizedCompare($1.subject.name) == .orderedAscending }
                return (term?.isActive == true ? String(localized: "courses.currentTerm", defaultValue: "Текущий семестр · \(title)") : title, sorted)
            }
    }

    @MainActor
    private func load() async {
        do {
            courses = try await CoursesAPI().courses(mine: isTeacher)
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }
}

private struct CourseRow: View {
    let course: CourseDTO
    let showsGroup: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(course.subject.name)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                .fixedSize(horizontal: false, vertical: true)
            let details = [
                showsGroup ? course.group?.name : course.teacher?.name,
                course.credits.map { String(localized: "courses.credits", defaultValue: "\($0) кр.") },
            ].compactMap { $0 }.filter { !$0.isEmpty }
            if !details.isEmpty {
                Text(details.joined(separator: " · "))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Дисциплина: кто ведёт, группа, кредиты — и её задания и материалы.
///
/// У задания и материала дисциплина — название, а не id (так их отдаёт сервер),
/// поэтому связываем по названию предмета.
struct CourseDetailView: View {
    let course: CourseDTO
    let role: Role

    @State private var assignments: [AssignmentDTO]?
    @State private var materials: [MaterialDTO]?

    private var isTeacher: Bool { role == .teacher }

    var body: some View {
        List {
            Section {
                DetailRow(title: String(localized: "courses.subject", defaultValue: "Дисциплина"), value: course.subject.name, symbol: "book")
                if let code = course.subject.code, !code.isEmpty {
                    DetailRow(title: String(localized: "courses.code", defaultValue: "Код"), value: code, symbol: "number")
                }
                if let teacher = course.teacher {
                    NavigationLink(value: AppRoute.profile(id: teacher.id)) {
                        DetailRow(title: String(localized: "role.teacher", defaultValue: "Преподаватель"), value: teacher.name, symbol: "person")
                    }
                }
                if let group = course.group {
                    NavigationLink {
                        GroupMembersView(groupID: group.id, title: group.name)
                    } label: {
                        DetailRow(title: String(localized: "profile.group", defaultValue: "Группа"), value: group.name, symbol: "person.3")
                    }
                }
                if let credits = course.credits {
                    DetailRow(title: String(localized: "courses.creditsTitle", defaultValue: "Кредиты"), value: String(credits), symbol: "rosette")
                }
                if let term = course.term?.name {
                    DetailRow(title: String(localized: "courses.term", defaultValue: "Семестр"), value: term, symbol: "calendar")
                }
            }
            .listRowBackground(Palette.card)

            Section {
                if let assignments {
                    if assignments.isEmpty {
                        Text(String(localized: "courses.noAssignments", defaultValue: "Заданий нет"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(assignments) { assignment in
                        NavigationLink(value: AppRoute.assignment(id: assignment.id)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(assignment.title).font(Typography.body)
                                if let due = assignment.dueAt {
                                    Text(String(localized: "courses.due", defaultValue: "Срок: \(due.formatted(date: .abbreviated, time: .shortened))"))
                                        .font(Typography.meta)
                                        .foregroundStyle(due < Date() ? Palette.destructive : Palette.mutedForeground)
                                }
                            }
                        }
                    }
                } else {
                    ProgressView()
                }
            } header: {
                Text(String(localized: "study.assignments", defaultValue: "Задания"))
            }
            .listRowBackground(Palette.card)

            Section {
                if let materials {
                    if materials.isEmpty {
                        Text(String(localized: "courses.noMaterials", defaultValue: "Материалов нет"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(materials) { material in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(material.title).font(Typography.body)
                            if let count = material.files?.count, count > 0 {
                                Text(String(localized: "courses.files", defaultValue: "Файлов: \(count)"))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                        }
                    }
                    if !materials.isEmpty {
                        NavigationLink(value: AppRoute.section(.materials)) {
                            Text(String(localized: "courses.allMaterials", defaultValue: "Все материалы и файлы"))
                        }
                    }
                } else {
                    ProgressView()
                }
            } header: {
                Text(String(localized: "study.materials", defaultValue: "Материалы"))
            }
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(course.subject.name))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let api = StudyAPI()
            let name = course.subject.name.lowercased()
            async let tasks = try? api.assignments().items
            async let files = try? api.materials().items
            assignments = (await tasks ?? []).filter { $0.subject?.lowercased() == name }
            materials = (await files ?? []).filter { $0.subject?.lowercased() == name }
        }
    }
}

/// Участники группы: одногруппники старосты, группа преподавателя.
struct GroupMembersView: View {
    let groupID: String?
    let title: String

    @State private var members: [GroupMemberDTO]?
    @State private var failure: String?
    @State private var query = ""

    var body: some View {
        List {
            if groupID == nil {
                EmptyStateView(
                    title: String(localized: "group.none", defaultValue: "Вы не состоите в группе"),
                    symbol: "person.3"
                )
                .listRowBackground(Color.clear)
            } else if let members {
                let visible = filtered(members)
                Section {
                    ForEach(visible) { member in
                        NavigationLink(value: AppRoute.profile(id: member.id)) {
                            HStack(spacing: Spacing.lg) {
                                AvatarView(url: member.avatarUrl, name: member.name, size: 36)
                                Text(member.name).font(Typography.body)
                                Spacer(minLength: 0)
                                if member.role == Role.starosta.rawValue {
                                    StatusBadge(text: String(localized: "role.starosta", defaultValue: "Староста"), tint: Palette.primary)
                                }
                            }
                        }
                    }
                } footer: {
                    Text(String(localized: "group.count", defaultValue: "Всего: \(members.count)"))
                }
                .listRowBackground(Palette.card)
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(title))
        .searchable(text: $query, prompt: Text(String(localized: "group.search", defaultValue: "Найти по имени")))
        .refreshable { await load() }
        .task { await load() }
    }

    private func filtered(_ members: [GroupMemberDTO]) -> [GroupMemberDTO] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return needle.isEmpty ? members : members.filter { $0.name.lowercased().contains(needle) }
    }

    @MainActor
    private func load() async {
        guard let groupID else { return }
        do {
            members = try await CoursesAPI().members(groupID: groupID)
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }
}

/// Одногруппники старосты: группа берётся из своего профиля.
struct ClassmatesView: View {
    @Environment(ViewerProfileModel.self) private var viewer

    var body: some View {
        GroupMembersView(groupID: viewer.profile?.groupId, title: MoreSection.classmates.title)
            .id(viewer.profile?.groupId)
            .task { if viewer.profile == nil { await viewer.refresh() } }
    }
}

/// Группы преподавателя — те, у которых он ведёт дисциплины.
struct TeacherGroupsView: View {
    @State private var groups: [CourseDTO.Group]?
    @State private var failure: String?

    var body: some View {
        List {
            if let groups {
                if groups.isEmpty {
                    EmptyStateView(title: String(localized: "groups.empty", defaultValue: "Групп пока нет"), symbol: "person.2")
                        .listRowBackground(Color.clear)
                }
                ForEach(groups, id: \.id) { group in
                    NavigationLink {
                        GroupMembersView(groupID: group.id, title: group.name)
                    } label: {
                        IconRow(title: group.name, symbol: "person.3", tint: TileTint.teal)
                    }
                    .listRowBackground(Palette.card)
                }
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(MoreSection.groups.title))
        .refreshable { await load() }
        .task { await load() }
    }

    @MainActor
    private func load() async {
        do {
            let courses = try await CoursesAPI().courses(mine: true)
            var seen = Set<String>()
            groups = courses.compactMap(\.group)
                .filter { seen.insert($0.id).inserted }
                .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }
}

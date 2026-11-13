import GRDB
import SwiftUI

/// Занятие из расписания: когда, где, кто ведёт — и переходы на карту кампуса, в
/// профиль преподавателя, к дисциплине и её заданиям.
///
/// Пара читается из локальной базы, как и всё расписание: карточку открывают в
/// коридоре, где связи может не быть. Сеть нужна только связанным заданиям.
struct LessonDetailView: View {
    let pairID: String
    let date: Date

    @State private var pair: PairRecord?
    @State private var change: PairChangeRecord?
    @State private var isMissing = false
    @State private var course: CourseDTO?
    @State private var assignments: [AssignmentDTO]?
    /// Дисциплина или задания не пришли — это сбой, а не «заданий нет».
    @State private var relatedFailed = false
    /// Разовое изменение на этот день с сервера — с новой аудиторией и заменяющим, как
    /// в карточке пары веба. В локальной базе их нет: там только время и примечание.
    @State private var remoteChange: StudentScheduleChangeDTO?

    private var item: SchedulePair? { pair.map { SchedulePair(pair: $0, change: change) } }

    @State private var showsCourse = false

    var body: some View {
        List {
            if let item {
                header(item)

                if let change = remoteChange {
                    changeSection(change)
                }

                Section {
                    DetailRow(
                        title: String(localized: "lesson.time", defaultValue: "Время"),
                        value: "\(item.startTime) – \(item.endTime)",
                        symbol: "clock"
                    )
                    if let room = item.pair.roomName, !room.isEmpty {
                        if let roomID = item.pair.roomId {
                            NavigationLink(value: AppRoute.campusRoom(roomID: roomID)) {
                                DetailRow(title: String(localized: "lesson.room", defaultValue: "Аудитория"), value: room, symbol: "mappin.and.ellipse")
                            }
                            .accessibilityHint(Text(String(localized: "lesson.room.map", defaultValue: "Показать на карте кампуса")))
                        } else {
                            DetailRow(title: String(localized: "lesson.room", defaultValue: "Аудитория"), value: room, symbol: "mappin.and.ellipse")
                        }
                    }
                    if let teacher = item.pair.teacherName, !teacher.isEmpty {
                        if let teacherID = item.pair.teacherId {
                            NavigationLink(value: AppRoute.profile(id: teacherID)) {
                                DetailRow(title: String(localized: "role.teacher", defaultValue: "Преподаватель"), value: teacher, symbol: "person")
                            }
                        } else {
                            DetailRow(title: String(localized: "role.teacher", defaultValue: "Преподаватель"), value: teacher, symbol: "person")
                        }
                    }
                    DetailRow(
                        title: String(localized: "lesson.week", defaultValue: "Неделя"),
                        value: Self.weekTitle(item.pair.weekType),
                        symbol: "calendar"
                    )
                }

                relatedSection
            }
        }
        .listStyle(.insetGrouped)
        .screenState(item == nil) {
            if isMissing {
                EmptyStateView(
                    title: String(localized: "lesson.missing", defaultValue: "Занятие не найдено"),
                    symbol: "calendar.badge.exclamationmark",
                    hint: String(localized: "lesson.missing.hint", defaultValue: "Расписание могли изменить — обновите его")
                )
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(String(localized: "shell.lesson", defaultValue: "Пара")))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $showsCourse) {
            if let course { CourseDetailView(course: course, role: .student) }
        }
        .task { await load() }
    }

    /// Дисциплина и её задания — строками как в списке чатов.
    @ViewBuilder
    private var relatedSection: some View {
        Section {
            if let course {
                NavigationLink {
                    CourseDetailView(course: course, role: .student)
                } label: {
                    TelegramStyleRow(
                        title: course.subject.name,
                        subtitle: StudyText.join([course.teacher?.name, course.credits.map(CoursesText.credits)]),
                        meta: course.subject.code
                    ) {
                        RowSymbol(symbol: "book.closed.fill", tint: TileTint.indigo, size: 40)
                    }
                }
            }
            if let assignments {
                ForEach(assignments.prefix(5)) { assignment in
                    NavigationLink(value: AppRoute.assignment(id: assignment.id)) {
                        TelegramStyleRow(
                            title: assignment.title,
                            subtitle: StudyText.due(assignment.dueAt),
                            meta: assignment.dueAt.map { DisplayFormat.relative($0) },
                            metaTint: StudyDue.tint(assignment.dueAt)
                        ) {
                            RowSymbol(symbol: "list.clipboard.fill", tint: TileTint.orange, size: 40)
                        }
                    }
                }
                if relatedFailed {
                    DashboardFailurePlaceholder { await load() }
                } else if assignments.isEmpty && course == nil {
                    Text(String(localized: "lesson.noLinks", defaultValue: "Заданий по этой дисциплине нет"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            } else if relatedFailed {
                DashboardFailurePlaceholder { await load() }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        } header: {
            Text(String(localized: "lesson.related", defaultValue: "По дисциплине"))
        }
    }

    /// Шапка по центру, как карточка в Telegram: значок цвета дисциплины, название,
    /// день и время, ниже — круглые кнопки «Карта», «Преподаватель», «Дисциплина».
    private func header(_ item: SchedulePair) -> some View {
        let tint: Color = item.isCancelled ? Color.gray : ScheduleSubjectTint.color(for: item.pair.subject)
        let day: String = date.formatted(Date.FormatStyle().weekday(.wide).day().month())
        let subtitle: String = day + " · " + item.startTime + " – " + item.endTime
        let actions: [HeroAction] = heroActions(item)
        return Section {
            HeroHeader(
                visual: HeroVisual.symbol("book.closed.fill", tint: tint),
                title: item.pair.subject,
                subtitle: subtitle,
                actions: actions
            ) {
                if let note = item.changeNote {
                    StatusBadge(text: note, tint: item.isCancelled ? Palette.destructive : Palette.warning)
                }
            }
        }
    }

    private func heroActions(_ item: SchedulePair) -> [HeroAction] {
        var actions: [HeroAction] = []
        if let roomID = remoteChange?.newRoom?.id ?? item.pair.roomId {
            actions.append(HeroAction(title: String(localized: "lesson.action.map", defaultValue: "На карте"), symbol: "map.fill") {
                lessonPush(.campusRoom(roomID: roomID))
            })
        }
        if let teacherID = remoteChange?.newTeacher?.id ?? item.pair.teacherId {
            actions.append(HeroAction(title: String(localized: "role.teacher", defaultValue: "Преподаватель"), symbol: "person.fill") {
                lessonPush(.profile(id: teacherID))
            })
        }
        if course != nil {
            actions.append(HeroAction(title: String(localized: "lesson.course", defaultValue: "Дисциплина"), symbol: "book.fill") {
                showsCourse = true
            })
        }
        return actions
    }

    /// Что поменялось на этот день: тип, новое время, аудитория, заменяющий, примечание.
    private func changeSection(_ change: StudentScheduleChangeDTO) -> some View {
        Section {
            IconRow(
                title: StudentChangeFormat.title(change.type),
                symbol: change.type == "CANCELLED" ? "xmark" : "arrow.triangle.2.circlepath",
                tint: change.type == "CANCELLED" ? TileTint.red : TileTint.orange
            )
            if let start = change.newStartTime, let end = change.newEndTime {
                DetailRow(title: String(localized: "student.lesson.change.time", defaultValue: "Новое время"), value: "\(start) – \(end)", symbol: "clock")
            }
            if let room = change.newRoom {
                NavigationLink(value: AppRoute.campusRoom(roomID: room.id)) {
                    DetailRow(title: String(localized: "student.lesson.change.room", defaultValue: "Новая аудитория"), value: room.name, symbol: "mappin.and.ellipse")
                }
            }
            if let teacher = change.newTeacher, !teacher.name.isEmpty {
                if let id = teacher.id {
                    NavigationLink(value: AppRoute.profile(id: id)) {
                        DetailRow(title: String(localized: "student.lesson.change.teacher", defaultValue: "Заменяющий преподаватель"), value: teacher.name, symbol: "person.badge.clock")
                    }
                } else {
                    DetailRow(title: String(localized: "student.lesson.change.teacher", defaultValue: "Заменяющий преподаватель"), value: teacher.name, symbol: "person.badge.clock")
                }
            }
            if let note = change.note, !note.isEmpty {
                Text(note)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
        } header: {
            Text(String(localized: "student.lesson.change.title", defaultValue: "Изменение на этот день"))
        }
    }

    static func weekTitle(_ raw: String) -> String {
        switch raw {
        case "ODD": return String(localized: "schedule.oddWeek", defaultValue: "Нечётная")
        case "EVEN": return String(localized: "schedule.evenWeek", defaultValue: "Чётная")
        default: return String(localized: "lesson.everyWeek", defaultValue: "Каждую неделю")
        }
    }

    @MainActor
    private func load() async {
        // Изменения дня — тем же запросом, что у расписания: даты в базе — полночь UTC.
        let changesOfDay = ScheduleStore(database: AppServices.database).changes(on: date)
            .filter(PairChangeRecord.Columns.pairId == pairID)
        let found = try? await AppServices.database.reader.read { [pairID] db -> (PairRecord?, PairChangeRecord?) in
            (try PairRecord.fetchOne(db, key: pairID), try changesOfDay.fetchOne(db))
        }
        pair = found?.0
        change = found?.1
        isMissing = pair == nil
        guard let subject = pair?.subject.lowercased() else { return }

        // Пара хранит дисциплину названием (так её отдаёт сервер) — связываем по нему.
        // Курсы и задания — те же ответы, что у списков и главной: из кеша экранов сразу,
        // свежие — следом (п. 30 аудита; `courseId` в паре — «Требует бэкенда»).
        if course == nil, assignments == nil {
            async let cachedCourses = ScreenCache.cached { try await CoursesAPI().courses(mine: false) }
            async let cachedTasks = ScreenCache.cached { try await StudyAPI().assignments().items }
            let (savedCourses, savedTasks) = await (cachedCourses, cachedTasks)
            if course == nil, let savedCourses {
                course = savedCourses.first { $0.subject.name.lowercased() == subject }
            }
            if assignments == nil, let savedTasks {
                assignments = savedTasks.filter { $0.subject?.lowercased() == subject }
            }
        }
        async let courses = try? ScreenCache.refreshing { try await CoursesAPI().courses(mine: false) }
        async let tasks = try? ScreenCache.refreshing { try await StudyAPI().assignments().items }
        let day = ScheduleAPI.day(date, in: .current)
        async let changes = try? StudentStudyAPI().scheduleChanges(from: day, to: day)
        let fetchedCourses = await courses
        let fetchedTasks = await tasks
        // Ушли с экрана посреди загрузки — это не сбой.
        guard !Task.isCancelled else { return }
        // Не пришедшее не затирает показанное: при сбое повтора старое остаётся.
        relatedFailed = fetchedCourses == nil || fetchedTasks == nil
        if let fetchedCourses {
            course = fetchedCourses.first { $0.subject.name.lowercased() == subject }
        }
        if let fetchedTasks {
            assignments = fetchedTasks.filter { $0.subject?.lowercased() == subject }
        }
        remoteChange = StudentCalendarBuilder.mergedChanges((await changes ?? []).filter { $0.pairId == pairID })["\(pairID)|\(day)"]
    }
}

/// Открыть маршрут в стеке текущей вкладки — для круглых кнопок шапки, которые не
/// `NavigationLink`.
@MainActor
private func lessonPush(_ route: AppRoute) {
    let router = AppServices.router
    router.stacks[router.selectedTab, default: []].append(route)
}

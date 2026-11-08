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
    /// Разовое изменение на этот день с сервера — с новой аудиторией и заменяющим, как
    /// в карточке пары веба. В локальной базе их нет: там только время и примечание.
    @State private var remoteChange: StudentScheduleChangeDTO?

    private var item: SchedulePair? { pair.map { SchedulePair(pair: $0, change: change) } }

    var body: some View {
        List {
            if let item {
                header(item)

                if let change = remoteChange {
                    changeSection(change)
                }

                Section {
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

                Section {
                    if let course {
                        NavigationLink {
                            CourseDetailView(course: course, role: .student)
                        } label: {
                            IconRow(
                                title: String(localized: "lesson.course", defaultValue: "Дисциплина"),
                                symbol: "book",
                                tint: TileTint.indigo,
                                subtitle: [course.teacher?.name, course.credits.map { String(localized: "courses.credits", defaultValue: "\($0) кр.") }]
                                    .compactMap { $0 }.joined(separator: " · ")
                            )
                        }
                    }
                    if let assignments {
                        ForEach(assignments.prefix(5)) { assignment in
                            NavigationLink(value: AppRoute.assignment(id: assignment.id)) {
                                IconRow(
                                    title: assignment.title,
                                    symbol: "list.clipboard",
                                    tint: TileTint.orange,
                                    subtitle: assignment.dueAt.map {
                                        String(localized: "courses.due", defaultValue: "Срок: \($0.formatted(date: .abbreviated, time: .shortened))")
                                    }
                                )
                            }
                        }
                        if assignments.isEmpty && course == nil {
                            Text(String(localized: "lesson.noLinks", defaultValue: "Заданий по этой дисциплине нет"))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                } header: {
                    Text(String(localized: "lesson.related", defaultValue: "По дисциплине"))
                }
            } else if isMissing {
                EmptyStateView(
                    title: String(localized: "lesson.missing", defaultValue: "Занятие не найдено"),
                    symbol: "calendar.badge.exclamationmark",
                    hint: String(localized: "lesson.missing.hint", defaultValue: "Расписание могли изменить — обновите его")
                )
                .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(String(localized: "shell.lesson", defaultValue: "Пара")))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func header(_ item: SchedulePair) -> some View {
        Section {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(item.pair.subject)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Palette.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                    .strikethrough(item.isCancelled)
                HStack(spacing: Spacing.md) {
                    Label {
                        Text(verbatim: "\(item.startTime) – \(item.endTime)")
                            .font(Typography.tabular(Typography.body.weight(.semibold)))
                    } icon: {
                        Image(systemName: "clock")
                    }
                    Text(date, format: .dateTime.weekday(.wide).day().month())
                        .foregroundStyle(Palette.mutedForeground)
                }
                .font(Typography.body)
                if let note = item.changeNote {
                    Label(note, systemImage: item.isCancelled ? "xmark.circle" : "exclamationmark.circle")
                        .font(Typography.meta.weight(.medium))
                        .foregroundStyle(item.isCancelled ? Palette.destructive : Palette.warning)
                }
            }
            .padding(.vertical, Spacing.xs)
            .accessibilityElement(children: .combine)
        }
    }

    /// Что поменялось на этот день: тип, новое время, аудитория, заменяющий, примечание.
    private func changeSection(_ change: StudentScheduleChangeDTO) -> some View {
        Section {
            HStack {
                StatusBadge(
                    text: StudentChangeFormat.title(change.type),
                    tint: change.type == "CANCELLED" ? Palette.destructive : Palette.warning
                )
                Spacer()
            }
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
        async let courses = try? CoursesAPI().courses(mine: false)
        async let tasks = try? StudyAPI().assignments().items
        let day = ScheduleAPI.day(date, in: .current)
        async let changes = try? StudentStudyAPI().scheduleChanges(from: day, to: day)
        course = (await courses ?? []).first { $0.subject.name.lowercased() == subject }
        assignments = (await tasks ?? []).filter { $0.subject?.lowercased() == subject }
        remoteChange = StudentCalendarBuilder.mergedChanges((await changes ?? []).filter { $0.pairId == pairID })["\(pairID)|\(day)"]
    }
}

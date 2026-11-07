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

    private var item: SchedulePair? { pair.map { SchedulePair(pair: $0, change: change) } }

    var body: some View {
        List {
            if let item {
                header(item)

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
                .listRowBackground(Palette.card)

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
                .listRowBackground(Palette.card)
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
        .scrollContentBackground(.hidden)
        .background(Palette.background)
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
        .listRowBackground(Palette.card)
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
        course = (await courses ?? []).first { $0.subject.name.lowercased() == subject }
        assignments = (await tasks ?? []).filter { $0.subject?.lowercased() == subject }
    }
}

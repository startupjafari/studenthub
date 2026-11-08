import SwiftUI

/// «Мои задачи» (веб `/tasks`): список, который система собирает сама из заданий,
/// заявок и событий, — по срокам: срочно, сегодня, на этой неделе, позже, выполнено.
/// Своих задач у студента нет — их и в вебе нет.
struct StudentTasksView: View {
    @State private var reloadToken = 0

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: Self.load) { tasks in
            List {
                if tasks.isEmpty {
                    EmptyStateView(
                        title: String(localized: "student.tasks.empty", defaultValue: "Задач нет"),
                        symbol: "checkmark.circle",
                        hint: String(localized: "student.tasks.emptyHint", defaultValue: "Всё выполнено. Новые задачи появятся здесь автоматически.")
                    )
                    .listRowBackground(Color.clear)
                }
                ForEach(StudentTask.Bucket.allCases, id: \.self) { bucket in
                    let items = tasks.filter { $0.bucket == bucket }
                    if !items.isEmpty {
                        Section {
                            ForEach(items) { task in
                                NavigationLink(value: task.route) {
                                    StudentTaskRow(task: task)
                                }
                            }
                        } header: {
                            HStack(spacing: Spacing.sm) {
                                Text(bucket.title)
                                StatusBadge(text: String(items.count), tint: bucket.tint)
                            }
                        }
                        .listRowBackground(Palette.card)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { reloadToken += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(StudentScreen.tasks.title))
    }

    /// Все три источника обязательны: молча пропавший источник показал бы «Задач нет»,
    /// когда они есть.
    private static func load() async throws -> [StudentTask] {
        let api = StudentStudyAPI()
        async let applications = api.applications(limit: 50)
        async let events = api.upcomingEvents(limit: 30)
        async let assignments = api.assignments().items
        return StudentTask.build(
            applications: try await applications,
            events: try await events,
            assignments: try await assignments,
            timeZone: ScheduleModel.universityTimeZone ?? .current
        )
    }
}

/// Задача, собранная из другого модуля.
struct StudentTask: Identifiable, Equatable {
    enum Bucket: Int, CaseIterable, Hashable {
        case urgent, today, week, later, done

        var title: String {
            switch self {
            case .urgent: return String(localized: "student.tasks.bucket.urgent", defaultValue: "Срочно")
            case .today: return String(localized: "student.tasks.bucket.today", defaultValue: "Сегодня")
            case .week: return String(localized: "student.tasks.bucket.week", defaultValue: "На этой неделе")
            case .later: return String(localized: "student.tasks.bucket.later", defaultValue: "Позже")
            case .done: return String(localized: "student.tasks.bucket.done", defaultValue: "Выполнено")
            }
        }

        var tint: Color {
            switch self {
            case .urgent: return Palette.destructive
            case .today: return Palette.warning
            case .week: return Palette.info
            case .later: return Palette.mutedForeground
            case .done: return Palette.success
            }
        }
    }

    enum Kind: Hashable {
        case submitApplication, correctApplication, pickupDocument, applicationDone
        case attendEvent, assignmentDue, assignmentFix, assignmentDone

        var title: String {
            switch self {
            case .submitApplication: return String(localized: "student.tasks.kind.submitApplication", defaultValue: "Завершить и отправить заявку")
            case .correctApplication: return String(localized: "student.tasks.kind.correctApplication", defaultValue: "Исправить заявку")
            case .pickupDocument: return String(localized: "student.tasks.kind.pickupDocument", defaultValue: "Забрать документ")
            case .applicationDone: return String(localized: "student.tasks.kind.applicationDone", defaultValue: "Заявка выполнена")
            case .attendEvent: return String(localized: "student.tasks.kind.attendEvent", defaultValue: "Событие")
            case .assignmentDue: return String(localized: "student.tasks.kind.assignmentDue", defaultValue: "Сдать задание")
            case .assignmentFix: return String(localized: "student.tasks.kind.assignmentFix", defaultValue: "Исправить работу")
            case .assignmentDone: return String(localized: "student.tasks.kind.assignmentDone", defaultValue: "Задание проверено")
            }
        }

        var symbol: String {
            switch self {
            case .submitApplication, .correctApplication, .applicationDone: return "doc.text"
            case .pickupDocument: return "shippingbox"
            case .attendEvent: return "calendar.badge.clock"
            case .assignmentDue, .assignmentFix, .assignmentDone: return "list.clipboard"
            }
        }
    }

    let id: String
    let bucket: Bucket
    let kind: Kind
    let title: String
    let dueAt: Date?
    let route: AppRoute

    var isDone: Bool { bucket == .done }

    static func build(
        applications: [StudentApplicationDTO],
        events: [StudentEventDTO],
        assignments: [AssignmentDTO],
        timeZone: TimeZone,
        now: Date = Date()
    ) -> [StudentTask] {
        var tasks: [StudentTask] = []
        let today = dayNumber(now, timeZone)

        func bucket(_ due: Date?, urgentWithoutDue: Bool = false) -> Bucket {
            guard let due else { return urgentWithoutDue ? .urgent : .later }
            let diff = dayNumber(due, timeZone) - today
            if diff < 0 { return .urgent }
            if diff == 0 { return .today }
            return diff <= 7 ? .week : .later
        }

        for assignment in assignments {
            let status = StudentAssignmentStatus.of(assignment, now: now)
            // Ждём проверку или приём закрыт — делать студенту нечего.
            if status == .submitted || status == .closed { continue }
            let route = AppRoute.assignment(id: assignment.id)
            if status == .graded {
                tasks.append(StudentTask(id: "assignment-\(assignment.id)", bucket: .done, kind: .assignmentDone,
                                         title: assignment.title, dueAt: assignment.mySubmission?.gradedAt, route: route))
                continue
            }
            let fix = status == .returned
            tasks.append(StudentTask(id: "assignment-\(assignment.id)", bucket: bucket(assignment.dueAt, urgentWithoutDue: fix),
                                     kind: fix ? .assignmentFix : .assignmentDue,
                                     title: assignment.title, dueAt: assignment.dueAt, route: route))
        }

        for application in applications {
            let title = application.service?.title ?? application.number ?? ""
            let route = AppRoute.application(id: application.id)
            if application.status == "ISSUED" || application.status == "DELIVERED" {
                tasks.append(StudentTask(id: "app-\(application.id)", bucket: .done, kind: .applicationDone,
                                         title: title, dueAt: application.issuedAt, route: route))
                continue
            }
            let kind: Kind
            switch application.status {
            case "DRAFT": kind = .submitApplication
            case "NEEDS_CORRECTION": kind = .correctApplication
            case "READY_FOR_PICKUP": kind = .pickupDocument
            default: continue // в работе у деканата — не задача студента
            }
            tasks.append(StudentTask(id: "app-\(application.id)", bucket: bucket(application.dueAt, urgentWithoutDue: kind != .submitApplication),
                                     kind: kind, title: title, dueAt: application.dueAt, route: route))
        }

        for event in events where event.isRegistered == true {
            let diff = dayNumber(event.startsAt, timeZone) - today
            guard diff >= 0, diff <= 30 else { continue }
            tasks.append(StudentTask(id: "event-\(event.id)", bucket: bucket(event.startsAt), kind: .attendEvent,
                                     title: event.title, dueAt: event.startsAt, route: .event(id: event.id)))
        }

        // Внутри срока — по дедлайну, без срока в конце.
        return tasks.sorted {
            if $0.bucket != $1.bucket { return $0.bucket.rawValue < $1.bucket.rawValue }
            return ($0.dueAt ?? .distantFuture) < ($1.dueAt ?? .distantFuture)
        }
    }

    /// Номер календарного дня в поясе вуза: «23:59 31.10» по Алматы — это 31-е, а не 1-е.
    private static func dayNumber(_ date: Date, _ timeZone: TimeZone) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let start = calendar.startOfDay(for: date)
        let parts = calendar.dateComponents([.year, .month, .day], from: start)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .current
        let normalized = utc.date(from: parts) ?? start
        return Int((normalized.timeIntervalSince1970 / 86_400).rounded(.down))
    }
}

private struct StudentTaskRow: View {
    let task: StudentTask

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: task.isDone ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(task.isDone ? Palette.success : Palette.mutedForeground)
                .accessibilityHidden(true)
            Image(systemName: task.kind.symbol)
                .font(.footnote)
                .frame(width: 30, height: 30)
                .foregroundStyle(Palette.mutedForeground)
                .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.md))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(task.isDone ? Palette.mutedForeground : Palette.foreground)
                    .lineLimit(2)
                Text(verbatim: [task.kind.title, task.dueAt.map { $0.formatted(.dateTime.day().month(.abbreviated)) }]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

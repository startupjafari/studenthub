import SwiftUI

// MARK: - День преподавателя

/// Занятие дня с учётом разовых изменений: отмена, перенос, смена аудитории, замена.
struct TeachingDayPair: Identifiable, Equatable {
    let pair: PairDTO
    let start: String
    let end: String
    let isCancelled: Bool
    let isMoved: Bool
    let newRoom: String?
    /// Он ведёт чужую пару по замене.
    let isSubstituting: Bool

    var id: String { pair.id }
    var room: String? { newRoom ?? pair.room?.name }
}

/// Дата изменения расписания — полночь UTC: день берём в UTC, как `date.slice(0, 10)` веба.
func teachingChangeDay(_ date: Date) -> String {
    DayString.string(from: date, timeZone: TimeZone(identifier: "UTC") ?? .gmt)
}

/// Занятия преподавателя на дату: свои пары дня и чётности недели без отданных на
/// замену, плюс чужие, где он заменяющий. Решает последнее изменение пары на дату —
/// они приходят по времени создания.
func teachingDayPairs(
    pairs: [PairDTO],
    changes: [TeachingScheduleChangeDTO],
    date: Date,
    viewerID: String
) -> [TeachingDayPair] {
    let day = TeachingAPI.day(date)
    let dayChanges = changes.filter { teachingChangeDay($0.date) == day }
    let weekday = teachingWeekday(of: date)
    let parity = teachingWeekParity(of: date)

    func substitution(of pairID: String) -> TeachingScheduleChangeDTO? {
        dayChanges.last { $0.pairId == pairID && $0.type == "SUBSTITUTED" }
    }

    var result: [PairDTO] = pairs.filter { pair in
        guard pair.dayOfWeek == weekday, pair.weekType == "BOTH" || pair.weekType == parity else { return false }
        if let sub = substitution(of: pair.id), let teacher = sub.newTeacher, teacher.id != viewerID { return false }
        return true
    }
    var substituting = Set<String>()
    let own = Set(result.map(\.id))
    for change in dayChanges where change.type == "SUBSTITUTED" && !own.contains(change.pairId) && !substituting.contains(change.pairId) {
        guard let pair = change.pair, pair.teacher?.id != viewerID, substitution(of: change.pairId)?.newTeacher?.id == viewerID else { continue }
        substituting.insert(change.pairId)
        result.append(PairDTO(
            id: change.pairId,
            scheduleId: nil,
            groupId: pair.groupId,
            subject: pair.subject,
            dayOfWeek: pair.dayOfWeek ?? weekday,
            startTime: pair.startTime,
            endTime: pair.endTime,
            weekType: pair.weekType ?? "BOTH",
            teacher: pair.teacher.map { PairDTO.Person(id: $0.id, firstName: $0.firstName, lastName: $0.lastName) },
            room: pair.room.map { PairDTO.Room(id: $0.id, name: $0.name) }
        ))
    }

    return result
        .map { pair in
            let own = dayChanges.filter { $0.pairId == pair.id }
            let moved = own.last { $0.type == "MOVED" }
            return TeachingDayPair(
                pair: pair,
                start: moved?.newStartTime ?? pair.startTime,
                end: moved?.newEndTime ?? pair.endTime,
                isCancelled: own.contains { $0.type == "CANCELLED" },
                isMoved: moved != nil,
                newRoom: own.last { $0.type == "ROOM_CHANGED" }?.newRoom?.name,
                isSubstituting: substituting.contains(pair.id)
            )
        }
        .sorted { $0.start < $1.start }
}

// MARK: - Журнал посещаемости

/// Журнал посещаемости: дата → занятия этого дня → отметки. Главный вопрос экрана —
/// какие пары ещё не отмечены, поэтому признак стоит у каждой строки.
struct TeachingAttendanceJournalView: View {
    @Environment(\.viewerID) private var viewerID

    @State private var date = Date()
    @State private var pairs: [PairDTO]?
    @State private var changes: [TeachingScheduleChangeDTO] = []
    @State private var marked: Set<String> = []
    /// Отметки не пришли: без них каждая пара выглядела бы неотмеченной — признаки
    /// прячем и говорим о сбое полосой.
    @State private var markedFailure: String?
    @State private var markedOffline = false
    @State private var failure: String?
    @State private var isOffline = false

    private let api = TeachingAPI()

    var body: some View {
        List {
            Section {
                ScheduleDateStrip(selection: $date) { day in
                    guard let pairs else { return false }
                    let weekday = teachingWeekday(of: day)
                    let parity = teachingWeekParity(of: day)
                    return pairs.contains { $0.dayOfWeek == weekday && ($0.weekType == "BOTH" || $0.weekType == parity) }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: Spacing.xs, bottom: Spacing.xs, trailing: Spacing.xs))
            }

            if let pairs {
                let day = teachingDayPairs(pairs: pairs, changes: changes, date: date, viewerID: viewerID)
                if !day.isEmpty {
                    if let markedFailure {
                        StaleDataBanner(message: markedFailure, isOffline: markedOffline) { await loadMarked() }
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                    }
                    Section {
                        ForEach(day) { item in
                            if item.isCancelled {
                                row(item).opacity(0.6)
                            } else {
                                NavigationLink(value: AppRoute.lesson(id: item.pair.id, date: date)) {
                                    row(item)
                                }
                            }
                        }
                    } header: {
                        let open = day.filter { !$0.isCancelled }
                        let done = open.filter { marked.contains($0.id) }.count
                        HStack(spacing: Spacing.sm) {
                            Text(date, format: .dateTime.weekday(.wide).day().month())
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Palette.foreground)
                            Spacer(minLength: Spacing.sm)
                            if markedFailure == nil {
                                StatusBadge(
                                    text: String(localized: "teaching.attendance.markedCount", defaultValue: "Отмечено \(done.formatted()) из \(open.count.formatted())"),
                                    tint: done == open.count ? Palette.success : Palette.warning
                                )
                            }
                        }
                        .textCase(nil)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(pairs.map { teachingDayPairs(pairs: $0, changes: changes, date: date, viewerID: viewerID).isEmpty } ?? true) {
            if pairs != nil {
                EmptyStateView(
                    title: String(localized: "teaching.attendance.noPairs", defaultValue: "На эту дату занятий нет"),
                    symbol: "calendar",
                    hint: String(localized: "teaching.attendance.noPairs.hint", defaultValue: "Выберите другую дату.")
                )
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(TeacherScreen.attendanceJournal.title))
        .pullToRefresh { await load() }
        .task(id: TeachingAPI.day(date)) { await load() }
        // Вернулись из отметки — признак «отмечено» должен обновиться без жеста.
        .onAppear { if pairs != nil { Task { await loadMarked() } } }
    }

    /// Занятие как в расписании: время слева, полоса цвета дисциплины, название и
    /// аудитория; справа — отмечено ли.
    private func row(_ item: TeachingDayPair) -> some View {
        HStack(alignment: .center, spacing: Spacing.md) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: item.start)
                    .font(Typography.tabular(.subheadline.weight(.semibold)))
                    .strikethrough(item.isCancelled)
                Text(verbatim: item.end)
                    .font(Typography.tabular(.footnote))
                    .foregroundStyle(Palette.mutedForeground)
            }
            .frame(minWidth: 46, alignment: .trailing)
            Capsule()
                .fill(item.isCancelled ? Color.gray : ScheduleSubjectTint.color(for: item.pair.subject))
                .frame(width: 4)
                .frame(maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.pair.subject)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                if let room = item.room {
                    Label(room, systemImage: "mappin.and.ellipse")
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                }
                HStack(spacing: Spacing.sm) {
                    if item.isSubstituting {
                        StatusBadge(text: String(localized: "teaching.attendance.substitution", defaultValue: "Замена"), tint: Palette.warning)
                    }
                    if item.isCancelled {
                        StatusBadge(text: String(localized: "teaching.attendance.cancelled", defaultValue: "Отменено"), tint: Palette.mutedForeground)
                    }
                }
            }
            Spacer(minLength: Spacing.md)
            if !item.isCancelled, markedFailure == nil {
                let done = marked.contains(item.id)
                Image(systemName: done ? "checkmark.circle.fill" : "circle.dashed")
                    .font(.title3)
                    .foregroundStyle(done ? Palette.success : Palette.warning)
                    .accessibilityLabel(Text(done
                        ? String(localized: "teaching.attendance.marked", defaultValue: "Отмечено")
                        : String(localized: "teaching.attendance.notMarked", defaultValue: "Не отмечено")))
            }
        }
        .padding(.vertical, Spacing.xs)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    @MainActor
    private func load() async {
        do {
            if pairs == nil {
                pairs = try await ScheduleAPI().schedule().pairs
            }
            changes = try await api.scheduleChanges(from: date, to: date)
            failure = nil
            await loadMarked()
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func loadMarked() async {
        guard let pairs else { return }
        let ids = teachingDayPairs(pairs: pairs, changes: changes, date: date, viewerID: viewerID)
            .filter { !$0.isCancelled }
            .map(\.id)
        do {
            marked = try await api.markedPairs(date: date, pairIDs: ids)
            markedFailure = nil
        } catch is CancellationError {
            return
        } catch {
            markedFailure = error.userMessage
            markedOffline = error.isOffline
        }
    }
}

// MARK: - Отметка занятия

/// Отметки одного занятия: статусы и примечания. Отдельная модель, потому что у
/// экрана есть несохранённое состояние, которое нельзя потерять при обновлении.
@MainActor
@Observable
final class TeachingAttendanceModel {
    private(set) var subject: String?
    private(set) var students: [TeachingAttendanceRosterDTO.Student] = []
    private(set) var isLoaded = false
    private(set) var isSaving = false
    var failure: String?
    private(set) var isOffline = false
    var savedAt: Date?
    var statuses: [String: String] = [:]
    var notes: [String: String] = [:]

    let pairID: String
    let date: Date
    private let api = TeachingAPI()

    init(pairID: String, date: Date) {
        self.pairID = pairID
        self.date = date
    }

    var markedCount: Int { students.filter { statuses[$0.id] != nil }.count }

    /// `keepEdits` — при обновлении из QR: самоотметки подтягиваются, но то, что
    /// преподаватель уже поправил руками, не затирается.
    func load(keepEdits: Bool = false) async {
        do {
            let roster = try await api.attendanceRoster(pairID: pairID, date: date)
            subject = roster.subject
            students = roster.students.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
            for student in roster.students {
                if !keepEdits || statuses[student.id] == nil, let status = student.status { statuses[student.id] = status }
                if !keepEdits || notes[student.id] == nil, let note = student.note { notes[student.id] = note }
            }
            isLoaded = true
            failure = nil
            isOffline = false
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    /// Самый частый случай — пришли все, кроме двоих: отмечаем всех и правим исключения.
    func markAllPresent() {
        for student in students { statuses[student.id] = "PRESENT" }
    }

    func save() async {
        guard !isSaving, !statuses.isEmpty else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let entries = statuses.map { id, status in
                let note = notes[id]?.trimmingCharacters(in: .whitespacesAndNewlines)
                return TeachingAttendanceEntry(studentId: id, status: status, note: (note?.isEmpty ?? true) ? nil : note)
            }
            try await api.saveAttendance(pairID: pairID, date: date, entries: entries)
            savedAt = Date()
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }
}

/// QR занятия для самоотметки: студенты сканируют камерой. Токен живёт 90 секунд —
/// обновляем его раз в минуту, а отметившиеся подтягиваются в журнал.
struct TeachingAttendanceQRView: View {
    let pairID: String
    let date: Date
    let refreshed: () async -> Void

    @State private var qr: TeachingAttendanceQRDTO?
    @State private var image: UIImage?
    @State private var failure: String?
    @State private var isLoading = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: Spacing.xl) {
                Text(String(localized: "teaching.attendance.qr.hint", defaultValue: "Студенты сканируют код камерой телефона, чтобы отметиться на занятии."))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                Group {
                    if let image {
                        Image(uiImage: image)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .padding(Spacing.lg)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                            .accessibilityLabel(Text(String(localized: "teaching.attendance.qr.title", defaultValue: "QR для отметки")))
                    } else if failure != nil {
                        Text(String(localized: "teaching.attendance.qr.unavailable", defaultValue: "QR-отметка открыта только во время занятия: с 30 минут до начала до 15 минут после конца. На отменённую пару и на другую дату код не выдаётся."))
                            .font(Typography.body)
                            .foregroundStyle(Palette.mutedForeground)
                            .multilineTextAlignment(.center)
                            .padding(Spacing.xl)
                            .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))
                    } else {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 240)
                    }
                }
                .frame(maxWidth: 320)
                if let qr {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let left = max(0, Int(qr.expiresAt.timeIntervalSince(context.date).rounded()))
                        Text(String(localized: "teaching.attendance.qr.expires", defaultValue: "Обновится через \(left.formatted()) с"))
                            .font(Typography.meta.monospacedDigit())
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                Button {
                    Task { await load() }
                } label: {
                    Label(String(localized: "teaching.attendance.qr.refresh", defaultValue: "Обновить"), systemImage: "arrow.clockwise")
                }
                .controlSize(.large)
                .glassButton()
                .disabled(isLoading)
                Spacer()
            }
            .padding(Spacing.xl)
            .frame(maxWidth: .infinity)
            .background(Palette.background)
            .navigationTitle(Text(String(localized: "teaching.attendance.qr.title", defaultValue: "QR для отметки")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .task {
                // Обновление раз в минуту — раньше истечения токена (90 с).
                while !Task.isCancelled {
                    // В фоне QR никто не видит — новый токен берём после возвращения.
                    await AppLifecycle.shared.waitUntilActive()
                    if Task.isCancelled { break }
                    await load()
                    try? await Task.sleep(for: .seconds(60))
                }
            }
        }
    }

    @MainActor
    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let value = try await TeachingAPI().attendanceQR(pairID: pairID, date: date)
            qr = value
            image = Self.decode(value.qr)
            failure = nil
            await refreshed()
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    /// `data:image/png;base64,…` → картинка.
    private static func decode(_ dataURL: String) -> UIImage? {
        guard let comma = dataURL.firstIndex(of: ",") else { return nil }
        guard let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }
}

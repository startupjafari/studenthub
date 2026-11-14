import SwiftUI
import UniformTypeIdentifiers

/// Подписи перечислений сервера для экранов преподавателя. Неизвестное значение
/// показывается как есть: новое значение на сервере не должно ронять экран.
enum TeachingText {
    // MARK: Задания

    static let assignmentTypes = ["HOMEWORK", "LAB", "COURSEWORK", "PROJECT", "OTHER"]
    static let submissionTypes = ["TEXT", "FILE", "LINK", "MIXED"]

    static func assignmentType(_ raw: String) -> String {
        switch raw {
        case "HOMEWORK": return String(localized: "teaching.assignmentType.homework", defaultValue: "Домашнее задание")
        case "LAB": return String(localized: "teaching.assignmentType.lab", defaultValue: "Лабораторная")
        case "COURSEWORK": return String(localized: "teaching.assignmentType.coursework", defaultValue: "Курсовая")
        case "PROJECT": return String(localized: "teaching.assignmentType.project", defaultValue: "Проект")
        case "OTHER": return String(localized: "teaching.assignmentType.other", defaultValue: "Другое")
        default: return raw
        }
    }

    static func submissionType(_ raw: String) -> String {
        switch raw {
        case "TEXT": return String(localized: "teaching.submissionType.text", defaultValue: "Текст")
        case "FILE": return String(localized: "teaching.submissionType.file", defaultValue: "Файл")
        case "LINK": return String(localized: "teaching.submissionType.link", defaultValue: "Ссылка")
        case "MIXED": return String(localized: "teaching.submissionType.mixed", defaultValue: "Смешанный")
        default: return raw
        }
    }

    static func assignmentStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "DRAFT": return (String(localized: "teaching.assignmentStatus.draft", defaultValue: "Черновик"), Palette.mutedForeground)
        case "PUBLISHED": return (String(localized: "teaching.assignmentStatus.published", defaultValue: "Опубликовано"), Palette.success)
        case "CLOSED": return (String(localized: "teaching.assignmentStatus.closed", defaultValue: "Закрыто"), Palette.warning)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func submissionStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "DRAFT": return (String(localized: "teaching.submissionStatus.draft", defaultValue: "Черновик"), Palette.mutedForeground)
        case "SUBMITTED": return (String(localized: "teaching.submissionStatus.submitted", defaultValue: "На проверке"), Palette.info)
        case "GRADED": return (String(localized: "teaching.submissionStatus.graded", defaultValue: "Оценено"), Palette.success)
        case "RETURNED": return (String(localized: "teaching.submissionStatus.returned", defaultValue: "Возвращено"), Palette.warning)
        default: return (raw, Palette.mutedForeground)
        }
    }

    // MARK: Журнал

    static let columnKinds = ["LAB", "CONTROL", "EXAM", "OTHER"]

    static func columnKind(_ raw: String) -> String {
        switch raw {
        case "LAB": return String(localized: "teaching.columnKind.lab", defaultValue: "Лабораторная")
        case "CONTROL": return String(localized: "teaching.columnKind.control", defaultValue: "Контрольная")
        case "EXAM": return String(localized: "teaching.columnKind.exam", defaultValue: "Экзамен")
        case "OTHER": return String(localized: "teaching.columnKind.other", defaultValue: "Другое")
        default: return raw
        }
    }

    // MARK: Экзамены

    static let examFormats = ["ORAL", "WRITTEN", "TEST", "PROJECT", "OTHER"]
    static let examStatuses = ["SCHEDULED", "PASSED", "FAILED", "ABSENT", "RETAKE"]

    static func examFormat(_ raw: String) -> String {
        switch raw {
        case "ORAL": return String(localized: "teaching.examFormat.oral", defaultValue: "Устный")
        case "WRITTEN": return String(localized: "teaching.examFormat.written", defaultValue: "Письменный")
        case "TEST": return String(localized: "teaching.examFormat.test", defaultValue: "Тест")
        case "PROJECT": return String(localized: "teaching.examFormat.project", defaultValue: "Проект")
        case "OTHER": return String(localized: "teaching.examFormat.other", defaultValue: "Другое")
        default: return raw
        }
    }

    static func examStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "SCHEDULED": return (String(localized: "teaching.examStatus.scheduled", defaultValue: "Запланирован"), Palette.info)
        case "PASSED": return (String(localized: "teaching.examStatus.passed", defaultValue: "Сдан"), Palette.success)
        case "FAILED": return (String(localized: "teaching.examStatus.failed", defaultValue: "Не сдан"), Palette.destructive)
        case "ABSENT": return (String(localized: "teaching.examStatus.absent", defaultValue: "Неявка"), Palette.warning)
        case "RETAKE": return (String(localized: "teaching.examStatus.retake", defaultValue: "Пересдача"), Palette.warning)
        default: return (raw, Palette.mutedForeground)
        }
    }

    // MARK: Расписание

    static let weekTypes = ["BOTH", "ODD", "EVEN"]

    static func weekType(_ raw: String) -> String {
        switch raw {
        case "BOTH": return String(localized: "teaching.weekType.both", defaultValue: "Каждую неделю")
        case "ODD": return String(localized: "teaching.weekType.odd", defaultValue: "Нечётная неделя")
        case "EVEN": return String(localized: "teaching.weekType.even", defaultValue: "Чётная неделя")
        default: return raw
        }
    }

    static func changeType(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "MOVED": return (String(localized: "teaching.changeType.moved", defaultValue: "Перенос"), Palette.info)
        case "ROOM_CHANGED": return (String(localized: "teaching.changeType.roomChanged", defaultValue: "Смена аудитории"), Palette.info)
        case "CANCELLED": return (String(localized: "teaching.changeType.cancelled", defaultValue: "Отмена"), Palette.destructive)
        case "SUBSTITUTED": return (String(localized: "teaching.changeType.substituted", defaultValue: "Замена"), Palette.warning)
        default: return (raw, Palette.mutedForeground)
        }
    }

    /// День недели по номеру API: 1 — понедельник.
    static func weekday(_ number: Int) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale.current
        let symbols = calendar.standaloneWeekdaySymbols
        // В Calendar неделя начинается с воскресенья: понедельник — индекс 1.
        let index = number % 7
        guard symbols.indices.contains(index) else { return String(number) }
        return symbols[index].capitalized
    }

    static func weekdayShort(_ number: Int) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale.current
        let symbols = calendar.shortStandaloneWeekdaySymbols
        let index = number % 7
        guard symbols.indices.contains(index) else { return String(number) }
        return symbols[index].capitalized
    }

    // MARK: Числа

    /// Балл без лишних нулей: «7», «7,5».
    static func score(_ value: Double?) -> String {
        guard let value else { return "—" }
        return JSONValue.format(value)
    }

    /// Ввод балла: запятая и точка одинаково, пустое — `nil`.
    static func parseScore(_ raw: String) -> Double? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard !trimmed.isEmpty else { return nil }
        return Double(trimmed)
    }
}

/// Номер дня недели в нумерации API (1 — понедельник) для даты.
func teachingWeekday(of date: Date) -> Int {
    let weekday = Calendar(identifier: .gregorian).component(.weekday, from: date)
    return (weekday + 5) % 7 + 1
}

/// Чётность ISO-недели даты: `ODD` или `EVEN` — как `isoWeekParity` веба.
func teachingWeekParity(of date: Date) -> String {
    var calendar = Calendar(identifier: .iso8601)
    calendar.timeZone = .current
    let week = calendar.component(.weekOfYear, from: date)
    return week % 2 == 0 ? "EVEN" : "ODD"
}

/// «ЧЧ:ММ» из даты (для полей времени пары).
func teachingTimeString(_ date: Date) -> String {
    let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
    return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
}

/// Дата сегодняшнего дня с временем «ЧЧ:ММ» — для `DatePicker` времени пары.
func teachingTimeDate(_ value: String) -> Date {
    let parts = value.split(separator: ":").compactMap { Int($0) }
    let hour = parts.first ?? 8
    let minute = parts.count > 1 ? parts[1] : 0
    return Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
}

/// Выбор дисциплины из своих: формы заданий, экзаменов и журнал.
struct TeachingCoursePicker: View {
    let courses: [CourseDTO]
    @Binding var selection: String

    var body: some View {
        Picker(String(localized: "teaching.course", defaultValue: "Дисциплина"), selection: $selection) {
            Text(String(localized: "teaching.course.pick", defaultValue: "Выберите дисциплину")).tag("")
            ForEach(courses) { course in
                Text(TeachingCoursePicker.label(course)).tag(course.id)
            }
        }
    }

    static func label(_ course: CourseDTO) -> String {
        if let group = course.group?.name, !group.isEmpty {
            return "\(course.subject.name) · \(group)"
        }
        return course.subject.name
    }
}

/// Выбор аудитории с поиском на сервере: аудиторий в вузе сотни, и первая сотня
/// по алфавиту хвост не покрывает.
struct TeachingRoomPicker: View {
    @Binding var selection: TeachingNamedRef?

    @State private var query = ""
    /// `nil` — первый ответ ещё не пришёл: пустой список здесь значит «не нашлось».
    @State private var rooms: [TeachingRoomDTO]?
    @State private var failure: String?
    @State private var isOffline = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                Button {
                    selection = nil
                    dismiss()
                } label: {
                    HStack {
                        Text(String(localized: "teaching.room.none", defaultValue: "Без аудитории"))
                            .foregroundStyle(Palette.foreground)
                        Spacer()
                        if selection == nil { Image(systemName: "checkmark").foregroundStyle(Palette.primary) }
                    }
                }
                ForEach(rooms ?? []) { room in
                    Button {
                        selection = TeachingNamedRef(id: room.id, name: room.name)
                        dismiss()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(room.name).foregroundStyle(Palette.foreground)
                                if let building = room.building, !building.isEmpty {
                                    Text(building).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                                }
                            }
                            Spacer()
                            if selection?.id == room.id { Image(systemName: "checkmark").foregroundStyle(Palette.primary) }
                        }
                    }
                }
            } footer: {
                // Список уже на экране — сбой поиска подписью, без стирания найденного.
                if let failure, rooms != nil { Text(failure) }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(rooms?.isEmpty != false) {
            if rooms == nil, let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else if rooms == nil {
                LoadingStateView()
            } else {
                EmptyStateView(
                    title: String(localized: "teaching.room.notFound", defaultValue: "Аудитория не найдена"),
                    symbol: "mappin.slash"
                )
            }
        }
        .navigationTitle(Text(String(localized: "teaching.room", defaultValue: "Аудитория")))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text(String(localized: "teaching.room.search", defaultValue: "Номер аудитории"))
        )
        .task(id: query) {
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    @MainActor
    private func load() async {
        do {
            rooms = try await TeachingAPI().rooms(search: query.trimmingCharacters(in: .whitespaces))
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

/// Строка формы «Аудитория» с переходом к выбору.
struct TeachingRoomField: View {
    @Binding var room: TeachingNamedRef?

    var body: some View {
        NavigationLink {
            TeachingRoomPicker(selection: $room)
        } label: {
            HStack {
                Text(String(localized: "teaching.room", defaultValue: "Аудитория"))
                Spacer()
                Text(room?.name ?? String(localized: "teaching.room.none", defaultValue: "Без аудитории"))
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
    }
}

/// Файл, выбранный в «Файлах»: данные читаются сразу, пока есть доступ к ссылке.
struct TeachingPickedFile {
    let data: Data
    let name: String
    let mime: String

    static func read(_ url: URL) throws -> TeachingPickedFile {
        let data = try PickedFile.readNow(url)
        let mime = (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType?.preferredMIMEType) ?? "application/octet-stream"
        return TeachingPickedFile(data: data, name: url.lastPathComponent, mime: mime)
    }
}

/// Текст отказа: у конфликта (`CONFLICT`) свой, понятный этому экрану, — общее
/// сообщение сервера про конфликт не говорит, что делать дальше.
func teachingFailure(_ error: Error, conflict: String? = nil) -> String {
    if let conflict, let api = error as? APIError, api.code == .conflict { return conflict }
    return error.userMessage
}

// MARK: - Оформление строк

/// Счётчик справа снизу строки — как непрочитанные в списке чатов: залитая капсула
/// с числом.
struct TeachingCounter: View {
    let count: Int
    var tint: Color = Palette.primary

    var body: some View {
        Text(verbatim: count.formatted())
            .font(Typography.tabular(.footnote.weight(.semibold)))
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .frame(minWidth: 22, minHeight: 22)
            .background(tint, in: Capsule())
    }
}

/// Значок задания по типу — одинаковый в списках, очереди проверки и карточках.
func teachingAssignmentSymbol(_ type: String?) -> String {
    switch type {
    case "LAB": return "flask.fill"
    case "COURSEWORK": return "doc.text.fill"
    case "PROJECT": return "hammer.fill"
    default: return "list.clipboard.fill"
    }
}

/// Открыть маршрут в стеке текущей вкладки — для круглых кнопок шапок карточек,
/// которые не `NavigationLink`.
@MainActor
func teachingPush(_ route: AppRoute) {
    let router = AppServices.router
    router.push(route)
}

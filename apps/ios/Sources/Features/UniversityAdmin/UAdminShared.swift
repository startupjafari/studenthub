import SwiftUI
import UIKit

// Общее для экранов администратора вуза: подписи перечислений сервера, разбор подробностей
// отказа, выбор группы/помещения/преподавателя поиском на сервере, «Поделиться» файлом.

// MARK: - Подписи

enum UAdminText {
    static let roomKinds = [
        "AUDITORIUM", "LAB", "SPORT_HALL", "LIBRARY", "ASSEMBLY_HALL", "ADMIN_OFFICE", "DEAN_OFFICE", "ACCOUNTING",
        "CANTEEN", "DORMITORY", "OTHER",
    ]

    /// Учебные помещения — у них есть вместимость и пары в расписании (`ACADEMIC_ROOM_KINDS`).
    static func isAcademic(_ kind: String) -> Bool { ["AUDITORIUM", "LAB", "SPORT_HALL"].contains(kind) }

    static func roomKind(_ raw: String) -> String {
        switch raw {
        case "AUDITORIUM": return String(localized: "uadmin.room.kind.auditorium", defaultValue: "Аудитория")
        case "LAB": return String(localized: "uadmin.room.kind.lab", defaultValue: "Лаборатория")
        case "SPORT_HALL": return String(localized: "uadmin.room.kind.sportHall", defaultValue: "Спортзал")
        case "LIBRARY": return String(localized: "uadmin.room.kind.library", defaultValue: "Библиотека")
        case "ASSEMBLY_HALL": return String(localized: "uadmin.room.kind.assemblyHall", defaultValue: "Актовый зал")
        case "ADMIN_OFFICE": return String(localized: "uadmin.room.kind.adminOffice", defaultValue: "Административный кабинет")
        case "DEAN_OFFICE": return String(localized: "uadmin.room.kind.deanOffice", defaultValue: "Деканат")
        case "ACCOUNTING": return String(localized: "uadmin.room.kind.accounting", defaultValue: "Бухгалтерия")
        case "CANTEEN": return String(localized: "uadmin.room.kind.canteen", defaultValue: "Столовая")
        case "DORMITORY": return String(localized: "uadmin.room.kind.dormitory", defaultValue: "Общежитие")
        case "OTHER": return String(localized: "uadmin.room.kind.other", defaultValue: "Другое")
        default: return raw
        }
    }

    /// Значок и цвет помещения в строке списка — по назначению.
    static func roomSymbol(_ raw: String) -> (symbol: String, tint: Color) {
        switch raw {
        case "AUDITORIUM": return ("door.left.hand.open", TileTint.blue)
        case "LAB": return ("flask", TileTint.purple)
        case "SPORT_HALL": return ("figure.run", TileTint.green)
        case "LIBRARY": return ("books.vertical", TileTint.indigo)
        case "ASSEMBLY_HALL": return ("theatermasks", TileTint.pink)
        case "ADMIN_OFFICE": return ("briefcase", TileTint.gray)
        case "DEAN_OFFICE": return ("building.columns", TileTint.teal)
        case "ACCOUNTING": return ("banknote", TileTint.orange)
        case "CANTEEN": return ("fork.knife", TileTint.orange)
        case "DORMITORY": return ("bed.double", TileTint.yellow)
        default: return ("square.grid.2x2", TileTint.gray)
        }
    }

    static func weekday(_ day: Int) -> String {
        switch day {
        case 1: return String(localized: "uadmin.day.1", defaultValue: "Понедельник")
        case 2: return String(localized: "uadmin.day.2", defaultValue: "Вторник")
        case 3: return String(localized: "uadmin.day.3", defaultValue: "Среда")
        case 4: return String(localized: "uadmin.day.4", defaultValue: "Четверг")
        case 5: return String(localized: "uadmin.day.5", defaultValue: "Пятница")
        case 6: return String(localized: "uadmin.day.6", defaultValue: "Суббота")
        case 7: return String(localized: "uadmin.day.7", defaultValue: "Воскресенье")
        default: return String(day)
        }
    }

    static func weekdayShort(_ day: Int) -> String {
        switch day {
        case 1: return String(localized: "uadmin.dayShort.1", defaultValue: "Пн")
        case 2: return String(localized: "uadmin.dayShort.2", defaultValue: "Вт")
        case 3: return String(localized: "uadmin.dayShort.3", defaultValue: "Ср")
        case 4: return String(localized: "uadmin.dayShort.4", defaultValue: "Чт")
        case 5: return String(localized: "uadmin.dayShort.5", defaultValue: "Пт")
        case 6: return String(localized: "uadmin.dayShort.6", defaultValue: "Сб")
        case 7: return String(localized: "uadmin.dayShort.7", defaultValue: "Вс")
        default: return String(day)
        }
    }

    static let weekTypes = ["BOTH", "ODD", "EVEN"]

    static func weekType(_ raw: String) -> String {
        switch raw {
        case "BOTH": return String(localized: "uadmin.parity.both", defaultValue: "Каждую неделю")
        case "ODD": return String(localized: "uadmin.parity.odd", defaultValue: "Нечётная")
        case "EVEN": return String(localized: "uadmin.parity.even", defaultValue: "Чётная")
        default: return raw
        }
    }

    static func role(_ raw: String) -> String {
        switch raw {
        case "STUDENT": return String(localized: "uadmin.role.student", defaultValue: "Студент")
        case "STAROSTA": return String(localized: "uadmin.role.starosta", defaultValue: "Староста")
        case "TEACHER": return String(localized: "uadmin.role.teacher", defaultValue: "Преподаватель")
        case "DEAN": return String(localized: "uadmin.role.dean", defaultValue: "Декан")
        default: return raw
        }
    }

    static let empty = "—"
}

// MARK: - Подробности отказа

enum UAdminFailure {
    /// Поля из `details[]` ответа: по ним экран называет, что мешает удалению.
    static func fields(_ error: Error) -> [String] {
        guard case .server(_, _, let details, _) = error as? APIError else { return [] }
        return details.map(\.field)
    }

    /// Сообщения из `details[]`: у конфликтов расписания там по-русски «с чем столкнулись».
    static func messages(_ error: Error) -> [String] {
        guard case .server(_, _, let details, _) = error as? APIError else { return [] }
        return details.map(\.message)
    }

    /// Своя формулировка отказа там, где экран показывает `error.userMessage` (лист формы):
    /// текст едет в сообщении ошибки сервера, и общий разбор покажет его как есть.
    static func message(_ text: String) -> Error {
        APIError.server(code: .unknown("CLIENT"), message: text, details: [], statusCode: 0)
    }

    static func isConflict(_ error: Error) -> Bool {
        (error as? APIError)?.code == .conflict
    }

    /// Текст отказа удаления: «Нельзя удалить — есть: группы, пользователи».
    static func blocked(_ error: Error, title: String, labels: [String: String]) -> String {
        guard isConflict(error) else { return error.userMessage }
        let found = fields(error).compactMap { labels[$0] }
        guard !found.isEmpty else { return title }
        let list = found.joined(separator: ", ")
        return String(localized: "uadmin.blockedList", defaultValue: "\(title). Мешает: \(list)")
    }

    /// Конфликт расписания — с перечнем, с чем столкнулись.
    static func schedule(_ error: Error) -> String {
        guard isConflict(error) else { return error.userMessage }
        let details = messages(error).filter { !$0.isEmpty }
        let title = String(localized: "uadmin.schedule.conflict", defaultValue: "Конфликт в расписании")
        guard !details.isEmpty else {
            return String(localized: "uadmin.schedule.conflictGeneric", defaultValue: "Конфликт в расписании: слот уже занят")
        }
        return title + ": " + details.joined(separator: "; ")
    }
}

// MARK: - Поиск с выбором

/// Лист выбора одного значения поиском на сервере: группа, помещение, преподаватель.
/// Пустой поиск показывает первые записи — человеку есть с чего начать.
struct UAdminSearchPicker<Item: Identifiable & Hashable>: View {
    let title: String
    let prompt: String
    var allowsNone: Bool = false
    var noneTitle: String = String(localized: "uadmin.picker.none", defaultValue: "Не выбрано")
    let load: (String) async throws -> [Item]
    let label: (Item) -> String
    var detail: (Item) -> String? = { _ in nil }
    let pick: (Item?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var items: [Item]?
    @State private var failure: String?
    @State private var isOffline = false

    var body: some View {
        NavigationStack {
            List {
                if allowsNone {
                    Button {
                        pick(nil)
                        dismiss()
                    } label: {
                        Text(noneTitle).foregroundStyle(Palette.mutedForeground)
                    }
                }
                if let items {
                    ForEach(items) { item in
                        Button {
                            pick(item)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(label(item)).foregroundStyle(Palette.foreground)
                                if let detail = detail(item), !detail.isEmpty {
                                    Text(detail).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .screenState(items?.isEmpty != false) {
                if items != nil {
                    EmptyStateView(
                        title: String(localized: "uadmin.picker.nothing", defaultValue: "Ничего не найдено"),
                        symbol: "magnifyingglass"
                    )
                } else if let failure {
                    ErrorStateView(message: failure, isOffline: isOffline) { await run(query) }
                } else {
                    LoadingStateView()
                }
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .debouncedSearch($query, prompt: prompt) { await run($0) }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
        }
    }

    @MainActor
    private func run(_ text: String) async {
        do {
            items = try await load(text)
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

/// Строка формы «подпись — выбранное значение», открывающая лист выбора.
struct UAdminPickerRow: View {
    let title: String
    let value: String?
    var placeholder: String = String(localized: "uadmin.picker.choose", defaultValue: "Выбрать")
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title).foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                Text(value ?? placeholder)
                    .foregroundStyle(value == nil ? Palette.mutedForeground : Palette.foreground)
                    .lineLimit(1)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground)
                    .accessibilityHidden(true)
            }
        }
    }
}

enum UAdminPickers {
    static func groups(_ search: String) async throws -> [UAdminGroupDTO] {
        try await UAdminAPI().groups(PageRequest(cursor: nil, page: 1, limit: 30), search: search.isEmpty ? nil : search).items
    }

    static func rooms(_ search: String) async throws -> [UAdminRoomDTO] {
        try await UAdminAPI().rooms(
            PageRequest(cursor: nil, page: 1, limit: 30),
            sort: "name",
            order: "asc",
            search: search.isEmpty ? nil : search
        ).items
    }

    /// Преподавателем пары или дисциплины может быть преподаватель или декан своего вуза.
    static func teachers(_ search: String) async throws -> [UAdminUserDTO] {
        let needle = search.isEmpty ? nil : search
        async let teachers = UAdminAPI().users(role: "TEACHER", search: needle)
        async let deans = UAdminAPI().users(role: "DEAN", search: needle)
        let all = try await teachers + deans
        return all.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    static func roomDetail(_ room: UAdminRoomDTO) -> String? {
        [UAdminText.roomKind(room.kind), room.building].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

// MARK: - Файл и копирование

/// Системный лист «Поделиться» для файла: сохранить в «Файлы», отправить, напечатать.
struct UAdminActivitySheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Файл, который можно отдать в `UAdminActivitySheet`: лежит во временной папке под
/// понятным именем — оно и будет именем в «Файлах».
struct UAdminSharedFile: Identifiable {
    let id = UUID()
    let url: URL

    static func write(_ data: Data, name: String) throws -> UAdminSharedFile {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: name)
        try data.write(to: url)
        return UAdminSharedFile(url: url)
    }
}

/// Секрет, показанный один раз: токен агента, ссылка-приглашение. Текст выделяется,
/// кнопка кладёт его в буфер обмена.
struct UAdminSecretField: View {
    let value: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(verbatim: value)
                .font(.footnote.monospaced())
                .foregroundStyle(Palette.foreground)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                UIPasteboard.general.string = value
                copied = true
            } label: {
                Label(
                    copied
                        ? String(localized: "uadmin.copied", defaultValue: "Скопировано")
                        : String(localized: "uadmin.copy", defaultValue: "Скопировать"),
                    systemImage: copied ? "checkmark" : "doc.on.doc"
                )
            }
            .glassButton()
        }
    }
}

// MARK: - Даты «ГГГГ-ММ-ДД»

enum UAdminDay {
    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    /// Дата из «2026-09-01» или из ISO-строки с временем — по первым десяти символам.
    static func date(_ raw: String) -> Date? {
        formatter.date(from: String(raw.prefix(10)))
    }

    /// День выбранной даты в «ГГГГ-ММ-ДД» — по местному календарю, без сдвига поясом.
    static func string(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04ld-%02ld-%02ld", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Дата для `DatePicker` из «ГГГГ-ММ-ДД»: полдень местного дня, чтобы пояс не сдвинул число.
    static func local(_ raw: String) -> Date? {
        let parts = raw.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    static func display(_ raw: String) -> String {
        guard let date = local(raw) else { return raw }
        return date.formatted(.dateTime.day().month(.abbreviated).year())
    }
}

/// «ЧЧ:ММ» ↔ `Date` для `DatePicker` времени пары.
enum UAdminClock {
    static func date(_ hhmm: String) -> Date {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        let hour = parts.first ?? 8
        let minute = parts.count > 1 ? parts[1] : 0
        return Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
    }

    static func string(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02ld:%02ld", parts.hour ?? 0, parts.minute ?? 0)
    }
}

// MARK: - Переходы и панель

/// Переход из кнопки шапки карточки: `HeroAction` — замыкание, а не `NavigationLink`,
/// поэтому экран кладём в стек текущей вкладки сами.
enum UAdminNav {
    @MainActor
    static func push(_ route: AppRoute) {
        let router = AppServices.router
        router.push(route)
    }
}

/// «Сохранить» в панели экрана (не листа): на iOS 26 — системная галочка в синем стекле
/// (`role: .confirm`), раньше — слово.
struct UAdminConfirmButton: View {
    let action: () -> Void

    var body: some View {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                Button(role: .confirm, action: action)
                    .accessibilityLabel(Text(String(localized: "common.save", defaultValue: "Сохранить")))
            } else {
                legacy
            }
        #else
            legacy
        #endif
    }

    private var legacy: some View {
        Button(String(localized: "common.save", defaultValue: "Сохранить"), action: action)
    }
}

extension View {
    /// Поиск с задержкой, как `debouncedSearch`, но с полем, всегда видным под заголовком:
    /// в длинных справочниках вуза поиск — главный способ найти строку.
    func uadminDebouncedSearch(
        _ text: Binding<String>,
        prompt: String,
        delay: Duration = .milliseconds(350),
        onChange: @escaping (String) async -> Void
    ) -> some View {
        debouncedSearch(text, prompt: prompt, delay: delay, onChange: onChange)
    }

    /// Мгновенный поиск по уже загруженному списку. Поле прячется при прокрутке вниз и
    /// выезжает жестом вниз, как на остальных экранах-списках.
    func uadminSearchable(_ text: Binding<String>, prompt: String) -> some View {
        searchable(text: text, prompt: Text(prompt))
    }
}

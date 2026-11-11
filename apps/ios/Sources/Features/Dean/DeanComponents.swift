import SwiftUI

// Общие кирпичи экранов деканата: подписи перечислений сервера, выбор из справочника с
// поиском, выгрузка файла в «Поделиться», текст конфликта расписания.

// MARK: - Подписи

enum DeanText {
    static func examFormat(_ raw: String) -> String {
        switch raw {
        case "ORAL": return String(localized: "dean.exam.format.oral", defaultValue: "Устный")
        case "WRITTEN": return String(localized: "dean.exam.format.written", defaultValue: "Письменный")
        case "TEST": return String(localized: "dean.exam.format.test", defaultValue: "Тест")
        case "PROJECT": return String(localized: "dean.exam.format.project", defaultValue: "Проект")
        default: return String(localized: "dean.exam.format.other", defaultValue: "Другое")
        }
    }

    static let examFormats = ["WRITTEN", "ORAL", "TEST", "PROJECT", "OTHER"]
    static let examStatuses = ["SCHEDULED", "PASSED", "FAILED", "ABSENT", "RETAKE"]

    static func examStatus(_ raw: String) -> (String, Color) {
        switch raw {
        case "SCHEDULED": return (String(localized: "dean.exam.status.scheduled", defaultValue: "Запланирован"), Palette.mutedForeground)
        case "PASSED": return (String(localized: "dean.exam.status.passed", defaultValue: "Сдал"), Palette.success)
        case "FAILED": return (String(localized: "dean.exam.status.failed", defaultValue: "Не сдал"), Palette.destructive)
        case "ABSENT": return (String(localized: "dean.exam.status.absent", defaultValue: "Не явился"), Palette.warning)
        case "RETAKE": return (String(localized: "dean.exam.status.retake", defaultValue: "Пересдача"), Palette.info)
        default: return (raw, Palette.mutedForeground)
        }
    }

    /// 1 — понедельник.
    static func day(_ day: Int) -> String {
        switch day {
        case 1: return String(localized: "dean.day.1", defaultValue: "Понедельник")
        case 2: return String(localized: "dean.day.2", defaultValue: "Вторник")
        case 3: return String(localized: "dean.day.3", defaultValue: "Среда")
        case 4: return String(localized: "dean.day.4", defaultValue: "Четверг")
        case 5: return String(localized: "dean.day.5", defaultValue: "Пятница")
        case 6: return String(localized: "dean.day.6", defaultValue: "Суббота")
        default: return String(localized: "dean.day.7", defaultValue: "Воскресенье")
        }
    }

    static func dayShort(_ day: Int) -> String {
        switch day {
        case 1: return String(localized: "dean.dayShort.1", defaultValue: "Пн")
        case 2: return String(localized: "dean.dayShort.2", defaultValue: "Вт")
        case 3: return String(localized: "dean.dayShort.3", defaultValue: "Ср")
        case 4: return String(localized: "dean.dayShort.4", defaultValue: "Чт")
        case 5: return String(localized: "dean.dayShort.5", defaultValue: "Пт")
        case 6: return String(localized: "dean.dayShort.6", defaultValue: "Сб")
        default: return String(localized: "dean.dayShort.7", defaultValue: "Вс")
        }
    }

    static let weekTypes = ["BOTH", "ODD", "EVEN"]

    static func weekType(_ raw: String) -> String {
        switch raw {
        case "ODD": return String(localized: "dean.week.odd", defaultValue: "Нечётные недели")
        case "EVEN": return String(localized: "dean.week.even", defaultValue: "Чётные недели")
        default: return String(localized: "dean.week.both", defaultValue: "Каждую неделю")
        }
    }

    static let changeTypes = ["CANCELLED", "MOVED", "ROOM_CHANGED", "SUBSTITUTED"]

    static func changeType(_ raw: String) -> (String, Color) {
        switch raw {
        case "CANCELLED": return (String(localized: "dean.change.cancelled", defaultValue: "Отмена"), Palette.destructive)
        case "MOVED": return (String(localized: "dean.change.moved", defaultValue: "Перенос"), Palette.warning)
        case "ROOM_CHANGED": return (String(localized: "dean.change.room", defaultValue: "Смена аудитории"), Palette.info)
        case "SUBSTITUTED": return (String(localized: "dean.change.substituted", defaultValue: "Замена"), Palette.info)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func riskReason(_ kind: String) -> String {
        switch kind {
        case "LOW_ATTENDANCE": return String(localized: "dean.risk.attendance", defaultValue: "Низкая посещаемость")
        case "OVERDUE_ASSIGNMENTS": return String(localized: "dean.risk.overdue", defaultValue: "Просроченные задания")
        case "LOW_GRADES": return String(localized: "dean.risk.grades", defaultValue: "Низкие оценки")
        default: return kind
        }
    }

    /// «12 %» или прочерк: «не отмечали» — это не ноль процентов.
    static func percent(_ value: Double?) -> String {
        DisplayFormat.percent(value)
    }

    /// Тон посещаемости — как в вебе: от 75 % — норма, от 60 % — внимание.
    static func rateTint(_ value: Double?) -> Color {
        guard let value else { return Palette.mutedForeground }
        if value >= 75 { return Palette.success }
        if value >= 60 { return Palette.warning }
        return Palette.destructive
    }
}

// MARK: - Время «HH:mm»

enum DeanTime {
    /// «HH:mm» → момент сегодняшнего дня для `DatePicker(.hourAndMinute)`.
    static func date(_ hhmm: String) -> Date {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        components.hour = parts.first ?? 8
        components.minute = parts.count > 1 ? parts[1] : 0
        return Calendar.current.date(from: components) ?? Date()
    }

    static func string(_ date: Date) -> String {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
    }

    /// «YYYY-MM-DD» в поясе вуза.
    static func day(_ date: Date, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    /// ISO-день недели (1 — понедельник) в поясе вуза.
    static func isoWeekday(_ date: Date, timeZone: TimeZone = .current) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let weekday = calendar.component(.weekday, from: date)
        return weekday == 1 ? 7 : weekday - 1
    }

    /// Дата из строки сервера: и «2025-09-01», и полный ISO-момент.
    static func parse(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        if let full = JSONValue.string(raw).date { return full }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(raw.prefix(10)))
    }
}

// MARK: - Ошибки

enum DeanErrorText {
    /// Конфликт расписания или экзамена: сервер перечисляет, с чем столкнулись, в `details`.
    static func message(_ error: Error) -> String {
        if let api = error as? APIError, case .server(let code, _, let details, _) = api, code == .conflict, !details.isEmpty {
            let lines = details.map(\.message).filter { !$0.isEmpty && !$0.hasPrefix("validation.") }
            if !lines.isEmpty {
                return String(localized: "dean.conflict", defaultValue: "Пересечение в расписании") + ": " + lines.joined(separator: "; ")
            }
        }
        return error.userMessage
    }

    /// Ошибка со своим текстом для `FormSheet`: он показывает `userMessage`, а тот
    /// читает текст только у ошибок API.
    static func failure(_ message: String) -> Error {
        APIError.server(code: .conflict, message: message, details: [], statusCode: 409)
    }
}

/// Необязательная часть экрана (сводка, список рядом с карточкой): значение или текст
/// сбоя. `try?` превращал сбой в «нет данных», и экран говорил «всё хорошо» там, где
/// просто не дозагрузился.
struct DeanPart<Value> {
    var value: Value?
    var failure: String?

    /// Отмена — не сбой: часть остаётся пустой, а экран, чья загрузка отменена, своё
    /// значение и не заменит (`checkCancellation` в загрузке снимка).
    static func load(_ body: () async throws -> Value) async -> DeanPart<Value> {
        do {
            return DeanPart(value: try await body())
        } catch is CancellationError {
            return DeanPart()
        } catch {
            return DeanPart(failure: error.userMessage)
        }
    }
}

// MARK: - Выбор из справочника

struct DeanPickOption: Identifiable, Hashable {
    let id: String
    let title: String
    var subtitle: String?
}

/// Поле формы «подпись — выбранное», открывающее список с поиском. Список грузит сам
/// экран через `load(search)`: справочники вуза большие, и держать их целиком незачем.
struct DeanPickerField: View {
    let title: String
    @Binding var selection: DeanPickOption?
    var allowsNone = true
    var noneTitle = String(localized: "dean.picker.none", defaultValue: "Не выбрано")
    var searchable = true
    let load: (String) async throws -> [DeanPickOption]

    var body: some View {
        NavigationLink {
            DeanPickerList(
                title: title,
                selection: $selection,
                allowsNone: allowsNone,
                noneTitle: noneTitle,
                searchable: searchable,
                load: load
            )
        } label: {
            LabeledContent(title) {
                Text(selection?.title ?? noneTitle)
                    .foregroundStyle(selection == nil ? Palette.mutedForeground : Palette.foreground)
                    .lineLimit(2)
                    .multilineTextAlignment(.trailing)
            }
        }
    }
}

private struct DeanPickerList: View {
    let title: String
    @Binding var selection: DeanPickOption?
    let allowsNone: Bool
    let noneTitle: String
    let searchable: Bool
    let load: (String) async throws -> [DeanPickOption]

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var options: [DeanPickOption]?
    @State private var failure: String?
    @State private var isOffline = false

    var body: some View {
        List {
            if allowsNone {
                row(nil)
            }
            if let options {
                ForEach(options) { option in row(option) }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(options?.isEmpty != false) {
            if options != nil {
                EmptyStateView(
                    title: String(localized: "dean.picker.empty", defaultValue: "Ничего не найдено"),
                    symbol: "magnifyingglass"
                )
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await run(search) }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(title))
        .navigationBarTitleDisplayMode(.inline)
        .modifier(SearchIfNeeded(enabled: searchable, text: $search) { await run($0) })
        .task { if options == nil { await run("") } }
    }

    private func row(_ option: DeanPickOption?) -> some View {
        Button {
            selection = option
            dismiss()
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(option?.title ?? noneTitle)
                        .foregroundStyle(option == nil ? Palette.mutedForeground : Palette.foreground)
                    if let subtitle = option?.subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                    }
                }
                Spacer()
                if option?.id == selection?.id {
                    Image(systemName: "checkmark").foregroundStyle(Palette.primary)
                }
            }
        }
    }

    @MainActor
    private func run(_ needle: String) async {
        do {
            options = try await load(needle)
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

private struct SearchIfNeeded: ViewModifier {
    let enabled: Bool
    @Binding var text: String
    let onChange: (String) async -> Void

    func body(content: Content) -> some View {
        if enabled {
            content.debouncedSearch(
                $text,
                prompt: String(localized: "dean.picker.search", defaultValue: "Поиск"),
                onChange: onChange
            )
        } else {
            content
        }
    }
}

/// Готовые загрузчики справочников для `DeanPickerField`.
enum DeanPickers {
    static func groups(_ api: DeanAPI) -> (String) async throws -> [DeanPickOption] {
        { search in
            try await api.groups(PageRequest(cursor: nil, page: 1, limit: 50), search: search).items.map {
                DeanPickOption(id: $0.id, title: $0.name, subtitle: $0.year.map { String($0) })
            }
        }
    }

    static func teachingStaff(_ api: DeanAPI) -> (String) async throws -> [DeanPickOption] {
        { search in
            try await api.teachingStaff(search: search).map {
                DeanPickOption(id: $0.id, title: $0.name, subtitle: [$0.roleValue.title, $0.email ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
            }
        }
    }

    static func rooms(_ api: DeanAPI) -> (String) async throws -> [DeanPickOption] {
        { search in
            try await api.rooms(search: search).map {
                DeanPickOption(id: $0.id, title: $0.name, subtitle: $0.building)
            }
        }
    }

    static func subjects(_ api: DeanAPI) -> (String) async throws -> [DeanPickOption] {
        { search in
            try await api.subjects(PageRequest(cursor: nil, page: 1, limit: 50), search: search).items.map {
                DeanPickOption(id: $0.id, title: $0.name, subtitle: $0.code)
            }
        }
    }

    static func terms(_ api: DeanAPI) -> (String) async throws -> [DeanPickOption] {
        { _ in
            try await api.terms(PageRequest(cursor: nil, page: 1, limit: 100)).items.map {
                DeanPickOption(
                    id: $0.id,
                    title: $0.name,
                    subtitle: $0.isActive ? String(localized: "dean.term.active", defaultValue: "Текущий семестр") : nil
                )
            }
        }
    }
}

// MARK: - Выгрузка в файл

/// Сохранить ответ-файл во временную папку и отдать системному «Поделиться».
@MainActor
@Observable
final class DeanFileExporter {
    var file: ExportedFile?
    var failure: String?
    var isRunning = false

    func run(name: String, fetch: () async throws -> Data) async {
        isRunning = true
        defer { isRunning = false }
        do {
            let data = try await fetch()
            let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appending(path: name)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            file = ExportedFile(url: url)
        } catch {
            failure = error.userMessage
        }
    }

    static func fileName(_ stem: String, format: DeanExportFormat) -> String {
        "studenthub_\(stem)_\(DeanTime.day(Date())).\(format.rawValue)"
    }
}

extension View {
    /// Лист «Поделиться» для выгрузки и ошибка выгрузки.
    func deanExportSheet(_ exporter: DeanFileExporter) -> some View {
        modifier(DeanExportModifier(exporter: exporter))
    }
}

private struct DeanExportModifier: ViewModifier {
    @Bindable var exporter: DeanFileExporter

    func body(content: Content) -> some View {
        content
            .sheet(item: $exporter.file) { file in
                ShareSheet(items: [file.url])
            }
            .actionFailureAlert($exporter.failure)
            .overlay {
                if exporter.isRunning {
                    ProgressView()
                        .padding(Spacing.xl)
                        .glassSurface(interactive: false, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                }
            }
    }
}

/// Строка «подпись — процент» с полосой: посещаемость группы, студента.
struct DeanRateRow: View {
    let title: String
    var subtitle: String?
    let rate: Double?
    var badge: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(Typography.body).foregroundStyle(Palette.foreground).lineLimit(2)
                if let badge {
                    StatusBadge(text: badge, tint: Palette.destructive)
                }
                Spacer(minLength: Spacing.md)
                Text(DeanText.percent(rate))
                    .font(Typography.meta.monospacedDigit().weight(.semibold))
                    .foregroundStyle(DeanText.rateTint(rate))
            }
            ProgressView(value: min(max((rate ?? 0) / 100, 0), 1))
                .tint(DeanText.rateTint(rate))
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Навигация и связь

/// Переход из кнопок шапки карточки: у `HeroAction` замыкание, а не `NavigationLink`,
/// поэтому экран кладём в стек текущей вкладки сами.
enum DeanNav {
    @MainActor
    static func push(_ route: AppRoute) {
        let router = AppServices.router
        router.stacks[router.selectedTab, default: []].append(route)
    }

    /// Личный чат с человеком: сервер вернёт уже существующий, если он есть.
    @MainActor
    static func openChat(userID: String) async throws {
        let chatID = try await ChatsAPI().createPrivate(with: userID)
        AppServices.router.select(.chats)
        AppServices.router.stacks[.chats] = [.chat(id: chatID)]
    }

    static func mailURL(_ email: String?) -> URL? {
        guard let email, !email.isEmpty else { return nil }
        return URL(string: "mailto:\(email)")
    }

    static func phoneURL(_ phone: String?) -> URL? {
        guard let phone, !phone.isEmpty else { return nil }
        let digits = phone.filter { $0.isNumber || $0 == "+" }
        return digits.isEmpty ? nil : URL(string: "tel:\(digits)")
    }
}

/// «Сохранить» в панели экрана (не листа): на iOS 26 — системная галочка в синем стекле
/// (`role: .confirm`), раньше — слово.
struct DeanConfirmButton: View {
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
    /// Поиск с задержкой, поле всегда видно под заголовком — для длинных списков
    /// факультета. Общий `.debouncedSearch` места поля не принимает.
    func deanDebouncedSearch(
        _ text: Binding<String>,
        prompt: String,
        onChange: @escaping (String) async -> Void
    ) -> some View {
        modifier(DeanDebouncedSearch(text: text, prompt: prompt, onChange: onChange))
    }
}

private struct DeanDebouncedSearch: ViewModifier {
    @Binding var text: String
    let prompt: String
    let onChange: (String) async -> Void

    @State private var lastSent = ""

    func body(content: Content) -> some View {
        content
            .searchable(text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: Text(prompt))
            .task(id: text) {
                let needle = text.trimmingCharacters(in: .whitespaces)
                guard needle != lastSent else { return }
                if !needle.isEmpty {
                    try? await Task.sleep(for: .milliseconds(350))
                    guard !Task.isCancelled else { return }
                }
                lastSent = needle
                await onChange(needle)
            }
    }
}

/// Плитка даты в строке: число крупно, месяц мелко — как в «Календаре». Экзамен ищут
/// глазами по дню, а не по названию.
struct DeanDateTile: View {
    let date: Date
    var tint: Color = Palette.primary

    var body: some View {
        VStack(spacing: 0) {
            Text(date, format: .dateTime.month(.abbreviated))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(tint)
                .textCase(.uppercase)
            Text(date, format: .dateTime.day())
                .font(.title3.weight(.semibold).monospacedDigit())
                .foregroundStyle(Palette.foreground)
        }
        .frame(width: 48, height: 48)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .accessibilityHidden(true)
    }
}

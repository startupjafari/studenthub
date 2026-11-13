import SwiftUI
import UIKit
import UniformTypeIdentifiers

// Шаблоны документов (веб — `DocumentTemplatesView`, `TemplateDetailView`): DOCX-бланки вуза
// с переменными StudentHub. Версии, проверка, публикация, документ для студента.
// Сам DOCX правят в Word — на телефоне его можно загрузить из «Файлов», посмотреть
// пример на демо-данных и скачать исходник.

enum StaffTemplateText {
    static let statuses = ["DRAFT", "PUBLISHED", "ARCHIVED"]
    static let categories = ["CERTIFICATE", "APPLICATION", "ORDER", "CONTRACT", "CLEARANCE", "DORMITORY", "OTHER"]
    static let locales = ["ru", "kk", "en"]

    static func status(_ raw: String) -> (String, Color) {
        switch raw {
        case "DRAFT": return (String(localized: "staff.tpl.status.draft", defaultValue: "Черновик"), Palette.mutedForeground)
        case "PUBLISHED": return (String(localized: "staff.tpl.status.published", defaultValue: "Опубликован"), Palette.success)
        case "ARCHIVED": return (String(localized: "staff.tpl.status.archived", defaultValue: "В архиве"), Palette.warning)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func category(_ raw: String) -> String {
        switch raw {
        case "CERTIFICATE": return String(localized: "staff.tpl.cat.certificate", defaultValue: "Справка")
        case "APPLICATION": return String(localized: "staff.tpl.cat.application", defaultValue: "Заявление")
        case "ORDER": return String(localized: "staff.tpl.cat.order", defaultValue: "Приказ")
        case "CONTRACT": return String(localized: "staff.tpl.cat.contract", defaultValue: "Договор")
        case "CLEARANCE": return String(localized: "staff.tpl.cat.clearance", defaultValue: "Обходной лист")
        case "DORMITORY": return String(localized: "staff.tpl.cat.dormitory", defaultValue: "Общежитие")
        case "OTHER": return String(localized: "staff.tpl.cat.other", defaultValue: "Другое")
        default: return raw
        }
    }

    static func locale(_ raw: String) -> String {
        switch raw {
        case "ru": return String(localized: "staff.tpl.locale.ru", defaultValue: "Русский")
        case "kk": return String(localized: "staff.tpl.locale.kk", defaultValue: "Казахский")
        case "en": return String(localized: "staff.tpl.locale.en", defaultValue: "Английский")
        default: return raw
        }
    }

    private static func part(_ raw: String?) -> String {
        switch raw {
        case "header": return String(localized: "staff.tpl.part.header", defaultValue: " в верхнем колонтитуле")
        case "footer": return String(localized: "staff.tpl.part.footer", defaultValue: " в нижнем колонтитуле")
        case "other": return String(localized: "staff.tpl.part.other", defaultValue: " в сносках или свойствах документа")
        default: return ""
        }
    }

    /// Замечание проверки — по коду, как в вебе.
    static func issue(_ issue: StaffTemplateIssue) -> String {
        let tag = issue.tag ?? ""
        let place = part(issue.part)
        switch issue.code {
        case "SYNTAX":
            return String(localized: "staff.tpl.issue.syntax", defaultValue: "В документе обнаружена ошибка в переменной\(place). Проверьте фигурные скобки и повторите загрузку.")
        case "UNKNOWN_VARIABLE":
            return String(localized: "staff.tpl.issue.unknown", defaultValue: "Переменная \(tag)\(place) не поддерживается StudentHub. Проверьте написание по каталогу.")
        case "UNSUPPORTED_TAG":
            return String(localized: "staff.tpl.issue.unsupported", defaultValue: "Конструкция \(tag) пока не поддерживается: используйте только простые переменные из каталога.")
        case "TOO_MANY_TAGS":
            return String(localized: "staff.tpl.issue.tooMany", defaultValue: "В документе слишком много переменных — не больше 500.")
        case "NO_VARIABLES":
            return String(localized: "staff.tpl.issue.noVariables", defaultValue: "В документе нет ни одной переменной — он будет выдаваться без изменений.")
        case "OPTIONAL_VARIABLE":
            let label = StaffTemplateVariables.find(tag)?.label ?? tag
            return String(localized: "staff.tpl.issue.optional", defaultValue: "Поле «\(label)» бывает не заполнено — тогда на его месте останется пусто.")
        case "PERSONAL_DATA":
            return String(localized: "staff.tpl.issue.personal", defaultValue: "Шаблон подставляет персональные данные студента. Выдавайте документ только по запросу.")
        case "MORE_ISSUES":
            return String(localized: "staff.tpl.issue.more", defaultValue: "И ещё несколько похожих ошибок (\(tag)) — исправьте перечисленные и загрузите файл снова.")
        default:
            return [issue.code, tag].filter { !$0.isEmpty }.joined(separator: " ")
        }
    }

    /// Почему файл не принят вовсе: `details[].message` ошибки `TEMPLATE_FILE_INVALID`.
    static func fileProblem(_ error: Error) -> String {
        guard case .server(_, _, let details, _)? = error as? APIError,
              let code = details.first?.message
        else { return error.userMessage }
        switch code {
        case "CORRUPTED": return String(localized: "staff.tpl.file.corrupted", defaultValue: "Файл повреждён и не открывается. Сохраните документ в Word заново и загрузите ещё раз.")
        case "NOT_WORD_DOCUMENT": return String(localized: "staff.tpl.file.notWord", defaultValue: "Это не документ Word. Сохраните файл в формате .docx.")
        case "MACROS": return String(localized: "staff.tpl.file.macros", defaultValue: "В документе есть макросы. Сохраните его как обычный документ Word (.docx) без макросов.")
        case "ACTIVE_CONTENT": return String(localized: "staff.tpl.file.active", defaultValue: "В документе есть встроенные объекты или элементы управления. Удалите их и загрузите файл снова.")
        case "EXTERNAL_CONTENT": return String(localized: "staff.tpl.file.external", defaultValue: "Документ ссылается на внешний шаблон или файл. Отключите связь и сохраните документ заново.")
        case "ENCRYPTED": return String(localized: "staff.tpl.file.encrypted", defaultValue: "Файл защищён паролем. Снимите защиту и загрузите его снова.")
        case "TOO_COMPLEX": return String(localized: "staff.tpl.file.complex", defaultValue: "Файл слишком сложный для обработки. Уберите крупные вложения и загрузите его снова.")
        default: return error.userMessage
        }
    }

    /// Генерация не прошла: в профиле студента не заполнены поля (`details[].field`).
    static func generationProblem(_ error: Error) -> String {
        guard case .server(_, _, let details, _)? = error as? APIError, !details.isEmpty,
              details.allSatisfy({ StaffTemplateVariables.find($0.field) != nil })
        else { return error.userMessage }
        let fields = details.compactMap { StaffTemplateVariables.find($0.field)?.label }.joined(separator: ", ")
        return String(localized: "staff.tpl.dataMissing", defaultValue: "Не удалось сформировать документ. Не заполнено: \(fields).")
    }
}

// MARK: - Каталог переменных

/// Переменные, которые StudentHub подставляет в DOCX. Реестр живёт в
/// `@studenthub/shared-config` (`DOCUMENT_TEMPLATE_VARIABLES`) и отдельной ручки у него нет —
/// поэтому здесь его копия с теми же ключами и подписями.
struct StaffTemplateVariable: Identifiable {
    let key: String
    let group: String
    let label: String
    let example: String
    var optional = false
    var personal = false

    var id: String { key }
    var tag: String { "{\(key)}" }
}

enum StaffTemplateVariables {
    static let groups = ["STUDENT", "EDUCATION", "UNIVERSITY", "DOCUMENT", "ISSUER"]

    static func group(_ raw: String) -> String {
        switch raw {
        case "STUDENT": return String(localized: "staff.tpl.group.student", defaultValue: "Студент")
        case "EDUCATION": return String(localized: "staff.tpl.group.education", defaultValue: "Обучение")
        case "UNIVERSITY": return String(localized: "staff.tpl.group.university", defaultValue: "Университет")
        case "DOCUMENT": return String(localized: "staff.tpl.group.document", defaultValue: "Документ")
        case "ISSUER": return String(localized: "staff.tpl.group.issuer", defaultValue: "Сотрудник")
        default: return raw
        }
    }

    static func find(_ key: String) -> StaffTemplateVariable? {
        let bare = key.trimmingCharacters(in: CharacterSet(charactersIn: "{} "))
        return all.first { $0.key == bare }
    }

    static let all: [StaffTemplateVariable] = [
        StaffTemplateVariable(key: "student.fullName", group: "STUDENT", label: String(localized: "staff.tpl.var.fullName", defaultValue: "ФИО студента"), example: "Нурланова Айгерим Ержановна", personal: true),
        StaffTemplateVariable(key: "student.lastName", group: "STUDENT", label: String(localized: "staff.tpl.var.lastName", defaultValue: "Фамилия"), example: "Нурланова", personal: true),
        StaffTemplateVariable(key: "student.firstName", group: "STUDENT", label: String(localized: "staff.tpl.var.firstName", defaultValue: "Имя"), example: "Айгерим", personal: true),
        StaffTemplateVariable(key: "student.middleName", group: "STUDENT", label: String(localized: "staff.tpl.var.middleName", defaultValue: "Отчество"), example: "Ержановна", optional: true, personal: true),
        StaffTemplateVariable(key: "student.birthDate", group: "STUDENT", label: String(localized: "staff.tpl.var.birthDate", defaultValue: "Дата рождения"), example: "14.03.2005", personal: true),
        StaffTemplateVariable(key: "student.studentCardNumber", group: "STUDENT", label: String(localized: "staff.tpl.var.card", defaultValue: "Номер студенческого билета"), example: "202312345", personal: true),
        StaffTemplateVariable(key: "student.group", group: "EDUCATION", label: String(localized: "staff.tpl.var.group", defaultValue: "Группа"), example: "ИС-23"),
        StaffTemplateVariable(key: "student.course", group: "EDUCATION", label: String(localized: "staff.tpl.var.course", defaultValue: "Курс"), example: "3"),
        StaffTemplateVariable(key: "student.faculty", group: "EDUCATION", label: String(localized: "staff.tpl.var.faculty", defaultValue: "Факультет"), example: "Факультет информационных технологий"),
        StaffTemplateVariable(key: "student.specialty", group: "EDUCATION", label: String(localized: "staff.tpl.var.specialty", defaultValue: "Специальность"), example: "6B06102 Информационные системы"),
        StaffTemplateVariable(key: "student.studyForm", group: "EDUCATION", label: String(localized: "staff.tpl.var.studyForm", defaultValue: "Форма обучения"), example: "Очная"),
        StaffTemplateVariable(key: "student.educationLevel", group: "EDUCATION", label: String(localized: "staff.tpl.var.level", defaultValue: "Уровень образования"), example: "Бакалавриат"),
        StaffTemplateVariable(key: "student.fundingType", group: "EDUCATION", label: String(localized: "staff.tpl.var.funding", defaultValue: "Основа обучения"), example: "Грант"),
        StaffTemplateVariable(key: "student.enrollmentYear", group: "EDUCATION", label: String(localized: "staff.tpl.var.enrollment", defaultValue: "Год поступления"), example: "2023"),
        StaffTemplateVariable(key: "student.graduationYear", group: "EDUCATION", label: String(localized: "staff.tpl.var.graduation", defaultValue: "Год окончания"), example: "2027"),
        StaffTemplateVariable(key: "university.name", group: "UNIVERSITY", label: String(localized: "staff.tpl.var.uniName", defaultValue: "Название университета"), example: "Пример университета"),
        StaffTemplateVariable(key: "university.shortName", group: "UNIVERSITY", label: String(localized: "staff.tpl.var.uniShort", defaultValue: "Краткое название"), example: "ПУ"),
        StaffTemplateVariable(key: "university.city", group: "UNIVERSITY", label: String(localized: "staff.tpl.var.city", defaultValue: "Город"), example: "Астана"),
        StaffTemplateVariable(key: "university.address", group: "UNIVERSITY", label: String(localized: "staff.tpl.var.address", defaultValue: "Адрес"), example: "пр. Примерный, 1"),
        StaffTemplateVariable(key: "university.phone", group: "UNIVERSITY", label: String(localized: "staff.tpl.var.phone", defaultValue: "Телефон"), example: "+7 700 000 00 00"),
        StaffTemplateVariable(key: "university.email", group: "UNIVERSITY", label: String(localized: "staff.tpl.var.email", defaultValue: "Электронная почта"), example: "info@example.edu"),
        StaffTemplateVariable(key: "university.website", group: "UNIVERSITY", label: String(localized: "staff.tpl.var.website", defaultValue: "Сайт"), example: "https://example.edu"),
        StaffTemplateVariable(key: "document.date", group: "DOCUMENT", label: String(localized: "staff.tpl.var.docDate", defaultValue: "Дата формирования"), example: "06.11.2026"),
        StaffTemplateVariable(key: "document.year", group: "DOCUMENT", label: String(localized: "staff.tpl.var.docYear", defaultValue: "Год"), example: "2026"),
        StaffTemplateVariable(key: "issuer.fullName", group: "ISSUER", label: String(localized: "staff.tpl.var.issuer", defaultValue: "ФИО сотрудника"), example: "Примерова Мария Сергеевна"),
        StaffTemplateVariable(key: "issuer.position", group: "ISSUER", label: String(localized: "staff.tpl.var.position", defaultValue: "Должность сотрудника"), example: "Специалист офиса регистратора"),
    ]
}

/// Каталог переменных: что можно вставить в документ Word. Нажатие копирует переменную.
private struct StaffTemplateVariablesView: View {
    @State private var search = ""
    @State private var group: String?
    @State private var copied: String?

    var body: some View {
        List {
            FilterChipsRow(
                options: [(nil, String(localized: "staff.tpl.group.all", defaultValue: "Все"))]
                    + StaffTemplateVariables.groups.map { (Optional($0), StaffTemplateVariables.group($0)) },
                selection: $group
            )
            let rows = filtered
            if !rows.isEmpty {
                Section {
                    ForEach(rows) { variable in
                        Button {
                            UIPasteboard.general.string = variable.tag
                            copied = variable.tag
                        } label: {
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                HStack {
                                    Text(variable.label).font(Typography.body).foregroundStyle(Palette.foreground)
                                    Spacer()
                                    Image(systemName: copied == variable.tag ? "checkmark" : "doc.on.doc")
                                        .foregroundStyle(Palette.primary)
                                }
                                Text(variable.tag)
                                    .font(Typography.meta.monospaced())
                                    .foregroundStyle(Palette.primary)
                                Text(String(localized: "staff.tpl.example", defaultValue: "Пример: \(variable.example)"))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                                HStack(spacing: Spacing.sm) {
                                    if variable.personal {
                                        StatusBadge(text: String(localized: "staff.tpl.personal", defaultValue: "Персональные данные"), tint: Palette.warning)
                                    }
                                    if variable.optional {
                                        StatusBadge(text: String(localized: "staff.tpl.optional", defaultValue: "Может быть пустым"), tint: Palette.info)
                                    }
                                }
                            }
                            .padding(.vertical, Spacing.xs)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(Text(String(localized: "staff.tpl.copy", defaultValue: "Скопировать")))
                    }
                } footer: {
                    Text(String(localized: "staff.tpl.catalog.hint", defaultValue: "Нажмите на переменную, чтобы скопировать её, и вставьте в документ Word."))
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(filtered.isEmpty) {
            EmptyStateView(
                title: String(localized: "staff.tpl.catalog.empty", defaultValue: "Ничего не найдено"),
                symbol: "magnifyingglass",
                hint: String(localized: "staff.tpl.catalog.empty.hint", defaultValue: "Попробуйте другое слово или выберите группу «Все»")
            )
        }
        .searchable(text: $search, prompt: Text(String(localized: "staff.tpl.catalog.search", defaultValue: "Поиск переменной")))
        .navigationTitle(Text(String(localized: "staff.tpl.variables", defaultValue: "Переменные")))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(String(localized: "staff.tpl.copyAll", defaultValue: "Скопировать все")) {
                    UIPasteboard.general.string = filtered.map(\.tag).joined(separator: "\n")
                    copied = "*"
                }
            }
        }
    }

    private var filtered: [StaffTemplateVariable] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        return StaffTemplateVariables.all.filter { variable in
            (group == nil || variable.group == group)
                && (needle.isEmpty || variable.label.lowercased().contains(needle) || variable.key.lowercased().contains(needle))
        }
    }
}

// MARK: - Список шаблонов

struct StaffTemplatesView: View {
    @Environment(\.viewerRole) private var role
    @State private var search = ""
    @State private var status: String?
    @State private var category: String?
    @State private var loader: PagedLoader<StaffTemplate>
    @State private var creating = false
    @State private var created: String?
    @State private var appeared = false

    private let api = StaffAPI()

    init() {
        let api = StaffAPI()
        _loader = State(initialValue: PagedLoader(limit: 20) { request in
            try await api.templates(search: "", status: nil, category: nil, request)
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: isFiltered
                    ? String(localized: "staff.tpl.emptyFiltered", defaultValue: "Под фильтр ничего не подошло")
                    : String(localized: "staff.tpl.empty", defaultValue: "Шаблонов пока нет"),
                symbol: "doc.text",
                hint: isFiltered ? nil : String(
                    localized: "staff.tpl.empty.hint",
                    defaultValue: "Загрузите бланк справки или заявления в формате Word — StudentHub будет заполнять его данными студентов сам."
                ),
                actionTitle: canManage && !isFiltered ? String(localized: "staff.tpl.create", defaultValue: "Создать шаблон") : nil,
                action: canManage && !isFiltered ? { creating = true } : nil
            ),
            header: {
                FilterChipsRow(
                    options: [(nil, String(localized: "staff.tpl.allStatuses", defaultValue: "Все статусы"))]
                        + StaffTemplateText.statuses.map { (Optional($0), StaffTemplateText.status($0).0) },
                    selection: $status
                )
                if canManage {
                    NavigationLink {
                        StaffTemplateVariablesView()
                    } label: {
                        IconRow(
                            title: String(localized: "staff.tpl.variables", defaultValue: "Переменные"),
                            symbol: "curlybraces",
                            tint: TileTint.indigo,
                            subtitle: String(localized: "staff.tpl.variables.hint", defaultValue: "Что можно вставить в документ Word")
                        )
                    }
                }
            },
            row: { item in
                NavigationLink(value: AppRoute.staff(.documentTemplate(id: item.id))) {
                    templateRow(item)
                }
            }
        )
        .navigationTitle(Text(StaffScreen.documentTemplates.title))
        .debouncedSearch($search, prompt: String(localized: "staff.tpl.search", defaultValue: "Поиск по названию")) { _ in
            await reload()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(String(localized: "staff.tpl.category", defaultValue: "Вид документа"), selection: $category) {
                        Text(String(localized: "staff.tpl.allCategories", defaultValue: "Все виды")).tag(String?.none)
                        ForEach(StaffTemplateText.categories, id: \.self) { Text(StaffTemplateText.category($0)).tag(String?.some($0)) }
                    }
                } label: {
                    Image(systemName: category == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel(Text(String(localized: "staff.tpl.category", defaultValue: "Вид документа")))
            }
        }
        .adminFloatingAction(canManage, String(localized: "staff.tpl.create", defaultValue: "Создать шаблон")) {
            creating = true
        }
        .onChange(of: status) { Task { await reload() } }
        .onChange(of: category) { Task { await reload() } }
        .sheet(isPresented: $creating) {
            StaffTemplateInfoSheet(template: nil) { id in
                await loader.reload()
                created = id
            }
        }
        .navigationDestination(item: $created) { id in
            StaffTemplateDetailView(templateID: id)
        }
        .onAppear {
            if appeared { Task { await loader.reload() } }
            appeared = true
        }
    }

    /// Управление — только админ вуза; модератор и декан видят опубликованные.
    private var canManage: Bool { role == .universityAdmin }

    private var isFiltered: Bool {
        status != nil || category != nil || !search.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func reload() async {
        let needle = search
        let status = status
        let category = category
        await loader.replace { request in
            try await api.templates(search: needle, status: status, category: category, request)
        }
    }

    private func templateRow(_ item: StaffTemplate) -> some View {
        let status = StaffTemplateText.status(item.status)
        let line = [
            StaffTemplateText.category(item.category),
            String(localized: "staff.tpl.variablesCount", defaultValue: "Переменных: \(item.variableCount.formatted())"),
        ].joined(separator: " · ")
        return TelegramStyleRow(
            title: item.title,
            subtitle: [item.description ?? "", line].filter { !$0.isEmpty }.joined(separator: "\n"),
            meta: item.updatedAt.map(DisplayFormat.date)
        ) {
            RowSymbol(symbol: "doc.text.fill", tint: status.1)
        } accessory: {
            HStack(spacing: Spacing.xs) {
                if item.hasUnpublishedChanges {
                    StatusBadge(text: String(localized: "staff.tpl.unpublished", defaultValue: "Есть изменения"), tint: Palette.info)
                }
                StatusBadge(text: status.0, tint: status.1)
            }
        }
    }
}

// MARK: - Название, вид, язык

private struct StaffTemplateInfoSheet: View {
    let template: StaffTemplate?
    let saved: (String) async -> Void

    @State private var title = ""
    @State private var category = "CERTIFICATE"
    @State private var description = ""
    @State private var locale = "ru"
    @State private var createdID: String?

    private let api = StaffAPI()

    var body: some View {
        FormSheet(
            title: template == nil
                ? String(localized: "staff.tpl.new", defaultValue: "Новый шаблон")
                : String(localized: "staff.tpl.editTitle", defaultValue: "Изменить шаблон"),
            saveTitle: template == nil
                ? String(localized: "staff.tpl.createAndContinue", defaultValue: "Создать")
                : String(localized: "common.save", defaultValue: "Сохранить"),
            canSave: !trimmedTitle.isEmpty && trimmedTitle.count <= 200 && description.count <= 1000,
            save: {
                if let template {
                    try await api.updateTemplate(
                        id: template.id, title: trimmedTitle, category: category, description: description, locale: locale
                    )
                    createdID = template.id
                } else {
                    let trimmed = description.trimmingCharacters(in: .whitespacesAndNewlines)
                    let created = try await api.createTemplate(StaffTemplateInput(
                        title: trimmedTitle, category: category, description: trimmed.isEmpty ? nil : trimmed, locale: locale
                    ))
                    createdID = created.id
                }
            },
            saved: {
                if let createdID { await saved(createdID) }
            }
        ) {
            Section {
                TextField(String(localized: "staff.tpl.titleField", defaultValue: "Название"), text: $title)
                Picker(String(localized: "staff.tpl.category", defaultValue: "Вид документа"), selection: $category) {
                    ForEach(StaffTemplateText.categories, id: \.self) { Text(StaffTemplateText.category($0)).tag($0) }
                }
                Picker(String(localized: "staff.tpl.locale", defaultValue: "Язык документа"), selection: $locale) {
                    ForEach(StaffTemplateText.locales, id: \.self) { Text(StaffTemplateText.locale($0)).tag($0) }
                }
            }
            Section(String(localized: "staff.tpl.description", defaultValue: "Описание")) {
                TextField(String(localized: "staff.tpl.description", defaultValue: "Описание"), text: $description, axis: .vertical)
                    .lineLimit(2...6)
            }
        }
        .onAppear {
            guard let template, title.isEmpty else { return }
            title = template.title
            category = template.category
            description = template.description ?? ""
            locale = template.locale
        }
    }

    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
}

// MARK: - Карточка шаблона

struct StaffTemplateDetailView: View {
    let templateID: String

    @Environment(\.viewerRole) private var role
    @Environment(\.dismiss) private var dismiss
    @State private var remote = RemoteValue<StaffTemplate>()
    @State private var actionFailure: String?
    @State private var notice: String?
    @State private var editing = false
    @State private var uploading = false
    @State private var isWorking = false
    @State private var generating = false
    @State private var confirmDelete = false
    @State private var confirmUnpublish = false
    @State private var preview: URL?
    @State private var opener = RemoteFileOpener()

    private let api = StaffAPI()

    private var template: StaffTemplate? { remote.value }

    var body: some View {
        RemoteValueContent(remote: remote, load: fetch) { template in content(template) }
        .navigationTitle(Text(StaffScreen.documentTemplate(id: templateID).title))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editing) {
            if let template {
                StaffTemplateInfoSheet(template: template) { _ in await load() }
            }
        }
        .sheet(isPresented: $generating) {
            StaffStudentPickerSheet(
                title: String(localized: "staff.tpl.generate", defaultValue: "Документ для студента"),
                hint: String(localized: "staff.tpl.generate.hint", defaultValue: "Выберите студента своего университета. Документ сформируется файлом Word.")
            ) { student in
                try await generate(for: student)
            }
        }
        .fileImporter(isPresented: $uploading, allowedContentTypes: [.staffDocx]) { result in
            Task { await upload(result) }
        }
        .alert(
            String(localized: "staff.tpl.delete.confirm", defaultValue: "Удалить шаблон «\((template?.title).orEmpty)»?"),
            isPresented: $confirmDelete
        ) {
            Button(deleteActionTitle, role: .destructive) { Task { await remove() } }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: {
            Text(deleteHint)
        }
        .alert(
            String(localized: "staff.tpl.unpublish.confirm", defaultValue: "Снять шаблон с публикации?"),
            isPresented: $confirmUnpublish
        ) {
            Button(String(localized: "staff.tpl.unpublish", defaultValue: "Снять с публикации"), role: .destructive) {
                Task { await run { try await api.unpublishTemplate(id: templateID) } }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: {
            Text(String(localized: "staff.tpl.unpublish.hint", defaultValue: "Формировать документы по нему станет нельзя, пока вы не опубликуете его снова."))
        }
        .sheet(item: Binding(get: { preview.map { StaffDownloadedFile(url: $0) } }, set: { preview = $0?.url })) { file in
            StaffActivitySheet(items: [file.url])
        }
        .actionFailureAlert($actionFailure)
        .alert(
            String(localized: "staff.tpl.done", defaultValue: "Готово"),
            isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(notice ?? "")
        }
        .remoteFilePreview(opener)
        .overlay {
            if isWorking {
                ProgressView()
                    .padding(Spacing.xl)
                    .glassSurface(interactive: false, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            }
        }
    }

    private var canManage: Bool { role == .universityAdmin }

    private var deleteActionTitle: String {
        (template?.generationCount ?? 0) > 0
            ? String(localized: "staff.tpl.archive", defaultValue: "В архив")
            : String(localized: "staff.tpl.delete", defaultValue: "Удалить")
    }

    private var deleteHint: String {
        (template?.generationCount ?? 0) > 0
            ? String(localized: "staff.tpl.delete.archivesHint", defaultValue: "По шаблону уже выдавали документы, поэтому он уйдёт в архив: формировать документы станет нельзя, а история сохранится.")
            : String(localized: "staff.tpl.delete.hint", defaultValue: "Шаблон и все его версии будут удалены без возможности восстановления.")
    }

    @ViewBuilder
    private func content(_ template: StaffTemplate) -> some View {
        let archived = template.status == "ARCHIVED"
        let current = template.versions?.first { $0.id == template.currentVersion?.id }
        let valid = current?.validation.valid == true
        let status = StaffTemplateText.status(template.status)
        List {
            Section {
                if canManage, !archived {
                    HeroHeader(
                        visual: .symbol("doc.text.fill", tint: status.1),
                        title: template.title,
                        subtitle: [StaffTemplateText.category(template.category), StaffTemplateText.locale(template.locale)].joined(separator: " · "),
                        actions: heroActions(template, current: current, valid: valid)
                    ) {
                        HStack(spacing: Spacing.sm) {
                            StatusBadge(text: status.0, tint: status.1)
                            if template.hasUnpublishedChanges {
                                StatusBadge(text: String(localized: "staff.tpl.unpublished", defaultValue: "Есть изменения"), tint: Palette.info)
                            }
                        }
                    } moreMenu: {
                        if canManage, !archived {
                            HeroMenuItem(String(localized: "staff.tpl.edit", defaultValue: "Изменить"), symbol: "pencil") {
                                editing = true
                            }
                            if let current {
                                HeroMenuItem(String(localized: "staff.tpl.downloadSource", defaultValue: "Скачать исходный DOCX"), symbol: "arrow.down.doc") {
                                    downloadSource(current)
                                }
                            }
                            HeroMenuItem(String(localized: "staff.tpl.replaceFile", defaultValue: "Заменить файл"), symbol: "arrow.up.doc") {
                                uploading = true
                            }
                            HeroMenuDivider()
                            HeroMenuItem(deleteActionTitle, symbol: (template.generationCount ?? 0) > 0 ? "archivebox" : "trash", isDestructive: true) {
                                confirmDelete = true
                            }
                        }
                    }
                } else {
                    HeroHeader(
                        visual: .symbol("doc.text.fill", tint: status.1),
                        title: template.title,
                        subtitle: [StaffTemplateText.category(template.category), StaffTemplateText.locale(template.locale)].joined(separator: " · "),
                        actions: heroActions(template, current: current, valid: valid)
                    ) {
                        HStack(spacing: Spacing.sm) {
                            StatusBadge(text: status.0, tint: status.1)
                            if template.hasUnpublishedChanges {
                                StatusBadge(text: String(localized: "staff.tpl.unpublished", defaultValue: "Есть изменения"), tint: Palette.info)
                            }
                        }
                    }
                }
            }

            Section {
                if archived {
                    Label(
                        String(
                            localized: "staff.tpl.archivedNotice",
                            defaultValue: "Шаблон в архиве: по нему выдано документов — \((template.generationCount ?? 0).formatted()), поэтому история и файлы сохранены. Формировать документы и менять шаблон нельзя."
                        ),
                        systemImage: "archivebox"
                    )
                    .font(Typography.meta)
                    .foregroundStyle(Palette.warning)
                }
            }

            Section {
                if let current {
                    if template.hasUnpublishedChanges {
                        Label(
                            String(localized: "staff.tpl.unpublished.hint", defaultValue: "Новый файл загружен, но ещё не опубликован: документы формируются по прежней версии"),
                            systemImage: "info.circle"
                        )
                        .font(Typography.meta)
                        .foregroundStyle(Palette.info)
                    }
                    StaffValidationReport(validation: current.validation)
                    Button {
                        Task { await showPreview(current) }
                    } label: {
                        Label(String(localized: "staff.tpl.preview", defaultValue: "Предпросмотр на примере"), systemImage: "eye")
                    }
                    .disabled(!valid || !canManage)
                    if canManage {
                        Button {
                            downloadSource(current)
                        } label: {
                            Label(String(localized: "staff.tpl.downloadSource", defaultValue: "Скачать исходный DOCX"), systemImage: "arrow.down.doc")
                        }
                    }
                    if canManage, !archived {
                        Button {
                            uploading = true
                        } label: {
                            Label(String(localized: "staff.tpl.replaceFile", defaultValue: "Заменить файл"), systemImage: "arrow.up.doc")
                        }
                    }
                } else if archived {
                    Text(String(localized: "staff.tpl.noFile", defaultValue: "Файл так и не загрузили"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                } else {
                    Text(String(localized: "staff.tpl.uploadIntro", defaultValue: "Загрузите документ Word (.docx) с переменными. Файлы .doc, .docm и архивы не подойдут."))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                    if canManage {
                        Button {
                            uploading = true
                        } label: {
                            Label(String(localized: "staff.tpl.upload", defaultValue: "Загрузить DOCX"), systemImage: "arrow.up.doc")
                        }
                    }
                }
            } header: {
                Text(current.map {
                    String(localized: "staff.tpl.currentVersion", defaultValue: "Рабочая версия \($0.version.formatted())")
                } ?? String(localized: "staff.tpl.file", defaultValue: "Файл шаблона"))
            } footer: {
                if current != nil, canManage, !archived {
                    Text(String(localized: "staff.tpl.replace.hint", defaultValue: "Новый файл сохранится новой версией. Опубликованная версия продолжит работать, пока вы не опубликуете новую."))
                }
            }

            if canManage, !archived {
                Section(String(localized: "staff.tpl.publication", defaultValue: "Публикация")) {
                    Text(publicationText(template, valid: valid))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                    if template.status != "PUBLISHED" || template.hasUnpublishedChanges {
                        Button {
                            Task { await run { try await api.publishTemplate(id: templateID) } }
                        } label: {
                            Label(
                                template.hasUnpublishedChanges
                                    ? String(localized: "staff.tpl.publishChanges", defaultValue: "Опубликовать изменения")
                                    : String(localized: "staff.tpl.publish", defaultValue: "Опубликовать"),
                                systemImage: "paperplane"
                            )
                        }
                        .disabled(!valid)
                    }
                    if template.status == "PUBLISHED" {
                        Button(role: .destructive) {
                            confirmUnpublish = true
                        } label: {
                            Label(String(localized: "staff.tpl.unpublish", defaultValue: "Снять с публикации"), systemImage: "arrow.uturn.backward")
                        }
                    }
                }
            }

            if template.status == "PUBLISHED" {
                Section {
                    Button {
                        generating = true
                    } label: {
                        Label(String(localized: "staff.tpl.generate.action", defaultValue: "Сформировать для студента"), systemImage: "person.text.rectangle")
                    }
                } header: {
                    Text(String(localized: "staff.tpl.generate", defaultValue: "Документ для студента"))
                } footer: {
                    Text(String(
                        localized: "staff.tpl.generate.footer",
                        defaultValue: "Данные возьмутся из профиля студента. Если нужного поля нет, документ не сформируется — сначала заполните профиль. Уже сформировано: \((template.generationCount ?? 0).formatted())."
                    ))
                }
            }

            if let versions = template.versions, !versions.isEmpty {
                Section(String(localized: "staff.tpl.versions", defaultValue: "История версий")) {
                    ForEach(versions) { version in
                        Button {
                            downloadSource(version)
                        } label: {
                            versionRow(version, template: template)
                        }
                        .buttonStyle(.plain)
                        .disabled(!canManage)
                    }
                }
            }

            Section(String(localized: "staff.tpl.about", defaultValue: "О шаблоне")) {
                if let description = template.description, !description.isEmpty {
                    Text(description).font(Typography.body).foregroundStyle(Palette.foreground)
                }
                DetailRow(title: String(localized: "staff.tpl.author", defaultValue: "Автор"), value: template.author?.displayName ?? "—", symbol: "person")
                DetailRow(title: String(localized: "staff.tpl.created", defaultValue: "Создан"), value: DisplayFormat.date(template.createdAt), symbol: "calendar")
                DetailRow(title: String(localized: "staff.tpl.updated", defaultValue: "Изменён"), value: DisplayFormat.date(template.updatedAt), symbol: "pencil")
                DetailRow(title: String(localized: "staff.tpl.variablesTitle", defaultValue: "Переменных"), value: template.variableCount.formatted(), symbol: "curlybraces")
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .pullToRefresh { await load() }
    }

    /// Круглые кнопки шапки: главное, что делают с шаблоном, — сформировать документ,
    /// посмотреть пример и опубликовать.
    private func heroActions(_ template: StaffTemplate, current: StaffTemplateVersion?, valid: Bool) -> [HeroAction] {
        var actions: [HeroAction] = []
        if template.status == "PUBLISHED" {
            actions.append(HeroAction(title: String(localized: "staff.tpl.generateShort", defaultValue: "Сформировать"), symbol: "person.text.rectangle") {
                generating = true
            })
        }
        if let current, valid, canManage {
            actions.append(HeroAction(title: String(localized: "staff.tpl.previewShort", defaultValue: "Пример"), symbol: "eye") {
                Task { await showPreview(current) }
            })
        }
        if canManage, template.status != "ARCHIVED", valid, template.status != "PUBLISHED" || template.hasUnpublishedChanges {
            actions.append(HeroAction(title: String(localized: "staff.tpl.publishShort", defaultValue: "Опубликовать"), symbol: "paperplane.fill") {
                Task { await run { try await api.publishTemplate(id: templateID) } }
            })
        }
        if canManage, template.status != "ARCHIVED", current == nil {
            actions.append(HeroAction(title: String(localized: "staff.tpl.uploadShort", defaultValue: "Загрузить"), symbol: "arrow.up.doc") {
                uploading = true
            })
        }
        return actions
    }

    private func versionRow(_ version: StaffTemplateVersion, template: StaffTemplate) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: Spacing.sm) {
                Text(String(localized: "staff.tpl.versionN", defaultValue: "Версия \(version.version.formatted())"))
                    .font(Typography.body.weight(.medium))
                    .foregroundStyle(Palette.foreground)
                if version.id == template.publishedVersion?.id {
                    StatusBadge(text: String(localized: "staff.tpl.publishedBadge", defaultValue: "Опубликована"), tint: Palette.success)
                }
                if !version.validation.valid {
                    StatusBadge(text: String(localized: "staff.tpl.needsFix", defaultValue: "Нужно исправить"), tint: Palette.destructive)
                }
                Spacer()
                if canManage {
                    Image(systemName: "arrow.down.circle").foregroundStyle(Palette.primary)
                }
            }
            Text([
                version.fileName,
                version.size.map { DisplayFormat.fileSize($0) },
                version.createdAt.map { DisplayFormat.date($0) },
                version.createdBy?.displayName,
            ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(2)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    private func publicationText(_ template: StaffTemplate, valid: Bool) -> String {
        if template.status == "PUBLISHED", let published = template.publishedVersion {
            let date = template.publishedAt.map { DisplayFormat.date($0) } ?? ""
            return String(localized: "staff.tpl.publishedInfo", defaultValue: "Опубликована версия \(published.version.formatted()) от \(date)")
        }
        return valid
            ? String(localized: "staff.tpl.publishReady", defaultValue: "Шаблон прошёл проверку и готов к публикации.")
            : String(localized: "staff.tpl.publishBlocked", defaultValue: "Опубликовать можно только шаблон, прошедший проверку.")
    }

    // MARK: Действия

    private func load() async {
        await remote.load(fetch)
    }

    private func fetch() async throws -> StaffTemplate {
        try await api.template(id: templateID)
    }

    @MainActor
    private func run(_ work: () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await work()
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func upload(_ result: Result<URL, Error>) async {
        guard let file = StaffPickedFile.read(result) else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try await api.uploadTemplateVersion(id: templateID, data: file.data, name: file.name)
            await load()
        } catch {
            actionFailure = StaffTemplateText.fileProblem(error)
        }
    }

    /// Пример на демо-данных сервера — тот же документ, что «Проверить на примере» в вебе.
    /// Системный просмотр показывает DOCX страницами.
    @MainActor
    private func showPreview(_ version: StaffTemplateVersion) async {
        isWorking = true
        defer { isWorking = false }
        do {
            let data = try await api.testTemplate(id: templateID, versionID: version.id)
            let name = String(localized: "staff.tpl.previewName", defaultValue: "Пример — версия \(version.version.formatted())") + ".docx"
            opener.previewURL = try StaffPickedFile.temporary(data, name: name)
        } catch {
            actionFailure = error.userMessage
        }
    }

    private func downloadSource(_ version: StaffTemplateVersion) {
        guard canManage else { return }
        Task {
            await opener.open(name: version.fileName ?? "template-v\(version.version).docx") {
                try await api.templateSource(id: templateID, versionID: version.id).url
            }
        }
    }

    /// Документ для студента сохраняется во временный файл и уходит в «Поделиться».
    private func generate(for student: StaffUserPick) async throws {
        do {
            let data = try await api.generateTemplate(id: templateID, studentID: student.id)
            let name = "\(template?.title ?? "document") — \(student.name).docx"
            let url = try StaffPickedFile.temporary(data, name: name)
            await load()
            preview = url
        } catch {
            throw StaffMessageError(message: StaffTemplateText.generationProblem(error))
        }
    }

    @MainActor
    private func remove() async {
        isWorking = true
        defer { isWorking = false }
        do {
            let archived = try await api.deleteTemplate(id: templateID)
            if archived {
                notice = String(localized: "staff.tpl.archivedToast", defaultValue: "Шаблон перенесён в архив")
                await load()
            } else {
                dismiss()
            }
        } catch {
            actionFailure = error.userMessage
        }
    }
}

/// Отчёт проверки шаблона: что исправить, на что обратить внимание, найденные переменные.
private struct StaffValidationReport: View {
    let validation: StaffTemplateValidation

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if validation.valid, validation.errors.isEmpty {
                Label(String(localized: "staff.tpl.valid", defaultValue: "Проверка пройдена"), systemImage: "checkmark.seal")
                    .foregroundStyle(Palette.success)
            }
            if !validation.errors.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(String(localized: "staff.tpl.errors", defaultValue: "Что исправить"))
                        .font(Typography.meta.weight(.semibold))
                        .foregroundStyle(Palette.destructive)
                    ForEach(Array(validation.errors.enumerated()), id: \.offset) { _, issue in
                        Label(StaffTemplateText.issue(issue), systemImage: "xmark.octagon")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.foreground)
                    }
                }
            }
            if !validation.warnings.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(String(localized: "staff.tpl.warnings", defaultValue: "Обратите внимание"))
                        .font(Typography.meta.weight(.semibold))
                        .foregroundStyle(Palette.warning)
                    ForEach(Array(validation.warnings.enumerated()), id: \.offset) { _, issue in
                        Label(StaffTemplateText.issue(issue), systemImage: "exclamationmark.triangle")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.foreground)
                    }
                }
            }
            if validation.variables.isEmpty {
                Text(String(localized: "staff.tpl.noVariables", defaultValue: "Переменных в документе нет"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            } else {
                Text(validation.variables.map { StaffTemplateVariables.find($0)?.label ?? $0 }.joined(separator: ", "))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .padding(.vertical, Spacing.xs)
    }
}

// MARK: - Выбор студента

/// Поиск студента своего вуза (студенты и старосты) — админским поиском пользователей.
struct StaffStudentPickerSheet: View {
    let title: String
    var hint: String?
    let pick: (StaffUserPick) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var results: [StaffUserPick] = []
    @State private var isSearching = false
    @State private var isWorking = false
    /// Сбой поиска: вместо результатов — экран ошибки с повтором, а не «никого не нашли».
    @State private var searchFailure: String?
    @State private var isOffline = false
    /// Отказ выбора (сервер не принял студента) — плашкой над найденными.
    @State private var failure: String?

    private let api = StaffAPI()

    var body: some View {
        NavigationStack {
            List {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if let hint {
                    Text(hint).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                        .listRowBackground(Color.clear)
                }
                // Новый поиск поверх найденных по прошлой строке — загрузка строкой над ними.
                if isSearching, !results.isEmpty, search.trimmingCharacters(in: .whitespaces).count >= 2 {
                    LoadingStateView().listRowBackground(Color.clear)
                }
                ForEach(results) { person in
                    Button {
                        Task { await choose(person) }
                    } label: {
                        PersonRow(
                            name: person.name,
                            subtitle: [StaffRoleText.title(person.role), person.groupName, person.email].compactMap { $0 }.joined(separator: " · "),
                            avatarURL: person.avatarThumbUrl
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(isWorking)
                }
            }
            .listStyle(.insetGrouped)
            .screenState(results.isEmpty) {
                if search.trimmingCharacters(in: .whitespaces).count < 2 {
                    Text(String(localized: "staff.picker.typeMore", defaultValue: "Введите хотя бы две буквы ФИО"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                } else if isSearching {
                    LoadingStateView()
                } else if let searchFailure {
                    ErrorStateView(message: searchFailure, isOffline: isOffline) {
                        await find(search.trimmingCharacters(in: .whitespaces))
                    }
                } else {
                    Text(String(localized: "staff.picker.nothing", defaultValue: "Никого не нашли"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            .debouncedSearch($search, prompt: String(localized: "staff.picker.search", defaultValue: "ФИО студента")) { value in
                await find(value)
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .overlay {
                if isWorking {
                    ProgressView()
                        .padding(Spacing.xl)
                        .glassSurface(interactive: false, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                }
            }
        }
    }

    @MainActor
    private func find(_ value: String) async {
        guard value.count >= 2 else {
            results = []
            searchFailure = nil
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            // Поиск фильтрует по одной роли — на студентов и старост идёт два запроса.
            async let students = api.users(search: value, role: "STUDENT")
            async let starostas = api.users(search: value, role: "STAROSTA")
            let merged = try await students + starostas
            results = merged.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
            searchFailure = nil
            // Новый поиск — прошлый отказ в выборе к новым результатам не относится.
            failure = nil
            isOffline = false
        } catch is CancellationError {
            return
        } catch {
            // Найденные по прошлой строке под новой выглядели бы её результатом.
            results = []
            searchFailure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func choose(_ person: StaffUserPick) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await pick(person)
            dismiss()
        } catch {
            failure = StaffErrorText.message(error)
        }
    }
}

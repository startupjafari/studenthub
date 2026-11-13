import SwiftUI
import UniformTypeIdentifiers

// Общее для экранов соцчасти: состояние платформы (выключенные разделы), выбор
// человека, подписи перечислений сервера и текст статьи.

// MARK: - Выключенные разделы

/// Разделы, выключенные платформой (`GET /platform/state`). Читается один раз в минуту:
/// выключение — редкое событие, и опрашивать сервер на каждом экране незачем.
@MainActor
@Observable
final class CommunityPlatformState {
    static let shared = CommunityPlatformState()

    private(set) var disabled: Set<String> = []
    @ObservationIgnored private var loadedAt: Date?

    func isDisabled(_ section: String) -> Bool { disabled.contains(section) }

    func refresh(force: Bool = false) async {
        if !force, let loadedAt, Date().timeIntervalSince(loadedAt) < 60 { return }
        guard let state = try? await CommunityAPI().platformState() else { return }
        disabled = Set(state.disabledSections ?? [])
        loadedAt = Date()
    }
}

/// Обёртка экрана раздела: если платформа его выключила, вместо содержимого — понятное
/// объяснение. Ключи — `PLATFORM_SECTIONS`: `chats`, `events`, `documents`,
/// `applications`, `portfolio`, `career`.
struct CommunitySectionGate<Content: View>: View {
    let section: String
    @ViewBuilder let content: () -> Content

    private var state: CommunityPlatformState { CommunityPlatformState.shared }

    var body: some View {
        Group {
            if state.isDisabled(section) {
                CommunityDisabledSectionView(section: section)
            } else {
                content()
            }
        }
        .task { await state.refresh() }
    }
}

struct CommunityDisabledSectionView: View {
    let section: String

    var body: some View {
        EmptyStateView(
            title: String(localized: "community.disabled.title", defaultValue: "Раздел временно отключён"),
            symbol: "nosign",
            hint: String(
                localized: "community.disabled.hint",
                defaultValue: "Раздел «\(CommunityText.section(section))» выключила команда платформы. Загляните позже."
            )
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
        .navigationTitle(Text(CommunityText.section(section)))
    }
}

// MARK: - Кнопка создания

extension View {
    /// Плавающая кнопка создания, если роли действие доступно: `.floatingAction` без
    /// ветвлений в каждом экране соцчасти.
    @ViewBuilder
    func communityFloatingAction(_ isShown: Bool, _ title: String, symbol: String = "plus", action: @escaping () -> Void) -> some View {
        if isShown {
            floatingAction(title, symbol: symbol, action: action)
        } else {
            self
        }
    }
}

// MARK: - Выбор человека

/// Поиск человека по имени или логину — для упоминания, адресата, доступа к документу.
struct CommunityPersonPicker: View {
    let title: String
    let pick: (SearchResultsDTO.Person) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var people: [SearchResultsDTO.Person] = []
    @State private var isSearching = false
    /// Поиск не удался — не «Никого не нашли».
    @State private var failure: String?
    @State private var isOffline = false

    var body: some View {
        NavigationStack {
            List(people) { person in
                Button {
                    pick(person)
                    dismiss()
                } label: {
                    PersonRow(
                        name: person.name,
                        subtitle: person.username.map { "@\($0)" },
                        avatarURL: person.avatarUrl,
                        size: 36
                    )
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if people.isEmpty {
                    if isSearching {
                        LoadingStateView()
                    } else if let failure {
                        ErrorStateView(message: failure, isOffline: isOffline) { await search(query) }
                    } else {
                        ContentUnavailableView(
                            query.count < 2
                                ? String(localized: "search.hint", defaultValue: "Введите хотя бы две буквы")
                                : String(localized: "search.empty", defaultValue: "Никого не нашли"),
                            systemImage: "person.crop.circle.badge.questionmark"
                        )
                    }
                }
            }
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(String(localized: "search.people", defaultValue: "Имя или логин"))
            )
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .task(id: query) {
                failure = nil
                guard query.trimmingCharacters(in: .whitespaces).count >= 2 else {
                    people = []
                    isSearching = false
                    return
                }
                isSearching = true
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                await search(query)
            }
        }
    }

    /// Запрос поиска. Ответ на устаревший запрос (человек допечатал) отбрасывается.
    @MainActor
    private func search(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else { return }
        isSearching = true
        do {
            let found = try await FeedAPI().search(trimmed).people
            guard !Task.isCancelled else { return }
            people = found ?? []
            failure = nil
        } catch {
            // Отменил новый ввод — его запрос и решит, что показать. Оборванное соединение
            // без отмены задачи — не повод крутить поиск вечно.
            guard !Task.isCancelled else { return }
            if error is CancellationError {
                isSearching = false
                return
            }
            people = []
            failure = error.userMessage
            isOffline = error.isOffline
        }
        isSearching = false
    }
}

// MARK: - Подписи

enum CommunityText {
    static func section(_ key: String) -> String {
        switch key {
        case "chats": return String(localized: "community.section.chats", defaultValue: "Чаты")
        case "events": return String(localized: "community.section.events", defaultValue: "События")
        case "documents": return String(localized: "community.section.documents", defaultValue: "Документы")
        case "applications": return String(localized: "community.section.applications", defaultValue: "Заявки")
        case "portfolio": return String(localized: "community.section.portfolio", defaultValue: "Портфолио")
        case "career": return String(localized: "community.section.career", defaultValue: "Карьера")
        default: return key
        }
    }

    static func audience(_ raw: String) -> String {
        switch raw {
        case "ALL": return String(localized: "community.audience.all", defaultValue: "Все")
        case "UNIVERSITY": return String(localized: "community.audience.university", defaultValue: "Весь вуз")
        case "FACULTY": return String(localized: "community.audience.faculty", defaultValue: "Факультет")
        case "GROUP": return String(localized: "community.audience.group", defaultValue: "Группа")
        case "SUBJECT": return String(localized: "community.audience.subject", defaultValue: "Дисциплина")
        case "TEACHERS": return String(localized: "community.audience.teachers", defaultValue: "Преподаватели")
        case "PERSONAL": return String(localized: "community.audience.personal", defaultValue: "Лично человеку")
        case "COMPANY": return String(localized: "community.audience.company", defaultValue: "Страница компании")
        default: return raw
        }
    }

    static func audienceSymbol(_ raw: String) -> String {
        switch raw {
        case "ALL": return "globe"
        case "UNIVERSITY": return "building.columns"
        case "FACULTY": return "building.2"
        case "GROUP": return "person.3"
        case "SUBJECT": return "book"
        case "TEACHERS": return "person.crop.rectangle.stack"
        case "PERSONAL": return "lock"
        default: return "person.2"
        }
    }

    static func documentType(_ id: String, label: String? = nil) -> String {
        if let label, !label.isEmpty { return label }
        switch id {
        case "ID_CARD": return String(localized: "community.docType.idCard", defaultValue: "Удостоверение личности")
        case "PASSPORT": return String(localized: "community.docType.passport", defaultValue: "Паспорт")
        case "BIRTH_CERTIFICATE": return String(localized: "community.docType.birth", defaultValue: "Свидетельство о рождении")
        case "PHOTO_3X4": return String(localized: "community.docType.photo", defaultValue: "Фото 3×4")
        case "NAME_CHANGE": return String(localized: "community.docType.nameChange", defaultValue: "Смена ФИО")
        case "LEGAL_GUARDIAN": return String(localized: "community.docType.guardian", defaultValue: "Документы опекуна")
        case "SCHOOL_CERTIFICATE": return String(localized: "community.docType.school", defaultValue: "Аттестат")
        case "DIPLOMA": return String(localized: "community.docType.diploma", defaultValue: "Диплом")
        case "DIPLOMA_SUPPLEMENT": return String(localized: "community.docType.supplement", defaultValue: "Приложение к диплому")
        case "TRANSCRIPT": return String(localized: "community.docType.transcript", defaultValue: "Транскрипт")
        case "CERTIFICATES": return String(localized: "community.docType.certificates", defaultValue: "Сертификаты")
        case "ACADEMIC_REFERENCE": return String(localized: "community.docType.academicRef", defaultValue: "Академическая справка")
        case "TRANSFER_DOCS": return String(localized: "community.docType.transfer", defaultValue: "Документы о переводе")
        case "MEDICAL": return String(localized: "community.docType.medical", defaultValue: "Медицинская справка")
        case "STUDY_PLACE": return String(localized: "community.docType.studyPlace", defaultValue: "Справка с места учёбы")
        case "DORMITORY_DOCS": return String(localized: "community.docType.dormitory", defaultValue: "Документы для общежития")
        case "MILITARY_DOCS": return String(localized: "community.docType.military", defaultValue: "Воинский учёт")
        case "SOCIAL_REFERENCE": return String(localized: "community.docType.social", defaultValue: "Социальная справка")
        case "BENEFITS_DOCS": return String(localized: "community.docType.benefits", defaultValue: "Документы на льготы")
        case "STUDY_CONTRACT": return String(localized: "community.docType.contract", defaultValue: "Договор на обучение")
        case "ENROLLMENT_ORDER": return String(localized: "community.docType.enrollment", defaultValue: "Приказ о зачислении")
        case "STUDENT_ID": return String(localized: "community.docType.studentId", defaultValue: "Студенческий билет")
        case "CAMPUS_PASS": return String(localized: "community.docType.campusPass", defaultValue: "Пропуск в кампус")
        case "STUDY_PLACE_REF": return String(localized: "community.docType.studyPlaceRef", defaultValue: "Справка вуза о месте учёбы")
        case "TRANSCRIPT_ISSUED": return String(localized: "community.docType.transcriptIssued", defaultValue: "Транскрипт от вуза")
        default: return id
        }
    }

    static func documentCategory(_ raw: String) -> String {
        switch raw {
        case "PERSONAL": return String(localized: "community.docCategory.personal", defaultValue: "Личные")
        case "ACADEMIC": return String(localized: "community.docCategory.academic", defaultValue: "Учебные")
        case "CERTIFICATE": return String(localized: "community.docCategory.certificate", defaultValue: "Справки")
        case "ISSUED_BY_UNIVERSITY": return String(localized: "community.docCategory.issued", defaultValue: "Выданные вузом")
        default: return raw
        }
    }

    static func documentStatus(_ raw: String?) -> (text: String, tint: Color)? {
        guard let raw else { return nil }
        switch raw {
        case "DRAFT": return (String(localized: "community.docStatus.draft", defaultValue: "Черновик"), Palette.mutedForeground)
        case "UPLOADED": return (String(localized: "community.docStatus.uploaded", defaultValue: "Загружен"), Palette.info)
        case "IN_REVIEW": return (String(localized: "community.docStatus.review", defaultValue: "На проверке"), Palette.warning)
        case "VERIFIED": return (String(localized: "community.docStatus.verified", defaultValue: "Проверен"), Palette.success)
        case "ACCEPTED": return (String(localized: "community.docStatus.accepted", defaultValue: "Принят"), Palette.success)
        case "REJECTED": return (String(localized: "community.docStatus.rejected", defaultValue: "Отклонён"), Palette.destructive)
        case "NEEDS_REPLACEMENT": return (String(localized: "community.docStatus.replace", defaultValue: "Нужна замена"), Palette.destructive)
        case "EXPIRING": return (String(localized: "community.docStatus.expiring", defaultValue: "Скоро истекает"), Palette.warning)
        case "EXPIRED": return (String(localized: "community.docStatus.expired", defaultValue: "Истёк"), Palette.destructive)
        case "ARCHIVED": return (String(localized: "community.docStatus.archived", defaultValue: "В архиве"), Palette.mutedForeground)
        case "PENDING": return (String(localized: "community.docStatus.pending", defaultValue: "Ждёт проверки"), Palette.warning)
        case "REPLACEMENT_REQUIRED": return (String(localized: "community.docStatus.replace", defaultValue: "Нужна замена"), Palette.destructive)
        case "SUBMITTED": return (String(localized: "community.docStatus.submitted", defaultValue: "Отправлено"), Palette.info)
        case "PARTIAL": return (String(localized: "community.docStatus.partial", defaultValue: "Принято частично"), Palette.warning)
        case "OPEN": return (String(localized: "community.docStatus.open", defaultValue: "Открыт"), Palette.info)
        case "CLOSED": return (String(localized: "community.docStatus.closed", defaultValue: "Закрыт"), Palette.mutedForeground)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func grantee(_ raw: String) -> String {
        switch raw {
        case "UNIVERSITY": return String(localized: "community.grantee.university", defaultValue: "Вуз")
        case "DEPARTMENT": return String(localized: "community.grantee.department", defaultValue: "Факультет")
        case "USER": return String(localized: "community.grantee.user", defaultValue: "Человек")
        default: return raw
        }
    }

    static func meetingProvider(_ raw: String?) -> String {
        switch raw {
        case "ZOOM": return "Zoom"
        case "GOOGLE_MEET": return "Google Meet"
        case "TEAMS": return "Microsoft Teams"
        default: return String(localized: "community.event.online", defaultValue: "Онлайн")
        }
    }
}

// MARK: - Файл с устройства

/// Файл, выбранный в «Файлах» или в галерее: данные, тип, имя.
struct CommunityPickedFile: Equatable {
    let data: Data
    let mime: String
    let filename: String

    /// Из системного выбора файла. Доступ к файлу вне песочницы открывается на время чтения.
    static func read(_ url: URL) throws -> CommunityPickedFile {
        let data = try PickedFile.readNow(url)
        let type = UTType(filenameExtension: url.pathExtension)
        let mime = type?.preferredMIMEType ?? "application/octet-stream"
        return CommunityPickedFile(data: data, mime: mime, filename: url.lastPathComponent)
    }
}

// MARK: - Текст статьи

/// Markdown статьи по абзацам: заголовки `#`, списки, цитаты и обычный текст с
/// разметкой внутри строки. Полного движка Markdown в SwiftUI нет, а статье хватает этого.
///
/// Вёрстка — для чтения длинного текста: межстрочный воздух, заметные промежутки между
/// блоками, заголовки отбиты сверху сильнее, чем снизу, — так видно, к чему они относятся.
struct CommunityMarkdownView: View {
    let source: String

    /// Межстрочный интервал текста: системный для `body` плотный, рассчитан на строки
    /// списков, а не на абзацы статьи.
    private static let leading: CGFloat = 4

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }

    private enum Block {
        case heading(String, level: Int)
        /// Подряд идущие пункты — один блок: между ними зазор меньше, чем между абзацами.
        case bullets([String])
        /// Подряд идущие строки `>` — одна цитата, а не стопка отдельных плашек.
        case quote([String])
        case paragraph(String)
        case code(String)
    }

    private var blocks: [Block] {
        var result: [Block] = []
        var paragraph: [String] = []
        var code: [String]?
        func flush() {
            if !paragraph.isEmpty {
                result.append(.paragraph(paragraph.joined(separator: "\n")))
                paragraph = []
            }
        }
        for raw in source.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                if let lines = code {
                    result.append(.code(lines.joined(separator: "\n")))
                    code = nil
                } else {
                    flush()
                    code = []
                }
                continue
            }
            if code != nil {
                code?.append(raw)
                continue
            }
            if line.isEmpty {
                flush()
            } else if line.hasPrefix("#") {
                flush()
                let level = line.prefix { $0 == "#" }.count
                result.append(.heading(line.drop { $0 == "#" }.trimmingCharacters(in: .whitespaces), level: level))
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
                flush()
                let item = String(line.dropFirst(2))
                if case .bullets(let items) = result.last {
                    result[result.count - 1] = .bullets(items + [item])
                } else {
                    result.append(.bullets([item]))
                }
            } else if line.hasPrefix(">") {
                flush()
                let text = line.drop { $0 == ">" }.trimmingCharacters(in: .whitespaces)
                if case .quote(let lines) = result.last {
                    result[result.count - 1] = .quote(lines + [text])
                } else {
                    result.append(.quote([text]))
                }
            } else {
                paragraph.append(line)
            }
        }
        if let code { result.append(.code(code.joined(separator: "\n"))) }
        flush()
        return result
    }

    @ViewBuilder
    private func blockView(_ block: Block) -> some View {
        switch block {
        case .heading(let text, let level):
            Text(RichText.attributed(text))
                .font(level <= 1 ? .title2.weight(.bold) : level == 2 ? .title3.weight(.semibold) : .headline)
                .foregroundStyle(Palette.foreground)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, level <= 2 ? Spacing.md : Spacing.xs)
                .accessibilityAddTraits(.isHeader)
        case .bullets(let items):
            VStack(alignment: .leading, spacing: Spacing.sm) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                        Text(verbatim: "•")
                            .foregroundStyle(Palette.primary)
                            .accessibilityHidden(true)
                        Text(RichText.attributed(item))
                            .lineSpacing(Self.leading)
                            .tint(Palette.primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .font(Typography.body)
            .foregroundStyle(Palette.foreground)
            .padding(.leading, Spacing.xs)
        case .quote(let lines):
            // Полоса — наложением по высоте текста: в стеке рядом с ним гибкая фигура
            // не знала бы своей высоты внутри прокрутки.
            Text(RichText.attributed(lines.joined(separator: "\n")))
                .font(Typography.body.italic())
                .foregroundStyle(Palette.foreground.opacity(0.8))
                .lineSpacing(Self.leading)
                .tint(Palette.primary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, Spacing.md)
                .padding(.leading, Spacing.xl)
                .padding(.trailing, Spacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.primary.opacity(0.08))
                .overlay(alignment: .leading) {
                    Palette.primary
                        .frame(width: 3)
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        case .paragraph(let text):
            Text(RichText.attributed(text))
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                .lineSpacing(Self.leading)
                .tint(Palette.primary)
                .fixedSize(horizontal: false, vertical: true)
        case .code(let text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(verbatim: text)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Palette.foreground)
                    .padding(Spacing.lg)
            }
            .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        }
    }
}

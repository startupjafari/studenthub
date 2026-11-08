import SwiftUI
import UIKit
import UniformTypeIdentifiers

// Кирпичи, общие для экранов сотрудников вуза: подписи справочников документов, ввод
// короткого текста перед действием, выбор файла, отдача файла в «Поделиться».

// MARK: - Подписи справочника документов

/// Типы, категории и поля документов, действия журнала — те же подписи, что в вебе
/// (`Documents.docType_*`, `docCat_*`, `dt_field_*`, `evt_*`).
enum StaffDocText {
    static func typeTitle(_ id: String) -> String {
        switch id {
        case "ID_CARD": return String(localized: "staff.docType.idCard", defaultValue: "Удостоверение личности")
        case "PASSPORT": return String(localized: "staff.docType.passport", defaultValue: "Паспорт")
        case "BIRTH_CERTIFICATE": return String(localized: "staff.docType.birthCertificate", defaultValue: "Свидетельство о рождении")
        case "PHOTO_3X4": return String(localized: "staff.docType.photo", defaultValue: "Фотография 3×4")
        case "NAME_CHANGE": return String(localized: "staff.docType.nameChange", defaultValue: "Смена фамилии")
        case "LEGAL_GUARDIAN": return String(localized: "staff.docType.guardian", defaultValue: "Документы законного представителя")
        case "SCHOOL_CERTIFICATE": return String(localized: "staff.docType.school", defaultValue: "Аттестат")
        case "DIPLOMA": return String(localized: "staff.docType.diploma", defaultValue: "Диплом")
        case "DIPLOMA_SUPPLEMENT": return String(localized: "staff.docType.diplomaSupplement", defaultValue: "Приложение к диплому")
        case "TRANSCRIPT", "TRANSCRIPT_ISSUED": return String(localized: "staff.docType.transcript", defaultValue: "Транскрипт")
        case "CERTIFICATES": return String(localized: "staff.docType.certificates", defaultValue: "Сертификаты")
        case "ACADEMIC_REFERENCE": return String(localized: "staff.docType.academicReference", defaultValue: "Академическая справка")
        case "TRANSFER_DOCS": return String(localized: "staff.docType.transfer", defaultValue: "Документы о переводе")
        case "MEDICAL": return String(localized: "staff.docType.medical", defaultValue: "Медицинская справка")
        case "STUDY_PLACE", "STUDY_PLACE_REF": return String(localized: "staff.docType.studyPlace", defaultValue: "Справка с места учёбы")
        case "DORMITORY_DOCS": return String(localized: "staff.docType.dormitory", defaultValue: "Документы для общежития")
        case "MILITARY_DOCS": return String(localized: "staff.docType.military", defaultValue: "Документы для военкомата")
        case "SOCIAL_REFERENCE": return String(localized: "staff.docType.social", defaultValue: "Социальная справка")
        case "BENEFITS_DOCS": return String(localized: "staff.docType.benefits", defaultValue: "Документы для льгот")
        case "STUDY_CONTRACT": return String(localized: "staff.docType.contract", defaultValue: "Договор на обучение")
        case "ENROLLMENT_ORDER": return String(localized: "staff.docType.enrollment", defaultValue: "Приказ о зачислении")
        case "STUDENT_ID": return String(localized: "staff.docType.studentId", defaultValue: "Студенческий билет")
        case "CAMPUS_PASS": return String(localized: "staff.docType.campusPass", defaultValue: "Пропуск")
        default: return id
        }
    }

    static let categories = ["PERSONAL", "ACADEMIC", "CERTIFICATE", "ISSUED_BY_UNIVERSITY"]

    static func category(_ raw: String) -> String {
        switch raw {
        case "PERSONAL": return String(localized: "staff.docCat.personal", defaultValue: "Личные")
        case "ACADEMIC": return String(localized: "staff.docCat.academic", defaultValue: "Учебные")
        case "CERTIFICATE": return String(localized: "staff.docCat.certificate", defaultValue: "Справки")
        case "ISSUED_BY_UNIVERSITY": return String(localized: "staff.docCat.issued", defaultValue: "Выданные университетом")
        default: return raw
        }
    }

    static let fields = ["number", "issuedAt", "expiresAt", "issuedBy", "comment"]

    static func field(_ raw: String) -> String {
        switch raw {
        case "number": return String(localized: "staff.docField.number", defaultValue: "Номер")
        case "issuedAt": return String(localized: "staff.docField.issuedAt", defaultValue: "Дата выдачи")
        case "expiresAt": return String(localized: "staff.docField.expiresAt", defaultValue: "Действителен до")
        case "issuedBy": return String(localized: "staff.docField.issuedBy", defaultValue: "Кем выдан")
        case "comment": return String(localized: "staff.docField.comment", defaultValue: "Комментарий")
        default: return raw
        }
    }

    static let journalActions = [
        "UPLOAD", "VIEW", "DOWNLOAD", "EDIT", "REPLACE", "PAGE_ADD", "PAGE_REMOVE", "GRANT", "REVOKE",
        "SUBMIT", "REVIEW", "ACCEPT", "REJECT", "ARCHIVE", "DELETE", "EXPIRING", "EXPIRE",
    ]

    static func action(_ raw: String) -> String {
        switch raw {
        case "UPLOAD": return String(localized: "staff.docEvent.upload", defaultValue: "Загрузка")
        case "VIEW": return String(localized: "staff.docEvent.view", defaultValue: "Просмотр")
        case "DOWNLOAD": return String(localized: "staff.docEvent.download", defaultValue: "Скачивание")
        case "EDIT": return String(localized: "staff.docEvent.edit", defaultValue: "Изменение")
        case "REPLACE": return String(localized: "staff.docEvent.replace", defaultValue: "Замена версии")
        case "GRANT": return String(localized: "staff.docEvent.grant", defaultValue: "Предоставление доступа")
        case "REVOKE": return String(localized: "staff.docEvent.revoke", defaultValue: "Отзыв доступа")
        case "REVIEW": return String(localized: "staff.docEvent.review", defaultValue: "Проверка")
        case "ACCEPT": return String(localized: "staff.docEvent.accept", defaultValue: "Принят")
        case "REJECT": return String(localized: "staff.docEvent.reject", defaultValue: "Отклонён")
        case "ARCHIVE": return String(localized: "staff.docEvent.archive", defaultValue: "Архивирование")
        case "UNARCHIVE": return String(localized: "staff.docEvent.unarchive", defaultValue: "Возврат из архива")
        case "DELETE": return String(localized: "staff.docEvent.delete", defaultValue: "Удаление")
        case "PAGE_ADD": return String(localized: "staff.docEvent.pageAdd", defaultValue: "Добавление страниц")
        case "PAGE_REMOVE": return String(localized: "staff.docEvent.pageRemove", defaultValue: "Удаление страницы")
        case "SUBMIT": return String(localized: "staff.docEvent.submit", defaultValue: "Отправка по запросу")
        case "EXPIRING": return String(localized: "staff.docEvent.expiring", defaultValue: "Скоро истекает")
        case "EXPIRE": return String(localized: "staff.docEvent.expire", defaultValue: "Срок истёк")
        default: return raw
        }
    }
}

/// Подпись роли по коду сервера; неизвестное — как есть.
enum StaffRoleText {
    static func title(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        let role = Role(rawValue: raw) ?? .unknown
        return role == .unknown ? raw : role.title
    }
}

// MARK: - Ввод текста перед действием

/// Что спросить у сотрудника перед действием: причину, комментарий, место выдачи, код.
struct StaffTextPrompt: Identifiable {
    let id = UUID()
    let title: String
    var message: String?
    var placeholder: String = ""
    var multiline = false
    var required = true
    /// Цифровая клавиатура — для сроков и количеств.
    var numeric = false
    /// Что уже введено: правка значения, а не ввод с нуля.
    var initial = ""
    var actionTitle: String = String(localized: "staff.prompt.submit", defaultValue: "Подтвердить")
    let run: (String) async throws -> Void
}

/// Лист с одним полем: ошибка сервера остаётся над полем, лист не закрывается.
struct StaffTextPromptSheet: View {
    let prompt: StaffTextPrompt
    var done: () async -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var failure: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    if prompt.multiline {
                        TextField(prompt.placeholder, text: $text, axis: .vertical)
                            .lineLimit(3...8)
                    } else {
                        TextField(prompt.placeholder, text: $text)
                            .keyboardType(prompt.numeric ? .numberPad : .default)
                    }
                } footer: {
                    if let message = prompt.message { Text(message) }
                }
            }
            .onAppear { if text.isEmpty { text = prompt.initial } }
            .navigationTitle(Text(prompt.title))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(prompt.actionTitle) { Task { await run() } }
                            .disabled(prompt.required && trimmed.isEmpty)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    @MainActor
    private func run() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await prompt.run(trimmed)
            await done()
            dismiss()
        } catch {
            failure = StaffErrorText.message(error)
        }
    }
}

/// Текст ошибки: свой текст экрана (`StaffMessageError`) или общий разбор.
enum StaffErrorText {
    static func message(_ error: Error) -> String {
        if let own = error as? StaffMessageError { return own.message }
        return error.userMessage
    }
}

/// Ошибка с готовым текстом для человека — когда код сервера здесь значит другое.
struct StaffMessageError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

// MARK: - Файлы

/// Выбранный файл: содержимое, имя и тип.
struct StaffPickedFile {
    let data: Data
    let name: String
    let mime: String

    /// Файл из «Файлов» читается только внутри доступа к защищённому ресурсу.
    static func read(_ result: Result<URL, Error>) -> StaffPickedFile? {
        guard case .success(let url) = result else { return nil }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return nil }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        return StaffPickedFile(data: data, name: url.lastPathComponent, mime: mime)
    }

    /// Сохранить полученные байты во временный файл — его отдают в «Поделиться» или
    /// в системный просмотр.
    static func temporary(_ data: Data, name: String) throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let safe = name.replacingOccurrences(of: "/", with: "-")
        let url = folder.appending(path: safe.isEmpty ? "file" : safe)
        try data.write(to: url)
        return url
    }
}

/// Системный лист «Поделиться»: сохранить в «Файлы», отправить, напечатать.
struct StaffActivitySheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

extension UTType {
    /// DOCX — тип по расширению: системного константного у него нет.
    static var staffDocx: UTType {
        UTType(filenameExtension: "docx") ?? .data
    }

    static var staffXlsx: UTType {
        UTType(filenameExtension: "xlsx") ?? .data
    }
}

// MARK: - Мелкие строки

/// Строка «подпись — значение» в одну линию: для счётчиков и настроек.
struct StaffValueRow: View {
    let title: String
    let value: String
    var tint: Color = Palette.mutedForeground

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).foregroundStyle(Palette.foreground)
            Spacer(minLength: Spacing.md)
            Text(value)
                .foregroundStyle(tint)
                .multilineTextAlignment(.trailing)
        }
        .font(Typography.body)
        .accessibilityElement(children: .combine)
    }
}

/// Кнопка-ссылка внутри строки списка: без неё нажатие уходит всей строке.
struct StaffInlineButton: View {
    let title: String
    let symbol: String
    var role: ButtonRole?
    let action: () -> Void

    var body: some View {
        Button(role: role, action: action) {
            Label(title, systemImage: symbol)
                .font(Typography.meta.weight(.semibold))
        }
        .glassButton()
        .controlSize(.small)
    }
}

/// Даты для параметров `YYYY-MM-DD` — по календарю устройства.
enum StaffDay {
    static func string(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}

/// `FormSheet` со своим текстом ошибки: экран может бросить `StaffMessageError`, когда код
/// сервера в этом месте значит конкретное («номер занят», «экземпляр выдан»).
struct StaffFormSheet<Content: View>: View {
    let title: String
    var saveTitle: String = String(localized: "common.save", defaultValue: "Сохранить")
    var canSave: Bool = true
    let save: () async throws -> Void
    var saved: () async -> Void = {}
    @ViewBuilder let content: () -> Content

    @Environment(\.dismiss) private var dismiss
    @State private var failure: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                content()
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(saveTitle) { Task { await run() } }
                            .disabled(!canSave)
                    }
                }
            }
        }
    }

    @MainActor
    private func run() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await save()
            await saved()
            dismiss()
        } catch {
            failure = StaffErrorText.message(error)
        }
    }
}

import SwiftUI

// Подписи и разбор, общие для экранов охраны. Значения перечислений сервера приходят
// строкой: незнакомое показывается как есть, а не роняет экран.

enum SecurityText {
    static func denyReason(_ raw: String?) -> String {
        switch raw {
        case "STATUS": return String(localized: "security.deny.status", defaultValue: "Не учится: отчислен, выпускник или переведён")
        case "BLOCKED": return String(localized: "security.deny.blocked", defaultValue: "Аккаунт заблокирован")
        case "OTHER_UNIVERSITY": return String(localized: "security.deny.otherUniversity", defaultValue: "Студент другого вуза")
        case "INVALID_QR": return String(localized: "security.deny.invalidQR", defaultValue: "Недействительный QR")
        case "EXPIRED_QR": return String(localized: "security.deny.expiredQR", defaultValue: "QR истёк")
        case "REUSED_QR": return String(localized: "security.deny.reusedQR", defaultValue: "QR уже проверен — скриншот")
        case .some(let value): return value
        case .none: return String(localized: "security.denied", defaultValue: "Отказ")
        }
    }

    static let documentTypes = ["ID_CARD", "PASSPORT", "DRIVER_LICENSE", "OTHER"]

    static func documentType(_ raw: String) -> String {
        switch raw {
        case "ID_CARD": return String(localized: "security.doc.idCard", defaultValue: "Удостоверение личности")
        case "PASSPORT": return String(localized: "security.doc.passport", defaultValue: "Паспорт")
        case "DRIVER_LICENSE": return String(localized: "security.doc.driverLicense", defaultValue: "Водительские права")
        case "OTHER": return String(localized: "security.doc.other", defaultValue: "Другой")
        default: return raw
        }
    }

    static func roomKind(_ raw: String) -> String {
        switch raw {
        case "AUDITORIUM": return String(localized: "security.roomKind.auditorium", defaultValue: "Аудитория")
        case "LAB": return String(localized: "security.roomKind.lab", defaultValue: "Лаборатория")
        case "SPORT_HALL": return String(localized: "security.roomKind.sportHall", defaultValue: "Спортзал")
        case "LIBRARY": return String(localized: "security.roomKind.library", defaultValue: "Библиотека")
        case "ASSEMBLY_HALL": return String(localized: "security.roomKind.assemblyHall", defaultValue: "Актовый зал")
        case "ADMIN_OFFICE": return String(localized: "security.roomKind.adminOffice", defaultValue: "Административный кабинет")
        case "DEAN_OFFICE": return String(localized: "security.roomKind.deanOffice", defaultValue: "Деканат")
        case "ACCOUNTING": return String(localized: "security.roomKind.accounting", defaultValue: "Бухгалтерия")
        case "CANTEEN": return String(localized: "security.roomKind.canteen", defaultValue: "Столовая")
        case "DORMITORY": return String(localized: "security.roomKind.dormitory", defaultValue: "Общежитие")
        case "OTHER": return String(localized: "security.roomKind.other", defaultValue: "Другое")
        default: return raw
        }
    }

    static func cameraStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "ONLINE": return (String(localized: "security.camera.online", defaultValue: "В сети"), Palette.success)
        case "OFFLINE": return (String(localized: "security.camera.offline", defaultValue: "Не в сети"), Palette.mutedForeground)
        case "AUTH_FAILED": return (String(localized: "security.camera.authFailed", defaultValue: "Ошибка входа"), Palette.destructive)
        default: return (String(localized: "security.camera.unknown", defaultValue: "Неизвестно"), Palette.mutedForeground)
        }
    }

    /// Время записи журнала: сегодняшнее — только часы, более раннее — с датой.
    static func journalTime(_ date: Date) -> String {
        if Calendar.current.isDateInToday(date) {
            return date.formatted(.dateTime.hour().minute())
        }
        return date.formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }

    /// «ГГГГ-ММ-ДД» по календарю телефона — фильтр журнала по дню.
    static func dayString(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}

/// Что за QR StudentHub перед камерой — как `parseQrTarget` в вебе. Домен не сверяем,
/// сверяем путь: ссылки в QR собираются из разных адресов, а переход всё равно
/// собирается заново внутри приложения.
enum SecurityQRTarget: Equatable {
    case studentID(token: String)
    case room(code: String)
    case login
    case other

    private static let codeAlphabet = Set("23456789ABCDEFGHJKMNPQRSTUVWXYZ")

    static func parse(_ raw: String) -> SecurityQRTarget {
        guard
            let components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
            let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http"
        else { return .other }
        var path = components.path
        while path.count > 1, path.hasSuffix("/") { path.removeLast() }
        let token = components.queryItems?.first(where: { $0.name == "t" })?.value
        switch path {
        case "/verify-id":
            if let token, !token.isEmpty, token.count <= 2048 { return .studentID(token: token) }
            return .other
        case "/qr":
            return token?.isEmpty == false ? .login : .other
        default:
            break
        }
        let segments = path.split(separator: "/").map(String.init)
        if segments.count == 2, segments[0] == "r", isReadableCode(segments[1]) {
            return .room(code: segments[1])
        }
        return .other
    }

    /// Код помещения из ручного ввода: «ABCD-EFGH», «abcd efgh» или ссылка с наклейки.
    static func roomCode(fromInput raw: String) -> String? {
        if case .room(let code) = parse(raw) { return code }
        let cleaned = raw.uppercased().filter { !$0.isWhitespace && $0 != "-" }
        return isReadableCode(cleaned) ? cleaned : nil
    }

    static func isReadableCode(_ value: String) -> Bool {
        value.count == 8 && value.allSatisfy { codeAlphabet.contains($0) }
    }
}

/// Плашка «Пропущен / отказ» и прочие короткие статусы на экранах охраны.
struct SecurityBadge: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .lineLimit(2)
            .multilineTextAlignment(.trailing)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, 2)
            .foregroundStyle(tint)
            .background(tint.opacity(0.12), in: Capsule())
    }
}

/// Строка прохода студента в журнале — как строка чата: аватар с отметкой «пропущен /
/// отказ», ФИО, время справа, группа и причина отказа ниже.
struct SecurityPassRow: View {
    let pass: SecurityPassDTO

    var body: some View {
        let tint = pass.allowed ? Palette.success : Palette.destructive
        TelegramStyleRow(
            title: pass.student?.name ?? String(localized: "security.unknownStudent", defaultValue: "Не установлен"),
            subtitle: subtitle,
            meta: SecurityText.journalTime(pass.createdAt)
        ) {
            ZStack(alignment: .bottomTrailing) {
                if let student = pass.student {
                    AvatarView(url: nil, name: student.name, size: 44)
                } else {
                    RowSymbol(symbol: "person.fill.questionmark", tint: TileTint.gray)
                }
                Image(systemName: pass.allowed ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, tint)
                    .background(Circle().fill(Palette.background).padding(-2))
                    .offset(x: 3, y: 3)
                    .accessibilityHidden(true)
            }
        } accessory: {
            StatusBadge(
                text: pass.allowed
                    ? String(localized: "security.allowed", defaultValue: "Пропущен")
                    : String(localized: "security.denied", defaultValue: "Отказ"),
                tint: tint
            )
        }
    }

    /// Группа и охранник; у отказа первой строкой — причина: её ищут глазами.
    private var subtitle: String {
        let meta = [pass.student?.group, pass.guardName]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        guard !pass.allowed else { return meta }
        let reason = SecurityText.denyReason(pass.denyReason)
        return meta.isEmpty ? reason : "\(reason)\n\(meta)"
    }
}

/// Строка посетителя: кто, зачем, когда вошёл и вышел. `onExit` — кнопка «Вышел»
/// прямо в строке, пока человек в здании.
struct SecurityVisitorRow: View {
    let visitor: SecurityVisitorDTO
    var isExiting = false
    var onExit: (() -> Void)?

    var body: some View {
        TelegramStyleRow(
            title: visitor.fullName,
            subtitle: subtitle,
            meta: SecurityText.journalTime(visitor.enteredAt)
        ) {
            AvatarView(url: nil, name: visitor.fullName, size: 44)
        } accessory: {
            if visitor.exitedAt == nil {
                if let onExit {
                    if isExiting {
                        ProgressView()
                    } else {
                        Button(action: onExit) {
                            Label(String(localized: "security.markExit", defaultValue: "Вышел"), systemImage: "door.left.hand.open")
                                .font(Typography.meta.weight(.semibold))
                        }
                        .buttonStyle(.borderless)
                        .glassButton()
                        .controlSize(.small)
                    }
                } else {
                    StatusBadge(text: String(localized: "security.stillInside", defaultValue: "В здании"), tint: Palette.info)
                }
            }
        }
        .accessibilityActions {
            if visitor.exitedAt == nil, let onExit, !isExiting {
                Button(String(localized: "security.markExit", defaultValue: "Вышел"), action: onExit)
            }
        }
    }

    /// Первая строка — цель визита, вторая — выход, документ, телефон, кто записал.
    private var subtitle: String {
        let exited = visitor.exitedAt.map {
            String(localized: "security.visitor.exited", defaultValue: "Выход: \(SecurityText.journalTime($0))")
        }
        let document = visitor.documentType.map { type in
            [SecurityText.documentType(type), visitor.documentLast4.map { "•••• \($0)" }]
                .compactMap { $0 }
                .joined(separator: " ")
        }
        let details = [exited, document, visitor.phone, visitor.createdByName]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        return details.isEmpty ? visitor.purpose : "\(visitor.purpose)\n\(details)"
    }
}

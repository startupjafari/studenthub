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

/// Строка прохода студента в журнале.
struct SecurityPassRow: View {
    let pass: SecurityPassDTO

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            Image(systemName: pass.allowed ? "checkmark.shield.fill" : "xmark.shield.fill")
                .font(.title3)
                .foregroundStyle(pass.allowed ? Palette.success : Palette.destructive)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(pass.student?.name ?? String(localized: "security.unknownStudent", defaultValue: "Не установлен"))
                    .font(Typography.cardTitle)
                    .foregroundStyle(pass.student == nil ? Palette.mutedForeground : Palette.foreground)
                    .lineLimit(2)
                let meta = [pass.student?.group, SecurityText.journalTime(pass.createdAt), pass.guardName]
                    .compactMap { $0 }
                    .filter { !$0.isEmpty }
                    .joined(separator: " · ")
                Text(meta)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
                if !pass.allowed {
                    Text(SecurityText.denyReason(pass.denyReason))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: Spacing.md)
            SecurityBadge(
                text: pass.allowed
                    ? String(localized: "security.allowed", defaultValue: "Пропущен")
                    : String(localized: "security.denied", defaultValue: "Отказ"),
                tint: pass.allowed ? Palette.success : Palette.destructive
            )
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Строка посетителя: кто, к кому, когда вошёл и вышел.
struct SecurityVisitorRow: View {
    let visitor: SecurityVisitorDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(visitor.fullName)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                Spacer(minLength: Spacing.md)
                if visitor.exitedAt == nil {
                    SecurityBadge(text: String(localized: "security.stillInside", defaultValue: "В здании"), tint: Palette.info)
                }
            }
            Text(visitor.purpose)
                .font(Typography.meta)
                .foregroundStyle(Palette.foreground)
                .fixedSize(horizontal: false, vertical: true)
            let entered = String(
                localized: "security.visitor.entered",
                defaultValue: "Вход: \(SecurityText.journalTime(visitor.enteredAt))"
            )
            let exited = visitor.exitedAt.map {
                String(localized: "security.visitor.exited", defaultValue: "Выход: \(SecurityText.journalTime($0))")
            }
            Text([entered, exited].compactMap { $0 }.joined(separator: " · "))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            let document = visitor.documentType.map { type in
                [SecurityText.documentType(type), visitor.documentLast4.map { "•••• \($0)" }]
                    .compactMap { $0 }
                    .joined(separator: " ")
            }
            let extra = [document, visitor.phone, visitor.createdByName].compactMap { $0 }.filter { !$0.isEmpty }
            if !extra.isEmpty {
                Text(extra.joined(separator: " · "))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

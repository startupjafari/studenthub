import SwiftUI

/// Как показать точку журнала: балл бывает дробным, тип приходит кодом из
/// `GRADE_COLUMN_KINDS`.
enum GradeFormat {
    /// «8,5 / 10» или «8,5», если у точки нет максимума. Дробь не обрезаем: 8,5 — не 8.
    static func score(_ score: Double, max: Int?, locale: Locale = .current) -> String {
        let shown = score.formatted(.number.precision(.fractionLength(0...2)).locale(locale))
        guard let max else { return shown }
        return "\(shown) / \(max)"
    }

    /// Название типа точки — как в вебе (`Gradebook.kind_*`). Незнакомый тип — без подписи.
    static func kindTitle(_ kind: String) -> String? {
        switch kind {
        case "LAB": return String(localized: "study.kindLab", defaultValue: "Лабораторная")
        case "CONTROL": return String(localized: "study.kindControl", defaultValue: "Контрольная")
        case "EXAM": return String(localized: "study.kindExam", defaultValue: "Экзамен")
        case "OTHER": return String(localized: "study.kindOther", defaultValue: "Другое")
        default: return nil
        }
    }
}

enum AttendanceStatus {
    static func title(_ status: String) -> String {
        switch status {
        case "PRESENT": return String(localized: "study.present", defaultValue: "Был")
        case "LATE": return String(localized: "study.late", defaultValue: "Опоздал")
        case "ABSENT": return String(localized: "study.absent", defaultValue: "Пропуск")
        case "EXCUSED": return String(localized: "study.excused", defaultValue: "Уважительная")
        default: return status
        }
    }

    static func symbol(_ status: String) -> String {
        switch status {
        case "ABSENT": return "xmark.circle"
        case "LATE": return "clock"
        case "EXCUSED": return "doc.text"
        default: return "checkmark.circle"
        }
    }

    static func color(_ status: String) -> Color {
        switch status {
        case "ABSENT": return Palette.destructive
        case "LATE": return Palette.warning
        case "EXCUSED": return Palette.info
        default: return Palette.success
        }
    }
}

struct EmptyRow: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Typography.body)
            .foregroundStyle(Palette.mutedForeground)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.xxl)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}

/// Склейка подписей строки: пустые и отсутствующие части пропускаются. Отдельной
/// функцией с явным типом — литерал массива опционалов внутри обобщённого вызова
/// проверяется долго.
enum StudyText {
    static func join(_ parts: [String?], separator: String = " · ") -> String {
        parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: separator)
    }

    /// «Срок: 12 нояб., 18:00».
    static func due(_ date: Date?) -> String? {
        guard let date else { return nil }
        let text: String = date.formatted(date: .abbreviated, time: .shortened)
        return String(localized: "courses.due", defaultValue: "Срок: \(text)")
    }

    static func dateTime(_ date: Date?) -> String? {
        guard let date else { return nil }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

/// Срок задания: прошёл ли и каким цветом его показать. Отдельно, а не выражением в
/// строке: `??` с `.distantFuture` и сравнением внутри обобщённого инициализатора
/// заметно тормозит проверку типов.
enum StudyDue {
    static func isPast(_ date: Date?, now: Date = Date()) -> Bool {
        guard let date else { return false }
        return date < now
    }

    static func tint(_ date: Date?) -> Color {
        isPast(date) ? Palette.destructive : Palette.mutedForeground
    }
}

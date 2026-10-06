import Foundation

/// Куда ведёт внешняя ссылка: пуш, уведомление или ссылка из веба.
///
/// Схема задана в Ф0 намеренно. Пуш о сообщении должен открывать сам чат, а не
/// список чатов, и прикручивать это к готовой навигации дороже, чем договориться
/// сразу: экраны Ф1–Ф4 просто добавляют свои случаи.
///
/// Разбираются две формы одного и того же: собственная схема `studenthub://chats?c=…`
/// (её кладёт в пуш сервер) и адрес веба `https://…/chats?c=…` (ссылка, которую
/// человек получил в переписке). Пути совпадают с вебом — иначе их пришлось бы
/// держать в голове в двух версиях.
enum DeepLink: Equatable {
    case tab(AppTab)
    case section(MoreSection)
    case chat(id: String)
    case post(id: String)
    case application(id: String)
    case event(id: String)
    case lesson(id: String)

    static let scheme = "studenthub"

    init?(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }

        var segments: [String]
        if components.scheme?.lowercased() == Self.scheme {
            // В `studenthub://chats?c=1` первый сегмент пути — это host.
            segments = [components.host].compactMap { $0 } + components.path.split(separator: "/").map(String.init)
        } else if components.scheme?.lowercased() == "https" || components.scheme?.lowercased() == "http" {
            segments = components.path.split(separator: "/").map(String.init)
        } else {
            return nil
        }

        // Ролевой префикс веба (`/teacher/schedule`) на телефоне не значит ничего:
        // вкладки у всех ролей одни и те же, различается наполнение.
        if segments.first == "teacher" {
            segments.removeFirst()
        }

        let query = components.queryItems ?? []
        func value(_ name: String) -> String? {
            query.first { $0.name == name }?.value?.nilIfEmpty
        }

        guard let head = segments.first else {
            self = .tab(.home)
            return
        }
        // Глубже двух сегментов адресов у нас нет: всё, что длиннее, — не наш случай.
        guard segments.count <= 2 else { return nil }
        let tail = segments.count == 2 ? segments[1] : nil

        switch (head, tail) {
        case ("chats", nil):
            self = value("c").map { DeepLink.chat(id: $0) } ?? .tab(.chats)
        case ("chats", .some(let id)):
            self = .chat(id: id)

        case ("schedule", nil):
            self = value("lesson").map { DeepLink.lesson(id: $0) } ?? .tab(.schedule)
        case ("schedule", .some(let id)):
            self = .lesson(id: id)

        // Учёба — одна вкладка на несколько разделов веба.
        case ("academic", nil), ("grades", nil), ("assignments", nil), ("attendance", nil),
            ("courses", nil), ("materials", nil), ("gradebook", nil), ("exams", nil):
            self = .tab(.study)

        case ("posts", .some(let id)):
            self = .post(id: id)

        case ("applications", nil):
            self = value("a").map { DeepLink.application(id: $0) } ?? .section(.applications)
        case ("applications", .some(let id)):
            self = .application(id: id)

        case ("events", nil):
            self = .section(.events)
        case ("events", .some(let id)):
            self = .event(id: id)

        case ("profile", nil):
            self = .section(.profile)
        case ("documents", nil):
            self = .section(.documents)
        case ("settings", nil):
            self = .section(.settings)
        case ("starosta", "classmates"), ("starosta", "group"):
            self = .section(.classmates)
        case ("starosta", "group-requests"):
            self = .section(.groupRequests)

        default:
            // Незнакомый адрес не угадываем: пусть откроется в браузере, где работает
            // полная версия. Это и путь для ролей вне MVP, и страховка на будущее —
            // старая сборка не должна «съедать» ссылку на раздел, которого в ней нет.
            return nil
        }
    }
}

extension String {
    fileprivate var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

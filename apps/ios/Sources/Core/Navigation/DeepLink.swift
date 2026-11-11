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
    /// Чужой профиль: подписка, упоминание, заявка в друзья.
    case profile(id: String)
    /// Библиотека: «Мои книги», карточка книги и QR-наклейка экземпляра.
    case myBooks
    case book(id: String)
    case bookCopy(code: String)

    static let scheme = "studenthub"

    init?(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }

        // Схему разворачиваем до switch: сопоставлять `String?` с константой нельзя.
        guard let scheme = components.scheme?.lowercased() else { return nil }

        var segments: [String] = []
        switch scheme {
        case Self.scheme:
            // В `studenthub://chats?c=1` первый сегмент пути — это host.
            if let host = components.host {
                segments.append(host)
            }
            segments += components.path.split(separator: "/").map(String.init)
        case "https", "http":
            segments = components.path.split(separator: "/").map(String.init)
        default:
            return nil
        }
        // Пустые куски убираем: у `studenthub://` host разбирается в пустую строку, а
        // «раздел с пустым именем» — это корень, то есть главная.
        segments = segments.filter { !$0.isEmpty }

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
            self = value("lesson").map { DeepLink.lesson(id: $0) } ?? .section(.schedule)
        case ("schedule", .some(let id)):
            self = .lesson(id: id)

        // Учёба — группа «Разделов» на несколько разделов веба.
        case ("academic", nil), ("grades", nil), ("assignments", nil), ("attendance", nil),
            ("courses", nil), ("materials", nil), ("gradebook", nil), ("exams", nil):
            self = .tab(.workspace)

        case ("feed", nil), ("posts", nil):
            self = .tab(.feed)
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
        case ("profile", .some(let id)):
            self = .profile(id: id)
        case ("documents", nil):
            self = .section(.documents)
        case ("settings", nil):
            self = .section(.settings)
        case ("consultations", nil):
            self = .section(.consultations)
        // Запись в деканат в вебе живёт на `/appointments`.
        case ("appointments", nil):
            self = .section(.deanery)
        case ("portfolio", nil):
            self = .section(.portfolio)
        case ("campus", nil):
            self = .section(.campusMap)
        case ("starosta", "classmates"), ("starosta", "group"):
            self = .section(.classmates)

        // Библиотека читателя. Сюда же ведут её уведомления: `data.url = "/my-books"`.
        case ("books", nil):
            self = .section(.library)
        case ("books", .some(let id)):
            self = .book(id: id)
        case ("my-books", nil):
            self = .myBooks
        // QR-наклейка экземпляра ведёт на адрес, а не содержит данные: какая это книга,
        // спросим у сервера на экране.
        case ("c", .some(let code)):
            self = .bookCopy(code: code)

        default:
            // Незнакомый адрес не угадываем: пусть откроется в браузере, где работает
            // полная версия. Это и путь для ролей вне MVP, и страховка на будущее —
            // старая сборка не должна «съедать» ссылку на раздел, которого в ней нет.
            return nil
        }
    }
}

/// Адреса соцчасти, у которых нет своего случая в `DeepLink`: вступление в чат по
/// ссылке, статья, страница вуза, друзья, карточка события, запросы документов.
///
/// Отдельный разбор, а не новые случаи `DeepLink`: роутер перебирает `DeepLink`
/// исчерпывающе, и новый случай без правки роутера сломал бы сборку. Роутер спрашивает
/// этот разбор первым (`AppRouter.open(_:for:)`) и кладёт путь в нужную вкладку.
struct CommunityDeepLink: Equatable {
    let tab: AppTab
    let routes: [AppRoute]

    init?(url: URL) {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let scheme = components.scheme?.lowercased()
        else { return nil }
        var segments: [String]
        switch scheme {
        case DeepLink.scheme:
            segments = (components.host.map { [$0] } ?? []) + components.path.split(separator: "/").map(String.init)
        case "https", "http":
            segments = components.path.split(separator: "/").map(String.init)
        default:
            return nil
        }
        segments = segments.filter { !$0.isEmpty }
        if segments.first == "teacher" { segments.removeFirst() }
        let query = components.queryItems ?? []
        func value(_ name: String) -> String? {
            query.first { $0.name == name }?.value.flatMap { $0.isEmpty ? nil : $0 }
        }
        guard let head = segments.first, segments.count <= 2 else { return nil }
        let tail = segments.count == 2 ? segments[1] : nil

        switch (head, tail) {
        // Приглашение в группу: без кода сервер не пустит, такую ссылку не разбираем.
        case ("join-chat", .some(let id)):
            guard let code = value("k") else { return nil }
            self.init(tab: .chats, routes: [.community(.joinChat(id: id, code: code))])
        case ("articles", .some(let id)):
            self.init(tab: .feed, routes: [.community(.article(id: id))])
        case ("universities", .some(let id)):
            self.init(tab: .feed, routes: [.community(.university(id: id))])
        case ("friends", _):
            self.init(tab: .feed, routes: [.community(.friends(userID: nil))])
        // Карточка события: под ней — список, чтобы «назад» вёл к событиям.
        case ("events", .some(let id)):
            self.init(tab: .workspace, routes: [.section(.events), .community(.event(id: id))])
        case ("documents", nil) where value("section") == "requests":
            self.init(tab: .workspace, routes: [.section(.documents), .community(.documentRequests)])
        default:
            return nil
        }
    }

    init(tab: AppTab, routes: [AppRoute]) {
        self.tab = tab
        self.routes = routes
    }
}

extension String {
    fileprivate var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

import SwiftUI
import UIKit

// Подписи перечислений сервера и мелкие общие куски экранов администрирования. Неизвестное
// значение показывается как есть: новый статус на сервере не должен ронять экран.

enum AdminText {
    // MARK: Жалобы

    static let complaintStatuses = ["PENDING", "REVIEWING", "RESOLVED", "DISMISSED"]
    static let priorities = ["HIGH", "MEDIUM", "LOW"]

    static func complaintStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "PENDING": return (String(localized: "admin.complaint.status.pending", defaultValue: "Новые"), Palette.info)
        case "REVIEWING": return (String(localized: "admin.complaint.status.reviewing", defaultValue: "В работе"), Palette.warning)
        case "RESOLVED": return (String(localized: "admin.complaint.status.resolved", defaultValue: "Решены"), Palette.success)
        case "DISMISSED": return (String(localized: "admin.complaint.status.dismissed", defaultValue: "Отклонены"), Palette.mutedForeground)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func priority(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "HIGH": return (String(localized: "admin.priority.high", defaultValue: "Высокий"), Palette.destructive)
        case "MEDIUM": return (String(localized: "admin.priority.medium", defaultValue: "Средний"), Palette.warning)
        case "LOW": return (String(localized: "admin.priority.low", defaultValue: "Низкий"), Palette.mutedForeground)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func target(_ raw: String) -> String {
        switch raw {
        case "POST": return String(localized: "admin.target.post", defaultValue: "Пост")
        case "STORY": return String(localized: "admin.target.story", defaultValue: "История")
        case "COMMENT": return String(localized: "admin.target.comment", defaultValue: "Комментарий")
        case "MESSAGE": return String(localized: "admin.target.message", defaultValue: "Сообщение")
        case "USER": return String(localized: "admin.target.user", defaultValue: "Пользователь")
        default: return raw
        }
    }

    // MARK: Блокировка

    /// Сроки блокировки, как в вебе: бессрочно, неделя, месяц.
    static let blockTerms: [Int] = [0, 7, 30]

    static func blockTerm(_ days: Int) -> String {
        switch days {
        case 0: return String(localized: "admin.block.forever", defaultValue: "Навсегда")
        case 7: return String(localized: "admin.block.week", defaultValue: "Неделя")
        case 30: return String(localized: "admin.block.month", defaultValue: "Месяц")
        default: return String(localized: "admin.block.days", defaultValue: "\(days.formatted()) дн.")
        }
    }

    static func blockConfirm(_ days: Int) -> String {
        days == 0
            ? String(localized: "admin.block.confirmForever", defaultValue: "Заблокировать бессрочно? Все сессии пользователя будут закрыты.")
            : String(localized: "admin.block.confirmFor", defaultValue: "Заблокировать на срок «\(blockTerm(days))»? Все сессии пользователя будут закрыты.")
    }

    // MARK: Приглашения

    static func inviteStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "PENDING": return (String(localized: "admin.invite.status.pending", defaultValue: "Ожидает"), Palette.info)
        case "USED": return (String(localized: "admin.invite.status.used", defaultValue: "Использовано"), Palette.success)
        case "EXPIRED": return (String(localized: "admin.invite.status.expired", defaultValue: "Истекло"), Palette.mutedForeground)
        case "REVOKED": return (String(localized: "admin.invite.status.revoked", defaultValue: "Отозвано"), Palette.mutedForeground)
        default: return (raw, Palette.mutedForeground)
        }
    }

    // MARK: Вузы

    static let universityStatuses = ["PENDING", "ACTIVE", "BLOCKED"]

    static func universityStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "PENDING": return (String(localized: "admin.university.status.pending", defaultValue: "Ожидает"), Palette.warning)
        case "ACTIVE": return (String(localized: "admin.university.status.active", defaultValue: "Активен"), Palette.success)
        case "BLOCKED": return (String(localized: "admin.university.status.blocked", defaultValue: "Заблокирован"), Palette.destructive)
        default: return (raw, Palette.mutedForeground)
        }
    }

    // MARK: Заявки на демо

    static let demoStatuses = ["NEW", "APPROVED", "REJECTED"]
    static let demoReasons = ["NOT_ELIGIBLE", "DUPLICATE", "INSUFFICIENT_INFO", "NO_CAPACITY", "OTHER"]

    static func demoStatus(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "PENDING_EMAIL": return (String(localized: "admin.demo.status.pendingEmail", defaultValue: "Адрес не подтверждён"), Palette.mutedForeground)
        case "NEW": return (String(localized: "admin.demo.status.new", defaultValue: "Новая"), Palette.info)
        case "APPROVED": return (String(localized: "admin.demo.status.approved", defaultValue: "Одобрена"), Palette.success)
        case "REJECTED": return (String(localized: "admin.demo.status.rejected", defaultValue: "Отклонена"), Palette.destructive)
        default: return (raw, Palette.mutedForeground)
        }
    }

    static func demoTab(_ raw: String) -> String {
        switch raw {
        case "NEW": return String(localized: "admin.demo.tab.new", defaultValue: "Новые")
        case "APPROVED": return String(localized: "admin.demo.tab.approved", defaultValue: "Одобренные")
        case "REJECTED": return String(localized: "admin.demo.tab.rejected", defaultValue: "Отклонённые")
        default: return raw
        }
    }

    /// Причина отказа — тем же текстом, что уходит заявителю в письме.
    static func demoReason(_ raw: String) -> String {
        switch raw {
        case "NOT_ELIGIBLE": return String(localized: "admin.demo.reason.notEligible", defaultValue: "Платформа рассчитана на организации высшего и среднего профессионального образования.")
        case "DUPLICATE": return String(localized: "admin.demo.reason.duplicate", defaultValue: "Заявка от этого вуза у нас уже есть — мы работаем по ней.")
        case "INSUFFICIENT_INFO": return String(localized: "admin.demo.reason.insufficient", defaultValue: "По заявке не удалось понять, от какой организации она подана.")
        case "NO_CAPACITY": return String(localized: "admin.demo.reason.noCapacity", defaultValue: "Сейчас мы не можем взять новый вуз на тестирование.")
        case "OTHER": return String(localized: "admin.demo.reason.other", defaultValue: "Сейчас мы не можем открыть доступ по этой заявке.")
        default: return raw
        }
    }

    // MARK: Поддержка

    static let supportTags = ["ACCESS", "DATA", "DOCS", "BUG", "FEATURE", "ABUSE", "OTHER"]

    static func supportTag(_ raw: String) -> String {
        switch raw {
        case "ACCESS": return String(localized: "admin.support.tag.access", defaultValue: "Доступ")
        case "DATA": return String(localized: "admin.support.tag.data", defaultValue: "Данные")
        case "DOCS": return String(localized: "admin.support.tag.docs", defaultValue: "Документы")
        case "BUG": return String(localized: "admin.support.tag.bug", defaultValue: "Ошибка")
        case "FEATURE": return String(localized: "admin.support.tag.feature", defaultValue: "Пожелание")
        case "ABUSE": return String(localized: "admin.support.tag.abuse", defaultValue: "Нарушение")
        case "OTHER": return String(localized: "admin.support.tag.other", defaultValue: "Другое")
        default: return raw
        }
    }

    // MARK: Общее

    static let all = String(localized: "admin.filter.all", defaultValue: "Все")
    static let close = String(localized: "admin.action.close", defaultValue: "Закрыть")
    static let copyLink = String(localized: "admin.action.copyLink", defaultValue: "Скопировать ссылку")
    static let share = String(localized: "admin.action.share", defaultValue: "Поделиться")
}

// MARK: - Выгрузка файлом

/// Файл выгрузки во временной папке: его отдают системному «Поделиться».
struct AdminExportedFile: Identifiable {
    let url: URL
    var id: String { url.path }

    static func write(_ data: Data, name: String) throws -> AdminExportedFile {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: name)
        try data.write(to: url)
        return AdminExportedFile(url: url)
    }
}

/// Системный лист «Поделиться» над готовым файлом: сохранить в «Файлы», отправить почтой.
struct AdminShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

// MARK: - Ссылка приглашения

/// Ссылка регистрации по токену. Адрес веба берётся из сборки; без него показываем сам
/// токен — его можно передать человеку и вставить в форму регистрации.
enum AdminInviteLink {
    static func url(token: String) -> String {
        guard let base = AppConfiguration.webBaseURL else { return token }
        var components = URLComponents(url: base.appendingPathComponent("register"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "token", value: token)]
        return components?.url?.absoluteString ?? token
    }
}

/// Карточка с только что выданной ссылкой: показывается один раз, поэтому копирование и
/// «Поделиться» — прямо здесь.
struct AdminInviteLinkSection: View {
    let link: String
    var hint: String = String(localized: "admin.invite.linkOnce", defaultValue: "Ссылка показывается один раз — скопируйте её сейчас")

    @State private var copied = false

    var body: some View {
        Section {
            Text(verbatim: link)
                .font(.callout.monospaced())
                .textSelection(.enabled)
                .foregroundStyle(Palette.foreground)
            Button {
                UIPasteboard.general.string = link
                copied = true
            } label: {
                Label(
                    copied ? String(localized: "admin.invite.copied", defaultValue: "Ссылка скопирована") : AdminText.copyLink,
                    systemImage: copied ? "checkmark" : "doc.on.doc"
                )
            }
            ShareLink(item: link) {
                Label(AdminText.share, systemImage: "square.and.arrow.up")
            }
        } header: {
            Text(String(localized: "admin.invite.linkTitle", defaultValue: "Ссылка-приглашение"))
        } footer: {
            Text(hint)
        }
        .listRowBackground(Palette.card)
    }
}

// MARK: - Мелочи

extension AdminPersonDTO {
    /// Ссылка на профиль человека, если он ещё существует.
    var profileRoute: AppRoute { .profile(id: id) }
}

/// Строка «подпись — значение», которую можно нажать: ведёт в профиль или карточку.
struct AdminLinkRow: View {
    let title: String
    let value: String
    let route: AppRoute

    var body: some View {
        NavigationLink(value: route) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).foregroundStyle(Palette.mutedForeground)
                Spacer(minLength: Spacing.md)
                Text(value)
                    .foregroundStyle(Palette.primary)
                    .multilineTextAlignment(.trailing)
            }
            .font(Typography.body)
        }
    }
}

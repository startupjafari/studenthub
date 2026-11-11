import SwiftUI

/// Карьера: студенту — вакансии, отклики, профиль и резюме; сотрудникам вуза — компании, модерация вакансий, аналитика; работодателю — его кабинет.
///
/// Маршрут — `AppRoute.career(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum CareerScreen: Hashable {
    case home
    case vacancies
    case vacancy(id: String)
    case applications
    case profile
    case resume
    case events
    case companies
    case company(id: String)
    case vacancyReview
    case analytics
    case employerHome
    case employerVacancies
    case employerVacancy(id: String)
    case candidates
    case candidate(id: String)
    case access
    case team
    case companyProfile
    /// Резюме так, как его видят по публичной ссылке (`/r/resume/[slug]`).
    case publicResume(slug: String)

    var title: String {
        switch self {
        case .home: return String(localized: "career.screen.home", defaultValue: "Карьера")
        case .vacancies: return String(localized: "career.screen.vacancies", defaultValue: "Вакансии")
        case .vacancy: return String(localized: "career.screen.vacancy", defaultValue: "Вакансия")
        case .applications: return String(localized: "career.screen.applications", defaultValue: "Мои отклики")
        case .profile: return String(localized: "career.screen.profile", defaultValue: "Карьерный профиль")
        case .resume: return String(localized: "career.screen.resume", defaultValue: "Резюме")
        case .events: return String(localized: "career.screen.events", defaultValue: "Карьерные события")
        case .companies: return String(localized: "career.screen.companies", defaultValue: "Компании")
        case .company: return String(localized: "career.screen.company", defaultValue: "Компания")
        case .vacancyReview: return String(localized: "career.screen.vacancyReview", defaultValue: "Модерация вакансий")
        case .analytics: return String(localized: "career.screen.analytics", defaultValue: "Аналитика карьеры")
        case .employerHome: return String(localized: "career.screen.employerHome", defaultValue: "Кабинет работодателя")
        case .employerVacancies: return String(localized: "career.screen.employerVacancies", defaultValue: "Вакансии компании")
        case .employerVacancy: return String(localized: "career.screen.employerVacancy", defaultValue: "Вакансия")
        case .candidates: return String(localized: "career.screen.candidates", defaultValue: "Кандидаты")
        case .candidate: return String(localized: "career.screen.candidate", defaultValue: "Кандидат")
        case .access: return String(localized: "career.screen.access", defaultValue: "Доступ к вузам")
        case .team: return String(localized: "career.screen.team", defaultValue: "Команда")
        case .companyProfile: return String(localized: "career.screen.companyProfile", defaultValue: "Профиль компании")
        case .publicResume: return String(localized: "career.screen.resume", defaultValue: "Резюме")
        }
    }

    var symbol: String {
        switch self {
        case .home: return "briefcase"
        case .vacancies: return "magnifyingglass"
        case .vacancy: return "briefcase"
        case .applications: return "paperplane"
        case .profile: return "person.crop.rectangle"
        case .resume: return "doc.text"
        case .events: return "calendar"
        case .companies: return "building.2"
        case .company: return "building.2"
        case .vacancyReview: return "checkmark.shield"
        case .analytics: return "chart.bar"
        case .employerHome: return "rectangle.3.group"
        case .employerVacancies: return "briefcase"
        case .employerVacancy: return "briefcase"
        case .candidates: return "person.3"
        case .candidate: return "person"
        case .access: return "graduationcap"
        case .team: return "person.badge.plus"
        case .companyProfile: return "building.2"
        case .publicResume: return "doc.richtext"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        switch self {
        case .home: CareerHomeView()
        case .vacancies: CareerVacanciesView()
        case .vacancy(let id): CareerVacancyView(id: id)
        case .applications: CareerApplicationsView()
        case .profile: CareerProfileView()
        case .resume: CareerResumeView()
        case .events: CareerEventsView()
        case .companies: CareerCompaniesView()
        case .company(let id): CareerCompanyView(id: id)
        case .vacancyReview: CareerVacancyReviewView()
        case .analytics: CareerAnalyticsView()
        case .employerHome: CareerEmployerHomeView()
        case .employerVacancies: CareerEmployerVacanciesView()
        case .employerVacancy(let id): CareerEmployerVacancyView(id: id)
        case .candidates: CareerCandidatesView()
        case .candidate(let id): CareerCandidateView(id: id)
        case .access: CareerAccessView()
        case .team: CareerTeamView()
        case .companyProfile: CareerCompanyProfileView()
        case .publicResume(let slug): CareerPublicResumeView(slug: slug)
        }
    }

    /// Карьерные разделы учебной роли (`careerNavFor` в вебе).
    static func items(for role: Role) -> [WorkspaceItem] {
        let cases: [CareerScreen]
        switch role {
        case .student, .starosta:
            cases = [.home, .vacancies, .applications, .profile, .resume, .events]
        case .teacher:
            cases = [.vacancies, .events]
        case .dean, .universityAdmin, .universityModerator, .platformAdmin, .platformModerator:
            cases = [.home, .companies, .vacancyReview, .vacancies, .events, .analytics]
        default:
            cases = []
        }
        return cases.map { WorkspaceItem(title: $0.title, symbol: $0.symbol, tint: TileTint.purple, route: .career($0)) }
    }

    /// «Разделы» работодателя. Своего вуза у него нет: студентов он видит только в вузах,
    /// одобривших заявку компании, поэтому «Доступ к вузам» стоит рядом с кандидатами.
    static var employerWorkspace: [WorkspaceGroup] {
        let hints: [CareerScreen: String] = [
            .employerVacancies: String(localized: "career.hint.vacancies", defaultValue: "Создание, публикация и решения вузов"),
            .candidates: String(localized: "career.hint.candidates", defaultValue: "Отклики на вакансии и карточки студентов"),
            .access: String(localized: "career.hint.access", defaultValue: "Заявки в университеты и их статусы"),
            .team: String(localized: "career.hint.team", defaultValue: "Коллеги и приглашения"),
            .companyProfile: String(localized: "career.hint.company", defaultValue: "То, что видят студенты"),
        ]
        return [
            WorkspaceGroup(
                title: String(localized: "career.group.employer", defaultValue: "Кабинет"),
                items: [CareerScreen.employerVacancies, .candidates, .access, .team, .companyProfile].map {
                    WorkspaceItem(title: $0.title, symbol: $0.symbol, tint: TileTint.purple, hint: hints[$0], route: .career($0))
                }
            ),
        ]
    }
}

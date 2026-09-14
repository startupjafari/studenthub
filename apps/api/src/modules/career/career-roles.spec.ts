// Метаданные декораторов читаются через reflect-metadata: в unit-тестах main.ts,
// который подключает его в проде, не загружается.
import 'reflect-metadata'
import { Role } from '@studenthub/shared-types'
import { ROLES_KEY } from '../../common/decorators/roles.decorator'
import { CareerAnalyticsController } from './career-analytics.controller'
import { CareerEventsController } from './career-events.controller'
import { UniversityCompaniesController } from './university-companies.controller'
import { UniversityVacanciesController, VacanciesController } from './vacancies.controller'

// Роли карьерного центра объявлены декоратором, а не кодом сервиса, поэтому обычные
// unit-тесты сервисов их не ловят: список можно урезать, и все тесты останутся зелёными,
// а раздел молча начнёт отвечать «Недостаточно прав». Так и случилось с модератором
// платформы — навигация показывала ему четыре раздела, API не пускал ни в один.
//
// Здесь проверяется РОВНО матрица доступа из docs/PROJECT.md §682/§686/§694.

function rolesOf(controller: object, method: string): Role[] {
  const handler = (controller as Record<string, unknown>)[method]
  return (Reflect.getMetadata(ROLES_KEY, handler as object) ?? []) as Role[]
}

const STAFF_READ = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

describe('Карьерный центр: матрица доступа', () => {
  it('разделы вуза открыты обеим платформенным ролям (PROJECT.md §678)', () => {
    const proto = CareerAnalyticsController.prototype
    for (const method of ['university', 'universityReport', 'exportUniversityReport']) {
      expect(rolesOf(proto, method)).toEqual(expect.arrayContaining(STAFF_READ))
    }
    expect(rolesOf(UniversityCompaniesController.prototype, 'list')).toEqual(
      expect.arrayContaining(STAFF_READ),
    )
    expect(rolesOf(UniversityVacanciesController.prototype, 'queue')).toEqual(
      expect.arrayContaining(STAFF_READ),
    )
  })

  it('решение по допуску компании — только администраторы (§682)', () => {
    const roles = rolesOf(UniversityCompaniesController.prototype, 'decide')
    expect(roles).toEqual(expect.arrayContaining([Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN]))
    // Модератор видит очередь, но не решает — ни в вузе, ни на платформе.
    expect(roles).not.toContain(Role.UNIVERSITY_MODERATOR)
    expect(roles).not.toContain(Role.PLATFORM_MODERATOR)
    expect(roles).not.toContain(Role.DEAN)
  })

  it('витрина вакансий открыта студенту и всем сотрудникам вуза (§686)', () => {
    for (const method of ['search', 'byId']) {
      expect(rolesOf(VacanciesController.prototype, method)).toEqual(
        expect.arrayContaining([
          Role.STUDENT,
          Role.STAROSTA,
          Role.TEACHER,
          Role.DEAN,
          Role.UNIVERSITY_ADMIN,
          Role.UNIVERSITY_MODERATOR,
          Role.PLATFORM_ADMIN,
          Role.PLATFORM_MODERATOR,
        ]),
      )
    }
  })

  it('преподаватель — наблюдатель: витрина и события, но не управление (§682/§694)', () => {
    expect(rolesOf(CareerEventsController.prototype, 'list')).toContain(Role.TEACHER)
    expect(rolesOf(VacanciesController.prototype, 'search')).toContain(Role.TEACHER)
    expect(rolesOf(UniversityCompaniesController.prototype, 'list')).not.toContain(Role.TEACHER)
    expect(rolesOf(UniversityVacanciesController.prototype, 'queue')).not.toContain(Role.TEACHER)
    expect(rolesOf(CareerAnalyticsController.prototype, 'university')).not.toContain(Role.TEACHER)
  })

  it('работодатель не попадает в разделы вуза', () => {
    expect(rolesOf(UniversityCompaniesController.prototype, 'list')).not.toContain(Role.EMPLOYER)
    expect(rolesOf(UniversityVacanciesController.prototype, 'queue')).not.toContain(Role.EMPLOYER)
    expect(rolesOf(CareerAnalyticsController.prototype, 'university')).not.toContain(Role.EMPLOYER)
  })
})

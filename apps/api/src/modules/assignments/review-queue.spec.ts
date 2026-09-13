// Метаданные декораторов читаются через reflect-metadata: в unit-тестах main.ts,
// который подключает его в проде, не загружается.
import 'reflect-metadata'
import { Role } from '@studenthub/shared-types'
import { ROLES_KEY } from '../../common/decorators/roles.decorator'
import { AssignmentsController } from './assignments.controller'

// Очередь проверки читает чужие сдачи — важно, что она закрыта ролью и что порядок
// маршрутов не даёт ':id' перехватить 'review-queue'.
describe('Очередь проверки: доступ и маршрут', () => {
  it('закрыта студенческими ролями', () => {
    const handler = (AssignmentsController.prototype as unknown as Record<string, object>)[
      'reviewQueue'
    ] as object
    const roles = (Reflect.getMetadata(ROLES_KEY, handler) ?? []) as Role[]
    expect(roles).toEqual(expect.arrayContaining([Role.TEACHER, Role.DEAN]))
    expect(roles).not.toContain(Role.STUDENT)
    expect(roles).not.toContain(Role.STAROSTA)
  })

  it('объявлена ДО динамического ":id" — иначе Nest примет её за идентификатор', () => {
    const proto = AssignmentsController.prototype as unknown as Record<string, unknown>
    const methods = Object.getOwnPropertyNames(proto)
    expect(methods.indexOf('reviewQueue')).toBeLessThan(methods.indexOf('get'))
  })
})

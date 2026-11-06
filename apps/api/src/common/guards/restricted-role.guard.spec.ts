import { Reflector } from '@nestjs/core'
import type { ExecutionContext } from '@nestjs/common'
import { RESTRICTED_ROLES, Role } from '@studenthub/shared-types'
import { RestrictedRoleGuard } from './restricted-role.guard'
import { AppException } from '../exceptions/app.exception'
import type { CurrentUserData } from '../auth/jwt-payload.type'

// Guard — единственное, что отделяет охрану и библиотекаря от эндпоинтов без @Roles, где
// сервисы отдают незнакомой роли данные всего вуза. Тесты закрывают все стороны: такие роли
// не ходят дальше своего списка, чужой список им не помогает, а остальные роли появления
// guard'а не замечают.

describe('RestrictedRoleGuard', () => {
  const contextWith = (user: Partial<CurrentUserData> | undefined): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    }) as unknown as ExecutionContext

  const guardWith = (allowed: Role[] | undefined) => {
    const reflector = { getAllAndOverride: () => allowed } as unknown as Reflector
    return new RestrictedRoleGuard(reflector)
  }

  it('пускает ограниченную роль на маршрут, где она названа', () => {
    for (const role of RESTRICTED_ROLES) {
      expect(guardWith([role]).canActivate(contextWith({ role }))).toBe(true)
      expect(guardWith([...RESTRICTED_ROLES]).canActivate(contextWith({ role }))).toBe(true)
    }
  })

  it('закрывает ограниченной роли непомеченный маршрут, даже без @Roles', () => {
    for (const role of RESTRICTED_ROLES) {
      expect(() => guardWith(undefined).canActivate(contextWith({ role }))).toThrow(AppException)
    }
  })

  it('маршрут охраны закрыт библиотекарю, и наоборот', () => {
    expect(() =>
      guardWith([Role.SECURITY_GUARD]).canActivate(contextWith({ role: Role.LIBRARIAN })),
    ).toThrow(AppException)
    expect(() =>
      guardWith([Role.LIBRARIAN]).canActivate(contextWith({ role: Role.SECURITY_GUARD })),
    ).toThrow(AppException)
  })

  it('не трогает остальные роли — ни на помеченных маршрутах, ни на прочих', () => {
    for (const role of Object.values(Role).filter((r) => !RESTRICTED_ROLES.includes(r))) {
      expect(guardWith(undefined).canActivate(contextWith({ role }))).toBe(true)
      expect(guardWith([Role.SECURITY_GUARD]).canActivate(contextWith({ role }))).toBe(true)
    }
  })

  it('пропускает запрос без пользователя — это забота JwtAuthGuard', () => {
    expect(guardWith(undefined).canActivate(contextWith(undefined))).toBe(true)
  })
})

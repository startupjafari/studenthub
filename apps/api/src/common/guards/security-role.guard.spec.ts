import { Reflector } from '@nestjs/core'
import type { ExecutionContext } from '@nestjs/common'
import { Role } from '@studenthub/shared-types'
import { SecurityRoleGuard } from './security-role.guard'
import { AppException } from '../exceptions/app.exception'
import type { CurrentUserData } from '../auth/jwt-payload.type'

// Guard — единственное, что отделяет охранника от эндпоинтов без @Roles, где сервисы
// отдают незнакомой роли данные всего вуза. Тесты закрывают обе стороны: охрана не ходит
// дальше списка, а остальные роли появления guard'а не замечают.

describe('SecurityRoleGuard', () => {
  const contextWith = (user: Partial<CurrentUserData> | undefined): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    }) as unknown as ExecutionContext

  const guardWith = (allowed: boolean | undefined) => {
    const reflector = { getAllAndOverride: () => allowed } as unknown as Reflector
    return new SecurityRoleGuard(reflector)
  }

  it('пускает охранника на помеченный маршрут', () => {
    expect(guardWith(true).canActivate(contextWith({ role: Role.SECURITY_GUARD }))).toBe(true)
  })

  it('закрывает охраннику непомеченный маршрут, даже без @Roles', () => {
    expect(() =>
      guardWith(undefined).canActivate(contextWith({ role: Role.SECURITY_GUARD })),
    ).toThrow(AppException)
  })

  it('не трогает остальные роли — ни на помеченных маршрутах, ни на прочих', () => {
    for (const role of Object.values(Role).filter((r) => r !== Role.SECURITY_GUARD)) {
      expect(guardWith(undefined).canActivate(contextWith({ role }))).toBe(true)
      expect(guardWith(true).canActivate(contextWith({ role }))).toBe(true)
    }
  })

  it('пропускает запрос без пользователя — это забота JwtAuthGuard', () => {
    expect(guardWith(undefined).canActivate(contextWith(undefined))).toBe(true)
  })
})

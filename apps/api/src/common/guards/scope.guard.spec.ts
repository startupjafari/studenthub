import { Reflector } from '@nestjs/core'
import { Role } from '@studenthub/shared-types'
import { ScopeGuard } from './scope.guard'
import { AppException } from '../exceptions/app.exception'
import { mockExecutionContext } from './__testing__/context.mock'
import type { ScopeConfig } from '../decorators/scope.decorator'
import type { CurrentUserData } from '../auth/jwt-payload.type'

function makeReflector(value: ScopeConfig | undefined): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(value) } as unknown as Reflector
}

const adminUniA: CurrentUserData = {
  sub: 'a',
  role: Role.UNIVERSITY_ADMIN,
  universityId: 'uni-A',
  facultyId: null,
  groupId: null,
}
const platformAdmin: CurrentUserData = {
  sub: 'p',
  role: Role.PLATFORM_ADMIN,
  universityId: null,
  facultyId: null,
  groupId: null,
}

const uniScope: ScopeConfig = { level: 'university' }

function expectWrongScope(fn: () => void): void {
  try {
    fn()
    throw new Error('должно было бросить')
  } catch (err) {
    expect(err).toBeInstanceOf(AppException)
    expect((err as AppException).code).toBe('WRONG_SCOPE')
    expect((err as AppException).getStatus()).toBe(403)
  }
}

describe('ScopeGuard', () => {
  it('пропускает, если @Scope не задан', () => {
    const guard = new ScopeGuard(makeReflector(undefined))
    expect(guard.canActivate(mockExecutionContext({ user: adminUniA }))).toBe(true)
  })

  it('платформенная роль обходит scope даже при несовпадении', () => {
    const guard = new ScopeGuard(makeReflector(uniScope))
    const ctx = mockExecutionContext({ user: platformAdmin, params: { universityId: 'uni-Z' } })
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('пропускает при совпадении scope ресурса и токена', () => {
    const guard = new ScopeGuard(makeReflector(uniScope))
    const ctx = mockExecutionContext({ user: adminUniA, params: { universityId: 'uni-A' } })
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('WRONG_SCOPE при чужом университете', () => {
    const guard = new ScopeGuard(makeReflector(uniScope))
    const ctx = mockExecutionContext({ user: adminUniA, params: { universityId: 'uni-B' } })
    expectWrongScope(() => guard.canActivate(ctx))
  })

  it('WRONG_SCOPE, если у пользователя нет такого scope (null)', () => {
    const guard = new ScopeGuard(makeReflector({ level: 'faculty' }))
    const ctx = mockExecutionContext({ user: adminUniA, params: { facultyId: 'fac-1' } })
    expectWrongScope(() => guard.canActivate(ctx))
  })

  it('пропускает, если идентификатора ресурса нет в запросе (проверит сервис)', () => {
    const guard = new ScopeGuard(makeReflector(uniScope))
    expect(guard.canActivate(mockExecutionContext({ user: adminUniA }))).toBe(true)
  })

  it('читает идентификатор из указанного source/param', () => {
    const guard = new ScopeGuard(
      makeReflector({ level: 'university', source: 'query', param: 'uni' }),
    )
    const ok = mockExecutionContext({ user: adminUniA, query: { uni: 'uni-A' } })
    expect(guard.canActivate(ok)).toBe(true)
    const bad = mockExecutionContext({ user: adminUniA, query: { uni: 'uni-B' } })
    expectWrongScope(() => guard.canActivate(bad))
  })

  it('401 UNAUTHORIZED, если пользователя нет', () => {
    const guard = new ScopeGuard(makeReflector(uniScope))
    try {
      guard.canActivate(mockExecutionContext({ user: undefined }))
      throw new Error('должно было бросить')
    } catch (err) {
      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).code).toBe('UNAUTHORIZED')
    }
  })
})

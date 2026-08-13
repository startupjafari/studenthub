import type { ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { Role } from '@studenthub/shared-types'
import { TwoFactorGuard } from './two-factor.guard'
import type { JwtPayload } from '../auth/jwt-payload.type'

function ctxFor(user: JwtPayload | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext
}

function guardWith(exempt: boolean) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(exempt) } as unknown as Reflector
  return new TwoFactorGuard(reflector)
}

const user = (role: Role, tfa: boolean): JwtPayload => ({
  sub: 'u',
  role,
  universityId: 'uni',
  facultyId: null,
  groupId: null,
  tfa,
})

describe('TwoFactorGuard', () => {
  it('привилегированная роль без 2FA → TWO_FACTOR_SETUP_REQUIRED', () => {
    const guard = guardWith(false)
    expect(() => guard.canActivate(ctxFor(user(Role.DEAN, false)))).toThrow(
      expect.objectContaining({ code: 'TWO_FACTOR_SETUP_REQUIRED' }),
    )
  })

  it('привилегированная роль с включённой 2FA → пропускает', () => {
    const guard = guardWith(false)
    expect(guard.canActivate(ctxFor(user(Role.UNIVERSITY_ADMIN, true)))).toBe(true)
  })

  it('непривилегированная роль без 2FA → пропускает', () => {
    const guard = guardWith(false)
    expect(guard.canActivate(ctxFor(user(Role.STUDENT, false)))).toBe(true)
  })

  it('@TwoFactorExempt эндпоинт → пропускает даже привилегированную роль без 2FA', () => {
    const guard = guardWith(true)
    expect(guard.canActivate(ctxFor(user(Role.PLATFORM_ADMIN, false)))).toBe(true)
  })

  it('публичный роут (нет пользователя) → пропускает', () => {
    const guard = guardWith(false)
    expect(guard.canActivate(ctxFor(undefined))).toBe(true)
  })
})

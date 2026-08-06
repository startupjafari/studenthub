import { Reflector } from '@nestjs/core'
import { Role } from '@studenthub/shared-types'
import { RolesGuard } from './roles.guard'
import { AppException } from '../exceptions/app.exception'
import { mockExecutionContext } from './__testing__/context.mock'
import type { CurrentUserData } from '../auth/jwt-payload.type'

function makeReflector(value: unknown): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(value) } as unknown as Reflector
}

const dean: CurrentUserData = {
  sub: 'u1',
  role: Role.DEAN,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: null,
}

describe('RolesGuard', () => {
  it('пропускает, если @Roles не задан', () => {
    const guard = new RolesGuard(makeReflector(undefined))
    expect(guard.canActivate(mockExecutionContext({ user: dean }))).toBe(true)
  })

  it('пропускает, если роль пользователя входит в список', () => {
    const guard = new RolesGuard(makeReflector([Role.DEAN, Role.UNIVERSITY_ADMIN]))
    expect(guard.canActivate(mockExecutionContext({ user: dean }))).toBe(true)
  })

  it('403 FORBIDDEN, если роль не входит в список', () => {
    const guard = new RolesGuard(makeReflector([Role.PLATFORM_ADMIN]))
    try {
      guard.canActivate(mockExecutionContext({ user: dean }))
      throw new Error('должно было бросить')
    } catch (err) {
      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).code).toBe('FORBIDDEN')
      expect((err as AppException).getStatus()).toBe(403)
    }
  })

  it('401 UNAUTHORIZED, если пользователя нет, но роль требуется', () => {
    const guard = new RolesGuard(makeReflector([Role.DEAN]))
    try {
      guard.canActivate(mockExecutionContext({ user: undefined }))
      throw new Error('должно было бросить')
    } catch (err) {
      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).code).toBe('UNAUTHORIZED')
    }
  })
})

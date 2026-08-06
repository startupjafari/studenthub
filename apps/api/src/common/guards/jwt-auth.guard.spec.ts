import { Reflector } from '@nestjs/core'
import { JwtAuthGuard } from './jwt-auth.guard'
import { AppException } from '../exceptions/app.exception'
import { mockExecutionContext } from './__testing__/context.mock'

function makeReflector(isPublic: boolean): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as Reflector
}

describe('JwtAuthGuard', () => {
  it('@Public → пропускает без проверки токена', () => {
    const guard = new JwtAuthGuard(makeReflector(true))
    expect(guard.canActivate(mockExecutionContext({}))).toBe(true)
  })

  it('handleRequest возвращает пользователя при валидном токене', () => {
    const guard = new JwtAuthGuard(makeReflector(false))
    const user = { sub: 'u1' }
    expect(guard.handleRequest(null, user, undefined)).toBe(user)
  })

  it('handleRequest → TOKEN_EXPIRED при истёкшем токене', () => {
    const guard = new JwtAuthGuard(makeReflector(false))
    try {
      guard.handleRequest(null, false, { name: 'TokenExpiredError' })
      throw new Error('должно было бросить')
    } catch (err) {
      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).code).toBe('TOKEN_EXPIRED')
      expect((err as AppException).getStatus()).toBe(401)
    }
  })

  it('handleRequest → UNAUTHORIZED, если пользователя нет', () => {
    const guard = new JwtAuthGuard(makeReflector(false))
    try {
      guard.handleRequest(null, null, undefined)
      throw new Error('должно было бросить')
    } catch (err) {
      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).code).toBe('UNAUTHORIZED')
    }
  })
})

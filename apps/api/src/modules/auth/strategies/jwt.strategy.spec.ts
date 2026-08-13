import { UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { Role } from '@studenthub/shared-types'
import { JwtStrategy } from './jwt.strategy'
import type { EnvVars } from '../../../config/env.schema'

function make() {
  const config = { get: jest.fn().mockReturnValue('x'.repeat(32)) }
  return new JwtStrategy(config as unknown as ConfigService<EnvVars, true>)
}

describe('JwtStrategy.validate', () => {
  it('обычный access-токен → возвращает payload', () => {
    const strat = make()
    const payload = {
      sub: 'u1',
      role: Role.STUDENT,
      universityId: 'uni',
      facultyId: null,
      groupId: null,
      tfa: true,
    }
    // validate нормализует payload и проставляет tfa (для TwoFactorGuard).
    expect(strat.validate(payload)).toEqual(payload)
  })

  it('токен без tfa → tfa=false по умолчанию', () => {
    const strat = make()
    const result = strat.validate({
      sub: 'u1',
      role: Role.DEAN,
      universityId: 'uni',
      facultyId: 'fac',
      groupId: null,
    })
    expect(result.tfa).toBe(false)
  })

  it('challenge-токен 2FA (typ=TWO_FACTOR) → отвергается', () => {
    const strat = make()
    expect(() =>
      strat.validate({
        sub: 'u1',
        role: Role.STUDENT,
        universityId: null,
        facultyId: null,
        groupId: null,
        typ: 'TWO_FACTOR',
      }),
    ).toThrow(UnauthorizedException)
  })
})

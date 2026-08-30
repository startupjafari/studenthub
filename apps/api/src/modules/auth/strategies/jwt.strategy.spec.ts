import { UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { Role } from '@studenthub/shared-types'
import { JwtStrategy } from './jwt.strategy'
import type { EnvVars } from '../../../config/env.schema'
import type { JwtPayload } from '../../../common/auth/jwt-payload.type'

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
      companyId: null,
      tfa: true,
    }
    // validate нормализует payload и проставляет tfa (для TwoFactorGuard).
    expect(strat.validate(payload)).toEqual(payload)
  })

  /**
   * Страж белого списка полей.
   *
   * validate пересобирает payload вручную, и поле, которого нет в этом списке, молча
   * теряется: токен его несёт, а request.user — уже нет. Так пропал companyId (Ф18), и
   * работодатель на всех экранах получал «аккаунт не привязан к компании».
   *
   * Тип `Required<JwtPayload>` заставляет перечислить здесь КАЖДОЕ поле: добавили новое в
   * интерфейс — тест перестаёт компилироваться, пока его не внесли и сюда.
   */
  it('ни одно поле payload не теряется при валидации', () => {
    const strat = make()
    const full: Required<JwtPayload> = {
      sub: 'u1',
      role: Role.EMPLOYER,
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId: 'grp-1',
      companyId: 'co-1',
      tfa: true,
    }

    // Сравниваем целиком: пропущенное поле видно в диффе по имени.
    expect(strat.validate(full)).toEqual(full)
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

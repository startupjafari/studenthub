import { UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { Role } from '@studenthub/shared-types'
import { JwtStrategy } from './jwt.strategy'
import type { EnvVars } from '../../../config/env.schema'
import type { JwtPayload } from '../../../common/auth/jwt-payload.type'
import type { SessionRevocationService } from '../../../common/redis/session-revocation.service'
import type { UniversityAccessService } from '../../universities/university-access.service'
import { AppException } from '../../../common/exceptions/app.exception'

function make(revoked = false, denial: () => Promise<AppException | null> = async () => null) {
  const config = { get: jest.fn().mockReturnValue('x'.repeat(32)) }
  const revocation = { isRevoked: jest.fn().mockResolvedValue(revoked) }
  const universityAccess = { denial: jest.fn(denial) }
  return new JwtStrategy(
    config as unknown as ConfigService<EnvVars, true>,
    revocation as unknown as SessionRevocationService,
    universityAccess as unknown as UniversityAccessService,
  )
}

describe('JwtStrategy.validate', () => {
  it('обычный access-токен → возвращает payload', async () => {
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
    await expect(strat.validate(payload)).resolves.toEqual(payload)
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
  it('ни одно поле payload не теряется при валидации', async () => {
    const strat = make()
    const full: Required<JwtPayload> = {
      sub: 'u1',
      role: Role.EMPLOYER,
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId: 'grp-1',
      companyId: 'co-1',
      tfa: true,
      client: 'mini',
    }

    // Сравниваем целиком: пропущенное поле видно в диффе по имени.
    await expect(strat.validate(full)).resolves.toEqual(full)
  })

  it('токен без tfa → tfa=false по умолчанию', async () => {
    const strat = make()
    const result = await strat.validate({
      sub: 'u1',
      role: Role.DEAN,
      universityId: 'uni',
      facultyId: 'fac',
      groupId: null,
    })
    expect(result.tfa).toBe(false)
  })

  it('challenge-токен 2FA (typ=TWO_FACTOR) → отвергается', async () => {
    const strat = make()
    await expect(
      strat.validate({
        sub: 'u1',
        role: Role.STUDENT,
        universityId: null,
        facultyId: null,
        groupId: null,
        typ: 'TWO_FACTOR',
      }),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('токен выдан до отзыва сессий (блокировка) → отвергается', async () => {
    const strat = make(true)
    await expect(
      strat.validate({
        sub: 'u1',
        role: Role.STUDENT,
        universityId: null,
        facultyId: null,
        groupId: null,
        iat: 100,
      }),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('вуз заблокирован после выдачи токена → отказ с кодом UNIVERSITY_BLOCKED', async () => {
    const strat = make(false, async () => new AppException('UNIVERSITY_BLOCKED', 'Заблокирован'))
    await expect(
      strat.validate({
        sub: 'u1',
        role: Role.STUDENT,
        universityId: 'uni',
        facultyId: null,
        groupId: null,
      }),
    ).rejects.toMatchObject({ code: 'UNIVERSITY_BLOCKED' })
  })

  it('статус вуза не прочитан (сбой БД) → запрос пропускается', async () => {
    const strat = make(false, async () => {
      throw new Error('db down')
    })
    await expect(
      strat.validate({
        sub: 'u1',
        role: Role.STUDENT,
        universityId: 'uni',
        facultyId: null,
        groupId: null,
      }),
    ).resolves.toMatchObject({ sub: 'u1' })
  })
})

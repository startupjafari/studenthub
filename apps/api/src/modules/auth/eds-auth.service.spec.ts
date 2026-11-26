import { createHmac } from 'node:crypto'
import { Role } from '@studenthub/shared-types'
import type { EdsCredentialInfo } from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import type { VerifiedEdsSigner } from '../../common/eds/eds-verifier'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { EdsAuthService, surnameMismatch } from './eds-auth.service'

// Вход и привязка по ЭЦП (docs/PROJECT.md §8.3 «Вход по ЭЦП»). NCANode подменён фейком
// EdsVerifier: здесь проверяется поток — одноразовость challenge, назначение, поиск учётки
// по HMAC ИИН, роли, счётчики, — а не криптография.

const IIN = '900101300123'
const PEPPER = 'p'.repeat(40)
const IIN_HASH = createHmac('sha256', PEPPER).update(IIN).digest('hex')
const CTX = { ip: '10.0.0.7', userAgent: 'jest' }

function signer(over: Partial<VerifiedEdsSigner> = {}): VerifiedEdsSigner {
  return {
    iin: IIN,
    orgBin: '123456789012',
    subjectCn: 'АБИШЕВА АСЕМ',
    certSerial: 'serial-2026',
    certIssuer: 'ҰЛТТЫҚ КУӘЛАНДЫРУШЫ ОРТАЛЫҚ (RSA)',
    certNotBefore: new Date('2026-01-10T00:00:00Z'),
    certNotAfter: new Date('2027-01-10T00:00:00Z'),
    ...over,
  }
}

const INFO: EdsCredentialInfo = {
  iinLast4: '0123',
  subjectCn: 'АБИШЕВА АСЕМ',
  orgBin: '123456789012',
  certNotAfter: '2027-01-10T00:00:00.000Z',
  linkedAt: '2026-11-26T10:00:00.000Z',
  lastUsedAt: null,
}

const dean = (sub = 'u-dean'): JwtPayload => ({
  sub,
  role: Role.DEAN,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: null,
  tfa: true,
})

function setup(opts: { enabled?: boolean } = {}) {
  // Redis как Map: SET с TTL и MULTI GET+DEL, выполняемый целиком в exec — как в Redis,
  // где транзакция не перемежается чужими командами.
  const store = new Map<string, string>()
  const redis = {
    store,
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
    multi: jest.fn(() => {
      const ops: Array<() => [null, unknown]> = []
      const chain = {
        get(key: string) {
          ops.push(() => [null, store.get(key) ?? null])
          return chain
        },
        del(key: string) {
          ops.push(() => [null, store.delete(key) ? 1 : 0])
          return chain
        },
        exec: async () => ops.map((op) => op()),
      }
      return chain
    }),
  }
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'EDS_LOGIN_ENABLED') return opts.enabled ?? true
      if (key === 'EDS_IIN_PEPPER') return PEPPER
      return undefined
    }),
  }
  const verifier = { verifyAuthSignature: jest.fn().mockResolvedValue(signer()) }
  const users = {
    findEdsCredentialByIinHash: jest
      .fn()
      .mockResolvedValue({ userId: 'u-dean', role: Role.DEAN } as { userId: string; role: Role }),
    touchEdsCredential: jest.fn().mockResolvedValue(undefined),
    getTwoFactorForLogin: jest.fn().mockResolvedValue({
      id: 'u-dean',
      role: Role.DEAN,
      isBlocked: false,
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId: null,
      twoFactorEnabled: true,
      twoFactorSecret: 'enc',
      twoFactorBackupCodes: [],
      companyMembership: null,
    }),
    getEdsOwner: jest.fn().mockResolvedValue({
      firstName: 'Асем',
      lastName: 'Абишева',
      email: 'dean@uni.kz',
      locale: 'kz',
    }),
    linkEdsCredential: jest.fn().mockResolvedValue({ info: INFO, replaced: false }),
    hasEdsCredential: jest.fn().mockResolvedValue(true),
    removeEdsCredential: jest.fn().mockResolvedValue(true),
  }
  const session = {
    accessToken: 'access',
    refreshToken: 'id.secret',
    refreshExpiresAt: new Date('2026-12-26T00:00:00Z'),
    payload: dean(),
  }
  const auth = { issueSessionForUser: jest.fn().mockResolvedValue(session) }
  // Верный код — функция списания (для backup-кода — условная запись в БД).
  const consume = jest.fn().mockResolvedValue(true)
  const twoFactor = {
    checkWithLimit: jest.fn().mockResolvedValue(consume),
    verifyForUser: jest.fn().mockResolvedValue(true),
  }
  const loginAttempts = {
    beginAttempt: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(true) }

  const service = new EdsAuthService(
    config as never,
    redis as never,
    verifier as never,
    users as never,
    auth as never,
    twoFactor as never,
    loginAttempts as never,
    audit as never,
    queue as never,
  )
  return {
    service,
    redis,
    config,
    verifier,
    users,
    auth,
    session,
    twoFactor,
    consume,
    loginAttempts,
    audit,
    queue,
  }
}

describe('EdsAuthService — вход', () => {
  it('подписанный challenge → сессия без TOTP, счётчик обнулён, снимок сертификата обновлён', async () => {
    const { service, verifier, users, auth, session, loginAttempts } = setup()
    const challenge = await service.createLoginChallenge()

    await expect(
      service.login({ challengeId: challenge.challengeId, cms: 'cms-base64' }, CTX),
    ).resolves.toBe(session)

    // Подписано ровно то, что выдано: байты nonce, а не его base64-строка.
    expect(verifier.verifyAuthSignature).toHaveBeenCalledWith(
      'cms-base64',
      Buffer.from(challenge.nonce, 'base64'),
    )
    expect(Buffer.from(challenge.nonce, 'base64')).toHaveLength(32)
    // Учётка ищется по HMAC ИИН, а не по самому ИИН.
    expect(users.findEdsCredentialByIinHash).toHaveBeenCalledWith(IIN_HASH)
    expect(auth.issueSessionForUser).toHaveBeenCalledWith('u-dean', CTX, 'eds')
    expect(loginAttempts.beginAttempt).toHaveBeenCalledWith(`eds:${IIN_HASH}`)
    expect(loginAttempts.reset).toHaveBeenCalledWith(`eds:${IIN_HASH}`)
    expect(users.touchEdsCredential).toHaveBeenCalledWith('u-dean', {
      subjectCn: 'АБИШЕВА АСЕМ',
      orgBin: '123456789012',
      certSerial: 'serial-2026',
      certIssuer: 'ҰЛТТЫҚ КУӘЛАНДЫРУШЫ ОРТАЛЫҚ (RSA)',
      certNotAfter: new Date('2027-01-10T00:00:00Z'),
    })
  })

  it('challenge живёт три минуты', async () => {
    const { service, redis } = setup()
    const before = Date.now()
    const challenge = await service.createLoginChallenge()

    expect(redis.set).toHaveBeenCalledWith(
      `eds:challenge:${challenge.challengeId}`,
      expect.any(String),
      'EX',
      180,
    )
    const ttl = new Date(challenge.expiresAt).getTime() - before
    expect(ttl).toBeGreaterThanOrEqual(179_000)
    expect(ttl).toBeLessThanOrEqual(181_000)
  })

  it('повтор того же challenge → EDS_SIGNATURE_INVALID, NCANode второй раз не спрашивается', async () => {
    const { service, verifier } = setup()
    const { challengeId } = await service.createLoginChallenge()
    await service.login({ challengeId, cms: 'cms' }, CTX)

    await expect(service.login({ challengeId, cms: 'cms' }, CTX)).rejects.toMatchObject({
      code: 'EDS_SIGNATURE_INVALID',
    })
    expect(verifier.verifyAuthSignature).toHaveBeenCalledTimes(1)
  })

  it('гонка двух входов с одним challenge: сессию получает ровно один', async () => {
    const { service, auth } = setup()
    const { challengeId } = await service.createLoginChallenge()

    const results = await Promise.allSettled([
      service.login({ challengeId, cms: 'cms' }, CTX),
      service.login({ challengeId, cms: 'cms' }, CTX),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'EDS_SIGNATURE_INVALID' })
    expect(auth.issueSessionForUser).toHaveBeenCalledTimes(1)
  })

  it('неизвестный или истёкший challenge → EDS_SIGNATURE_INVALID', async () => {
    const { service, verifier } = setup()
    await expect(
      service.login({ challengeId: '6f1c1f3e-2a57-4d53-8f43-3c4fbb1b7a11', cms: 'cms' }, CTX),
    ).rejects.toMatchObject({ code: 'EDS_SIGNATURE_INVALID' })
    expect(verifier.verifyAuthSignature).not.toHaveBeenCalled()
  })

  it('challenge привязки для входа не годится — и сгорает', async () => {
    const { service, redis, verifier } = setup()
    const { challengeId } = await service.createLinkChallenge(dean())

    await expect(service.login({ challengeId, cms: 'cms' }, CTX)).rejects.toMatchObject({
      code: 'EDS_SIGNATURE_INVALID',
    })
    expect(verifier.verifyAuthSignature).not.toHaveBeenCalled()
    expect(redis.store.size).toBe(0)
  })

  it('подпись отвергнута NCANode → его код наружу как есть, challenge сгорел', async () => {
    const { service, verifier, auth, redis } = setup()
    verifier.verifyAuthSignature.mockRejectedValue(
      new AppException('EDS_CERT_REVOKED', 'Сертификат отозван'),
    )
    const { challengeId } = await service.createLoginChallenge()

    await expect(service.login({ challengeId, cms: 'cms' }, CTX)).rejects.toMatchObject({
      code: 'EDS_CERT_REVOKED',
    })
    expect(auth.issueSessionForUser).not.toHaveBeenCalled()
    expect(redis.store.size).toBe(0)
  })

  it('ЭЦП не привязана → EDS_NOT_LINKED, попытка засчитана и не обнулена', async () => {
    const { service, users, auth, loginAttempts } = setup()
    users.findEdsCredentialByIinHash.mockResolvedValue(null)
    const { challengeId } = await service.createLoginChallenge()

    await expect(service.login({ challengeId, cms: 'cms' }, CTX)).rejects.toMatchObject({
      code: 'EDS_NOT_LINKED',
    })
    expect(loginAttempts.beginAttempt).toHaveBeenCalledTimes(1)
    expect(loginAttempts.reset).not.toHaveBeenCalled()
    expect(auth.issueSessionForUser).not.toHaveBeenCalled()
  })

  it('роль без права входа по ЭЦП → тот же EDS_NOT_LINKED, сессии нет', async () => {
    const { service, users, auth } = setup()
    users.findEdsCredentialByIinHash.mockResolvedValue({ userId: 'u-st', role: Role.STUDENT })
    const { challengeId } = await service.createLoginChallenge()

    await expect(service.login({ challengeId, cms: 'cms' }, CTX)).rejects.toMatchObject({
      code: 'EDS_NOT_LINKED',
    })
    expect(auth.issueSessionForUser).not.toHaveBeenCalled()
  })

  it('учётка заблокирована → отказ общего пути выдачи сессии, счётчик не обнулён', async () => {
    const { service, auth, users, loginAttempts } = setup()
    auth.issueSessionForUser.mockRejectedValue(
      new AppException('FORBIDDEN', 'Учётная запись заблокирована'),
    )
    const { challengeId } = await service.createLoginChallenge()

    await expect(service.login({ challengeId, cms: 'cms' }, CTX)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(loginAttempts.reset).not.toHaveBeenCalled()
    expect(users.touchEdsCredential).not.toHaveBeenCalled()
  })

  it('серия отказов по ИИН → LOGIN_LOCKED, до учётки дело не доходит', async () => {
    const { service, users, loginAttempts, auth } = setup()
    loginAttempts.beginAttempt.mockRejectedValue(
      new AppException('LOGIN_LOCKED', 'Слишком много неудачных попыток входа'),
    )
    const { challengeId } = await service.createLoginChallenge()

    await expect(service.login({ challengeId, cms: 'cms' }, CTX)).rejects.toMatchObject({
      code: 'LOGIN_LOCKED',
    })
    expect(users.findEdsCredentialByIinHash).not.toHaveBeenCalled()
    expect(auth.issueSessionForUser).not.toHaveBeenCalled()
  })

  it('Redis недоступен → EDS_UNAVAILABLE: без одноразовости вход по ЭЦП закрыт', async () => {
    const { service, redis } = setup()
    redis.set.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(service.createLoginChallenge()).rejects.toMatchObject({ code: 'EDS_UNAVAILABLE' })
  })

  it('выключено флагом → FEATURE_DISABLED везде, кроме публичной настройки', async () => {
    const { service, redis } = setup({ enabled: false })
    expect(service.publicConfig()).toEqual({ enabled: false })
    await expect(service.createLoginChallenge()).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    })
    await expect(
      service.login({ challengeId: '6f1c1f3e-2a57-4d53-8f43-3c4fbb1b7a11', cms: 'cms' }, CTX),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    await expect(service.createLinkChallenge(dean())).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    })
    await expect(service.unlink('u-dean', '123456', CTX)).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    })
    expect(redis.set).not.toHaveBeenCalled()
  })
})

describe('EdsAuthService — привязка', () => {
  async function linkInput(service: EdsAuthService, user = dean(), code = '123456') {
    const { challengeId } = await service.createLinkChallenge(user)
    return { challengeId, cms: 'cms-link', code }
  }

  it('код, challenge, подпись → привязка, аудит и письмо владельцу', async () => {
    const { service, users, consume, audit, queue, verifier } = setup()
    const input = await linkInput(service)

    await expect(service.link(dean(), input, CTX)).resolves.toEqual({
      ...INFO,
      nameMismatch: false,
    })

    expect(verifier.verifyAuthSignature).toHaveBeenCalledWith('cms-link', expect.any(Buffer))
    expect(consume).toHaveBeenCalledTimes(1)
    expect(users.linkEdsCredential).toHaveBeenCalledWith('u-dean', {
      iinHash: IIN_HASH,
      iinLast4: '0123',
      subjectCn: 'АБИШЕВА АСЕМ',
      orgBin: '123456789012',
      certSerial: 'serial-2026',
      certIssuer: 'ҰЛТТЫҚ КУӘЛАНДЫРУШЫ ОРТАЛЫҚ (RSA)',
      certNotAfter: new Date('2027-01-10T00:00:00Z'),
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-dean',
        action: 'eds_link',
        metadata: { replaced: false, nameMismatch: false },
        ip: '10.0.0.7',
      }),
    )
    expect(queue.enqueue).toHaveBeenCalledWith(
      'email',
      'send-eds-linked',
      { to: 'dean@uni.kz', locale: 'kz', firstName: 'Асем', subjectCn: 'АБИШЕВА АСЕМ' },
      expect.objectContaining({ jobId: expect.stringContaining('eds-linked:u-dean:') }),
    )
  })

  it('неверный код 2FA → INVALID_2FA_CODE; challenge цел, NCANode не спрашивается', async () => {
    const { service, twoFactor, verifier, users } = setup()
    twoFactor.checkWithLimit.mockResolvedValueOnce(null)
    const input = await linkInput(service, dean(), '000000')

    await expect(service.link(dean(), input, CTX)).rejects.toMatchObject({
      code: 'INVALID_2FA_CODE',
    })
    expect(verifier.verifyAuthSignature).not.toHaveBeenCalled()
    expect(users.linkEdsCredential).not.toHaveBeenCalled()

    // Опечатка в коде не заставляет подписывать заново: тот же challenge с верным кодом проходит.
    await expect(service.link(dean(), { ...input, code: '123456' }, CTX)).resolves.toMatchObject({
      iinLast4: '0123',
    })
  })

  it('ИИН привязан к другой учётке → EDS_ALREADY_LINKED, backup-код не списан', async () => {
    const { service, users, consume } = setup()
    users.findEdsCredentialByIinHash.mockResolvedValue({ userId: 'someone-else', role: Role.DEAN })
    const input = await linkInput(service)

    await expect(service.link(dean(), input, CTX)).rejects.toMatchObject({
      code: 'EDS_ALREADY_LINKED',
    })
    expect(consume).not.toHaveBeenCalled()
    expect(users.linkEdsCredential).not.toHaveBeenCalled()
  })

  it('перепривязка своей учётки (новый ключ или другой ИИН) — замена, в аудите replaced', async () => {
    const { service, users, audit } = setup()
    // Тот же ИИН уже за этой учёткой — не конфликт, а перевыпущенный ключ.
    users.findEdsCredentialByIinHash.mockResolvedValue({ userId: 'u-dean', role: Role.DEAN })
    users.linkEdsCredential.mockResolvedValue({ info: INFO, replaced: true })
    const input = await linkInput(service)

    await service.link(dean(), input, CTX)

    expect(users.linkEdsCredential).toHaveBeenCalledTimes(1)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'eds_link',
        metadata: expect.objectContaining({ replaced: true }),
      }),
    )
  })

  it('фамилия в сертификате другая → nameMismatch, но привязка проходит', async () => {
    const { service, users } = setup()
    users.getEdsOwner.mockResolvedValue({
      firstName: 'Асем',
      lastName: 'Иванова',
      email: 'dean@uni.kz',
      locale: 'ru',
    })
    const input = await linkInput(service)

    await expect(service.link(dean(), input, CTX)).resolves.toMatchObject({ nameMismatch: true })
    expect(users.linkEdsCredential).toHaveBeenCalledTimes(1)
  })

  it('challenge входа и чужой challenge привязки не годятся → EDS_SIGNATURE_INVALID', async () => {
    const { service, users } = setup()
    const login = await service.createLoginChallenge()
    await expect(
      service.link(dean(), { challengeId: login.challengeId, cms: 'cms', code: '123456' }, CTX),
    ).rejects.toMatchObject({ code: 'EDS_SIGNATURE_INVALID' })

    // Challenge, выданный другой сессии: подпись чужого ключа к этой учётке не привяжется.
    const foreign = await linkInput(service, dean('u-other'))
    await expect(service.link(dean(), foreign, CTX)).rejects.toMatchObject({
      code: 'EDS_SIGNATURE_INVALID',
    })
    expect(users.linkEdsCredential).not.toHaveBeenCalled()
  })

  it('роль без входа по ЭЦП → FORBIDDEN и на challenge, и на привязке', async () => {
    const { service, users } = setup()
    const student: JwtPayload = { ...dean('u-st'), role: Role.STUDENT }
    await expect(service.createLinkChallenge(student)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Роль сменилась уже после выдачи challenge — решает база, а не токен.
    const input = await linkInput(service)
    users.getTwoFactorForLogin.mockResolvedValue({
      id: 'u-dean',
      role: Role.TEACHER,
      twoFactorEnabled: true,
    })
    await expect(service.link(dean(), input, CTX)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('2FA не включена → TWO_FACTOR_SETUP_REQUIRED: подтвердить привязку нечем', async () => {
    const { service, users, twoFactor } = setup()
    users.getTwoFactorForLogin.mockResolvedValue({
      id: 'u-dean',
      role: Role.DEAN,
      twoFactorEnabled: false,
    })
    const input = await linkInput(service)

    await expect(service.link(dean(), input, CTX)).rejects.toMatchObject({
      code: 'TWO_FACTOR_SETUP_REQUIRED',
    })
    expect(twoFactor.checkWithLimit).not.toHaveBeenCalled()
  })

  it('backup-код ушёл параллельным запросом → INVALID_2FA_CODE, привязка не записана', async () => {
    const { service, consume, users } = setup()
    consume.mockResolvedValue(false)
    const input = await linkInput(service)

    await expect(service.link(dean(), input, CTX)).rejects.toMatchObject({
      code: 'INVALID_2FA_CODE',
    })
    expect(users.linkEdsCredential).not.toHaveBeenCalled()
  })
})

describe('EdsAuthService — отвязка', () => {
  it('верный код → привязка снята, аудит eds_unlink', async () => {
    const { service, users, twoFactor, audit } = setup()
    await service.unlink('u-dean', '123456', CTX)

    expect(twoFactor.verifyForUser).toHaveBeenCalledWith('u-dean', '123456')
    expect(users.removeEdsCredential).toHaveBeenCalledWith('u-dean')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-dean', action: 'eds_unlink', ip: '10.0.0.7' }),
    )
  })

  it('привязки нет → BAD_REQUEST, код не тратится', async () => {
    const { service, users, twoFactor } = setup()
    users.hasEdsCredential.mockResolvedValue(false)

    await expect(service.unlink('u-dean', '123456', CTX)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(twoFactor.verifyForUser).not.toHaveBeenCalled()
  })

  it('неверный код → INVALID_2FA_CODE, привязка цела', async () => {
    const { service, users, twoFactor } = setup()
    twoFactor.verifyForUser.mockResolvedValue(false)

    await expect(service.unlink('u-dean', '000000', CTX)).rejects.toMatchObject({
      code: 'INVALID_2FA_CODE',
    })
    expect(users.removeEdsCredential).not.toHaveBeenCalled()
  })
})

describe('EdsAuthService — ИИН не утекает', () => {
  // ИИН — персональные данные: наружу из сервиса уходят только HMAC и последние четыре цифры
  // (в ответе привязки). Ни в тексте ошибки, ни в журнале, ни в письме полного ИИН быть не должно.
  it('ни одна ошибка, запись аудита и письмо не содержат ИИН', async () => {
    const errors: unknown[] = []
    const capture = (p: Promise<unknown>) => p.catch((e: unknown) => errors.push(e))

    const notLinked = setup()
    notLinked.users.findEdsCredentialByIinHash.mockResolvedValue(null)
    await capture(
      notLinked.service.login(
        { challengeId: (await notLinked.service.createLoginChallenge()).challengeId, cms: 'c' },
        CTX,
      ),
    )

    const wrongRole = setup()
    wrongRole.users.findEdsCredentialByIinHash.mockResolvedValue({
      userId: 'u-st',
      role: Role.STUDENT,
    })
    await capture(
      wrongRole.service.login(
        { challengeId: (await wrongRole.service.createLoginChallenge()).challengeId, cms: 'c' },
        CTX,
      ),
    )

    const taken = setup()
    taken.users.findEdsCredentialByIinHash.mockResolvedValue({ userId: 'other', role: Role.DEAN })
    const takenChallenge = await taken.service.createLinkChallenge(dean())
    await capture(
      taken.service.link(
        dean(),
        { challengeId: takenChallenge.challengeId, cms: 'c', code: '123456' },
        CTX,
      ),
    )

    const linked = setup()
    const linkedChallenge = await linked.service.createLinkChallenge(dean())
    await linked.service.link(
      dean(),
      { challengeId: linkedChallenge.challengeId, cms: 'c', code: '123456' },
      CTX,
    )
    const signedIn = setup()
    await signedIn.service.login(
      { challengeId: (await signedIn.service.createLoginChallenge()).challengeId, cms: 'c' },
      CTX,
    )

    expect(errors).toHaveLength(3)
    for (const error of errors) {
      expect(error).toBeInstanceOf(AppException)
      const e = error as AppException
      expect(e.message).not.toContain(IIN)
      expect(JSON.stringify(e.getResponse())).not.toContain(IIN)
      expect(JSON.stringify(e.details ?? [])).not.toContain(IIN)
    }
    for (const ctx of [notLinked, wrongRole, taken, linked, signedIn]) {
      expect(JSON.stringify(ctx.audit.record.mock.calls)).not.toContain(IIN)
      expect(JSON.stringify(ctx.queue.enqueue.mock.calls)).not.toContain(IIN)
      // И в Redis — только nonce и назначение, ИИН там нет и не было.
      expect(JSON.stringify(ctx.redis.set.mock.calls)).not.toContain(IIN)
    }
    // Ключи счётчика — по HMAC, не по ИИН.
    expect(JSON.stringify(signedIn.loginAttempts.beginAttempt.mock.calls)).not.toContain(IIN)
  })
})

describe('surnameMismatch', () => {
  it('регистр и «ё» не важны: фамилия — первое слово CN', () => {
    expect(surnameMismatch('СЁМИНА АННА ПЕТРОВНА', 'Семина')).toBe(false)
    expect(surnameMismatch('семина анна', '  СЁМИНА ')).toBe(false)
  })

  it('другая фамилия, латиница вместо кириллицы и пустой CN — расхождение', () => {
    expect(surnameMismatch('ИВАНОВА АННА', 'Петрова')).toBe(true)
    expect(surnameMismatch('IVANOVA ANNA', 'Иванова')).toBe(true)
    expect(surnameMismatch('', 'Иванова')).toBe(true)
  })

  it('двойная фамилия сравнивается целиком', () => {
    expect(surnameMismatch('ИВАНОВА-ПЕТРОВА АННА', 'Иванова-Петрова')).toBe(false)
  })
})

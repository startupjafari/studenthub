import { describe, expect, it } from 'vitest'
import {
  isRecoverableAuthError,
  isSessionRefused,
  REFRESH_RATE_LIMIT_RETRIES,
  refreshRetryDelayMs,
  type AuthErrorContext,
} from './auth-retry'

// База: истёкший токен у обычного запроса с Bearer.
function ctx(overrides: Partial<AuthErrorContext> = {}): AuthErrorContext {
  return {
    status: 401,
    code: 'TOKEN_EXPIRED',
    hasBearer: true,
    url: '/chats',
    alreadyRetried: false,
    ...overrides,
  }
}

describe('isRecoverableAuthError', () => {
  it('истёкший access-токен лечится', () => {
    expect(isRecoverableAuthError(ctx())).toBe(true)
  })

  it('запрос без Bearer с UNAUTHORIZED лечится — это гонка с восстановлением сессии', () => {
    expect(isRecoverableAuthError(ctx({ code: 'UNAUTHORIZED', hasBearer: false }))).toBe(true)
  })

  it('UNAUTHORIZED при наличии Bearer не лечится — токен отвергнут сервером', () => {
    expect(isRecoverableAuthError(ctx({ code: 'UNAUTHORIZED', hasBearer: true }))).toBe(false)
  })

  it('неверный пароль не лечится: повтор второй раз потратил бы лимит попыток', () => {
    expect(
      isRecoverableAuthError(ctx({ code: 'UNAUTHORIZED', hasBearer: false, url: '/auth/login' })),
    ).toBe(false)
  })

  it('вход по коду 2FA не лечится (подпуть /auth/login)', () => {
    expect(
      isRecoverableAuthError(
        ctx({ code: 'UNAUTHORIZED', hasBearer: false, url: '/auth/login/2fa' }),
      ),
    ).toBe(false)
  })

  it('сам refresh не лечится — иначе цикл', () => {
    expect(
      isRecoverableAuthError(ctx({ code: 'UNAUTHORIZED', hasBearer: false, url: '/auth/refresh' })),
    ).toBe(false)
  })

  it('регистрация по инвайту не лечится: 401 значит «инвайт негодный»', () => {
    expect(
      isRecoverableAuthError(
        ctx({ code: 'UNAUTHORIZED', hasBearer: false, url: '/auth/register-by-invite' }),
      ),
    ).toBe(false)
  })

  it('вход по QR не лечится: секрет одноразовый', () => {
    expect(
      isRecoverableAuthError(
        ctx({ code: 'UNAUTHORIZED', hasBearer: false, url: '/auth/qr/claim' }),
      ),
    ).toBe(false)
  })

  it('повторно один запрос не лечим — защита от цикла', () => {
    expect(isRecoverableAuthError(ctx({ alreadyRetried: true }))).toBe(false)
  })

  it('не-401 не лечится, даже с знакомым кодом', () => {
    expect(isRecoverableAuthError(ctx({ status: 403 }))).toBe(false)
    expect(isRecoverableAuthError(ctx({ status: 500, code: undefined }))).toBe(false)
  })

  it('прочие коды 401 не лечатся (например WRONG_SCOPE)', () => {
    expect(isRecoverableAuthError(ctx({ code: 'WRONG_SCOPE', hasBearer: false }))).toBe(false)
  })
})

describe('isSessionRefused — когда провал refresh означает конец сессии', () => {
  it('401 и 403 — сервер отверг сессию', () => {
    expect(isSessionRefused(401)).toBe(true)
    expect(isSessionRefused(403)).toBe(true)
  })

  it('429, 5xx и обрыв сети — временное: сессию не бросаем', () => {
    expect(isSessionRefused(429)).toBe(false)
    expect(isSessionRefused(503)).toBe(false)
    expect(isSessionRefused(undefined)).toBe(false)
  })
})

describe('refreshRetryDelayMs — повтор refresh после 429', () => {
  const noJitter = () => 0

  it('429 повторяется с растущей выдержкой: 1, 2, 4 с', () => {
    expect(refreshRetryDelayMs({ status: 429, attempt: 0, random: noJitter })).toBe(1_000)
    expect(refreshRetryDelayMs({ status: 429, attempt: 1, random: noJitter })).toBe(2_000)
    expect(refreshRetryDelayMs({ status: 429, attempt: 2, random: noJitter })).toBe(4_000)
  })

  it('после исчерпания повторов — сдаёмся', () => {
    expect(
      refreshRetryDelayMs({ status: 429, attempt: REFRESH_RATE_LIMIT_RETRIES, random: noJitter }),
    ).toBeNull()
  })

  it('Retry-After удлиняет выдержку, но не дольше 15 с', () => {
    expect(
      refreshRetryDelayMs({ status: 429, retryAfter: '7', attempt: 0, random: noJitter }),
    ).toBe(7_000)
    expect(
      refreshRetryDelayMs({ status: 429, retryAfter: '60', attempt: 0, random: noJitter }),
    ).toBe(15_000)
  })

  it('разброс — не больше половины выдержки', () => {
    expect(refreshRetryDelayMs({ status: 429, attempt: 0, random: () => 0.999 })).toBeLessThan(
      1_500,
    )
  })

  it('отказ в сессии, 5xx и сеть не повторяются: обмен мог уже пройти', () => {
    for (const status of [401, 403, 500, undefined]) {
      expect(refreshRetryDelayMs({ status, attempt: 0 })).toBeNull()
    }
  })
})

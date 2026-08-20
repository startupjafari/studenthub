import { describe, expect, it } from 'vitest'
import { isRecoverableAuthError, type AuthErrorContext } from './auth-retry'

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

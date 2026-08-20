import type { FastifyReply, FastifyRequest } from 'fastify'
import { AuthController } from './auth.controller'
import type { AuthService, SessionResult } from './auth.service'
import type { QrLoginService } from './qr-login.service'
import type { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { REFRESH_COOKIE, ROLE_COOKIE } from './auth.constants'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'

// Роль cookie в /auth/refresh: у отказа она такая же важная, как код ответа, — role-cookie,
// пережившая мёртвую сессию, разворачивает пользователя обратно в приложение (middleware §3).

function setup(refreshImpl: () => Promise<SessionResult>) {
  const authService = { refresh: jest.fn(refreshImpl) } as unknown as AuthService
  const config = {
    get: jest.fn().mockReturnValue('development'),
  } as unknown as ConfigService<EnvVars, true>
  const controller = new AuthController(
    authService,
    config,
    {} as QrLoginService,
    {} as AuditService,
  )

  const setCookie = jest.fn()
  const clearCookie = jest.fn()
  const reply = { setCookie, clearCookie } as unknown as FastifyReply
  const req = {
    ip: '::1',
    headers: {},
    cookies: { [REFRESH_COOKIE]: 'rt' },
  } as unknown as FastifyRequest

  return { controller, reply, req, setCookie, clearCookie }
}

const session: SessionResult = {
  accessToken: 'at',
  refreshToken: 'rt-new',
  refreshExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
  payload: {
    sub: 'u1',
    role: 'STUDENT',
    universityId: 'uni1',
    facultyId: null,
    groupId: null,
  },
} as unknown as SessionResult

describe('AuthController.refresh — cookie при отказе', () => {
  it('успех: обе cookie выставляются', async () => {
    const { controller, reply, req, setCookie, clearCookie } = setup(async () => session)

    await controller.refresh(req, reply)

    expect(setCookie).toHaveBeenCalledWith(REFRESH_COOKIE, 'rt-new', expect.any(Object))
    expect(setCookie).toHaveBeenCalledWith(ROLE_COOKIE, expect.any(String), expect.any(Object))
    expect(clearCookie).not.toHaveBeenCalled()
  })

  it('отказ: гасим и refresh-, и role-cookie, ошибку пробрасываем', async () => {
    const { controller, reply, req, setCookie, clearCookie } = setup(() =>
      Promise.reject(new AppException('UNAUTHORIZED', 'Сессия скомпрометирована, войдите заново')),
    )

    const err = await controller.refresh(req, reply).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AppException)
    expect((err as AppException).code).toBe('UNAUTHORIZED')
    // Без гашения role-cookie middleware вернул бы пользователя с /login на home,
    // где refresh падает снова — бесконечный редирект.
    expect(clearCookie).toHaveBeenCalledWith(ROLE_COOKIE, { path: '/' })
    expect(clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE, expect.any(Object))
    expect(setCookie).not.toHaveBeenCalled()
  })
})

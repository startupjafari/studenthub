import type { FastifyReply } from 'fastify'
import type { SessionResult } from './auth.service'
import { AUTH_COOKIE_PATH, REFRESH_COOKIE, ROLE_COOKIE } from './auth.constants'

/**
 * Cookie выданной сессии — общие для всех способов входа (пароль, 2FA, QR, регистрация, ЭЦП).
 * Вынесено из AuthController, чтобы второй контроллер входа (EdsController) ставил ровно те же
 * cookie, а не их копию, которая разойдётся при первой правке.
 */
export function setAuthCookies(reply: FastifyReply, session: SessionResult, secure: boolean): void {
  // Refresh — httpOnly, только на auth-пути (§6.2).
  reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: AUTH_COOKIE_PATH,
    expires: session.refreshExpiresAt,
  })
  // role-cookie — нечувствительная, для ролевого редиректа в middleware (§16.2). Не httpOnly.
  const roleValue = Buffer.from(
    JSON.stringify({
      role: session.payload.role,
      universityId: session.payload.universityId,
      facultyId: session.payload.facultyId,
      groupId: session.payload.groupId,
    }),
  ).toString('base64url')
  reply.setCookie(ROLE_COOKIE, roleValue, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: session.refreshExpiresAt,
  })
}

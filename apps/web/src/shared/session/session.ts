import type { Role } from '@studenthub/shared-types'
import { meRequest, refreshAccessToken, type MeResponse } from '../api'
import { store } from '../store/store'
import { clearAuth, setAccessToken, setAuth, setSessionUser } from '../store/auth-slice'
import type { AuthUser } from '../store/auth-slice'
import { logoutRequest } from '../api/auth-api'
import { syncLocaleCookieFromProfile } from '../i18n/locale-cookie'
import { claimDeviceCache, forgetDeviceData } from './device-data'
import { announceLogout } from './session-channel'

// Поля профиля, которые держит стор сессии (остальное читается из кэша `me`).
function toSessionUser(me: MeResponse): AuthUser {
  return { id: me.id, firstName: me.firstName, lastName: me.lastName, avatarUrl: me.avatarUrl }
}

// Устанавливает сессию по access-токену: кладёт токен, тянет профиль, наполняет Redux.
export async function establishSession(accessToken: string): Promise<Role> {
  store.dispatch(setAccessToken(accessToken))
  const me = await meRequest()
  // Язык из профиля — в cookie, которую читает next-intl. Нужно ровно для входа с нового
  // устройства: там cookie ещё дефолтная, а язык человека уже известен. Перерендер здесь
  // не вызываем — за входом всегда следует переход, он и подхватит.
  syncLocaleCookieFromProfile(me.locale)
  // До наполнения стора: следующие запросы уже пойдут от нового человека, и офлайн-кэш
  // прошлого не должен им подвернуться.
  await claimDeviceCache(me.id)
  store.dispatch(
    setAuth({
      user: toSessionUser(me),
      role: me.role,
      universityId: me.universityId,
      facultyId: me.facultyId,
      groupId: me.groupId,
      accessToken,
    }),
  )
  return me.role
}

/**
 * Синхронизация профиля в сторе после правки `me` (аватар, имя). Стор наполняется один раз
 * при входе, поэтому без этого вызова обновлённый аватар виден в профиле (он читает кэш
 * React Query), но не там, где автор берётся из сессии.
 */
export function syncSessionUser(me: MeResponse): void {
  store.dispatch(setSessionUser(toSessionUser(me)))
}

// Восстановление сессии после перезагрузки: refresh по httpOnly cookie → профиль.
//
// Обмен идёт через общий дедуплицированный refreshAccessToken, а не своим запросом: refresh-токен
// одноразовый, и параллельный обмен из интерцептора (запросы первого рендера, ушедшие без Bearer)
// выглядел бы для сервера как повторное использование — реюз-детектор погасил бы всю сессию.
//
// Без role-cookie не восстанавливаем: сервер ставит её вместе с refresh-cookie и гасит
// вместе с ней, так что её нет только после выхода, который не дошёл до сервера (см.
// endSession). Тихий обмен уцелевшей refresh-cookie вернул бы человека в сессию, из
// которой он только что вышел.
export async function restoreSession(): Promise<Role | null> {
  if (!hasRoleCookie()) return null
  try {
    return await establishSession(await refreshAccessToken())
  } catch {
    return null
  }
}

// Выход: стираем данные пользователя с устройства, гасим серверную сессию и локальный стор.
//
// Не бросает: выход завершается локально при любом ответе сервера. Если `POST /auth/logout`
// не дошёл (офлайн, 5xx), раньше исключение срывало переход на /login — данные оставались на
// экране, а следующий запрос тихо обновлял сессию, и человек уходил от общего компьютера,
// считая, что вышел. Теперь стираем role-cookie сами: middleware пустит на вход, а
// restoreSession не поднимет сессию из уцелевшей refresh-cookie.
export async function endSession(): Promise<void> {
  try {
    await forgetDeviceData()
    await logoutRequest()
  } catch {
    dropRoleCookie()
  } finally {
    store.dispatch(clearAuth())
    announceLogout()
  }
}

// Нечувствительная role-cookie (решение §16.2): ставит и гасит её сервер вместе с refresh.
const ROLE_COOKIE = 'sh_role'

function hasRoleCookie(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split('; ').some((c) => c.startsWith(`${ROLE_COOKIE}=`))
}

function dropRoleCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${ROLE_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`
}

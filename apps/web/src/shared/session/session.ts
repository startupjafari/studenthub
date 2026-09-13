import type { Role } from '@studenthub/shared-types'
import { meRequest, refreshAccessToken, type MeResponse } from '../api'
import { store } from '../store/store'
import { clearAuth, setAccessToken, setAuth, setSessionUser } from '../store/auth-slice'
import type { AuthUser } from '../store/auth-slice'
import { logoutRequest } from '../api/auth-api'

// Поля профиля, которые держит стор сессии (остальное читается из кэша `me`).
function toSessionUser(me: MeResponse): AuthUser {
  return { id: me.id, firstName: me.firstName, lastName: me.lastName, avatarUrl: me.avatarUrl }
}

// Устанавливает сессию по access-токену: кладёт токен, тянет профиль, наполняет Redux.
export async function establishSession(accessToken: string): Promise<Role> {
  store.dispatch(setAccessToken(accessToken))
  const me = await meRequest()
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
export async function restoreSession(): Promise<Role | null> {
  try {
    return await establishSession(await refreshAccessToken())
  } catch {
    return null
  }
}

// Выход: гасим серверную сессию и локальный стор.
export async function endSession(): Promise<void> {
  try {
    await logoutRequest()
  } finally {
    store.dispatch(clearAuth())
  }
}

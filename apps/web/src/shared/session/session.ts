import type { Role } from '@studenthub/shared-types'
import { meRequest, refreshAccessToken } from '../api'
import { store } from '../store/store'
import { clearAuth, setAccessToken, setAuth } from '../store/auth-slice'
import { logoutRequest } from '../api/auth-api'

// Устанавливает сессию по access-токену: кладёт токен, тянет профиль, наполняет Redux.
export async function establishSession(accessToken: string): Promise<Role> {
  store.dispatch(setAccessToken(accessToken))
  const me = await meRequest()
  store.dispatch(
    setAuth({
      user: { id: me.id, firstName: me.firstName, lastName: me.lastName, avatarUrl: me.avatarUrl },
      role: me.role,
      universityId: me.universityId,
      facultyId: me.facultyId,
      groupId: me.groupId,
      accessToken,
    }),
  )
  return me.role
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

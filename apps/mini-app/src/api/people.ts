import { apiGet, apiGetPaged, apiPatch } from './client'

// Люди: найти человека и решить, оставить ли ему доступ.
//
// С телефона доступны только поиск, карточка и блокировка — то, ради чего к списку
// обращаются вне рабочего места. Выгрузка, импорт и правка профиля остаются в вебе.

export interface Person {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  isBlocked: boolean
  createdAt: string
}

export interface Invite {
  id: string
  email: string | null
  role: string
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED'
  expiresAt: string
  createdAt: string
}

/**
 * Карточка человека для модератора (`GET /users/:id/moderation`).
 *
 * Отдельная ручка, а не профиль целиком: решение принимают по роли, вузу, состоянию
 * доступа и тому, попадался ли человек раньше. Остальные полсотни полей профиля с
 * телефона никто не читает, а ПДн в них хватает.
 */
export interface PersonCard {
  id: string
  firstName: string
  lastName: string
  role: string
  isBlocked: boolean
  createdAt: string
  university: { id: string; name: string } | null
  /** Жалобы на самого человека: всего и сколько подтвердилось. */
  complaints: { total: number; upheld: number }
}

export async function fetchPersonCard(id: string): Promise<PersonCard> {
  return apiGet<PersonCard>(`/users/${id}/moderation`)
}

/**
 * Поиск. Пустой запрос возвращает первую страницу списка — так экран показывает
 * заблокированных, не заставляя вспоминать фамилию.
 */
export async function searchPeople(
  search: string,
  blocked?: boolean,
): Promise<{ items: Person[]; total: number }> {
  const params = new URLSearchParams({ page: '1', limit: '20' })
  if (search.trim().length > 0) params.set('search', search.trim())
  if (blocked !== undefined) params.set('blocked', String(blocked))
  return apiGetPaged<Person>(`/users?${params.toString()}`)
}

/**
 * Блокировка требует кода 2FA, разблокировка — нет. Та же асимметрия, что у техработ:
 * отобрать доступ нельзя промахом по экрану, а вернуть обязано быть возможно сразу.
 */
export async function setBlocked(id: string, blocked: boolean, code?: string): Promise<void> {
  await apiPatch<null>(`/users/${id}/${blocked ? 'block' : 'unblock'}`, code ? { code } : {})
}

/** Выгнать чужого, не отбирая доступ у хозяина: блокировка наказала бы пострадавшего. */
export async function revokeSessions(id: string): Promise<void> {
  await apiPatch<null>(`/users/${id}/logout`, {})
}

export async function fetchInvites(): Promise<{ items: Invite[]; total: number }> {
  return apiGetPaged<Invite>('/invites?page=1&limit=20')
}

/** Отозвать ожидающий инвайт: ошибочно выданное приглашение иначе живёт до истечения. */
export async function revokeInvite(id: string): Promise<void> {
  await apiPatch<null>(`/invites/${id}/revoke`, {})
}

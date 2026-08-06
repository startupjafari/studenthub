import { cookies } from 'next/headers'
import { Role } from '@studenthub/shared-types'
import { ROLE_HOME } from '../config/routes'

export interface ServerSession {
  role: Role
  universityId: string | null
  facultyId: string | null
  groupId: string | null
}

// Читает роль из sh_role cookie на сервере (для layout-проверок роли). Не защита сама по себе —
// реальная авторизация на бэкенде; здесь решаем, что рендерить (§3).
export async function getServerSession(): Promise<ServerSession | null> {
  const store = await cookies()
  const value = store.get('sh_role')?.value
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as ServerSession
    if (parsed && typeof parsed.role === 'string' && parsed.role in ROLE_HOME) {
      return parsed
    }
  } catch {
    /* битая cookie */
  }
  return null
}

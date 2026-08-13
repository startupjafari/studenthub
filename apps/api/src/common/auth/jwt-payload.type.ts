import type { Role } from '@studenthub/shared-types'

// Payload access-токена (docs/BACKEND_RULES.md §6.2). Кладётся в request.user
// стратегией JwtStrategy; роль и scope берутся ТОЛЬКО отсюда, никогда из body/query.
export interface JwtPayload {
  sub: string
  role: Role
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  // Включена ли 2FA у пользователя на момент выдачи токена. Используется TwoFactorGuard
  // для форса настройки 2FA привилегированным ролям без обращения к БД на каждый запрос.
  // Обновляется при следующей ротации токена (refresh) после включения/отключения 2FA.
  tfa?: boolean
}

// Тип текущего пользователя запроса (то, что возвращает @CurrentUser()).
export type CurrentUserData = JwtPayload

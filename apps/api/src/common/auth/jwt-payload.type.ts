import type { Role } from '@studenthub/shared-types'

// Payload access-токена (docs/BACKEND_RULES.md §6.2). Кладётся в request.user
// стратегией JwtStrategy; роль и scope берутся ТОЛЬКО отсюда, никогда из body/query.
export interface JwtPayload {
  sub: string
  role: Role
  universityId: string | null
  facultyId: string | null
  groupId: string | null
}

// Тип текущего пользователя запроса (то, что возвращает @CurrentUser()).
export type CurrentUserData = JwtPayload

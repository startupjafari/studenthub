import { Role } from '@studenthub/shared-types'

// Какие роли может выдавать каждая роль — зеркало бэкенд-правила ALLOWED_ISSUERS
// (apps/api/.../invite-hierarchy.ts, docs/PROJECT.md §2.1). Бэкенд — источник истины;
// здесь только для UI-выбора (расхождение = лишний/скрытый пункт, не дыра безопасности).
export const INVITABLE_ROLES: Record<Role, Role[]> = {
  [Role.PLATFORM_ADMIN]: [Role.PLATFORM_MODERATOR, Role.UNIVERSITY_ADMIN],
  [Role.PLATFORM_MODERATOR]: [],
  [Role.UNIVERSITY_ADMIN]: [Role.UNIVERSITY_MODERATOR, Role.DEAN, Role.TEACHER],
  [Role.UNIVERSITY_MODERATOR]: [],
  [Role.DEAN]: [Role.TEACHER, Role.STAROSTA, Role.STUDENT],
  [Role.TEACHER]: [],
  [Role.STAROSTA]: [Role.STUDENT],
  [Role.STUDENT]: [],
}

// Роль, для которой платформенный админ обязан выбрать целевой вуз (invite-hierarchy.ts:
// UNIVERSITY_ADMIN — единственный случай, когда scope не выводится из выдающего).
export const UNIVERSITY_ROLES: Role[] = [Role.UNIVERSITY_ADMIN]

// Роли, требующие/допускающие выбор факультета при выдаче инвайта.
export const FACULTY_ROLES: Role[] = [Role.DEAN, Role.TEACHER]
// Роли, требующие выбор группы.
export const GROUP_ROLES: Role[] = [Role.STAROSTA, Role.STUDENT]

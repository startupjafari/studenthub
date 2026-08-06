// Роли платформы — единый источник для фронта и бэка (docs/PROJECT.md §2, docs/BACKEND_RULES.md §0).
// Локальное переобъявление Role запрещено. Значения совпадают с Prisma-enum `Role`
// (prisma/schema/_enums.prisma); порядок массива = иерархия сверху вниз.

export const Role = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  PLATFORM_MODERATOR: 'PLATFORM_MODERATOR',
  UNIVERSITY_ADMIN: 'UNIVERSITY_ADMIN',
  UNIVERSITY_MODERATOR: 'UNIVERSITY_MODERATOR',
  DEAN: 'DEAN',
  TEACHER: 'TEACHER',
  STAROSTA: 'STAROSTA',
  STUDENT: 'STUDENT',
} as const

export type Role = (typeof Role)[keyof typeof Role]

/** Иерархия ролей сверху вниз. Индекс меньше = выше по правам. */
export const ROLE_HIERARCHY: readonly Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
  Role.TEACHER,
  Role.STAROSTA,
  Role.STUDENT,
]

/** true, если роль `a` строго выше роли `b` в иерархии (для проверки выдачи инвайтов). */
export function isHigherRole(a: Role, b: Role): boolean {
  return ROLE_HIERARCHY.indexOf(a) < ROLE_HIERARCHY.indexOf(b)
}

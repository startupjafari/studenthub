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
  // Работодатель (Ф18) — единственная роль вне вуза. В иерархию инвайтов не входит:
  // её не «выдают сверху вниз», компания регистрируется сама и получает допуск от вуза.
  EMPLOYER: 'EMPLOYER',
  // Охрана одного вуза (docs/PROJECT.md §2): сканер QR, проверка студенческого, помещения,
  // камеры. Остальное API закрыто ей списком разрешённых маршрутов, а не по сервисам.
  SECURITY_GUARD: 'SECURITY_GUARD',
  // Библиотекарь одного вуза (docs/PROJECT.md §2, Фаза 20): каталог, выдача и возврат
  // книг. Закрыт так же, как охрана, — списком разрешённых маршрутов.
  LIBRARIAN: 'LIBRARIAN',
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
  // Охранник ниже студента. Место нужно правилу инвайтов «строго ниже своей роли»
  // (выдаёт только админ вуза) и модерации: модератор вуза может заблокировать охранника.
  // Студентам это ничего не открывает — модерация закрыта ролями отдельно.
  Role.SECURITY_GUARD,
  // Библиотекарь — там же и по той же причине. Друг над другом у охраны и библиотекаря
  // власти нет: модерация им обоим закрыта списком разрешённых маршрутов.
  Role.LIBRARIAN,
  // Работодатель стоит ниже всех: он не может пригласить никого и никем не приглашается
  // по обычной цепочке. Место в массиве нужно только чтобы indexOf возвращал число.
  Role.EMPLOYER,
]

/**
 * Роли с запретом по умолчанию (docs/PROJECT.md §2): им открыт только явный список
 * маршрутов, а не всё, что открыто любому вошедшему. Сервер закрывает остальное `403`
 * (`RestrictedRoleGuard`), веб не показывает и не запрашивает то, что им не положено:
 * поиск по платформе, чаты, профиль, документы.
 */
export const RESTRICTED_ROLES: readonly Role[] = [Role.SECURITY_GUARD, Role.LIBRARIAN]

/** true, если у роли запрет по умолчанию (`RESTRICTED_ROLES`). */
export function isRestrictedRole(role: Role | null | undefined): boolean {
  return role != null && RESTRICTED_ROLES.includes(role)
}

/** true, если роль `a` строго выше роли `b` в иерархии (для проверки выдачи инвайтов). */
export function isHigherRole(a: Role, b: Role): boolean {
  return ROLE_HIERARCHY.indexOf(a) < ROLE_HIERARCHY.indexOf(b)
}

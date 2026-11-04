import { Role } from '@studenthub/shared-types'
import type { ViewerLevel } from '@studenthub/campus-core'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { isPlatformRole } from '../../common/auth/group-scope'
import { AppException } from '../../common/exceptions/app.exception'

/**
 * Права кампуса (docs/CAMPUS_BUILDER.md §19). Новых ролей нет: правят и публикуют админ и
 * модератор вуза (решение владельца) и платформа; смотрят все члены вуза и охрана. Работодатель
 * планов вуза не видит.
 */
export const CAMPUS_EDITOR_ROLES: readonly Role[] = [
  Role.PLATFORM_ADMIN,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
]

// Сотрудники видят служебные помещения (`staff`): преподавательские, кафедры, щитовые — нет.
const STAFF_ROLES: ReadonlySet<Role> = new Set([
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
  Role.TEACHER,
  Role.SECURITY_GUARD,
])

export function isCampusEditor(viewer: JwtPayload): boolean {
  return CAMPUS_EDITOR_ROLES.includes(viewer.role as Role)
}

/** Уровень зрителя опубликованной карты: что из помещений ему отдаётся. */
export function viewerLevel(viewer: JwtPayload): ViewerLevel {
  if (isCampusEditor(viewer)) return 'editor'
  return STAFF_ROLES.has(viewer.role as Role) ? 'staff' : 'public'
}

/** Смотреть кампус: платформа — везде, остальные — только свой вуз; работодатель — нет. */
export function assertCanView(viewer: JwtPayload, universityId: string): void {
  if (viewer.role === Role.EMPLOYER) throw new AppException('FORBIDDEN', 'Карта вуза недоступна')
  if (isPlatformRole(viewer.role as Role)) return
  if (viewer.universityId !== universityId) {
    throw new AppException('WRONG_SCOPE', 'Кампус другого вуза')
  }
}

/** Править кампус: роль редактора и свой вуз (роль проверяет и @Roles, здесь — вуз). */
export function assertCanEdit(viewer: JwtPayload, universityId: string): void {
  if (!isCampusEditor(viewer))
    throw new AppException('FORBIDDEN', 'Править карту может администратор или модератор вуза')
  if (isPlatformRole(viewer.role as Role)) return
  if (viewer.universityId !== universityId) {
    throw new AppException('WRONG_SCOPE', 'Кампус другого вуза')
  }
}

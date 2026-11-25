// Аудитории публикации по роли — зеркало ALLOWED_AUDIENCES из posts.service.ts
// (docs/PROJECT.md §2.2: модераторы посты не создают, поэтому их в карте нет).
import { Role } from '@studenthub/shared-types'
import type { PostAudienceValue } from '@studenthub/shared-schemas'

// PERSONAL отложен до списка пользователей Ф12.2.
export const AUDIENCES_BY_ROLE: Partial<Record<Role, PostAudienceValue[]>> = {
  [Role.PLATFORM_ADMIN]: ['ALL', 'PERSONAL'],
  [Role.UNIVERSITY_ADMIN]: ['UNIVERSITY', 'FACULTY', 'GROUP', 'TEACHERS', 'PERSONAL'],
  [Role.DEAN]: ['FACULTY', 'GROUP', 'PERSONAL'],
  [Role.TEACHER]: ['GROUP', 'SUBJECT', 'PERSONAL'],
  [Role.STAROSTA]: ['GROUP', 'PERSONAL'],
  [Role.STUDENT]: ['GROUP', 'PERSONAL'],
  // Работодатель публикует только на странице своей компании.
  [Role.EMPLOYER]: ['COMPANY'],
}

// Кто выбирает конкретную группу/факультет. У студента и старосты группа своя, у декана —
// свой факультет, но не группа: группу факультета он выбирает (сервер подставил бы
// actor.groupId, а его у декана нет — «Не указана группа»).
export const GROUP_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER]
export const FACULTY_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN]

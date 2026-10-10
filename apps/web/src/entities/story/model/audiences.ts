// Аудитории сторис по роли — зеркало ALLOWED_AUDIENCES из stories.service.ts
// (docs/PROJECT.md §2.2, строка «Сторисы — создание»). Личной и предметной аудитории
// у сторис нет: формат публичный и живёт сутки.
import { Role } from '@studenthub/shared-types'
import type { StoryAudienceValue } from '@studenthub/shared-schemas'

export const STORY_AUDIENCES_BY_ROLE: Partial<Record<Role, StoryAudienceValue[]>> = {
  [Role.PLATFORM_ADMIN]: ['ALL'],
  [Role.UNIVERSITY_ADMIN]: ['UNIVERSITY', 'FACULTY', 'GROUP', 'TEACHERS'],
  [Role.DEAN]: ['FACULTY', 'GROUP'],
  [Role.TEACHER]: ['GROUP'],
  [Role.STAROSTA]: ['GROUP'],
  [Role.STUDENT]: ['GROUP'],
}

// Кто выбирает конкретную группу/факультет. У студента, старосты и декана они свои —
// сервер подставит их из профиля, и пикер только мешал бы.
export const STORY_GROUP_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN, Role.TEACHER]
export const STORY_FACULTY_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN]

/** Может ли роль публиковать сторисы (у модераторов и работодателя этого права нет). */
export function canCreateStory(role: Role | null): boolean {
  return role !== null && (STORY_AUDIENCES_BY_ROLE[role]?.length ?? 0) > 0
}

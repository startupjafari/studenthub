// Аудитории сторис по роли — зеркало ALLOWED_AUDIENCES из stories.service.ts
// (docs/PROJECT.md §2.2, строка «Сторисы — создание»). Предметной аудитории у сторис нет;
// личные (друзья и выбранные) доступны всем, кто публикует: круг задаёт сам автор.
import { Role } from '@studenthub/shared-types'
import type { StoryAudienceValue } from '@studenthub/shared-schemas'

const PERSONAL: StoryAudienceValue[] = ['FRIENDS', 'SELECTED']

export const STORY_AUDIENCES_BY_ROLE: Partial<Record<Role, StoryAudienceValue[]>> = {
  [Role.PLATFORM_ADMIN]: ['ALL', ...PERSONAL],
  [Role.UNIVERSITY_ADMIN]: ['UNIVERSITY', 'FACULTY', 'GROUP', 'TEACHERS', ...PERSONAL],
  [Role.DEAN]: ['FACULTY', 'GROUP', ...PERSONAL],
  [Role.TEACHER]: ['GROUP', ...PERSONAL],
  [Role.STAROSTA]: ['GROUP', ...PERSONAL],
  [Role.STUDENT]: ['GROUP', ...PERSONAL],
}

// Кто выбирает конкретную группу/факультет. У студента и старосты группа своя, у декана —
// факультет: их сервер подставит из профиля. Группы в профиле декана нет — её он
// выбирает среди групп своего факультета.
export const STORY_GROUP_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER]
export const STORY_FACULTY_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN]

/** Может ли роль публиковать сторисы (у модераторов и работодателя этого права нет). */
export function canCreateStory(role: Role | null): boolean {
  return role !== null && (STORY_AUDIENCES_BY_ROLE[role]?.length ?? 0) > 0
}

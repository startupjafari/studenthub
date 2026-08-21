// Аудитории публикации по роли — зеркало ALLOWED_AUDIENCES из posts.service.ts
// (docs/PROJECT.md §2.2: модераторы посты не создают, поэтому их в карте нет).
// Живёт в entities, а не в features/create-post: карта нужна двум фичам — созданию поста
// и репосту, а импорт между слайсами одного слоя запрещён (FRONTEND_RULES §2.1).
import { Role } from '@studenthub/shared-types'
import type { PostAudienceValue } from '@studenthub/shared-schemas'
import type { FeedPost } from './types'

// PERSONAL отложен до списка пользователей Ф12.2.
export const AUDIENCES_BY_ROLE: Partial<Record<Role, PostAudienceValue[]>> = {
  [Role.PLATFORM_ADMIN]: ['ALL', 'PERSONAL'],
  [Role.UNIVERSITY_ADMIN]: ['UNIVERSITY', 'FACULTY', 'GROUP', 'TEACHERS', 'PERSONAL'],
  [Role.DEAN]: ['FACULTY', 'GROUP', 'PERSONAL'],
  [Role.TEACHER]: ['GROUP', 'SUBJECT', 'PERSONAL'],
  [Role.STAROSTA]: ['GROUP', 'PERSONAL'],
  [Role.STUDENT]: ['GROUP', 'PERSONAL'],
}

// Репост: у RepostSchema нет поля subject, поэтому аудитория SUBJECT недоступна —
// сервер ответил бы «Не указан предмет».
export const REPOST_AUDIENCES_BY_ROLE: Partial<Record<Role, PostAudienceValue[]>> =
  Object.fromEntries(
    Object.entries(AUDIENCES_BY_ROLE).map(([role, list]) => [
      role,
      (list ?? []).filter((a) => a !== 'SUBJECT'),
    ]),
  )

// Кто выбирает конкретную группу/факультет (у студента/старосты/декана — свои, без пикера).
export const GROUP_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN, Role.TEACHER]
export const FACULTY_PICKER_ROLES: Role[] = [Role.UNIVERSITY_ADMIN]

// Можно ли репостить этот пост: роль должна уметь публиковать, сам пост — быть опубликованным
// (черновик и отложенный ещё не видны никому) и не личным (личный адресован одному человеку).
export function canRepost(role: Role | null, post: Pick<FeedPost, 'audience' | 'status'>): boolean {
  if (role === null) return false
  if (post.audience === 'PERSONAL' || post.status !== 'PUBLISHED') return false
  return (REPOST_AUDIENCES_BY_ROLE[role] ?? []).length > 0
}

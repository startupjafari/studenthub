import type { Prisma } from '@prisma/client'
import { Role, isHigherRole } from '@studenthub/shared-types'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

/** Поля автора, по которым решается модерация: ранг и scope — из его записи User, не из запроса. */
export const CONTENT_AUTHOR_SELECT = {
  role: true,
  universityId: true,
  facultyId: true,
} satisfies Prisma.UserSelect

export type ContentAuthor = Prisma.UserGetPayload<{ select: typeof CONTENT_AUTHOR_SELECT }>

type ContentScope = Pick<ContentAuthor, 'universityId' | 'facultyId'>

// Роли, которые снимают чужой контент в своём scope, — те же, что у постов (posts.service).
const MODERATOR_ROLES: ReadonlySet<Role> = new Set([
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
])

export function isContentModerator(role: Role): boolean {
  return MODERATOR_ROLES.has(role)
}

/**
 * Снятие чужого контента профиля модератором (статья, опрос, медиа, комментарий к статье или
 * опросу) — по правилам постов (posts.service assertModerator): платформа — везде; админ и
 * модератор вуза — в своём вузе; декан — на своём факультете. Чужое снимает только роль
 * СТРОГО выше автора: иначе модератор вуза снимал бы статьи админа вуза.
 *
 * Своего scope у контента профиля нет, как у поста: он живёт в профиле автора, поэтому scope —
 * вуз и факультет автора из БД (роль и scope модератора — из JWT). Для комментария `context` —
 * владелец статьи или опроса: под материалом своего студента модератор вуза снимает и
 * комментарий гостя из другого вуза, как комментарий под постом своего вуза. Ранг при этом
 * сверяется с автором самого комментария.
 */
export function assertContentModerator(
  actor: JwtPayload,
  author: ContentAuthor,
  context?: ContentScope | null,
): void {
  if (!isContentModerator(actor.role)) {
    throw new AppException('FORBIDDEN', 'Недостаточно прав')
  }
  if (!isHigherRole(actor.role, author.role)) {
    throw new AppException('FORBIDDEN', 'Чужой контент снимает только роль выше автора')
  }
  if (actor.role === Role.PLATFORM_ADMIN || actor.role === Role.PLATFORM_MODERATOR) return
  const scopes = context ? [author, context] : [author]
  if (actor.role === Role.DEAN) {
    if (actor.facultyId && scopes.some((s) => s.facultyId === actor.facultyId)) return
    throw new AppException('WRONG_SCOPE', 'Контент другого факультета')
  }
  if (actor.universityId && scopes.some((s) => s.universityId === actor.universityId)) return
  throw new AppException('WRONG_SCOPE', 'Контент другого университета')
}

import { Role, isHigherRole } from '@studenthub/shared-types'

interface Scope {
  universityId: string | null
  facultyId: string | null
}

/** Смотрящий — роль и scope из сессии (auth-slice), как их видит сервер в JWT. */
export interface ContentModerator extends Scope {
  id: string | null
  role: Role | null
}

/** Владелец профиля, на чей контент смотрят. */
export interface ContentOwner extends Scope {
  id: string
  role: Role
}

/** Что модератор может снять в чужом профиле: пункты «Удалить (модерация)» в меню. */
export interface ContentModeration {
  /** Сам контент владельца — статьи, опросы, фото и видео: scope + роль строго выше. */
  content: boolean
  /** Комментарии под его контентом: scope владельца; ранг автора комментария сверит сервер. */
  comments: boolean
}

export const NO_MODERATION: ContentModeration = { content: false, comments: false }

// Роли, снимающие чужой контент в своём scope, — как в API (content-moderation.ts).
const MODERATOR_ROLES: readonly Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

function inScope(viewer: ContentModerator, owner: Scope): boolean {
  if (viewer.role === Role.PLATFORM_ADMIN || viewer.role === Role.PLATFORM_MODERATOR) return true
  if (viewer.role === Role.DEAN) {
    return viewer.facultyId !== null && viewer.facultyId === owner.facultyId
  }
  return viewer.universityId !== null && viewer.universityId === owner.universityId
}

/**
 * Зеркало правил API для контента профиля: платформа — везде, админ и модератор вуза — свой
 * вуз, декан — свой факультет; чужое снимает только роль строго выше автора. Решает сервер —
 * здесь лишь не показываем пункт тем, кому он заведомо откажет.
 */
export function contentModeration(
  viewer: ContentModerator,
  owner: ContentOwner,
): ContentModeration {
  if (!viewer.role || viewer.id === owner.id || !MODERATOR_ROLES.includes(viewer.role)) {
    return NO_MODERATION
  }
  const comments = inScope(viewer, owner)
  return { comments, content: comments && isHigherRole(viewer.role, owner.role) }
}

import { PostAudience, type Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

/**
 * Какие события видит человек — по аудитории, как посты (задача 10.2). Общая для списка
 * событий и глобального поиска: поиск по названию искал по всему вузу и показывал студенту
 * заголовки событий чужих факультетов, групп и «только для преподавателей».
 */
export function eventVisibilityWhere(viewer: JwtPayload): Prisma.EventWhereInput {
  const or: Prisma.EventWhereInput[] = [{ audience: PostAudience.ALL }, { organizerId: viewer.sub }]
  if (viewer.universityId) {
    or.push({ audience: PostAudience.UNIVERSITY, universityId: viewer.universityId })
    // SUBJECT — событие преподавателя всему вузу: ни предмета, ни курса у события нет, и
    // интерфейс так и подписывает аудиторию («Весь вуз (от преподавателя)», E-F28). Сузить
    // до студентов курса можно только привязкой к курсу (courseId) — это миграция.
    or.push({ audience: PostAudience.SUBJECT, universityId: viewer.universityId })
    if (viewer.role === Role.TEACHER) {
      or.push({ audience: PostAudience.TEACHERS, universityId: viewer.universityId })
    }
  }
  if (viewer.facultyId) or.push({ audience: PostAudience.FACULTY, facultyId: viewer.facultyId })
  if (viewer.groupId) or.push({ audience: PostAudience.GROUP, groupId: viewer.groupId })
  return { OR: or }
}

/**
 * События, которыми зритель управляет или которые модерирует, — сверх адресованных ему
 * самому. Без этого админ вуза получал 404 на событие факультета или группы, хотя правка и
 * удаление ему разрешены (canManageEvent), а модератор не мог открыть обсуждение, чтобы
 * снять комментарий. Тот же приём, что `moderationWhere` у постов.
 *
 * null — модерирующего scope у роли нет; `{}` — вся платформа.
 */
export function eventModerationWhere(viewer: JwtPayload): Prisma.EventWhereInput | null {
  switch (viewer.role) {
    case Role.PLATFORM_ADMIN:
    case Role.PLATFORM_MODERATOR:
      return {}
    case Role.UNIVERSITY_ADMIN:
    case Role.UNIVERSITY_MODERATOR:
      return viewer.universityId ? { universityId: viewer.universityId } : null
    case Role.DEAN:
      return viewer.facultyId ? { facultyId: viewer.facultyId } : null
    default:
      return null
  }
}

/**
 * Видимость внутри модуля событий: адресованные зрителю плюс его scope управления и
 * модерации. Поиск и карьерные мероприятия по-прежнему берут eventVisibilityWhere —
 * там речь о том, что адресовано человеку, а не о том, что он модерирует.
 */
export function eventAccessWhere(viewer: JwtPayload): Prisma.EventWhereInput {
  const visible = eventVisibilityWhere(viewer)
  const moderated = eventModerationWhere(viewer)
  return moderated ? { OR: [visible, moderated] } : visible
}

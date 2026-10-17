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

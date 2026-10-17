import type { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { AppException } from '../exceptions/app.exception'

// Общие кирпичи проверок scope по группе (C-F30). Раньше каждый академический сервис держал
// свою копию `isPlatform` и `resolveGroup`, и правка правил доступа повторялась в нескольких
// местах — копии уже начали расходиться. Переезжают сюда постепенно, модуль за модулем.

/** Платформенные роли: своего вуза у них нет, scope по группе их не ограничивает. */
export function isPlatformRole(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

/** Факультет и вуз группы — то, с чем сверяется scope декана и сотрудников вуза. */
export interface GroupScope {
  facultyId: string
  universityId: string
}

/** Факультет и вуз группы; нет группы — NOT_FOUND. */
export async function resolveGroupScope(
  db: Pick<Prisma.TransactionClient, 'group'>,
  groupId: string,
): Promise<GroupScope> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { facultyId: true, faculty: { select: { universityId: true } } },
  })
  if (!group) throw new AppException('NOT_FOUND', 'Группа не найдена')
  return { facultyId: group.facultyId, universityId: group.faculty.universityId }
}

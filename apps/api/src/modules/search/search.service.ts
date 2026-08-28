import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const STUDENT_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

const LIMIT = 6

// Глобальный поиск (задача 22): кросс-модульно, по scope. Каждый источник — независимо и
// устойчиво (Promise.allSettled): если домен ещё не мигрирован, его блок просто пуст.
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name)

  constructor(private readonly prisma: PrismaService) {}

  async search(viewer: JwtPayload, q: string) {
    const contains: Prisma.StringFilter = { contains: q, mode: 'insensitive' }
    const uni = viewer.universityId ?? '__none__'

    const [people, courses, assignments, materials, events, chats] = await Promise.allSettled([
      this.prisma.user.findMany({
        where: {
          ...(isPlatform(viewer.role) ? {} : { universityId: uni }),
          deletedAt: null,
          isBlocked: false,
          // По username тоже: упоминание в комментарии пишут как @username, и без
          // этого автодополнение не находило человека по тому, что уже набрано.
          OR: [{ firstName: contains }, { lastName: contains }, { username: contains }],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          avatarUrl: true,
          role: true,
        },
        take: LIMIT,
      }),
      this.prisma.course.findMany({
        where: { ...this.courseScope(viewer, uni), subject: { is: { name: contains } } },
        select: {
          id: true,
          subject: { select: { name: true } },
          group: { select: { name: true } },
        },
        take: LIMIT,
      }),
      this.prisma.assignment.findMany({
        where: { ...this.assignmentScope(viewer, uni), title: contains },
        select: {
          id: true,
          title: true,
          course: { select: { subject: { select: { name: true } } } },
        },
        take: LIMIT,
      }),
      this.prisma.material.findMany({
        where: { ...this.materialScope(viewer, uni), title: contains },
        select: { id: true, title: true, subject: true },
        take: LIMIT,
      }),
      // События — по названию в пределах вуза (платформа — без ограничения).
      this.prisma.event.findMany({
        where: { ...this.eventScope(viewer, uni), title: contains },
        select: { id: true, title: true, startsAt: true },
        orderBy: { startsAt: 'desc' },
        take: LIMIT,
      }),
      // Чаты — только те, где смотрящий состоит (scope = членство), по названию группы.
      this.prisma.chat.findMany({
        where: { title: contains, members: { some: { userId: viewer.sub } } },
        select: { id: true, title: true, type: true },
        take: LIMIT,
      }),
    ])

    return {
      people: this.value(people),
      courses: this.value(courses),
      assignments: this.value(assignments),
      materials: this.value(materials),
      events: this.value(events),
      chats: this.value(chats),
    }
  }

  private value<T>(res: PromiseSettledResult<T[]>): T[] {
    if (res.status === 'fulfilled') return res.value
    this.logger.debug(`search source failed: ${String((res as PromiseRejectedResult).reason)}`)
    return []
  }

  private courseScope(viewer: JwtPayload, uni: string): Prisma.CourseWhereInput {
    if (isPlatform(viewer.role)) return {}
    if (STUDENT_ROLES.includes(viewer.role)) return { groupId: viewer.groupId ?? '__none__' }
    return { group: { is: { faculty: { is: { universityId: uni } } } } }
  }

  private assignmentScope(viewer: JwtPayload, uni: string): Prisma.AssignmentWhereInput {
    if (isPlatform(viewer.role)) return {}
    if (STUDENT_ROLES.includes(viewer.role)) {
      return {
        status: { in: ['PUBLISHED', 'CLOSED'] },
        course: { is: { groupId: viewer.groupId ?? '__none__' } },
      }
    }
    if (viewer.role === Role.TEACHER) return { course: { is: { teacherId: viewer.sub } } }
    return { course: { is: { group: { is: { faculty: { is: { universityId: uni } } } } } } }
  }

  private materialScope(viewer: JwtPayload, uni: string): Prisma.MaterialWhereInput {
    if (isPlatform(viewer.role)) return {}
    if (STUDENT_ROLES.includes(viewer.role)) return { groupId: viewer.groupId ?? '__none__' }
    return { group: { is: { faculty: { is: { universityId: uni } } } } }
  }

  private eventScope(viewer: JwtPayload, uni: string): Prisma.EventWhereInput {
    if (isPlatform(viewer.role)) return {}
    return { universityId: uni }
  }
}

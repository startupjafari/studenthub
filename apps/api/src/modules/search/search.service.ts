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

    const [people, courses, assignments, materials] = await Promise.allSettled([
      this.prisma.user.findMany({
        where: {
          ...(isPlatform(viewer.role) ? {} : { universityId: uni }),
          deletedAt: null,
          isBlocked: false,
          OR: [{ firstName: contains }, { lastName: contains }],
        },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true },
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
    ])

    return {
      people: this.value(people),
      courses: this.value(courses),
      assignments: this.value(assignments),
      materials: this.value(materials),
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
}

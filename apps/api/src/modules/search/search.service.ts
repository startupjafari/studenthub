import { Injectable, Logger } from '@nestjs/common'
import { PostAudience, Prisma } from '@prisma/client'
import type { SearchSource } from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { eventVisibilityWhere } from '../events/event-visibility'
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

  /**
   * `types` — какие источники искать (без него — все). Подсказке упоминаний нужны только
   * люди: раньше каждый набранный символ гонял ещё пять запросов — курсы, задания,
   * материалы, события и чаты, — результат которых выбрасывался. Не запрошенный источник
   * в ответе остаётся — пустым массивом, форма ответа одна.
   */
  async search(viewer: JwtPayload, q: string, types?: readonly SearchSource[]) {
    const contains: Prisma.StringFilter = { contains: q, mode: 'insensitive' }
    const uni = viewer.universityId ?? '__none__'
    // Запрос не запрошенного источника не строится вовсе.
    const run = <T>(source: SearchSource, query: () => Promise<T[]>): Promise<T[]> =>
      !types || types.includes(source) ? query() : Promise.resolve([])

    const [people, courses, assignments, materials, events, chats] = await Promise.allSettled([
      run('people', () =>
        this.prisma.user.findMany({
          where: {
            ...(isPlatform(viewer.role) ? {} : { universityId: uni }),
            deletedAt: null,
            isBlocked: false,
            // По username тоже: упоминание в комментарии пишут как @username, и без
            // этого автодополнение не находило человека по тому, что уже набрано.
            //
            // Логин здесь — публичный @-хэндл в пределах вуза: им подписаны упоминания в
            // постах и комментариях, которые читает вся аудитория. Секретом он не считается:
            // от подбора пароля по логину защищает счётчик неудач по учётке (LOGIN_LOCKED),
            // а не сокрытие. Ищем только по началу — так набирают упоминание; перебор логинов
            // вуза по подстроке («admin» где угодно в логине) автодополнению не нужен.
            OR: [
              { firstName: contains },
              { lastName: contains },
              { username: { startsWith: q, mode: 'insensitive' } },
            ],
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
      ),
      run('courses', () =>
        this.prisma.course.findMany({
          where: { ...this.courseScope(viewer, uni), subject: { is: { name: contains } } },
          select: {
            id: true,
            subject: { select: { name: true } },
            group: { select: { name: true } },
          },
          take: LIMIT,
        }),
      ),
      run('assignments', () =>
        this.prisma.assignment.findMany({
          where: { ...this.assignmentScope(viewer, uni), title: contains },
          select: {
            id: true,
            title: true,
            course: { select: { subject: { select: { name: true } } } },
          },
          take: LIMIT,
        }),
      ),
      run('materials', () =>
        this.prisma.material.findMany({
          where: { ...this.materialScope(viewer, uni), title: contains },
          select: { id: true, title: true, subject: true },
          take: LIMIT,
        }),
      ),
      // События — по названию, в своём вузе и по аудитории (платформа — без ограничения).
      run('events', () =>
        this.prisma.event.findMany({
          where: { ...this.eventScope(viewer, uni), title: contains },
          select: { id: true, title: true, startsAt: true },
          orderBy: { startsAt: 'desc' },
          take: LIMIT,
        }),
      ),
      // Чаты — только те, где смотрящий состоит (scope = членство), по названию группы.
      run('chats', () =>
        this.prisma.chat.findMany({
          where: { title: contains, members: { some: { userId: viewer.sub, bannedAt: null } } },
          select: { id: true, title: true, type: true },
          take: LIMIT,
        }),
      ),
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

  // Свой вуз и та же видимость по аудитории, что у списка событий. События для всех (ALL)
  // заводит платформа, и вуза у них нет: условие «свой вуз» прятало их от поиска, хотя
  // в списке событий их видит каждый.
  private eventScope(viewer: JwtPayload, uni: string): Prisma.EventWhereInput {
    if (isPlatform(viewer.role)) return {}
    return {
      AND: [
        { OR: [{ universityId: uni }, { audience: PostAudience.ALL }] },
        eventVisibilityWhere(viewer),
      ],
    }
  }
}

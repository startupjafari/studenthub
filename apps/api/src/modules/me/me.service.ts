import { Injectable, Logger } from '@nestjs/common'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { SchedulesService } from '../schedules/schedules.service'
import { EventsService } from '../events/events.service'
import { NotificationsService } from '../notifications/notifications.service'
import { AssignmentsService } from '../assignments/assignments.service'
import { ApplicationsService } from '../application-services/applications.service'
import { localDateString } from '../../common/time/local-label'

const STUDENT_ROLES: readonly Role[] = [Role.STUDENT, Role.STAROSTA]

// Задания «Сегодня»: блок «требует внимания» показывает сроки на неделю вперёд (по дате
// вуза), поэтому окно — 9 суток, с запасом на сдвиг часового пояса относительно UTC.
const ASSIGNMENTS_LIMIT = 50
const ASSIGNMENTS_DAYS_AHEAD = 9

// Ответ агрегатора «мой день». Вложенные коллекции — как их отдают доменные сервисы
// (формы живут в своих доменах, здесь не переобъявляются).
export interface MeTodayResponse {
  role: Role
  date: string
  timezone: string | null
  pairs: Awaited<ReturnType<SchedulesService['getSchedule']>>['pairs']
  scheduleChanges: Awaited<ReturnType<SchedulesService['listChanges']>>
  applications: unknown[]
  events: unknown[]
  assignments: unknown[]
  notifications: unknown[]
}

// BFF-агрегатор операционного экрана «Сегодня» / Action Center (docs/UNIFIED_UX.md PR-1).
// НЕ дублирует доменную логику — вызывает существующие сервисы по scope роли и собирает
// единый ответ, чтобы главный экран делал ОДИН запрос вместо шести. Источники устойчивы:
// сбой одного не роняет весь день (как retry:false на фронте прежде).
@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: SchedulesService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly assignments: AssignmentsService,
    private readonly applications: ApplicationsService,
  ) {}

  async today(viewer: JwtPayload): Promise<MeTodayResponse> {
    // Дата дня по часам вуза — окно для изменений расписания: в UTC с полуночи до пяти утра
    // по Алматы «сегодня» показывало вчерашние замены. Формат — DateStringSchema (YYYY-MM-DD).
    // Пояс читается напрямую: это настройка корня тенанта, которую так же читают все модули,
    // а UniversityService тянул бы в BFF модуль инвайтов ради одного поля.
    const university = viewer.universityId
      ? await this.prisma.university.findUnique({
          where: { id: viewer.universityId },
          select: { timezone: true },
        })
      : null
    const date = localDateString(new Date(), university?.timezone)
    const isStudent = STUDENT_ROLES.includes(viewer.role)

    const [
      schedule,
      substitutions,
      scheduleChanges,
      applications,
      events,
      assignments,
      notifications,
    ] = await Promise.all([
      this.safe('schedule', () => this.schedules.getSchedule(viewer, {}), {
        timezone: null as string | null,
        pairs: [] as MeTodayResponse['pairs'],
      }),
      // Чужие пары, которые преподаватель ведёт сегодня по замене (C-F12): в недельной
      // выборке их нет, а провести и отметить занятие должен именно он.
      this.safe(
        'substitutions',
        () => this.schedules.substitutionPairs(viewer, date),
        [] as MeTodayResponse['pairs'],
      ),
      this.safe(
        'scheduleChanges',
        () => this.schedules.listChanges(viewer, { from: date, to: date }),
        [] as MeTodayResponse['scheduleChanges'],
      ),
      // Заявки актуальны только студенту/старосте; остальным — пусто (у них своя очередь).
      isStudent
        ? this.safe(
            'applications',
            () =>
              this.items(
                this.applications.list(
                  viewer,
                  this.q(50, { sortBy: 'createdAt', sortOrder: 'desc' }),
                ),
              ),
            { items: [] },
          )
        : Promise.resolve({ items: [] as unknown[] }),
      this.safe(
        'events',
        () => this.items(this.events.list(viewer, { filter: 'upcoming', page: 1, limit: 20 })),
        { items: [] },
      ),
      // Дедлайны недели и свежие прошедшие (просрочка, возврат на доработку): студенту
      // список отдаётся «актуальные сверху», а окно по сроку не пускает вперёд задания
      // на месяц вперёд. Раньше здесь были 20 самых ранних сроков за все семестры.
      this.safe(
        'assignments',
        () =>
          this.items(
            this.assignments.list(
              viewer,
              this.q(ASSIGNMENTS_LIMIT, { dueTo: this.inDays(ASSIGNMENTS_DAYS_AHEAD) }),
            ),
          ),
        { items: [] },
      ),
      this.safe(
        'notifications',
        () => this.items(this.notifications.list(viewer.sub, { limit: 20 })),
        { items: [] },
      ),
    ])

    const ownIds = new Set(schedule.pairs.map((p) => p.id))
    return {
      role: viewer.role,
      date,
      timezone: schedule.timezone,
      pairs: [...schedule.pairs, ...substitutions.filter((p) => !ownIds.has(p.id))],
      scheduleChanges,
      applications: applications.items,
      events: events.items,
      assignments: assignments.items,
      notifications: notifications.items,
    }
  }

  // Offset-запрос с дефолтами страницы (доменные схемы дефолтят page/limit, но их тип —
  // output z.infer, где поля обязательны; передаём явно).
  private q<E extends object>(limit: number, extra?: E): { page: number; limit: number } & E {
    return { page: 1, limit, ...(extra ?? ({} as E)) }
  }

  // Момент через `days` суток — ISO-строка, как граница периода в query-схемах.
  private inDays(days: number): string {
    return new Date(Date.now() + days * 86_400_000).toISOString()
  }

  // Разворачиваем Paginated в { items }, чтобы дефолт при сбое (`{ items: [] }`) был совместим по типу.
  private async items<T>(p: Promise<{ items: T[] }>): Promise<{ items: T[] }> {
    const r = await p
    return { items: r.items }
  }

  // Устойчивый вызов источника: ошибка логируется и подменяется безопасным дефолтом,
  // чтобы один упавший домен не ломал весь операционный экран.
  private async safe<T>(source: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      this.logger.warn(`me/today: источник "${source}" недоступен: ${(err as Error).message}`)
      return fallback
    }
  }
}

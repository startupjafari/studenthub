import { Injectable, Logger } from '@nestjs/common'
import { Role } from '@studenthub/shared-types'
import type { ApplicationServiceStatus } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { QueueService, QUEUES, NOTIFICATION_JOBS } from '../../common/queue'
import type { NotificationJobData } from '../notifications/notification-job.type'

// Сигналы стороне вуза (D-F16). Студент получает уведомление на каждом шаге заявки, а
// обработчики о новой или исправленной заявке узнавали, только открыв очередь сами, и
// просроченная по сроку обработки заявка висела молча.

/** Кто ведёт заявку на уровне вуза: деканат — свой факультет, администрация — весь вуз. */
const UNIVERSITY_STAFF_ROLES: Role[] = [Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR]

/** Очередь заявок каждой роли-обработчика — туда ведёт уведомление. */
const STAFF_QUEUE_URL: Partial<Record<Role, string>> = {
  [Role.DEAN]: '/dean/applications',
  [Role.UNIVERSITY_ADMIN]: '/university-admin/applications',
  [Role.UNIVERSITY_MODERATOR]: '/moderator/university/applications',
}

/**
 * Статусы, в которых просрочка что-то значит, — тот же набор, что у счётчика «Просрочено»
 * очереди (ApplicationProcessService.queueStats): сводка не должна называть другое число,
 * чем человек увидит, открыв очередь.
 */
const OVERDUE_STATUSES: ApplicationServiceStatus[] = [
  'SUBMITTED',
  'RESUBMITTED',
  'IN_REVIEW',
  'IN_PREPARATION',
  'NEEDS_CORRECTION',
]

// Потолки выборок (BACKEND_RULES §7.2). Сводка группирует просроченные по вузу, факультету и
// ответственному — групп столько, сколько факультетов и сотрудников с хвостами, не заявок.
const OVERDUE_GROUPS_LIMIT = 5000
const STAFF_LIMIT = 5000
// Обработчиков одной заявки — деканы факультета или администрация вуза: единицы.
const HANDLERS_LIMIT = 100

interface Recipient {
  id: string
  role: Role
}

export interface HandledApplication {
  id: string
  number: string | null
  universityId: string
  facultyId: string | null
  assignedToId: string | null
}

@Injectable()
export class ApplicationNotifier {
  private readonly logger = new Logger(ApplicationNotifier.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Сообщить обработчикам о поданной (SUBMITTED) или исправленной (RESUBMITTED) заявке.
   *
   * Адресат — ответственный, если он назначен; иначе деканы факультета заявки, а у вузовской
   * услуги (или факультета без декана) — администрация вуза. Письмо-зеркало не шлём: заявок
   * за день много, а почта обработчика — не очередь; ежедневная сводка просрочки зеркалится.
   *
   * Сбой здесь не отменяет подачу — она уже записана: уведомление best-effort, как любая
   * постановка в очередь.
   */
  async notifyHandlers(
    app: HandledApplication,
    kind: 'submitted' | 'resubmitted',
    eventId: string,
  ): Promise<void> {
    try {
      const recipients = await this.handlersOf(app)
      const dedupeKey = `application-${kind}:${eventId}`
      for (const [role, ids] of groupByRole(recipients)) {
        const job: NotificationJobData = {
          recipientIds: ids,
          type: 'APP_UPDATE',
          titleKey: `applications.${kind}.title`,
          bodyKey: `applications.${kind}.body`,
          params: { number: app.number ?? '' },
          data: { url: STAFF_QUEUE_URL[role], applicationId: app.id },
          dedupeKey,
          emailFallback: false,
        }
        await this.queue.enqueue(QUEUES.NOTIFICATIONS, NOTIFICATION_JOBS.APPLICATION_UPDATED, job, {
          jobId: `${dedupeKey}:${role}`,
        })
      }
    } catch (error) {
      this.logger.warn(
        `Заявка ${app.id}: не удалось уведомить обработчиков — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * Ежедневная сводка просрочки (cron в CleanupService): каждому обработчику — одно
   * уведомление с числом его просроченных заявок. Назначенные считаются за ответственным,
   * неназначенные — за деканами факультета или администрацией вуза, как при подаче.
   * Возвращает число адресатов.
   */
  async notifyOverdue(now = new Date()): Promise<number> {
    const groups = await this.prisma.application.groupBy({
      by: ['universityId', 'facultyId', 'assignedToId'],
      where: {
        deletedAt: null,
        submittedAt: { not: null },
        dueAt: { lt: now },
        status: { in: OVERDUE_STATUSES },
      },
      _count: { _all: true },
      orderBy: [{ universityId: 'asc' }, { facultyId: 'asc' }, { assignedToId: 'asc' }],
      take: OVERDUE_GROUPS_LIMIT,
    })
    if (groups.length === 0) return 0

    const staff = await this.staffDirectory(groups)
    const counts = new Map<string, { role: Role; count: number }>()
    const add = (recipients: Recipient[], count: number): void => {
      for (const r of recipients) {
        const entry = counts.get(r.id) ?? { role: r.role, count: 0 }
        entry.count += count
        counts.set(r.id, entry)
      }
    }
    for (const g of groups) {
      const assignee = g.assignedToId ? staff.byId.get(g.assignedToId) : undefined
      // Ответственный уволен или заблокирован — заявка снова «ничья» для сводки.
      add(
        assignee && assignee.universityId === g.universityId
          ? [assignee]
          : staff.handlers(g.universityId, g.facultyId),
        g._count._all,
      )
    }

    // Ключ — дата: сводка одна в день, повтор задачи в тот же день её не задвоит.
    const day = now.toISOString().slice(0, 10)
    for (const [userId, { role, count }] of counts) {
      const dedupeKey = `applications-overdue:${day}`
      const job: NotificationJobData = {
        recipientIds: [userId],
        type: 'APP_UPDATE',
        titleKey: 'applications.overdue.title',
        bodyKey: 'applications.overdue.body',
        params: { count },
        data: { url: STAFF_QUEUE_URL[role] },
        dedupeKey,
      }
      await this.queue.enqueue(QUEUES.NOTIFICATIONS, NOTIFICATION_JOBS.APPLICATION_UPDATED, job, {
        jobId: `${dedupeKey}:${userId}`,
      })
    }
    if (counts.size > 0) {
      this.logger.log(`notifyOverdue: сводка просрочки ушла ${counts.size} обработчикам`)
    }
    return counts.size
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Обработчики одной заявки (см. notifyHandlers). */
  private async handlersOf(app: HandledApplication): Promise<Recipient[]> {
    if (app.assignedToId) {
      const assignee = await this.prisma.user.findFirst({
        where: {
          id: app.assignedToId,
          universityId: app.universityId,
          deletedAt: null,
          isBlocked: false,
        },
        select: { id: true, role: true },
      })
      if (assignee) return [assignee]
    }
    const staff = await this.prisma.user.findMany({
      where: {
        universityId: app.universityId,
        deletedAt: null,
        isBlocked: false,
        OR: [
          { role: { in: UNIVERSITY_STAFF_ROLES } },
          ...(app.facultyId ? [{ role: Role.DEAN, facultyId: app.facultyId }] : []),
        ],
      },
      select: { id: true, role: true },
      take: HANDLERS_LIMIT,
    })
    const deans = staff.filter((u) => u.role === Role.DEAN)
    return deans.length > 0 ? deans : staff.filter((u) => u.role !== Role.DEAN)
  }

  /**
   * Сотрудники, нужные сводке, — двумя запросами на весь прогон, а не по запросу на группу:
   * ответственные по id и обработчики (деканы и администрация) вузов из выборки.
   */
  private async staffDirectory(
    groups: Array<{ universityId: string; facultyId: string | null; assignedToId: string | null }>,
  ) {
    const assigneeIds = [
      ...new Set(groups.flatMap((g) => (g.assignedToId ? [g.assignedToId] : []))),
    ]
    const universityIds = [...new Set(groups.map((g) => g.universityId))]
    const select = { id: true, role: true, universityId: true, facultyId: true } as const
    const alive = { deletedAt: null, isBlocked: false }
    const [assignees, handlers] = await Promise.all([
      assigneeIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: assigneeIds }, ...alive },
            select,
            take: assigneeIds.length,
          })
        : Promise.resolve([]),
      this.prisma.user.findMany({
        where: {
          universityId: { in: universityIds },
          role: { in: [...UNIVERSITY_STAFF_ROLES, Role.DEAN] },
          ...alive,
        },
        select,
        take: STAFF_LIMIT,
      }),
    ])
    const byId = new Map(assignees.map((u) => [u.id, u]))
    return {
      byId,
      handlers: (universityId: string, facultyId: string | null): Recipient[] => {
        const rows = handlers.filter((u) => u.universityId === universityId)
        const deans = facultyId
          ? rows.filter((u) => u.role === Role.DEAN && u.facultyId === facultyId)
          : []
        if (deans.length > 0) return deans
        return rows.filter((u) => UNIVERSITY_STAFF_ROLES.includes(u.role))
      },
    }
  }
}

function groupByRole(recipients: Recipient[]): Map<Role, string[]> {
  const out = new Map<Role, string[]>()
  for (const r of recipients) {
    if (!STAFF_QUEUE_URL[r.role]) continue
    out.set(r.role, [...(out.get(r.role) ?? []), r.id])
  }
  return out
}
